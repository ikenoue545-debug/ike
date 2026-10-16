"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Card, Drawer, Empty, ErrorBox, Money, Notice, Select, Spinner, Tabs, cx, useToast } from "@/components/ui";
import { FindingItem, PageTitle, useYear } from "@/components/year";
import { api, useApi } from "@/lib/api";
import { yen } from "@/lib/format";
import type { Finding } from "@/lib/types";

type Row = {
  account_id: number;
  code: string | null;
  name: string;
  statement: "BS" | "PL" | null;
  section: string | null;
  section_label: string;
  category: string | null;
  category_label: string | null;
  classification: string;
  heading: string | null;
  opening: number | null;
  debit: number | null;
  credit: number | null;
  closing: number | null;
  tax_flag: string | null;
  issues: { severity: string; title: string }[];
};
type TB = {
  rows: Row[];
  totals: Record<string, number | null>;
  has_bs: boolean;
  has_pl: boolean;
  re_includes_current_profit: boolean | null;
  findings: Finding[];
  has_journal: boolean;
  financials: Record<string, number | null>;
};
type JournalResp = {
  account: { id: number; name: string };
  count: number;
  lines: { id: number; date: string; entry_no: string | null; side: string; amount: number; counter_account: string | null; partner: string | null; memo: string | null; tax_category: string | null }[];
};

export default function TrialBalancePage() {
  return (
    <Suspense>
      <TrialBalance />
    </Suspense>
  );
}

function TrialBalance() {
  const { fid, reloadReturn, locked } = useYear();
  const { meta } = useApp();
  const params = useSearchParams();
  const tb = useApi<TB>(`/fiscal-years/${fid}/trial-balance`);
  const [tab, setTab] = useState<"BS" | "PL" | "unknown">("BS");
  const [open, setOpen] = useState<number | null>(null);
  const { toast, toastNode } = useToast();

  useEffect(() => {
    const a = params.get("account");
    if (a) setOpen(Number(a));
    const j = params.get("journal");
    if (j)
      api<{ account_id: number | null }>(`/journal-lines/${j}`).then((r) => r.account_id && setOpen(r.account_id)).catch(() => undefined);
  }, [params]);

  const rows = useMemo(() => (tb.data?.rows ?? []).filter((r) => (tab === "unknown" ? !r.section || r.classification === "unknown" : r.statement === tab)), [tb.data, tab]);
  const unknownCount = (tb.data?.rows ?? []).filter((r) => !r.section || r.classification === "unknown").length;

  async function classify(r: Row, category: string) {
    try {
      await api(`/accounts/${r.account_id}`, { method: "PATCH", json: { category } });
      toast(`「${r.name}」の分類を変えました`);
      await tb.reload();
      await reloadReturn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  }

  if (tb.error) return <ErrorBox message={tb.error} />;
  if (!tb.data) return <Spinner />;
  const t = tb.data.totals;
  const fin = tb.data.financials;
  const critical = tb.data.findings.filter((f) => f.severity === "critical");
  const groups = groupByHeading(rows);

  return (
    <div className="space-y-4">
      {toastNode}
      <PageTitle
        title="試算表"
        help="取り込んだ試算表を、貸借対照表・損益計算書に分けて表示します。科目の分類（資産・負債・純資産・収益・費用と税務上の分類）を確認し、科目を押すと仕訳を確認できます。🔍 の印は税務調整が必要かもしれない科目です。"
      />
      {tb.data.rows.length === 0 ? (
        <Empty>試算表がまだありません。「資料」で試算表を取り込んでください。</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["資産合計", t.assets],
              ["負債合計", t.liabilities],
              ["純資産合計（取込値）", t.equity],
              ["当期純利益（PL）", t.net_income],
              ["未払法人税等（期末）", fin.tax_provision_close],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-slate-500">{l}</div>
                <div className="text-lg font-semibold">
                  <Money v={v as number | null} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge className={critical.length ? "bg-rose-50 text-rose-700 ring-rose-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}>
              {critical.length ? `整合性の重大エラー ${critical.length}件` : "貸借・増減・BSとPLの利益：一致"}
            </Badge>
            {tb.data.re_includes_current_profit === false && <Badge>繰越利益剰余金は当期純利益を含まない形（当期純利益を足して扱います）</Badge>}
            {tb.data.has_journal ? <Badge>仕訳帳あり（科目を押すと仕訳）</Badge> : <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">仕訳帳なし</Badge>}
          </div>
          {tb.data.findings.length > 0 && (
            <Card title={`試算表の確認事項（${tb.data.findings.length}件）`}>
              <ul className="space-y-2">
                {tb.data.findings.slice(0, 8).map((f) => (
                  <FindingItem key={f.fingerprint} f={f} fid={fid} />
                ))}
              </ul>
            </Card>
          )}
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: "BS", label: "貸借対照表" },
              { key: "PL", label: "損益計算書" },
              { key: "unknown", label: <span className={unknownCount ? "text-rose-700" : ""}>分類が未決定 {unknownCount}</span> },
            ]}
          />
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">科目</th>
                  <th className="px-3 py-2">分類</th>
                  <th className="px-3 py-2 text-right">期首残高</th>
                  <th className="px-3 py-2 text-right">借方</th>
                  <th className="px-3 py-2 text-right">貸方</th>
                  <th className="px-3 py-2 text-right">期末残高</th>
                  <th className="px-3 py-2">確認</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([heading, rs]) => (
                  <GroupRows key={heading} heading={heading} rows={rs} locked={locked} categories={meta.categories} onOpen={setOpen} onClassify={classify} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      該当する科目はありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {open !== null && <JournalDrawer accountId={open} onClose={() => setOpen(null)} row={tb.data.rows.find((r) => r.account_id === open)} />}
    </div>
  );
}

function groupByHeading(rows: Row[]): [string, Row[]][] {
  const out: [string, Row[]][] = [];
  for (const r of rows) {
    const h = r.heading ?? r.section_label;
    if (!out.length || out[out.length - 1][0] !== h) out.push([h, []]);
    out[out.length - 1][1].push(r);
  }
  return out;
}

function GroupRows({ heading, rows, locked, categories, onOpen, onClassify }: {
  heading: string;
  rows: Row[];
  locked: boolean;
  categories: { key: string; section: string; section_label: string; label: string }[];
  onOpen: (id: number) => void;
  onClassify: (r: Row, c: string) => void;
}) {
  const total = rows.reduce((s, r) => s + (r.closing ?? 0), 0);
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold text-slate-600">
          {heading}
        </td>
        <td className="num px-3 py-1.5 text-right text-xs font-semibold text-slate-600">{yen(total)}</td>
        <td />
      </tr>
      {rows.map((r) => (
        <tr key={r.account_id} className={cx("border-t border-slate-100 hover:bg-indigo-50/30", r.issues.some((i) => i.severity === "critical") && "bg-rose-50/60")}>
          <td className="px-3 py-1.5">
            <button className="text-left font-medium text-indigo-700 hover:underline" onClick={() => onOpen(r.account_id)}>
              {r.name}
            </button>
            {r.tax_flag && (
              <span className="ml-1 cursor-help" title={r.tax_flag}>
                🔍
              </span>
            )}
          </td>
          <td className="px-3 py-1.5">
            <Select
              value={r.category ?? ""}
              disabled={locked}
              onChange={(e) => onClassify(r, e.target.value)}
              className={cx("py-0.5 text-xs", (!r.section || r.classification === "unknown") && "border-rose-400 bg-rose-50")}
            >
              <option value="">{r.section ? `${r.section_label}（細目なし）` : "未分類（選んでください）"}</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.section_label}：{c.label}
                </option>
              ))}
            </Select>
          </td>
          <td className="num px-3 py-1.5 text-right">{yen(r.opening, { blankZero: true })}</td>
          <td className="num px-3 py-1.5 text-right">{yen(r.debit, { blankZero: true })}</td>
          <td className="num px-3 py-1.5 text-right">{yen(r.credit, { blankZero: true })}</td>
          <td className="num px-3 py-1.5 text-right font-medium">{yen(r.closing)}</td>
          <td className="px-3 py-1.5">
            {r.issues.map((i, k) => (
              <Badge key={k} className={i.severity === "critical" ? "bg-rose-50 text-rose-700 ring-rose-600/20" : "bg-amber-50 text-amber-800 ring-amber-600/20"}>
                <span title={i.title}>{i.severity === "critical" ? "要修正" : "要確認"}</span>
              </Badge>
            ))}
            {r.tax_flag && <span className="text-xs text-slate-500">{r.tax_flag}</span>}
          </td>
        </tr>
      ))}
    </>
  );
}

