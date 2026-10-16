"use client";

import { useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, Drawer, ErrorBox, Field, Notice, Select, Spinner, useToast } from "@/components/ui";
import { PageFindings, PageTitle, useYear } from "@/components/year";
import { api, download, useApi } from "@/lib/api";
import { dateTimeJa, yen } from "@/lib/format";

type Doc = { id: number; kind: string; kind_label: string; filename: string; size: number; sha256: string; uploaded_at: string };
type Batch = {
  id: number;
  document_id: number | null;
  kind: "trial_balance" | "journal";
  status: string;
  detected: {
    header_row: number;
    header: string[];
    mapping: Record<string, number>;
    missing_required: string[];
    fields: { key: string; label: string; required: boolean }[];
    sample: string[][];
    total_rows: number;
    file?: { format: string; encoding?: string | null; sheet?: string };
    skipped?: { row: number; label: string; reason: string }[];
    errors?: { row: number; message: string }[];
  };
  mapping: Record<string, number>;
  row_count: number | null;
  error: string | null;
  created_at: string;
  imported_at: string | null;
};
type DocsResp = { documents: Doc[]; imports: Batch[] };

const STATUS: Record<string, [string, string]> = {
  ok: ["そろっている", "bg-emerald-50 text-emerald-700 ring-emerald-600/20"],
  missing: ["不足", "bg-rose-50 text-rose-700 ring-rose-600/20"],
  recommended: ["あると良い", "bg-amber-50 text-amber-800 ring-amber-600/20"],
  not_needed: ["不要", "bg-slate-100 text-slate-500 ring-slate-500/20"],
};
const BATCH: Record<string, string> = { pending: "列の確認待ち", imported: "取込済", discarded: "破棄", error: "読めません", replaced: "置き換え済み" };

