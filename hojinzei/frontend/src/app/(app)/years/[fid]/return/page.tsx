"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Badge, Button, ErrorBox, Field, Money, Notice, Spinner, TextInput, YenInput, cx, useToast } from "@/components/ui";
import { FindingItem, useYear } from "@/components/year";
import { api, download, useApi } from "@/lib/api";
import { dateTimeJa, yen } from "@/lib/format";
import type { Cell, ReturnData, Schedule } from "@/lib/types";

type Override = { id: number; cell_key: string; value: number | null; reason: string; active: boolean; created_by: { display_name: string } | null; created_at: string; revoked_at: string | null };

const DETAIL_HEADERS: Record<string, Record<string, string>> = {
  b6_1: { name: "銘柄", "7": "収入金額", "8": "所得税額", "9": "計算期間（月）", "10": "所有期間（月）", "11": "所有期間割合", "12": "控除を受ける所得税額" },
  b15: { name: "科目", "6": "支出額", "7": "控除される費用の額", "8": "差引交際費等の額", "9": "うち接待飲食費の額" },
};
const INPUT_PAGE: Record<string, [string, string]> = {
  b1: ["tax-inputs#payments", "税額の基礎（中間申告分）"],
  b4: ["trial-balance", "試算表"],
  b5_1: ["opening", "期首情報・試算表"],
  b5_2: ["tax-inputs#payments", "税額の基礎（租税公課の納付・納税充当金・地方税）"],
  b6_1: ["tax-inputs#withholding", "税額の基礎（源泉所得税）"],
  b7_1: ["opening", "期首情報（繰越欠損金）"],
  b15: ["tax-inputs#entertainment", "税額の基礎（交際費等）"],
};
const SOURCE: Record<string, [string, string]> = {
  input: ["入力値", "bg-sky-50 text-sky-700 ring-sky-600/20"],
  computed: ["計算値", "bg-slate-100 text-slate-700 ring-slate-500/20"],
  override: ["手入力で上書き", "bg-amber-100 text-amber-900 ring-amber-600/30"],
  rule: ["ルール", "bg-violet-50 text-violet-700 ring-violet-600/20"],
};

export default function ReturnPage() {
  return (
    <Suspense>
      <ReturnPreview />
    </Suspense>
  );
}

