"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import type { Finding, FiscalYearDetail, ReturnData, Target } from "@/lib/types";
import { Button, cx, SeverityBadge } from "./ui";

export type YearCtx = {
  fid: number;
  fy: FiscalYearDetail;
  ret: ReturnData | null;
  retLoading: boolean;
  reloadFy: () => Promise<void>;
  reloadReturn: () => Promise<void>;
  locked: boolean;
};

export const YearContext = createContext<YearCtx | null>(null);

export function useYear(): YearCtx {
  const c = useContext(YearContext);
  if (!c) throw new Error("年度の画面の外で使われています");
  return c;
}

export const STEPS: { key: string; label: string; help: string }[] = [
  { key: "", label: "概要", help: "年度の基本情報と次にやること" },
  { key: "documents", label: "1 資料", help: "試算表・仕訳帳などを取り込む" },
  { key: "trial-balance", label: "2 試算表", help: "科目の分類と整合性を確認" },
  { key: "opening", label: "3 期首情報", help: "前期から引き継ぐ金額" },
  { key: "adjustments", label: "4 税務調整", help: "加算・減算の候補を判断" },
  { key: "tax-inputs", label: "5 税額の基礎", help: "租税公課・源泉所得税・交際費など" },
  { key: "return", label: "6 申告書", help: "別表のプレビューと計算根拠" },
  { key: "review", label: "7 最終チェック", help: "エラーの確認と承認" },
];

export function pageOfTarget(t: Target): string {
  switch (t.type) {
    case "account":
    case "journal":
      return "trial-balance";
    case "adjustment":
      return "adjustments";
    case "cell":
    case "schedule":
      return "return";
    case "page":
      if (t.page === "company") return "";
      return t.page ?? "";
    default:
      return "review";
  }
}

export function pageOf(f: Finding): string {
  return f.targets.length ? pageOfTarget(f.targets[0]) : "review";
}

export function hrefFor(fid: number, t: Target): string {
  const base = `/years/${fid}`;
  switch (t.type) {
    case "account":
      return `${base}/trial-balance?account=${t.id}`;
    case "journal":
      return `${base}/trial-balance?journal=${t.id}`;
    case "adjustment":
      return `${base}/adjustments?id=${t.id}`;
    case "cell":
      return `${base}/return?cell=${encodeURIComponent(t.key ?? "")}`;
    case "schedule":
      return `${base}/return?schedule=${encodeURIComponent(t.key ?? "")}`;
    case "page":
      if (t.page === "rules") return "/rules";
      if (t.page === "company") return base;
      return `${base}/${t.page}${t.section ? `#${t.section}` : ""}`;
    default:
      return `${base}/review`;
  }
}

const TARGET_LABEL: Record<string, string> = {
  account: "科目と仕訳を見る",
  journal: "仕訳を見る",
  adjustment: "税務調整を開く",
  cell: "別表の欄を開く",
  schedule: "別表を開く",
  page: "入力画面へ",
};

export function FindingItem({ f, fid, onAck, onUnack }: { f: Finding; fid: number; onAck?: (f: Finding) => void; onUnack?: (f: Finding) => void }) {
  const targets = f.targets.slice(0, 4);
  return (
    <li className={cx("rounded-md border p-3", f.acknowledged ? "border-slate-200 bg-slate-50 opacity-75" : f.severity === "critical" ? "border-rose-200 bg-rose-50/40" : f.severity === "warning" ? "border-amber-200 bg-amber-50/30" : "border-sky-200 bg-sky-50/30")}>
      <div className="flex flex-wrap items-start gap-2">
        <SeverityBadge severity={f.severity} />
        <span className="text-xs text-slate-500">{f.category}</span>
        {f.acknowledged && <span className="text-xs text-emerald-700">✓ 確認済み{f.ack_note ? `：${f.ack_note}` : ""}</span>}
      </div>
      <div className="mt-1 font-medium text-slate-800">{f.title}</div>
      {f.message && <p className="mt-1 text-sm text-slate-600">{f.message}</p>}
      {f.action && (
        <p className="mt-1 text-sm text-slate-700">
          <span className="font-semibold">どうするか：</span>
          {f.action}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {targets.map((t, i) => (
          <Link key={i} href={hrefFor(fid, t)} className="rounded border border-indigo-200 bg-white px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50">
            {TARGET_LABEL[t.type] ?? "開く"} →
          </Link>
        ))}
        {onAck && f.severity !== "critical" && !f.acknowledged && (
          <Button size="sm" variant="ghost" onClick={() => onAck(f)}>
            確認済みにする
          </Button>
        )}
        {onUnack && f.acknowledged && (
          <Button size="sm" variant="ghost" onClick={() => onUnack(f)}>
            確認を取り消す
          </Button>
        )}
      </div>
    </li>
  );
}

export function PageTitle({ title, help, actions }: { title: string; help?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {help && <p className="max-w-3xl text-sm text-slate-500">{help}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function PageFindings({ page, limit = 6 }: { page: string; limit?: number }) {
  const { ret, fid } = useYear();
  if (!ret) return null;
  const list = ret.findings.filter((f) => pageOf(f) === page && !f.acknowledged && f.severity !== "info");
  if (!list.length) return null;
  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50/40 p-3" open={list.some((f) => f.severity === "critical")}>
      <summary className="cursor-pointer text-sm font-semibold text-amber-900">
        この画面で確認すること（{list.length}件）
      </summary>
      <ul className="mt-2 space-y-2">
        {list.slice(0, limit).map((f) => (
          <FindingItem key={f.fingerprint} f={f} fid={fid} />
        ))}
      </ul>
      {list.length > limit && <p className="mt-2 text-xs text-slate-500">ほか {list.length - limit} 件は「最終チェック」で確認できます。</p>}
    </details>
  );
}
