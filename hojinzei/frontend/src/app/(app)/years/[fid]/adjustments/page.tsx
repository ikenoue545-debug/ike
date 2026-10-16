"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { AdjStatusBadge, Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Money, Notice, Select, Spinner, TextInput, YenInput, cx, useToast } from "@/components/ui";
import { PageFindings, PageTitle, useYear } from "@/components/year";
import { api, useApi } from "@/lib/api";
import { yen } from "@/lib/format";
import type { Adjustment, EngineAdjustment, Meta } from "@/lib/types";

const DISP: Record<string, string> = { ryuho: "留保", sonota: "社外流出", haitou: "社外流出（配当）", kome: "社外流出（※）" };
const DECISION: Record<string, [string, string]> = {
  pending: ["未判断", "bg-rose-50 text-rose-700 ring-rose-600/20"],
  adopted: ["採用", "bg-indigo-50 text-indigo-700 ring-indigo-600/20"],
  dismissed: ["調整不要", "bg-slate-100 text-slate-500 ring-slate-500/20"],
};
const ENGINE_SOURCE: Record<string, string> = {
  "2": "別表五(二)「5の⑤」",
  "3": "別表五(二)「10の⑤」＋「15の⑤」",
  "4": "別表五(二)「31」",
  "5": "別表五(二) その他（損金不算入）の⑤",
  "8": "別表十五「5」",
  "13": "別表五(二)「35」＋「36」",
  "29": "別表六(一)「6の③」",
  "21": "別表五(二)・六(一)の仮払経理",
  "10": "別表五(二)「37」",
};

export default function AdjustmentsPage() {
  return (
    <Suspense>
      <Adjustments />
    </Suspense>
  );
}

