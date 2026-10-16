"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, ErrorBox, Money, Spinner, StatusBadge, cx } from "@/components/ui";
import { STEPS, YearContext, pageOf } from "@/components/year";
import { api, useApi } from "@/lib/api";
import { dateJa, daysUntil } from "@/lib/format";
import type { FiscalYearDetail, ReturnData } from "@/lib/types";

export default function YearLayout({ children }: { children: React.ReactNode }) {
  const { fid } = useParams<{ fid: string }>();
  const pathname = usePathname();
  const fy = useApi<FiscalYearDetail>(`/fiscal-years/${fid}`);
  const [ret, setRet] = useState<ReturnData | null>(null);
  const [retLoading, setRetLoading] = useState(true);
  const [retErr, setRetErr] = useState<string | null>(null);

  const reloadReturn = useCallback(async () => {
    setRetLoading(true);
    try {
      setRet(await api<ReturnData>(`/fiscal-years/${fid}/return`));
      setRetErr(null);
    } catch (e) {
      setRetErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRetLoading(false);
    }
  }, [fid]);

  useEffect(() => {
    void reloadReturn();
  }, [reloadReturn]);

  const counts = useMemo(() => {
    const c: Record<string, { critical: number; warning: number }> = {};
    for (const f of ret?.findings ?? []) {
      if (f.acknowledged || f.severity === "info") continue;
      const p = pageOf(f);
      c[p] ??= { critical: 0, warning: 0 };
      c[p][f.severity as "critical" | "warning"] += 1;
    }
    return c;
  }, [ret]);

  if (fy.error) return <ErrorBox message={fy.error} />;
  if (!fy.data) return <Spinner />;
  const d = fy.data;
  const current = pathname.replace(`/years/${fid}`, "").replace(/^\//, "").split("/")[0] ?? "";
  const left = daysUntil(d.filing_deadline);
  const s = ret?.summary;

  return (
    <YearContext.Provider
      value={{ fid: Number(fid), fy: d, ret, retLoading, reloadFy: fy.reload, reloadReturn, locked: d.status === "approved" || d.status === "filed" }}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <Link href={`/companies/${d.company.id}`} className="text-xs text-indigo-600 hover:underline">
                {d.company.name}
              </Link>
              <div className="flex items-center gap-2">
                <span className="num text-base font-semibold">
                  {dateJa(d.start_date)}〜{dateJa(d.end_date)}
                </span>
                <span className="text-xs text-slate-500">（{d.months}か月）</span>
                <StatusBadge status={d.status} label={d.status_label} />
              </div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-slate-500">申告期限</div>
              <span className="num">{dateJa(d.filing_deadline)}</span>{" "}
              <Badge className={left < 0 ? "bg-rose-600 text-white ring-rose-700" : left <= 14 ? "bg-rose-50 text-rose-700 ring-rose-600/20" : undefined}>
                {left < 0 ? `${-left}日超過` : `あと${left}日`}
              </Badge>
            </div>
            <div className="text-sm">
              <div className="text-xs text-slate-500">所得金額</div>
              {s ? <Money v={s.income} /> : "…"}
            </div>
            <div className="text-sm">
              <div className="text-xs text-slate-500">差引確定法人税額</div>
              {s ? <Money v={s.corporate_final} /> : "…"}
            </div>
            <div className="text-sm">
              <div className="text-xs text-slate-500">地方法人税</div>
              {s ? <Money v={s.local_corporate_final} /> : "…"}
            </div>
            <div className="text-sm">
              <div className="text-xs text-slate-500">防衛特別法人税</div>
              {s ? s.defense_applicable ? <Money v={s.defense_final} /> : <span className="text-xs text-slate-400">対象外の年度</span> : "…"}
            </div>
            <div className="ml-auto flex items-center gap-2 text-sm">
              {ret && (
                <>
                  <Badge className={ret.counts.critical ? "bg-rose-50 text-rose-700 ring-rose-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}>
                    重大エラー {ret.counts.critical}
                  </Badge>
                  <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">要確認 {ret.counts.warning_open}</Badge>
                </>
              )}
              {retLoading && <span className="text-xs text-slate-400">再計算中…</span>}
            </div>
          </div>
          <nav className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            {STEPS.map((st) => {
              const c = counts[st.key];
              const active = current === st.key;
              return (
                <Link
                  key={st.key}
                  href={`/years/${fid}${st.key ? `/${st.key}` : ""}`}
                  title={st.help}
                  className={cx(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                    active ? "bg-indigo-600 font-semibold text-white" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {st.label}
                  {c?.critical ? <span className="rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">{c.critical}</span> : null}
                  {!c?.critical && c?.warning ? <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-amber-950">{c.warning}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>
        {d.status === "approved" || d.status === "filed" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            この年度は承認済です。内容を変更するには、最終チェックで承認を取り消してください。
          </div>
        ) : null}
        <ErrorBox message={retErr} />
        {children}
      </div>
    </YearContext.Provider>
  );
}
