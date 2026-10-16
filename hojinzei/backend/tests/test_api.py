"""API の結合テスト（取込 → 試算表の検証 → 税務調整 → 申告書 → 承認 → 翌期への引継ぎ → 出力）。

DB は既定で一時的な SQLite。TEST_DATABASE_URL を指定すると PostgreSQL でも同じテストを流す。
"""
from __future__ import annotations

import io
import os
from dataclasses import replace
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import load_settings
from app.main import create_app
from app.models import AuditLog, User
from app.security import hash_password

SAMPLES = Path(__file__).resolve().parents[2] / 'samples'
PW = 'test-password-1'


@pytest.fixture()
def app(tmp_path):
    url = os.environ.get('TEST_DATABASE_URL') or f'sqlite:///{tmp_path / "test.db"}'
    settings = replace(load_settings(), database_url=url, data_dir=tmp_path / 'data', env='test', seed_demo=False)
    a = create_app(settings, seed=False)
    a.state.db.drop_all()
    a.state.db.create_all()
    with a.state.db.SessionLocal() as db:
        for email, role in (('admin@t.example', 'admin'), ('rev@t.example', 'reviewer'), ('staff@t.example', 'staff'),
                            ('other@t.example', 'staff')):
            db.add(User(email=email, display_name=email.split('@')[0], role=role, password_hash=hash_password(PW)))
        db.commit()
    yield a
    a.state.db.drop_all()


def login(client: TestClient, email: str) -> dict:
    r = client.post('/api/auth/login', json={'email': email, 'password': PW})
    assert r.status_code == 200, r.text
    return {'Authorization': f'Bearer {r.json()["token"]}'}


@pytest.fixture()
def client(app):
    return TestClient(app)


def upload(client, h, fy, kind, path: Path, content: bytes | None = None, name: str | None = None):
    data = content if content is not None else path.read_bytes()
    r = client.post(f'/api/fiscal-years/{fy}/documents', headers=h, data={'kind': kind},
                    files={'file': (name or path.name, data, 'application/octet-stream')})
    assert r.status_code == 200, r.text
    return r.json()


def confirm(client, h, batch):
    body = {'header_row': batch['detected']['header_row'], 'mapping': batch['mapping']}
    p = client.post(f'/api/imports/{batch["id"]}/preview', headers=h, json=body)
    assert p.status_code == 200, p.text
    r = client.post(f'/api/imports/{batch["id"]}/confirm', headers=h, json=body)
    assert r.status_code == 200, r.text
    return p.json(), r.json()