function Adjustments() {
  const { fid, ret, reloadReturn, locked } = useYear();
  const { meta } = useApp();
  const params = useSearchParams();
  const list = useApi<{ adjustments: Adjustment[] }>(`/fiscal-years/${fid}/adjustments`);
  const [open, setOpen] = useState<Adjustment | "new" | null>(null);
  const [engineOpen, setEngineOpen] = useState<EngineAdjustment | null>(null);
  const [filter, setFilter] = useState<"all" | "open">("all");
  const { toast, toastNode } = useToast();

  useEffect(() => {
    const id = params.get("id");
    if (!id || !list.data) return;
    const a = list.data.adjustments.find((x) => String(x.id) === id);
    if (a) setOpen(a);
    else {
      const e = ret?.adjustments.find((x) => x.id === id);
      if (e) setEngineOpen(e);
    }
  }, [params, list.data, ret]);

  const rows = useMemo(() => {
    const all = list.data?.adjustments ?? [];
    return filter === "open" ? all.filter((a) => a.decision === "pending" || (a.decision === "adopted" && !a.confirmed)) : all;
  }, [list.data, filter]);
  const engineRows = (ret?.adjustments ?? []).filter((a) => a.origin === "engine" && (a.amount ?? 0) !== 0);

  async function refresh() {
    const r = await api<{ added: number }>(`/fiscal-years/${fid}/suggestions/refresh`, { method: "POST" });
    toast(r.added ? `候補を${r.added}件追加しました` : "新しい候補はありません");
    await list.reload();
    await reloadReturn();
  }

  async function after() {
    setOpen(null);
    await list.reload();
    await reloadReturn();
  }

  return (
    <div className="space-y-4">
      {toastNode}
      <PageTitle
        title="税務調整"
        help="会計上の利益を税務上の所得に直すための加算・減算です。試算表と仕訳から規則で候補を抽出します（生成AIは未使用）。候補ごとに「採用」か「調整不要（理由）」を選び、金額と根拠を確認してください。科目名だけでは確定しません。"
        actions={
          !locked && (
            <>
              <Button onClick={refresh}>候補を抽出</Button>
              <Button variant="primary" onClick={() => setOpen("new")}>
                ＋ 調整を追加
              </Button>
            </>
          )
        }
      />
      <PageFindings page="adjustments" />
      <Card
        title="税務調整一覧"
        actions={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "open")} className="py-1 text-xs">
            <option value="all">すべて</option>
            <option value="open">未判断・未確認だけ</option>
          </Select>
        }
      >
        {!list.data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>税務調整はまだありません。「候補を抽出」を押すか、「調整を追加」から入力してください。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">科目</th>
                  <th className="py-2 pr-3 text-right">対象額</th>
                  <th className="py-2 pr-3">税務調整案</th>
                  <th className="py-2 pr-3">別表四</th>
                  <th className="py-2 pr-3 text-right">調整額</th>
                  <th className="py-2 pr-3">判定</th>
                  <th className="py-2 pr-3">対応</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => (
                  <tr key={a.id} className={cx(a.decision === "dismissed" && "text-slate-400")}>
                    <td className="py-2 pr-3">{a.account_names.join("・") || "—"}</td>
                    <td className="py-2 pr-3 text-right">{a.target_amount !== null ? <Money v={a.target_amount} /> : "—"}</td>
                    <td className="py-2 pr-3 font-medium">{a.name}</td>
                    <td className="py-2 pr-3 text-xs">
                      「{a.line}」{a.direction === "add" ? "加算" : "減算"}・{DISP[a.disposition]}
                    </td>
                    <td className="py-2 pr-3 text-right">{a.decision === "dismissed" ? "—" : <Money v={a.amount} />}</td>
                    <td className="py-2 pr-3">
                      <AdjStatusBadge status={a.status} />
                    </td>
                    <td className="py-2 pr-3">
                      <Badge className={DECISION[a.decision][1]}>{DECISION[a.decision][0]}</Badge>
                      {a.decision === "adopted" && (a.confirmed ? <span className="ml-1 text-xs text-emerald-700">✓確認済み</span> : <span className="ml-1 text-xs text-amber-700">未確認</span>)}
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" onClick={() => setOpen(a)}>
                        詳細
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="別表五(二)・六(一)・十五から自動で作る調整">
        <p className="mb-2 text-sm text-slate-500">
          納付した税金・納税充当金・源泉所得税・交際費の内訳から自動で計算します。金額を直すときは「税額の基礎」の入力を直してください。
        </p>
        {engineRows.length === 0 ? (
          <p className="text-sm text-slate-500">該当する自動の調整はありません。</p>
        ) : (
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {engineRows.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3 font-medium">{a.name}</td>
                  <td className="py-2 pr-3 text-xs">
                    「{a.line}」{a.direction === "add" ? "加算" : "減算"}・{DISP[a.disposition]}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">元：{ENGINE_SOURCE[a.line] ?? "—"}</td>
                  <td className="py-2 pr-3 text-right">
                    <Money v={a.amount} />
                  </td>
                  <td className="py-2 pr-3">
                    <AdjStatusBadge status={a.status} />
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEngineOpen(a)}>
                      計算過程
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <AdjustmentDrawer a={open === "new" ? null : open} meta={meta} locked={locked} onClose={() => setOpen(null)} onDone={after} />}
      {engineOpen && (
        <Drawer open onClose={() => setEngineOpen(null)} title={engineOpen.name}>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">金額</dt>
              <dd className="text-lg font-semibold">
                <Money v={engineOpen.amount} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">別表四</dt>
              <dd>
                「{engineOpen.line}」{engineOpen.direction === "add" ? "加算" : "減算"}・{DISP[engineOpen.disposition]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">計算の元</dt>
              <dd>{ENGINE_SOURCE[engineOpen.line] ?? "—"}</dd>
            </div>
            {engineOpen.note && (
              <div>
                <dt className="text-xs text-slate-500">説明</dt>
                <dd>{engineOpen.note}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-500">根拠</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {engineOpen.basis.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex gap-2">
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" href={`/years/${fid}/return?cell=${encodeURIComponent(`b4:${engineOpen.line === "21" || engineOpen.line === "10" ? "22" : engineOpen.line}:total`)}`}>
              別表四で見る
            </Link>
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" href={`/years/${fid}/tax-inputs`}>
              入力を直す
            </Link>
          </div>
        </Drawer>
      )}
    </div>
  );
}

type Draft = {
  kind: string;
  name: string;
  line: string;
  direction: "add" | "deduct";
  disposition: "ryuho" | "sonota" | "haitou" | "kome";
  amount: number | null;
  status: "auto" | "review" | "missing" | "unsupported";
  five1_key: string | null;
  five1_name: string | null;
  five1_column: "increase" | "decrease";
  reason: string;
  basis: string[];
};

function AdjustmentDrawer({ a, meta, locked, onClose, onDone }: { a: Adjustment | null; meta: Meta; locked: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { fid } = useYear();
  const isNew = a === null;
  const [d, setD] = useState<Draft>(
    a
      ? { kind: a.kind, name: a.name, line: a.line, direction: a.direction, disposition: a.disposition, amount: a.amount, status: a.status, five1_key: a.five1_key, five1_name: a.five1_name, five1_column: a.five1_column, reason: a.reason ?? "", basis: a.basis }
      : { kind: "manual_add", name: "", line: "10", direction: "add", disposition: "sonota", amount: null, status: "review", five1_key: null, five1_name: null, five1_column: "increase", reason: "", basis: [] },
  );
  const [dismiss, setDismiss] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const lineSpec = meta.b4_lines.find((l) => l.line === d.line);

  function applyTemplate(kind: string) {
    const t = meta.adjustment_templates.find((x) => x.kind === kind);
    if (!t) return;
    setD({ ...d, kind, name: t.name, line: t.line, direction: t.direction, disposition: t.disposition, five1_key: t.five1_key ?? null, five1_name: t.five1_name ?? null, five1_column: t.five1_column ?? "increase", basis: t.basis });
  }

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const save = () =>
    run(async () => {
      const body = { ...d, five1_key: d.disposition === "ryuho" ? d.five1_key || null : null, five1_name: d.disposition === "ryuho" ? d.five1_name || d.name : null };
      if (isNew) await api(`/fiscal-years/${fid}/adjustments`, { method: "POST", json: body });
      else await api(`/adjustments/${a!.id}`, { method: "PATCH", json: { ...body, clear_amount: d.amount === null } });
    });

  const months = a?.evidence.find((e) => e.type === "monthly")?.months;

  return (
    <Drawer open onClose={onClose} title={isNew ? "税務調整を追加" : a!.name} wide>
      <div className="space-y-4">
        {!isNew && (
          <div className="flex flex-wrap items-center gap-2">
            <AdjStatusBadge status={a!.status} />
            <Badge className={DECISION[a!.decision][1]}>{DECISION[a!.decision][0]}</Badge>
            {a!.decision === "adopted" && (a!.confirmed ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">確認済み</Badge> : <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">未確認</Badge>)}
            {a!.origin === "suggestion" && <span className="text-xs text-slate-500">規則による候補</span>}
          </div>
        )}
        {!isNew && a!.reason && (
          <Notice tone={a!.status === "missing" ? "danger" : a!.status === "review" ? "warning" : "info"}>
            <div className="font-semibold">判断理由</div>
            {a!.reason}
          </Notice>
        )}
        {!isNew && a!.questions.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-semibold">確認事項</div>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {a!.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        {months && (
          <div>
            <div className="mb-1 text-sm font-semibold">月ごとの支給額（仕訳帳から集計）</div>
            <div className="grid grid-cols-4 gap-1 text-xs sm:grid-cols-6">
              {Object.entries(months).map(([m, v]) => (
                <div key={m} className="rounded border border-slate-200 p-1.5">
                  <div className="text-slate-500">{m}</div>
                  <div className="num font-medium">{yen(v)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!isNew && a!.account_names.length > 0 && (
          <div className="text-sm">
            該当科目：
            {a!.account_names.map((n) => (
              <Link key={n} href={`/years/${fid}/trial-balance`} className="mr-2 text-indigo-700 underline">
                {n}
              </Link>
            ))}
            {a!.target_amount !== null && (
              <>
                （試算表の金額 <Money v={a!.target_amount} />）
              </>
            )}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {isNew && (
            <Field label="ひな形">
              <Select value={d.kind} onChange={(e) => applyTemplate(e.target.value)}>
                {meta.adjustment_templates.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.name || (t.kind === "manual_add" ? "その他の加算（自由記入）" : "その他の減算（自由記入）")}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="名称（別表四に記載）">
            <TextInput value={d.name} disabled={locked} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <Field label="別表四の行">
            <Select
              value={d.line}
              disabled={locked}
              onChange={(e) => {
                const spec = meta.b4_lines.find((l) => l.line === e.target.value)!;
                setD({ ...d, line: spec.line, direction: spec.direction as "add" | "deduct", disposition: spec.dispositions[0] as Draft["disposition"] });
              }}
            >
              {meta.b4_lines.map((l) => (
                <option key={l.line} value={l.line}>
                  「{l.line}」{l.label}（{l.direction === "add" ? "加算" : "減算"}）
                </option>
              ))}
            </Select>
          </Field>
          <Field label="処分">
            <Select value={d.disposition} disabled={locked} onChange={(e) => setD({ ...d, disposition: e.target.value as Draft["disposition"] })}>
              {(lineSpec?.dispositions ?? []).map((k) => (
                <option key={k} value={k}>
                  {meta.dispositions[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="調整額" hint="空欄は「未確定」。未確定のままでは所得金額を計算しません">
            <YenInput value={d.amount} disabled={locked} onChange={(v) => setD({ ...d, amount: v })} />
          </Field>
          <Field label="判定">
            <Select value={d.status} disabled={locked} onChange={(e) => setD({ ...d, status: e.target.value as Draft["status"] })}>
              {Object.entries(meta.adjustment_statuses).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {d.disposition === "ryuho" && (
            <>
              <Field label="別表五(一)の行（名称）" hint="留保の調整は利益積立金額の行に反映します。同じ名称の行にまとめます">
                <TextInput value={d.five1_name ?? ""} disabled={locked} onChange={(e) => setD({ ...d, five1_name: e.target.value, five1_key: d.five1_key && d.five1_key !== `custom:${d.five1_name}` ? d.five1_key : `custom:${e.target.value}` })} />
              </Field>
              <Field label="別表五(一)の列">
                <Select value={d.five1_column} disabled={locked} onChange={(e) => setD({ ...d, five1_column: e.target.value as "increase" | "decrease" })}>
                  <option value="increase">③当期の増（新しく生じた差額）</option>
                  <option value="decrease">②当期の減（前期からの差額の解消）</option>
                </Select>
              </Field>
            </>
          )}
          <div className="md:col-span-2">
            <Field label="判断理由・計算の説明">
              <textarea className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" rows={3} value={d.reason} disabled={locked} onChange={(e) => setD({ ...d, reason: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="法令・通達等の根拠（1行に1つ）" hint="存在を確認した条文だけを書いてください">
              <textarea className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" rows={2} value={d.basis.join("\n")} disabled={locked} onChange={(e) => setD({ ...d, basis: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
          </div>
        </div>
        <ErrorBox message={err} />
        {!locked && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Button variant="primary" onClick={save} disabled={!d.name}>
              {isNew ? "追加" : "内容を保存"}
            </Button>
            {!isNew && a!.decision !== "adopted" && <Button onClick={() => run(() => api(`/adjustments/${a!.id}/decision`, { method: "POST", json: { decision: "adopted" } }))}>採用する</Button>}
            {!isNew && a!.decision === "adopted" && !a!.confirmed && (
              <Button onClick={() => run(() => api(`/adjustments/${a!.id}/confirm`, { method: "POST", json: { confirmed: true } }))}>内容を確認した</Button>
            )}
            {!isNew && a!.decision === "adopted" && a!.confirmed && (
              <Button variant="ghost" onClick={() => run(() => api(`/adjustments/${a!.id}/confirm`, { method: "POST", json: { confirmed: false } }))}>確認を取り消す</Button>
            )}
            {!isNew && a!.origin !== "suggestion" && (
              <Button variant="ghost" onClick={() => window.confirm("この税務調整を削除しますか") && run(() => api(`/adjustments/${a!.id}`, { method: "DELETE" }))}>
                削除
              </Button>
            )}
          </div>
        )}
        {!locked && !isNew && a!.decision !== "dismissed" && (
          <div className="rounded-md border border-slate-200 p-3">
            <Field label="調整不要と判断した理由" hint="候補は削除せず、理由を記録して「調整不要」にします">
              <TextInput value={dismiss} onChange={(e) => setDismiss(e.target.value)} placeholder="例：固定資産台帳で償却限度額以内を確認" />
            </Field>
            <Button className="mt-2" size="sm" disabled={!dismiss.trim()} onClick={() => run(() => api(`/adjustments/${a!.id}/decision`, { method: "POST", json: { decision: "dismissed", dismiss_reason: dismiss } }))}>
              調整不要にする
            </Button>
          </div>
        )}
        {!isNew && a!.decision === "dismissed" && (
          <Notice>
            調整不要の理由：{a!.dismiss_reason}
            {!locked && (
              <Button className="ml-2" size="sm" variant="ghost" onClick={() => run(() => api(`/adjustments/${a!.id}/decision`, { method: "POST", json: { decision: "pending" } }))}>
                未判断に戻す
              </Button>
            )}
          </Notice>
        )}
      </div>
    </Drawer>
  );
}