export default function DocumentsPage() {
  const { fid, ret, reloadReturn, reloadFy, locked } = useYear();
  const { meta } = useApp();
  const docs = useApi<DocsResp>(`/fiscal-years/${fid}/documents`);
  const [kind, setKind] = useState("trial_balance");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Batch | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, toastNode } = useToast();

  async function upload(files: FileList | null, k = kind) {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    try {
      let lastBatch: Batch | null = null;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("kind", k);
        fd.append("file", file);
        const r = await api<{ import: Batch | null }>(`/fiscal-years/${fid}/documents`, { method: "POST", body: fd });
        if (r.import) lastBatch = r.import;
      }
      toast("アップロードしました");
      await docs.reload();
      await reloadFy();
      if (lastBatch && lastBatch.status === "pending") setMapping(lastBatch);
      await reloadReturn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeDoc(d: Doc) {
    if (!window.confirm(`「${d.filename}」を削除します。取り込んだ数値は残ります。`)) return;
    await api(`/documents/${d.id}`, { method: "DELETE" });
    await docs.reload();
    await reloadReturn();
  }

  return (
    <div className="space-y-4">
      {toastNode}
      <PageTitle
        title="資料"
        help="必要な資料をそろえます。試算表・仕訳帳は CSV か Excel を取り込み、列の対応を確認してから反映します。そのほかの資料（前期の申告書 PDF など）は保存して、作業の根拠として残します。"
      />
      <PageFindings page="documents" />
      <Card title="必要な資料のチェックリスト">
        {!ret ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">資料</th>
                  <th className="py-2 pr-3">状態</th>
                  <th className="py-2 pr-3">使い道</th>
                  <th className="py-2 pr-3">出し方</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ret.documents.map((d) => (
                  <tr key={d.kind} id={d.kind}>
                    <td className="py-2 pr-3 font-medium">{d.label}</td>
                    <td className="py-2 pr-3">
                      <Badge className={STATUS[d.status][1]}>{STATUS[d.status][0]}</Badge>
                      {d.uploaded > 0 && <span className="ml-1 text-xs text-slate-500">{d.uploaded}件</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{d.need_reason}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{d.how}</td>
                    <td className="py-2 text-right">
                      {!locked && d.status !== "not_needed" && (
                        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                          アップロード
                          <input type="file" className="hidden" multiple onChange={(e) => upload(e.target.files, d.kind)} />
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {!locked && (
        <Card title="ファイルをアップロード">
          <div
            className="flex flex-wrap items-end gap-3 rounded-md border-2 border-dashed border-slate-300 p-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            <Field label="資料の種類">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(meta.doc_kinds).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <input ref={fileRef} type="file" multiple onChange={(e) => upload(e.target.files)} className="text-sm" disabled={busy} />
            <span className="text-xs text-slate-500">ここにドラッグしても追加できます。CSV（UTF-8・Shift_JIS）、Excel（.xlsx）、PDF、画像。上限 20MB。</span>
          </div>
          <div className="mt-2 space-y-2">
            <ErrorBox message={err} />
            <Notice>
              PDF・画像の読み取り（前期申告書の数値の抽出・OCR）は Phase 3 で実装予定です。現在は保存だけで、期首の金額は「期首情報」で入力します。
            </Notice>
          </div>
        </Card>
      )}
      <Card title="取込（試算表・仕訳帳）">
        {!docs.data ? (
          <Spinner />
        ) : docs.data.imports.length === 0 ? (
          <p className="text-sm text-slate-500">まだ取り込んでいません。</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3">日時</th>
                <th className="py-2 pr-3">種類</th>
                <th className="py-2 pr-3">ファイル</th>
                <th className="py-2 pr-3">状態</th>
                <th className="py-2 pr-3">行数</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.data.imports.map((b) => {
                const doc = docs.data!.documents.find((d) => d.id === b.document_id);
                return (
                  <tr key={b.id}>
                    <td className="py-2 pr-3 text-slate-500">{dateTimeJa(b.created_at)}</td>
                    <td className="py-2 pr-3">{b.kind === "trial_balance" ? "試算表" : "仕訳帳"}</td>
                    <td className="py-2 pr-3">{doc?.filename ?? "（削除済み）"}</td>
                    <td className="py-2 pr-3">
                      <Badge className={b.status === "imported" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : b.status === "pending" ? "bg-amber-50 text-amber-800 ring-amber-600/20" : undefined}>
                        {BATCH[b.status] ?? b.status}
                      </Badge>
                      {b.error && <div className="text-xs text-rose-600">{b.error}</div>}
                    </td>
                    <td className="py-2 pr-3 num">{b.row_count ?? "—"}</td>
                    <td className="py-2 text-right">
                      {b.status === "pending" && !locked && (
                        <Button size="sm" variant="primary" onClick={() => setMapping(b)}>
                          列の対応を確認して取り込む
                        </Button>
                      )}
                      {b.status === "imported" && (
                        <Button size="sm" variant="ghost" onClick={() => setMapping(b)}>
                          取込の内容
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="保存している資料">
        {!docs.data ? (
          <Spinner />
        ) : docs.data.documents.length === 0 ? (
          <p className="text-sm text-slate-500">まだありません。</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3">ファイル</th>
                <th className="py-2 pr-3">種類</th>
                <th className="py-2 pr-3">大きさ</th>
                <th className="py-2 pr-3">アップロード日時</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.data.documents.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-3">
                    {d.filename}
                    <div className="font-mono text-[10px] text-slate-400" title="SHA-256">
                      {d.sha256.slice(0, 16)}…
                    </div>
                  </td>
                  <td className="py-2 pr-3">{d.kind_label}</td>
                  <td className="py-2 pr-3 num">{(d.size / 1024).toFixed(1)} KB</td>
                  <td className="py-2 pr-3 text-slate-500">{dateTimeJa(d.uploaded_at)}</td>
                  <td className="space-x-1 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => download(`/documents/${d.id}/download`, d.filename)}>
                      ダウンロード
                    </Button>
                    {!locked && (
                      <Button size="sm" variant="ghost" onClick={() => removeDoc(d)}>
                        削除
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {mapping && (
        <MappingDrawer
          batch={mapping}
          onClose={() => setMapping(null)}
          onDone={async () => {
            setMapping(null);
            toast("取り込みました。再計算しています");
            await docs.reload();
            await reloadFy();
            await reloadReturn();
          }}
        />
      )}
    </div>
  );
}

type Preview = {
  kind: string;
  accounts?: { row: number; name: string; heading: string | null; opening: number | null; debit: number | null; credit: number | null; closing: number | null; section: string | null; category: string | null; classification: string }[];
  skipped?: { row: number; label: string; reason: string }[];
  errors?: { row: number; message: string }[];
  statements?: string[];
  unknown?: number;
  count?: number;
  period?: [string | null, string | null];
  sample?: { entry_date: string; account_name: string; side: string; amount: number; memo: string | null }[];
};

const SECTION: Record<string, string> = { asset: "資産", liability: "負債", equity: "純資産", revenue: "収益", expense: "費用" };

function MappingDrawer({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: () => Promise<void> }) {
  const det = batch.detected;
  const [headerRow, setHeaderRow] = useState(det.header_row);
  const [map, setMap] = useState<Record<string, number | null>>({ ...batch.mapping });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imported = batch.status === "imported";
  const header = det.header ?? [];

  async function doPreview() {
    setErr(null);
    setBusy(true);
    try {
      setPreview(await api<Preview>(`/imports/${batch.id}/preview`, { method: "POST", json: { header_row: headerRow, mapping: map } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setErr(null);
    setBusy(true);
    try {
      await api(`/imports/${batch.id}/confirm`, { method: "POST", json: { header_row: headerRow, mapping: map } });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={`${batch.kind === "trial_balance" ? "試算表" : "仕訳帳"}の取込`} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          見出しの語から列の対応を推定しました。違っていたら直してください。{det.file?.format === "CSV" ? `文字コード：${det.file?.encoding}` : `Excel：${det.file?.sheet ?? ""}`}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="見出しの行（0始まり）">
            <input type="number" min={0} className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" value={headerRow} disabled={imported} onChange={(e) => setHeaderRow(Number(e.target.value))} />
          </Field>
          {det.fields.map((fd) => (
            <Field key={fd.key} label={`${fd.label}${fd.required ? "（必須）" : ""}`}>
              <Select
                value={map[fd.key] ?? ""}
                disabled={imported}
                onChange={(e) => setMap({ ...map, [fd.key]: e.target.value === "" ? null : Number(e.target.value) })}
              >
                <option value="">（使わない）</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    {i + 1}列目：{h || "（見出しなし）"}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-500">ファイルの先頭（見出しの次から10行）</div>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {header.map((h, i) => (
                    <th key={i} className="whitespace-nowrap border-b px-2 py-1 text-left">
                      {i + 1}：{h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {det.sample.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {r.map((c, j) => (
                      <td key={j} className="whitespace-nowrap px-2 py-1">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {imported && (
          <Notice tone="success">
            取込済み（{batch.row_count}件）。読み飛ばした行：{det.skipped?.length ?? 0}件、読めなかった行：{det.errors?.length ?? 0}件。
          </Notice>
        )}
        {!imported && (
          <div className="flex gap-2">
            <Button onClick={doPreview} disabled={busy}>
              読み取り結果を確認
            </Button>
            <Button variant="primary" onClick={confirm} disabled={busy || !preview}>
              この内容で取り込む
            </Button>
          </div>
        )}
        <ErrorBox message={err} />
        {preview?.accounts && (
          <div className="space-y-2">
            <div className="text-sm">
              科目 {preview.accounts.length} 件（{(preview.statements ?? []).join("・") || "BS/PL 不明"}）。
              {preview.unknown ? <span className="font-semibold text-rose-700">分類できない科目 {preview.unknown} 件（取込後に試算表の画面で分類を選んでください）</span> : "すべての科目の分類を推定できました。"}
            </div>
            <div className="max-h-96 overflow-y-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left">
                  <tr>
                    <th className="px-2 py-1">行</th>
                    <th className="px-2 py-1">科目</th>
                    <th className="px-2 py-1">推定した区分</th>
                    <th className="px-2 py-1 text-right">期首</th>
                    <th className="px-2 py-1 text-right">借方</th>
                    <th className="px-2 py-1 text-right">貸方</th>
                    <th className="px-2 py-1 text-right">期末</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.accounts.map((a) => (
                    <tr key={a.row} className={a.classification === "unknown" ? "bg-rose-50" : ""}>
                      <td className="px-2 py-1 text-slate-400">{a.row}</td>
                      <td className="px-2 py-1">{a.name}</td>
                      <td className="px-2 py-1">{a.section ? SECTION[a.section] : "不明"}</td>
                      <td className="num px-2 py-1 text-right">{yen(a.opening, { blankZero: true })}</td>
                      <td className="num px-2 py-1 text-right">{yen(a.debit, { blankZero: true })}</td>
                      <td className="num px-2 py-1 text-right">{yen(a.credit, { blankZero: true })}</td>
                      <td className="num px-2 py-1 text-right">{yen(a.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!preview.skipped?.length && (
              <details className="text-xs text-slate-500">
                <summary>読み飛ばす行（見出し・小計）{preview.skipped.length}件</summary>
                {preview.skipped.map((s) => `${s.row}行目 ${s.label}（${s.reason}）`).join("、")}
              </details>
            )}
            {!!preview.errors?.length && <ErrorBox message={preview.errors.map((e) => `${e.row}行目：${e.message}`).join(" / ")} />}
          </div>
        )}
        {preview?.count !== undefined && (
          <div className="space-y-2 text-sm">
            <p>
              仕訳 {preview.count} 行（借方・貸方を1行ずつ数えます）。期間：{preview.period?.[0] ?? "—"}〜{preview.period?.[1] ?? "—"}。取り込むと、この年度の仕訳帳は置き換わります。
            </p>
            {!!preview.errors?.length && <ErrorBox message={preview.errors.slice(0, 10).map((e) => `${e.row}行目：${e.message}`).join(" / ")} />}
            <table className="min-w-full text-xs">
              <tbody>
                {preview.sample?.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{l.entry_date}</td>
                    <td className="py-1 pr-2">{l.side === "debit" ? "借" : "貸"}</td>
                    <td className="py-1 pr-2">{l.account_name}</td>
                    <td className="num py-1 pr-2 text-right">{yen(l.amount)}</td>
                    <td className="py-1 text-slate-500">{l.memo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Drawer>
  );
}