def setup_minato(client, h):
    """サンプル「みなと企画」を画面と同じ手順で入れる。"""
    c = client.post('/api/companies', headers=h, json={'name': 'テスト みなと企画（架空）', 'head_office_address': '東京都港区芝浦一丁目',
                                                         'fiscal_year_end_month': 9}).json()
    assert c['prefecture'] == '東京都' and c['municipality'] == '港区'
    fy = client.post(f'/api/companies/{c["id"]}/fiscal-years', headers=h,
                     json={'start_date': '2025-10-01', 'end_date': '2026-09-30', 'large_corp_subsidiary': False,
                           'tekiyo_jogai': False, 'dividends': 0}).json()
    d = SAMPLES / 'minato'
    for kind, f in (('trial_balance', '試算表_貸借対照表_2026-09.csv'), ('trial_balance', '試算表_損益計算書_2026-09.csv'),
                    ('journal', '仕訳帳_2025-10_2026-09.csv')):
        res = upload(client, h, fy['id'], kind, d / f)
        assert res['import']['status'] == 'pending'
        confirm(client, h, res['import'])
    fid = fy['id']
    prior = '2024-10-01〜2025-09-30'
    puts = {
        'tax_payments': {'payments': [
            {'tax': 'national', 'period': 'prior', 'label': prior, 'opening_unpaid': 463_200, 'paid_provision': 463_200},
            {'tax': 'prefectural', 'period': 'prior', 'label': prior, 'opening_unpaid': 105_000, 'paid_provision': 105_000},
            {'tax': 'enterprise', 'period': 'prior', 'label': prior, 'opening_unpaid': 180_000, 'paid_provision': 180_000},
            {'tax': 'national', 'period': 'interim', 'paid_expense': 231_600},
            {'tax': 'prefectural', 'period': 'interim', 'accrued': 52_500, 'paid_expense': 52_500},
            {'tax': 'enterprise', 'period': 'interim', 'accrued': 90_000, 'paid_expense': 90_000},
            {'tax': 'other', 'period': 'other', 'label': '延滞税', 'other_kind': 'nondeductible', 'accrued': 12_000,
             'paid_expense': 12_000}],
            'interim_corporate_tax': 210_000, 'interim_local_corporate_tax': 21_600},
        'provision': {'provision_charged': 400_000, 'confirmed': True},
        'local_taxes': {'final_prefectural': 57_100, 'final_municipal': 0, 'final_enterprise': 100_000},
        'withholding': {'items': [{'category': 'interest', 'payer': '架空銀行', 'gross_income': 20_000, 'tax_withheld': 3_063}]},
        'entertainment': {'rows': [{'account': '交際費', 'spent': 1_500_000, 'excluded': 0, 'food': 900_000}],
                          'reviewed_small_meals': True},
        'opening_meta': {'losses_confirmed': True, 'prior_retained_total': 8_271_800, 'prior_unpaid_national': 463_200},
    }
    for sec, body in puts.items():
        r = client.put(f'/api/fiscal-years/{fid}/inputs/{sec}', headers=h, json=body)
        assert r.status_code == 200, (sec, r.text)
    for body in ({'kind': 'retained', 'key': 'depreciation_excess', 'name': '減価償却超過額', 'amount': 150_000, 'confirmed': True},
                 {'kind': 'loss', 'name': '欠損金', 'amount': 500_000, 'loss_fy_start': '2021-10-01', 'loss_fy_end': '2022-09-30',
                  'confirmed': True}):
        assert client.post(f'/api/fiscal-years/{fid}/carryforward', headers=h, json=body).status_code == 200
    r = client.post(f'/api/fiscal-years/{fid}/adjustments', headers=h, json={
        'kind': 'depreciation_reversal', 'name': '減価償却超過額の当期認容額', 'line': '12', 'direction': 'deduct',
        'disposition': 'ryuho', 'amount': 50_000, 'five1_key': 'depreciation_excess', 'five1_name': '減価償却超過額',
        'five1_column': 'decrease', 'reason': 'テスト'})
    assert r.status_code == 200, r.text
    client.post(f'/api/adjustments/{r.json()["id"]}/confirm', headers=h, json={'confirmed': True})
    return c, fid


