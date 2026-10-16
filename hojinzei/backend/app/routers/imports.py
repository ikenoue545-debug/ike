"""資料のアップロードと、試算表・仕訳帳の取込（列マッピングの確認 → 取込）。"""
from __future__ import annotations

import hashlib
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import audit
from ..models import Account, Document, FiscalYear, ImportBatch, JournalLine, TrialBalanceLine, User
from ..security import current_user, get_db, get_fy_for
from ..services import importer
from ..services.accounts_master import classify, normalize
from ..services.documents import DOC_KINDS
from ..services.import_apply import apply_journal, apply_trial_balance
from ..services.workflow import advance_on
from .common import iso

router = APIRouter()
IMPORTABLE = {'trial_balance', 'journal'}
ALLOWED_EXT = {'.csv', '.txt', '.tsv', '.xlsx', '.xlsm', '.pdf', '.png', '.jpg', '.jpeg', '.xls'}


def _doc_dict(d: Document) -> dict:
    return {'id': d.id, 'fiscal_year_id': d.fiscal_year_id, 'kind': d.kind, 'kind_label': DOC_KINDS.get(d.kind, d.kind),
            'filename': d.filename, 'content_type': d.content_type, 'size': d.size, 'sha256': d.sha256,
            'uploaded_by': d.uploaded_by, 'uploaded_at': iso(d.uploaded_at)}


def _batch_dict(b: ImportBatch) -> dict:
    return {'id': b.id, 'fiscal_year_id': b.fiscal_year_id, 'document_id': b.document_id, 'kind': b.kind, 'status': b.status,
            'detected': b.detected, 'mapping': b.mapping, 'row_count': b.row_count, 'error': b.error,
            'created_at': iso(b.created_at), 'imported_at': iso(b.imported_at)}


def _safe_name(name: str) -> str:
    name = Path(name or 'file').name
    return re.sub(r'[^\w.\-（）()ぁ-んァ-ヶ一-龠ー]', '_', name)[:150] or 'file'


def _read_doc(request: Request, d: Document) -> bytes:
    return (request.app.state.settings.data_dir / d.storage_path).read_bytes()


@router.get('/fiscal-years/{fid}/documents')
def list_documents(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    docs = db.scalars(select(Document).where(Document.fiscal_year_id == fy.id).order_by(Document.uploaded_at.desc()))
    batches = db.scalars(select(ImportBatch).where(ImportBatch.fiscal_year_id == fy.id).order_by(ImportBatch.created_at.desc()))
    return {'documents': [_doc_dict(d) for d in docs], 'imports': [_batch_dict(b) for b in batches]}


@router.post('/fiscal-years/{fid}/documents')
async def upload_document(fid: int, request: Request, kind: str = Form(...), file: UploadFile = File(...),
                          user: User = Depends(current_user), db: Session = Depends(get_db)):
    fy = get_fy_for(db, user, fid)
    if kind not in DOC_KINDS:
        raise HTTPException(422, '資料の種類が不正です')
    settings = request.app.state.settings
    raw = await file.read()
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f'ファイルが大きすぎます（上限 {settings.max_upload_mb}MB）')
    if not raw:
        raise HTTPException(422, '空のファイルです')
    fname = _safe_name(file.filename)
    ext = Path(fname).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(422, f'この形式は受け付けていません（{", ".join(sorted(ALLOWED_EXT))}）')
    digest = hashlib.sha256(raw).hexdigest()
    rel = Path('files') / f'company-{fy.company_id}' / f'fy-{fy.id}' / f'{digest[:12]}-{fname}'
    path = settings.data_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    doc = Document(fiscal_year_id=fy.id, kind=kind, filename=fname,
                   content_type=file.content_type or mimetypes.guess_type(fname)[0], size=len(raw), sha256=digest,
                   storage_path=str(rel), uploaded_by=user.id)
    db.add(doc)
    db.flush()
    batch = None
    if kind in IMPORTABLE and ext in ('.csv', '.txt', '.tsv', '.xlsx', '.xlsm', '.xls'):
        batch = ImportBatch(fiscal_year_id=fy.id, document_id=doc.id, kind=kind, created_by=user.id)
        try:
            rows, info = importer.read_table(fname, raw)
            det = importer.detect(kind, rows)
            batch.detected = {**det, 'file': info}
            batch.mapping = det['mapping']
        except importer.ImportErrorJa as e:
            batch.status, batch.error = 'error', str(e)
        db.add(batch)
    fy.status = advance_on(fy.status, 'document')
    audit.log(db, user, 'document_upload', 'document', doc.id, company_id=fy.company_id, fiscal_year_id=fy.id, kind=kind,
              size=len(raw), sha256=digest)
    db.commit()
    return {'document': _doc_dict(doc), 'import': _batch_dict(batch) if batch else None}


