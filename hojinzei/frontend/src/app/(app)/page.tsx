"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, ErrorBox, Field, Modal, Select, Spinner, StatusBadge, TextInput, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateJa, dateTimeJa, daysUntil } from "@/lib/format";
import type { CompanyListItem, User } from "@/lib/types";

function Deadline({ iso }: { iso: string }) {
  const d = daysUntil(iso);
  const tone = d < 0 ? "bg-rose-600 text-white ring-rose-700" : d <= 14 ? "bg-rose-50 text-rose-700 ring-rose-600/20" : d <= 30 ? "bg-amber-50 text-amber-800 ring-amber-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20";
  return (
    <div className="flex items-center gap-2">
      <span className="num">{dateJa(iso)}</span>
      <Badge className={tone}>{d < 0 ? `${-d}日超過` : d === 0 ? "今日" : `あと${d}日`}</Badge>
    </div>
  );
}

export default function CompanyListPage() {
  const { meta } = useApp();
  const router = useRouter();
  const { data, error, loading } = useApi<CompanyListItem[]>("/companies");
  const users = useApi<User[]>("/users");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const list = (data ?? []).filter((c) => (!q || c.name.includes(q) || (c.name_kana ?? "").includes(q)) && (!status || c.current_year?.status === status));
    return list.sort((a, b) => (a.current_year?.filing_deadline ?? "9999").localeCompare(b.current_year?.filing_deadline ?? "9999"));
  }, [data, q, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">顧問先一覧</h1>
          <p className="text-sm text-slate-500">申告期限の近い順に並べています。行を押すと、その事業年度の作業画面を開きます。</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          ＋ 新しい顧問先
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <TextInput placeholder="法人名・フリガナで検索" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[12rem]">
          <option value="">すべての進捗</option>
          {meta.statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <ErrorBox message={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2.5">法人名</th>
                <th className="px-3 py-2.5">決算月</th>
                <th className="px-3 py-2.5">事業年度</th>
                <th className="px-3 py-2.5">申告期限</th>
                <th className="px-3 py-2.5">担当者</th>
                <th className="px-3 py-2.5">進捗</th>
                <th className="px-3 py-2.5">未解決エラー</th>
                <th className="px-3 py-2.5">最終更新日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const fy = c.current_year;
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-indigo-50/40"
                    onClick={() => router.push(fy ? `/years/${fy.id}` : `/companies/${c.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{c.name}</div>
                      <Link href={`/companies/${c.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-indigo-600 hover:underline">
                        会社情報
                      </Link>
                    </td>
                    <td className="px-3 py-3">{c.fiscal_year_end_month ? `${c.fiscal_year_end_month}月` : "—"}</td>
                    <td className="px-3 py-3 num">{fy ? `${dateJa(fy.start_date)}〜${dateJa(fy.end_date)}` : <span className="text-slate-400">未登録</span>}</td>
                    <td className="px-3 py-3">{fy ? <Deadline iso={fy.filing_deadline} /> : "—"}</td>
                    <td className="px-3 py-3">{c.assigned_user?.display_name ?? "—"}</td>
                    <td className="px-3 py-3">{fy ? <StatusBadge status={fy.status} label={fy.status_label} /> : "—"}</td>
                    <td className="px-3 py-3">
                      {!fy || fy.critical_count === null ? (
                        <span className="text-xs text-slate-400">未計算</span>
                      ) : (
                        <div className="flex gap-1">
                          <Badge className={cx(fy.critical_count ? "bg-rose-50 text-rose-700 ring-rose-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20")}>
                            重大 {fy.critical_count}
                          </Badge>
                          <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">要確認 {fy.warning_count ?? 0}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{dateTimeJa(c.last_updated)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    顧問先がありません。「新しい顧問先」から登録してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <NewCompanyModal open={open} onClose={() => setOpen(false)} users={users.data ?? []} />
    </div>
  );
}

function NewCompanyModal({ open, onClose, users }: { open: boolean; onClose: () => void; users: User[] }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", name_kana: "", corp_kind: "kabushiki", head_office_address: "", fiscal_year_end_month: "3", assigned_user_id: "" });
  const [cand, setCand] = useState<{ prefecture: string | null; municipality: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup() {
    if (!f.head_office_address) return setCand(null);
    setCand(await api("/tools/address", { method: "POST", json: { address: f.head_office_address } }));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const c = await api<{ id: number }>("/companies", {
        method: "POST",
        json: {
          name: f.name,
          name_kana: f.name_kana || null,
          corp_kind: f.corp_kind,
          head_office_address: f.head_office_address || null,
          fiscal_year_end_month: Number(f.fiscal_year_end_month),
          assigned_user_id: f.assigned_user_id ? Number(f.assigned_user_id) : null,
        },
      });
      router.push(`/companies/${c.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新しい顧問先"
      footer={
        <>
          <Button onClick={onClose}>やめる</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !f.name}>
            登録して会社情報へ
          </Button>
        </>
      }
    >
      <Field label="法人名（必須）">
        <TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="株式会社〇〇" />
      </Field>
      <Field label="フリガナ">
        <TextInput value={f.name_kana} onChange={(e) => setF({ ...f, name_kana: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="法人の種類">
          <Select value={f.corp_kind} onChange={(e) => setF({ ...f, corp_kind: e.target.value })}>
            <option value="kabushiki">株式会社</option>
            <option value="godo">合同会社</option>
            <option value="other">その他（未対応）</option>
          </Select>
        </Field>
        <Field label="決算月">
          <Select value={f.fiscal_year_end_month} onChange={(e) => setF({ ...f, fiscal_year_end_month: e.target.value })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="本店所在地" hint={cand ? `地方税の申告先の候補：${cand.prefecture ?? "（都道府県を判定できません）"} ${cand.municipality ?? ""}` : "入力すると、都道府県・市区町村を候補として表示します"}>
        <TextInput value={f.head_office_address} onChange={(e) => setF({ ...f, head_office_address: e.target.value })} onBlur={lookup} />
      </Field>
      <Field label="担当者">
        <Select value={f.assigned_user_id} onChange={(e) => setF({ ...f, assigned_user_id: e.target.value })}>
          <option value="">自分</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorBox message={err} />
    </Modal>
  );
}