def test_full_flow(client):
    h = login(client, 'staff@t.example')
    c, fid = setup_minato(client, h)

    tb = client.get(f'/api/fiscal-years/{fid}/trial-balance', headers=h).json()
    assert tb['has_bs'] and tb['has_pl']
    assert tb['totals']['net_income'] == 3_806_837
    assert tb['re_includes_current_profit'] is False
    assert not [f for f in tb['findings'] if f['severity'] == 'critical'], tb['findings']
    assert any(r['tax_flag'] for r in tb['rows'] if r['name'] == '交際費')
    # 科目を押すと仕訳
    acc = next(r for r in tb['rows'] if r['name'] == '役員報酬')
    j = client.get(f'/api/accounts/{acc["account_id"]}/journal', headers=h).json()
    assert j['count'] == 12

    # 候補の抽出：役員報酬の月額の変動（要確認）、減価償却（資料不足）
    assert client.post(f'/api/fiscal-years/{fid}/suggestions/refresh', headers=h).json()['added'] == 2
    adjs = client.get(f'/api/fiscal-years/{fid}/adjustments', headers=h).json()['adjustments']
    by_key = {a['suggestion_key']: a for a in adjs if a['suggestion_key']}
    assert by_key['officer_compensation']['status'] == 'review'
    assert by_key['officer_compensation']['evidence'][0]['months']['2026-04'] == 550_000
    assert by_key['depreciation']['status'] == 'missing'

    ret = client.get(f'/api/fiscal-years/{fid}/return', headers=h).json()
    s = ret['summary']
    # 手計算：所得 4,276,000 − 繰越欠損金 500,000 ＝ 3,776,000
    assert (s['income'], s['loss_deduction']) == (3_776_000, 500_000)
    # 3,776,000 × 15% ＝ 566,400 − 所得税額控除 3,063 ＝ 563,337 → 563,300、中間 210,000 → 353,300
    assert (s['corporate_tax'], s['corporate_final']) == (563_300, 353_300)
    # 地方法人税：566,000 × 10.3% ＝ 58,298 → 58,200 − 中間 21,600 ＝ 36,600
    assert s['local_corporate_final'] == 36_600
    assert s['defense_applicable'] is False
    assert ret['cells']['b5_1:check:value']['value'] == 0
    assert ret['cells']['b4:5:total']['value'] == 12_000  # 延滞税
    assert s['recommended_tax_provision'] == 353_300 + 36_600 + 57_100 + 0 + 100_000

    # レビュー担当者を指定すると、その人もこの会社を見られるようになる
    rv = login(client, 'rev@t.example')
    assert client.get(f'/api/fiscal-years/{fid}', headers=rv).status_code == 404
    rev_id = client.get('/api/auth/me', headers=rv).json()['id']
    assert client.patch(f'/api/fiscal-years/{fid}', headers=h, json={'reviewer_id': rev_id}).status_code == 200
    # 重大エラー（未判断の資料不足の候補）があると承認できない
    assert client.post(f'/api/fiscal-years/{fid}/approve', headers=h, json={}).status_code == 403  # 担当者は不可
    r = client.post(f'/api/fiscal-years/{fid}/approve', headers=rv, json={})
    assert r.status_code == 409 and '重大エラー' in r.json()['detail']['message']

    # 候補の判断：減価償却は「調整不要」（理由必須）、役員給与は採用して金額を入れる
    assert client.post(f'/api/adjustments/{by_key["depreciation"]["id"]}/decision', headers=h,
                       json={'decision': 'dismissed'}).status_code == 422
    assert client.post(f'/api/adjustments/{by_key["depreciation"]["id"]}/decision', headers=h,
                       json={'decision': 'dismissed', 'dismiss_reason': '固定資産台帳で償却限度額以内を確認'}).status_code == 200
    oc = by_key['officer_compensation']['id']
    assert client.post(f'/api/adjustments/{oc}/decision', headers=h, json={'decision': 'adopted'}).status_code == 200
    ret = client.get(f'/api/fiscal-years/{fid}/return', headers=h).json()
    assert any(f['code'] == 'B4_ADJ_AMOUNT_UNKNOWN' for f in ret['findings'])  # 金額未確定は重大エラー
    assert ret['summary']['income'] is None
    assert client.patch(f'/api/adjustments/{oc}', headers=h, json={'amount': 300_000, 'status': 'review',
                                                                   'reason': '4月改定は通常改定に当たらず増額分は損金不算入'}).status_code == 200
    assert client.post(f'/api/adjustments/{oc}/confirm', headers=h, json={'confirmed': True}).status_code == 200
    ret = client.get(f'/api/fiscal-years/{fid}/return', headers=h).json()
    assert ret['summary']['income'] == 4_076_000
    assert ret['counts']['critical'] == 0, [f['title'] for f in ret['findings'] if f['severity'] == 'critical']

    # 要確認は確認済みにできる、重大エラーはできない
    w = next(f for f in ret['findings'] if f['severity'] == 'warning')
    assert client.post(f'/api/fiscal-years/{fid}/acks', headers=h, json={'fingerprint': w['fingerprint'], 'code': w['code'],
                                                                         'note': '確認した'}).status_code == 200

    # 上書き（理由必須・履歴）
    assert client.post(f'/api/fiscal-years/{fid}/overrides', headers=h, json={'cell_key': 'b1:14:value', 'value': 1,
                                                                              'reason': ''}).status_code == 422
    r = client.post(f'/api/fiscal-years/{fid}/overrides', headers=h, json={'cell_key': 'b1:14:value', 'value': 200_000,
                                                                           'reason': '中間申告書の控えで確認'})
    oid = r.json()['id']
    ret = client.get(f'/api/fiscal-years/{fid}/return', headers=h).json()
    assert ret['cells']['b1:14:value']['source'] == 'override'
    assert client.delete(f'/api/overrides/{oid}', headers=h).status_code == 200
    ovs = client.get(f'/api/fiscal-years/{fid}/overrides', headers=h).json()
    assert len(ovs) == 1 and ovs[0]['active'] is False

    # 出力
    x = client.get(f'/api/fiscal-years/{fid}/export.xlsx', headers=h)
    assert x.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(x.content))
    assert {'概要', '別表四', '別表一', '計算根拠', '指摘', '使用したルール'} <= set(wb.sheetnames)
    assert 'ドラフト' in wb['概要']['A1'].value
    csv_text = client.get(f'/api/fiscal-years/{fid}/export.csv', headers=h).content.decode('utf-8-sig')
    assert 'b4:52:total' in csv_text

    # 承認 → 承認済は変更できない → 翌期への引継ぎ
    r = client.post(f'/api/fiscal-years/{fid}/approve', headers=rv, json={'note': 'レビュー済み'})
    assert r.status_code == 200, r.text
    assert client.post(f'/api/fiscal-years/{fid}/adjustments', headers=h, json={
        'name': 'x', 'line': '10', 'direction': 'add', 'disposition': 'sonota', 'amount': 1}).status_code == 409
    nxt = client.post(f'/api/fiscal-years/{fid}/next-year', headers=h)
    assert nxt.status_code == 200, nxt.text
    nid = nxt.json()['id']
    assert (nxt.json()['start_date'], nxt.json()['end_date']) == ('2026-10-01', '2027-09-30')
    carry = client.get(f'/api/fiscal-years/{nid}/carryforward', headers=h).json()
    retained = {c['key']: c['amount'] for c in carry if c['kind'] == 'retained'}
    assert retained == {'depreciation_excess': 100_000}
    assert not [c for c in carry if c['kind'] == 'loss']  # 欠損金は使い切った
    inputs = client.get(f'/api/fiscal-years/{nid}/inputs', headers=h).json()['sections']
    pays = {(p['tax'], p['period']): p['opening_unpaid'] for p in inputs['tax_payments']['payments']}
    cf = client.get(f'/api/fiscal-years/{fid}/return', headers=h).json()['carryforward']
    assert pays[('national', 'prior')] == cf['unpaid']['national']
    assert pays[('prefectural', 'prior')] == 57_100
    assert pays[('enterprise', 'prior')] == 100_000
    assert inputs['opening_meta']['prior_retained_total'] == cf['retained_total']