@router.get('/documents/{did}/download')
def download_document(did: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(Document, did)
    if d is None:
        raise HTTPException(404, '資料が見つかりません')
    get_fy_for(db, user, d.fiscal_year_id)
    audit.log(db, user, 'document_download', 'document', d.id, fiscal_year_id=d.fiscal_year_id)
    db.commit()
    return FileResponse(request.app.state.settings.data_dir / d.storage_path, filename=d.filename,
                        media_type=d.content_type or 'application/octet-stream')


@router.delete('/documents/{did}')
def delete_document(did: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(Document, did)
    if d is None:
        raise HTTPException(404, '資料が見つかりません')
    fy = get_fy_for(db, user, d.fiscal_year_id)
    path = request.app.state.settings.data_dir / d.storage_path
    db.delete(d)
    audit.log(db, user, 'document_delete', 'document', did, company_id=fy.company_id, fiscal_year_id=fy.id)
    db.commit()
    path.unlink(missing_ok=True)
    return {'ok': True}


def _batch_for(db: Session, user: User, bid: int) -> tuple[ImportBatch, FiscalYear]:
    b = db.get(ImportBatch, bid)
    if b is None:
        raise HTTPException(404, '取込が見つかりません')
    return b, get_fy_for(db, user, b.fiscal_year_id)


class MappingIn(BaseModel):
    header_row: Optional[int] = None
    mapping: dict[str, Optional[int]]
    sheet: Optional[str] = None


def _parse(request: Request, db: Session, b: ImportBatch, body: MappingIn) -> tuple[dict, dict, int]:
    doc = db.get(Document, b.document_id)
    if doc is None:
        raise HTTPException(409, '元のファイルが削除されています')
    rows, _ = importer.read_table(doc.filename, _read_doc(request, doc), body.sheet)
    mapping = {k: v for k, v in body.mapping.items() if v is not None}
    header_row = body.header_row if body.header_row is not None else b.detected.get('header_row', 0)
    fields = importer.FIELDS[b.kind]
    missing = [fields[f]['label'] for f, d in fields.items() if d['required'] and f not in mapping]
    if missing:
        raise HTTPException(422, f'必須の列が選ばれていません：{"・".join(missing)}')
    if b.kind == 'trial_balance':
        parsed = importer.parse_trial_balance(rows, header_row, mapping)
    else:
        parsed = importer.parse_journal(rows, header_row, mapping)
    return parsed, mapping, header_row


@router.get('/imports/{bid}')
def get_import(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b, _ = _batch_for(db, user, bid)
    return _batch_dict(b)


@router.post('/imports/{bid}/preview')
def preview_import(bid: int, body: MappingIn, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    b, fy = _batch_for(db, user, bid)
    try:
        parsed, mapping, header_row = _parse(request, db, b, body)
    except importer.ImportErrorJa as e:
        raise HTTPException(422, str(e)) from e
    if b.kind == 'trial_balance':
        accs = []
        for a in parsed['accounts']:
            cls = classify(a['name'], a['heading'])
            accs.append({**a, **cls})
        stmts = {a['statement'] for a in accs if a['statement']}
        return {'kind': b.kind, 'accounts': accs, 'skipped': parsed['skipped'], 'errors': parsed['errors'],
                'statements': sorted(stmts), 'unknown': sum(1 for a in accs if a['classification'] == 'unknown')}
    lines = parsed['lines']
    return {'kind': b.kind, 'count': len(lines), 'sample': [{**l, 'entry_date': iso(l['entry_date'])} for l in lines[:20]],
            'errors': parsed['errors'][:50],
            'period': [iso(min((l['entry_date'] for l in lines if l['entry_date']), default=None)),
                       iso(max((l['entry_date'] for l in lines if l['entry_date']), default=None))]}


@router.post('/imports/{bid}/confirm')
def confirm_import(bid: int, body: MappingIn, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    b, fy = _batch_for(db, user, bid)
    if fy.status in ('approved', 'filed'):
        raise HTTPException(409, '承認済の年度には取り込めません')
    if b.status == 'imported':
        raise HTTPException(409, 'この取込はすでに反映しています')
    try:
        parsed, mapping, header_row = _parse(request, db, b, body)
    except importer.ImportErrorJa as e:
        raise HTTPException(422, str(e)) from e
    if b.kind == 'trial_balance':
        n = apply_trial_balance(db, fy, b.id, parsed)
    else:
        n = apply_journal(db, fy, b.id, parsed)
    b.status, b.mapping, b.row_count = 'imported', mapping, n
    b.detected = {**b.detected, 'header_row': header_row, 'skipped': parsed.get('skipped', []), 'errors': parsed.get('errors', [])}
    b.imported_at = datetime.now(timezone.utc)
    # 取り込み直した古い取込は「置き換え済み」にする
    for old in db.scalars(select(ImportBatch).where(ImportBatch.fiscal_year_id == fy.id, ImportBatch.kind == b.kind,
                                                    ImportBatch.status == 'imported', ImportBatch.id != b.id)):
        if b.kind == 'journal':
            old.status = 'replaced'
    fy.status = advance_on(fy.status, 'import')
    audit.log(db, user, 'import_confirm', 'import_batch', b.id, company_id=fy.company_id, fiscal_year_id=fy.id, kind=b.kind,
              rows=n)
    db.commit()
    return _batch_dict(b)


@router.post('/imports/{bid}/discard')
def discard_import(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b, fy = _batch_for(db, user, bid)
    if b.status == 'imported':
        raise HTTPException(409, '反映済みの取込は破棄できません。取り込み直してください')
    b.status = 'discarded'
    audit.log(db, user, 'import_discard', 'import_batch', b.id, fiscal_year_id=fy.id)
    db.commit()
    return _batch_dict(b)