function ReturnPreview() {
  const { fid, ret, reloadReturn, locked } = useYear();
  const params = useSearchParams();
  const router = useRouter();
  const overrides = useApi<Override[]>(`/fiscal-years/${fid}/overrides`);
  const [sel, setSel] = useState<string>("b1");
  const [cellKey, setCellKey] = useState<string | null>(null);
  const { toast, toastNode } = useToast();

  const scheduleOfCell = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of ret?.schedules ?? []) for (const r of s.rows) for (const k of Object.values(r.cells)) m[k] = s.id;
    return m;
  }, [ret]);

  useEffect(() => {
    const c = params.get("cell");
    const s = params.get("schedule");
    if (c) {
      setCellKey(c);
      if (scheduleOfCell[c]) setSel(scheduleOfCell[c]);
    } else if (s) setSel(s);
  }, [params, scheduleOfCell]);

  if (!ret) return <Spinner label="計算しています…" />;
  const schedule = ret.schedules.find((s) => s.id === sel) ?? ret.schedules[0];
  const cell = cellKey ? ret.cells[cellKey] : null;

  function pick(key: string) {
    setCellKey(key);
    if (scheduleOfCell[key] && scheduleOfCell[key] !== sel) setSel(scheduleOfCell[key]);
    router.replace(`/years/${fid}/return?cell=${encodeURIComponent(key)}`, { scroll: false });
  }

  const issuesBySchedule: Record<string, number> = {};
  for (const f of ret.findings) {
    if (f.severity === "info" || f.acknowledged) continue;
    for (const t of f.targets) {
      if (t.type === "cell" && t.key) {
        const s = scheduleOfCell[t.key];
        if (s) issuesBySchedule[s] = (issuesBySchedule[s] ?? 0) + 1;
      }
    }
  }

  return (
    <div className="space-y-3">
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Notice tone="warning">
          画面上のプレビュー（ドラフト）です。国税庁の正式様式・電子申告データではありません。行番号は「令和8年4月1日以後終了事業年度分」の様式に合わせています。
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => download(`/fiscal-years/${fid}/export.xlsx`, `houjinzei-draft-${fid}.xlsx`)}>Excel 出力</Button>
          <Button onClick={() => download(`/fiscal-years/${fid}/export.csv`, `houjinzei-draft-${fid}.csv`)}>CSV 出力</Button>
          <Button
            onClick={async () => {
              await api(`/fiscal-years/${fid}/snapshots`, { method: "POST" });
              toast("計算結果を保存しました（最終チェックの履歴に残ります）");
            }}
          >
            計算結果を保存
          </Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[220px_1fr_360px]">
        <aside className="space-y-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-20 lg:self-start">
          <div className="px-2 pb-1 text-xs font-semibold text-slate-500">別表</div>
          {ret.schedules.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSel(s.id);
                setCellKey(null);
              }}
              className={cx("block w-full rounded-md px-2 py-1.5 text-left text-sm", s.id === schedule.id ? "bg-indigo-600 text-white" : "hover:bg-slate-100")}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium">{s.title}</span>
                {issuesBySchedule[s.id] ? <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-amber-950">{issuesBySchedule[s.id]}</span> : null}
              </div>
              <div className={cx("truncate text-[11px]", s.id === schedule.id ? "text-indigo-100" : "text-slate-500")}>
                {s.status === "not_applicable" ? "対象外の年度" : s.status === "not_required" ? "該当なし" : s.form_name}
              </div>
            </button>
          ))}
          <div className="border-t border-slate-100 px-2 pt-2 text-xs text-slate-500">
            未実装の別表は「最終チェック」の必要書類に表示します。
          </div>
        </aside>
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-base font-semibold">
              {schedule.title}　<span className="text-sm font-normal text-slate-600">{schedule.form_name}</span>
            </div>
            {schedule.status !== "computed" && <p className="mt-1 text-sm text-slate-500">{schedule.status_note}</p>}
            <p className="mt-1 text-xs text-slate-500">金額を押すと、右に計算過程と参照元を表示します。黄色は未確定（資料不足）の欄です。</p>
          </div>
          <ScheduleTable s={schedule} ret={ret} selected={cellKey} onPick={pick} />
        </section>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <CellPanel
            cell={cell}
            ret={ret}
            fid={fid}
            locked={locked}
            overrides={overrides.data ?? []}
            onPick={pick}
            onChanged={async () => {
              await overrides.reload();
              await reloadReturn();
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function ScheduleTable({ s, ret, selected, onPick }: { s: Schedule; ret: ReturnData; selected: string | null; onPick: (k: string) => void }) {
  const main = s.rows.filter((r) => r.kind !== "detail");
  const detail = s.rows.filter((r) => r.kind === "detail");
  const cols = s.columns;
  const extraCols = s.id === "b5_1";
  return (
    <div className="overflow-x-auto p-3">
      <table className="form-table min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs text-slate-600">
            <th className="w-12 border px-2 py-1.5">行</th>
            <th className="border px-2 py-1.5 text-left">区分</th>
            {cols.map((c) => (
              <th key={c.id} className="border px-2 py-1.5 text-right">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {main.map((r, i) => (
            <tr key={`${r.line}-${i}`} className={cx(r.kind === "subtotal" && "bg-slate-50/80", r.kind === "total" && "bg-indigo-50/60 font-semibold", r.kind === "provision" && "bg-white")}>
              <td className="border px-2 py-1 text-center text-xs text-slate-500">{r.line}</td>
              <td className={cx("border px-2 py-1", r.indent ? "pl-5" : "")}>{r.label}</td>
              {cols.map((c) => {
                const key = r.cells[c.id];
                const sub = extraCols && c.id === "3" && r.cells["3i"] ? [r.cells["3i"], r.cells["3f"]] : null;
                return (
                  <td key={c.id} className="border px-1 py-0.5 text-right align-top">
                    {key ? <CellButton cell={ret.cells[key]} selected={selected === key} onPick={onPick} total={r.kind !== "row"} /> : null}
                    {sub && (
                      <div className="mt-0.5 space-y-0.5 text-[11px] text-slate-500">
                        <div>
                          中間 <CellButton cell={ret.cells[sub[0]]} selected={selected === sub[0]} onPick={onPick} small />
                        </div>
                        <div>
                          確定 <CellButton cell={ret.cells[sub[1]]} selected={selected === sub[1]} onPick={onPick} small />
                        </div>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {main.length === 0 && (
            <tr>
              <td colSpan={cols.length + 2} className="border px-3 py-6 text-center text-slate-500">
                {s.status_note || "記載する行はありません。"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {detail.length > 0 && (
        <>
          <div className="mt-4 mb-1 text-xs font-semibold text-slate-600">{s.id === "b15" ? "支出交際費等の額の明細" : "明細"}</div>
          <table className="form-table min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-600">
                {Object.keys(detail[0].cells).map((k) => (
                  <th key={k} className="border px-2 py-1.5 text-right">
                    {DETAIL_HEADERS[s.id]?.[k] ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.map((r, i) => (
                <tr key={i}>
                  {Object.entries(r.cells).map(([k, key]) => (
                    <td key={k} className="border px-1 py-0.5 text-right">
                      <CellButton cell={ret.cells[key]} selected={selected === key} onPick={onPick} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function CellButton({ cell, selected, onPick, total, small }: { cell?: Cell; selected: boolean; onPick: (k: string) => void; total?: boolean; small?: boolean }) {
  if (!cell) return null;
  const isYen = cell.unit === "yen";
  const v = cell.value;
  const text = isYen ? (v === null ? "未確定" : yen(v)) : cell.unit === "months" ? `${v ?? ""}` : (cell.text ?? "");
  return (
    <button
      onClick={() => onPick(cell.key)}
      className={cx(
        "num inline-block min-w-[4.5rem] rounded px-1.5 py-0.5 text-right hover:bg-indigo-50",
        small && "min-w-0 px-1",
        selected && "ring-2 ring-indigo-500",
        isYen && v === null && "bg-amber-100 text-amber-900",
        cell.source === "override" && "bg-amber-50 underline decoration-amber-500 decoration-dotted",
        isYen && v === 0 && !total && "text-slate-300",
        isYen && v !== null && v < 0 && "text-rose-700",
        !isYen && "text-left",
      )}
      title={cell.label}
    >
      {text}
    </button>
  );
}

function cellPlace(ret: ReturnData, cell: Cell): string {
  for (const s of ret.schedules) {
    for (const r of s.rows) {
      const col = Object.entries(r.cells).find(([, k]) => k === cell.key)?.[0];
      if (col === undefined) continue;
      const colLabel = s.columns.find((c) => c.id === col)?.label ?? DETAIL_HEADERS[s.id]?.[col] ?? (col === "3i" ? "③当期の増 中間" : col === "3f" ? "③当期の増 確定" : "");
      return `${s.title}「${r.line}」${colLabel && col !== "value" ? `・${colLabel}` : ""}`;
    }
  }
  return cell.key;
}

function CellPanel({ cell, ret, fid, locked, overrides, onPick, onChanged }: {
  cell: Cell | null;
  ret: ReturnData;
  fid: number;
  locked: boolean;
  overrides: Override[];
  onPick: (k: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [val, setVal] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setVal(cell?.value ?? null);
    setReason("");
    setErr(null);
  }, [cell?.key, cell?.value]);

  if (!cell)
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        欄を押すと、ここに計算式・参照した欄・根拠条文・確認事項を表示します。
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs">
          <div className="font-semibold text-slate-600">使ったルールの版</div>
          <ul className="mt-1 space-y-0.5">
            {ret.rules_used.map((r) => (
              <li key={`${r.rule_id}@${r.version}`}>
                {r.title}（{r.version}・{r.status_label}・専門家レビュー：{r.expert_review}）
              </li>
            ))}
          </ul>
        </div>
      </div>
    );

  const related = ret.findings.filter((f) => f.targets.some((t) => t.type === "cell" && t.key === cell.key));
  const history = overrides.filter((o) => o.cell_key === cell.key);
  const active = history.find((o) => o.active);
  const [srcLabel, srcCls] = SOURCE[cell.source] ?? [cell.source, ""];

  async function addOverride() {
    setErr(null);
    try {
      await api(`/fiscal-years/${fid}/overrides`, { method: "POST", json: { cell_key: cell!.key, value: val, reason } });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <div className="text-xs text-slate-500">{cellPlace(ret, cell)}</div>
        <div className="font-semibold">{cell.label}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xl font-semibold">{cell.unit === "yen" ? <Money v={cell.value} /> : cell.text ?? cell.value}</span>
          <Badge className={srcCls}>{srcLabel}</Badge>
        </div>
        {cell.source === "override" && (
          <p className="mt-1 text-xs text-amber-800">
            計算値 {yen(cell.computed_value)} 円を上書き（理由：{cell.override_reason}）
          </p>
        )}
      </div>
      {cell.source === "input" && INPUT_PAGE[cell.schedule] && (
        <p className="text-sm">
          この欄は入力値です。直すときは{" "}
          <Link href={`/years/${fid}/${INPUT_PAGE[cell.schedule][0]}`} className="text-indigo-700 underline">
            {INPUT_PAGE[cell.schedule][1]}
          </Link>{" "}
          の入力を直してください。
        </p>
      )}
      {cell.formula && (
        <div>
          <div className="text-xs font-semibold text-slate-500">計算式</div>
          <div className="rounded bg-slate-50 px-2 py-1.5 text-sm">{cell.formula}</div>
        </div>
      )}
      {cell.refs.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500">参照した欄</div>
          <ul className="mt-1 space-y-1 text-sm">
            {cell.refs.map((r) => {
              if (r.startsWith("adj:")) {
                const id = r.slice(4);
                const a = ret.adjustments.find((x) => x.id === id);
                return (
                  <li key={r}>
                    <Link href={`/years/${fid}/adjustments?id=${id}`} className="text-indigo-700 underline">
                      税務調整：{a?.name ?? id}
                    </Link>{" "}
                    <Money v={a?.amount ?? null} />
                  </li>
                );
              }
              const c = ret.cells[r];
              return (
                <li key={r} className="flex items-center justify-between gap-2">
                  <button className="text-left text-indigo-700 hover:underline" onClick={() => onPick(r)}>
                    {c?.label ?? r}
                  </button>
                  {c && (c.unit === "yen" ? <Money v={c.value} /> : <span>{c.text}</span>)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {cell.basis.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500">根拠（法令・様式）</div>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {cell.basis.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {cell.notes.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500">メモ</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
            {cell.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {related.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500">この欄の確認事項</div>
          <ul className="mt-1 space-y-2">
            {related.map((f) => (
              <FindingItem key={f.fingerprint} f={f} fid={fid} />
            ))}
          </ul>
        </div>
      )}
      {cell.unit === "yen" && !locked && (
        <details className="rounded-md border border-slate-200 p-3" open={!!active}>
          <summary className="cursor-pointer text-sm font-semibold">手入力で上書き</summary>
          <p className="mt-1 text-xs text-slate-500">
            上書きすると、この値を使って後の計算をします。理由は必須で、履歴が残ります。計算の元の入力を直せる場合は、そちらを直してください。
          </p>
          <div className="mt-2 space-y-2">
            <Field label="値">
              <YenInput value={val} allowNegative onChange={setVal} />
            </Field>
            <Field label="理由（必須）">
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：中間申告書の控えで確認" />
            </Field>
            <ErrorBox message={err} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={reason.trim().length < 2} onClick={addOverride}>
                上書きする
              </Button>
              {active && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api(`/overrides/${active.id}`, { method: "DELETE" });
                    await onChanged();
                  }}
                >
                  上書きを取り消す
                </Button>
              )}
            </div>
          </div>
          {history.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
              {history.map((o) => (
                <li key={o.id}>
                  {dateTimeJa(o.created_at)} {o.created_by?.display_name}：{yen(o.value)}（{o.reason}）{o.active ? " ← 使用中" : `（取消 ${dateTimeJa(o.revoked_at)}）`}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