def test_permissions_and_audit(client, app):
    h = login(client, 'staff@t.example')
    other = login(client, 'other@t.example')
    c = client.post('/api/companies', headers=h, json={'name': '秘密の会社（架空）'}).json()
    # 担当でない利用者には見えない（存在も知らせない）
    assert client.get(f'/api/companies/{c["id"]}', headers=other).status_code == 404
    assert all(x['id'] != c['id'] for x in client.get('/api/companies', headers=other).json())
    # ログインなし
    assert client.get('/api/companies').status_code == 401
    # 管理者だけが削除できる
    assert client.delete(f'/api/companies/{c["id"]}', headers=h).status_code == 403
    admin = login(client, 'admin@t.example')
    assert client.delete(f'/api/companies/{c["id"]}', headers=admin).status_code == 200
    # 監査ログに会社名・金額は残さない
    with app.state.db.SessionLocal() as db:
        logs = list(db.scalars(select(AuditLog)))
        assert any(l.action == 'company_delete' for l in logs)
        assert not any('秘密' in str(l.detail) for l in logs)
    assert client.get('/api/audit', headers=h).status_code == 403
    assert client.get('/api/audit', headers=admin).status_code == 200


def test_corporate_number_validation(client):
    h = login(client, 'staff@t.example')
    assert client.post('/api/companies', headers=h, json={'name': 'x', 'corporate_number': '1234567890123'}).status_code == 422
    assert client.post('/api/tools/corporate-number', headers=h, json={'number': '7000012050002'}).json()['ok'] is True


