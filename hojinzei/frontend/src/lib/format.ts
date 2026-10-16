export function yen(v: number | null | undefined, opts: { blankZero?: boolean } = {}): string {
  if (v === null || v === undefined) return "未確定";
  if (opts.blankZero && v === 0) return "";
  if (v < 0) return `△${(-v).toLocaleString("ja-JP")}`;
  return v.toLocaleString("ja-JP");
}

/** 「1,234」「△1,234」「-1234」「１２３４」を整数にする。空欄は null。数字でなければ undefined。 */
export function parseYen(s: string): number | null | undefined {
  const t = s
    .normalize("NFKC")
    .replace(/[,\s円¥]/g, "")
    .trim();
  if (t === "") return null;
  const neg = /^[-−△▲]/.test(t);
  const body = neg ? t.slice(1) : t;
  if (!/^\d+$/.test(body)) return undefined;
  const n = parseInt(body, 10);
  return neg ? -n : n;
}

export function dateJa(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function dateTimeJa(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateJa(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function wareki(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const r = y - 2018;
  return `令和${r === 1 ? "元" : r}年${m}月${d}日`;
}