function JournalDrawer({ accountId, onClose, row }: { accountId: number; onClose: () => void; row?: Row }) {
  const j = useApi<JournalResp>(`/accounts/${accountId}/journal`);
  const totals = useMemo(() => {
    const t = { debit: 0, credit: 0 };
    for (const l of j.data?.lines ?? []) t[l.side as "debit" | "credit"] += l.amount;
    return t;
  }, [j.data]);
  return (
    <Drawer open onClose={onClose} title={`仕訳：${row?.name ?? ""}`} wide>
      {row && (
        <div className="mb-3 grid grid-cols-4 gap-2 text-sm">
          <div>
            期首 <Money v={row.opening} />
          </div>
          <div>
            借方 <Money v={row.debit} />
          </div>
          <div>
            貸方 <Money v={row.credit} />
          </div>
          <div>
            期末 <Money v={row.closing} />
          </div>
        </div>
      )}
      {row?.tax_flag && <Notice tone="warning">税務の確認：{row.tax_flag}</Notice>}
      {j.error && <ErrorBox message={j.error} />}
      {!j.data ? (
        <Spinner />
      ) : j.data.count === 0 ? (
        <Empty>この科目の仕訳はありません（仕訳帳を取り込むと表示できます）。</Empty>
      ) : (
        <>
          <p className="my-2 text-xs text-slate-500">
            仕訳帳の合計：借方 {yen(totals.debit)}・貸方 {yen(totals.credit)}（試算表の借方・貸方と一致するか確認できます）
          </p>
          <table className="min-w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-2">日付</th>
                <th className="py-1 pr-2">番号</th>
                <th className="py-1 pr-2 text-right">借方</th>
                <th className="py-1 pr-2 text-right">貸方</th>
                <th className="py-1 pr-2">相手科目</th>
                <th className="py-1 pr-2">取引先</th>
                <th className="py-1">摘要</th>
              </tr>
            </thead>
            <tbody>
              {j.data.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2 num">{l.date}</td>
                  <td className="py-1 pr-2">{l.entry_no}</td>
                  <td className="num py-1 pr-2 text-right">{l.side === "debit" ? yen(l.amount) : ""}</td>
                  <td className="num py-1 pr-2 text-right">{l.side === "credit" ? yen(l.amount) : ""}</td>
                  <td className="py-1 pr-2">{l.counter_account}</td>
                  <td className="py-1 pr-2">{l.partner}</td>
                  <td className="py-1">{l.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Drawer>
  );
}