def test_import_rejects_unbalanced_tb_and_maps_other_headers(client):
    h = login(client, 'staff@t.example')
    c = client.post('/api/companies', headers=h, json={'name': 'テスト（架空）'}).json()
    fy = client.post(f'/api/companies/{c["id"]}/fiscal-years', headers=h,
                     json={'start_date': '2026-04-01', 'end_date': '2027-03-31'}).json()
    # 列の並び・名前が違う CSV（Shift_JIS）。残高が増減と合わない科目と、分類できない科目を含む
    text = ('科目名,前期繰越,借方発生,貸方発生,残高\n'
            '普通預金,100,50,0,999\n'
            '売上,0,0,50,50\n'
            '謎の科目,0,10,0,10\n'
            '資本金,100,0,0,100\n')
    res = upload(client, h, fy['id'], 'trial_balance', Path('tb.csv'), text.encode('cp932'), 'tb.csv')
    b = res['import']
    assert b['detected']['file']['encoding'].startswith('Shift_JIS')
    assert set(b['mapping']) >= {'account_name', 'opening', 'debit', 'credit', 'closing'}
    preview, _ = confirm(client, h, b)
    assert preview['unknown'] == 1
    tb = client.get(f'/api/fiscal-years/{fy["id"]}/trial-balance', headers=h).json()
    codes = {f['code'] for f in tb['findings']}
    assert {'TB_UNCLASSIFIED', 'TB_ROW_MOVEMENT'} <= codes
    # 分類を直す
    acc = next(r for r in tb['rows'] if r['name'] == '謎の科目')
    assert client.patch(f'/api/accounts/{acc["account_id"]}', headers=h, json={'category': 'other_expense'}).status_code == 200
    tb = client.get(f'/api/fiscal-years/{fy["id"]}/trial-balance', headers=h).json()
    assert 'TB_UNCLASSIFIED' not in {f['code'] for f in tb['findings']}


