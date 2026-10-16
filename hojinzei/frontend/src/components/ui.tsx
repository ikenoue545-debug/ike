"use client";

import { useEffect, useState, type ReactNode } from "react";
import { parseYen, yen } from "@/lib/format";
import type { Severity } from "@/lib/types";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" };

export function Button({ variant = "secondary", size = "md", className, ...rest }: BtnProps) {
  const base = "inline-flex items-center justify-center gap-1 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  const sz = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
    secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return <button className={cx(base, sz, v, className)} {...rest} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const SEV: Record<Severity, string> = {
  critical: "bg-rose-50 text-rose-700 ring-rose-600/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
};
const SEV_LABEL: Record<Severity, string> = { critical: "重大エラー", warning: "要確認", info: "参考情報" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge className={SEV[severity]}>{SEV_LABEL[severity]}</Badge>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className ?? "bg-slate-100 text-slate-700 ring-slate-500/20")}>
      {children}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-600 ring-slate-500/20",
  collecting: "bg-sky-50 text-sky-700 ring-sky-600/20",
  data_loaded: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
  adjusting: "bg-violet-50 text-violet-700 ring-violet-600/20",
  drafted: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  in_review: "bg-amber-50 text-amber-800 ring-amber-600/20",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  filed: "bg-emerald-600 text-white ring-emerald-700",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge className={STATUS_COLORS[status]}>{label}</Badge>;
}

const ADJ_STATUS: Record<string, [string, string]> = {
  auto: ["自動確定可能", "bg-emerald-50 text-emerald-700 ring-emerald-600/20"],
  review: ["要確認", "bg-amber-50 text-amber-800 ring-amber-600/20"],
  missing: ["資料不足", "bg-rose-50 text-rose-700 ring-rose-600/20"],
  unsupported: ["対象外・未対応", "bg-slate-200 text-slate-700 ring-slate-500/20"],
};

export function AdjStatusBadge({ status }: { status: string }) {
  const [l, c] = ADJ_STATUS[status] ?? [status, ""];
  return <Badge className={c}>{l}</Badge>;
}

export function Money({ v, className, blankZero }: { v: number | null | undefined; className?: string; blankZero?: boolean }) {
  const unknown = v === null || v === undefined;
  return <span className={cx("num", unknown && "rounded bg-amber-100 px-1 text-amber-800", v !== null && v !== undefined && v < 0 && "text-rose-700", className)}>{yen(v, { blankZero })}</span>;
}

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

/** 金額の入力。空欄は null（未確定）。「△」「-」でマイナス。 */
export function YenInput({ value, onChange, allowNegative = false, placeholder, className, disabled }: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  allowNegative?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : yen(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value === null || value === undefined ? "" : yen(value));
  }, [value]);
  return (
    <input
      inputMode="numeric"
      disabled={disabled}
      placeholder={placeholder ?? "未入力"}
      className={cx(inputCls, "num text-right", bad && "border-rose-400", className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const p = parseYen(e.target.value);
        const ok = p !== undefined && (allowNegative || p === null || p >= 0);
        setBad(!ok);
      }}
      onBlur={() => {
        const p = parseYen(text);
        if (p === undefined || (!allowNegative && p !== null && p < 0)) {
          setBad(true);
          return;
        }
        setBad(false);
        onChange(p);
        setText(p === null ? "" : yen(p));
      }}
    />
  );
}

export function Spinner({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  const c = {
    info: "border-sky-200 bg-sky-50 text-sky-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-rose-200 bg-rose-50 text-rose-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return <div className={cx("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}

export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx("h-full overflow-y-auto bg-white shadow-xl", wide ? "w-full max-w-3xl" : "w-full max-w-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-3 text-base font-semibold">{title}</div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            value === it.key ? "border-indigo-600 font-semibold text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className={cx("fixed bottom-5 right-5 z-50 rounded-md px-4 py-2 text-sm text-white shadow-lg", msg.tone === "ok" ? "bg-emerald-600" : "bg-rose-600")} role="status">
      {msg.text}
    </div>
  ) : null;
  return { toast: (text: string, tone: "ok" | "err" = "ok") => setMsg({ text, tone }), toastNode: node };
}