def test_excel_import_and_short_year_defense_tax(client):
    h = login(client, 'staff@t.example')
    c = client.post('/api/companies', headers=h, json={'name': 'さくら（架空）', 'corp_kind': 'godo'}).json()
    fy = client.post(f'/api/companies/{c["id"]}/fiscal-years', headers=h,
                     json={'start_date': '2026-04-01', 'end_date': '2026-09-30', 'large_corp_subsidiary': False,
                           'tekiyo_jogai': False}).json()
    d = SAMPLES / 'sakura'
    res = upload(client, h, fy['id'], 'trial_balance', d / '残高試算表_2026-09.xlsx')
    assert res['import']['detected']['header_row'] == 2
    confirm(client, h, res['import'])
    res = upload(client, h, fy['id'], 'journal', d / '仕訳帳_2026-04_2026-09_sjis.csv')
    confirm(client, h, res['import'])
    fyd = client.get(f'/api/fiscal-years/{fy["id"]}', headers=h).json()
    assert fyd['capital_end'] == 3_000_000  # 試算表の資本金を候補として設定
    for sec, body in (('provision', {'provision_charged': 0}), ('local_taxes', {'final_prefectural': 0, 'final_municipal': 0}),
                      ('opening_meta', {'losses_confirmed': True, 'first_year': True})):
        client.put(f'/api/fiscal-years/{fy["id"]}/inputs/{sec}', headers=h, json=body)
    ret = client.get(f'/api/fiscal-years/{fy["id"]}/return', headers=h).json()
    s = ret['summary']
    assert ret['months'] == 6
    # 所得 15,000,000：400万×15%＋1,100万×23.2% ＝ 600,000＋2,552,000 ＝ 3,152,000
    assert s['corporate_final'] == 3_152_000
    # 地方法人税 3,152,000 × 10.3% ＝ 324,656 → 324,600
    assert s['local_corporate_final'] == 324_600
    # 防衛特別法人税 (3,152,000 − 500万×6/12) ＝ 652,000 × 4% ＝ 26,080 → 26,000
    assert s['defense_applicable'] and s['defense_final'] == 26_000
    assert ret['cells']['b5_1:check:value']['value'] == 0


def test_input_validation(client):
    h = login(client, 'staff@t.example')
    c = client.post('/api/companies', headers=h, json={'name': 'x（架空）'}).json()
    fy = client.post(f'/api/companies/{c["id"]}/fiscal-years', headers=h,
                     json={'start_date': '2026-04-01', 'end_date': '2027-03-31'}).json()
    assert client.put(f'/api/fiscal-years/{fy["id"]}/inputs/withholding', headers=h,
                      json={'items': [{'category': 'bad', 'payer': 'x'}]}).status_code == 422
    assert client.put(f'/api/fiscal-years/{fy["id"]}/inputs/nope', headers=h, json={}).status_code == 404
    # 別表四の行と処分の組合せ
    bad = {'name': 'x', 'line': '7', 'direction': 'add', 'disposition': 'ryuho', 'amount': 1}
    assert client.post(f'/api/fiscal-years/{fy["id"]}/adjustments', headers=h, json=bad).status_code == 422
    bad = {'name': 'x', 'line': '4', 'direction': 'add', 'disposition': 'ryuho', 'amount': 1}
    assert client.post(f'/api/fiscal-years/{fy["id"]}/adjustments', headers=h, json=bad).status_code == 422
    # 1年を超える事業年度
    assert client.post(f'/api/companies/{c["id"]}/fiscal-years', headers=h,
                       json={'start_date': '2027-04-01', 'end_date': '2028-04-30'}).status_code == 422
    # 試算表なし → 重大エラー（資料不足）、0円で埋めない
    ret = client.get(f'/api/fiscal-years/{fy["id"]}/return', headers=h).json()
    assert 'TB_MISSING' in {f['code'] for f in ret['findings'] if f['severity'] == 'critical'}
    assert ret['summary']['income'] is None


def test_demo_seed_loads(tmp_path):
    url = os.environ.get('TEST_DATABASE_URL') or f'sqlite:///{tmp_path / "seed.db"}'
    settings = replace(load_settings(), database_url=url, data_dir=tmp_path / 'data', env='test', seed_demo=True)
    a = create_app(settings, seed=False)
    a.state.db.drop_all()
    a = create_app(settings, seed=True)
    cl = TestClient(a)
    r = cl.post('/api/auth/login', json={'email': 'staff@example.com', 'password': 'demo-pass-2026'})
    h = {'Authorization': f'Bearer {r.json()["token"]}'}
    companies = cl.get('/api/companies', headers=h).json()
    assert len(companies) == 3
    minato = next(c for c in companies if 'みなと' in c['name'])
    ret = cl.get(f'/api/fiscal-years/{minato["current_year"]["id"]}/return', headers=h).json()
    assert ret['summary']['income'] == 3_776_000
    assert ret['summary']['corporate_final'] == 353_300
    a.state.db.drop_all()
