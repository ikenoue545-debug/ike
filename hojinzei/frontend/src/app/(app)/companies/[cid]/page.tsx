"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, ErrorBox, Field, Modal, Notice, Select, Spinner, StatusBadge, TextInput, YenInput, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateJa, daysUntil } from "@/lib/format";
import type { CompanyDetail, User } from "@/lib/types";

type Form = Record<string, string | number | null>;

export default function CompanyPage() {
  const { cid } = useParams<{ cid: string }>();
  const { user } = useApp();
  const router = useRouter();
  const { data, error, reload } = useApi<CompanyDetail>(`/companies/${cid}`);
  const users = useApi<User[]>("/users");
  const [f, setF] = useState<Form>({});
  const [cn, setCn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newFy, setNewFy] = useState(false);
  const { toast, toastNode } = useToast();

  useEffect(() => {
    if (data) {
      const rest: Form = {};
      for (const [k, v] of Object.entries(data)) {
        if (typeof v !== "object" || v === null) rest[k] = v as string | number | null;
      }
      setF(rest);
    }
  }, [data]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function checkCn() {
    const v = String(f.corporate_number ?? "").trim();
    if (!v) return setCn(null);
    const r = await api<{ ok: boolean; message: string }>("/tools/corporate-number", { method: "POST", json: { number: v } });
    setCn(r.ok ? null : r.message);
  }

  async function save() {
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      for (const k of ["name", "name_kana", "corporate_number", "corp_kind", "head_office_address", "prefecture", "municipality", "phone", "representative", "tax_office", "local_tax_offices", "industry", "business_description", "established_on", "notes"]) {
        body[k] = f[k] === "" ? null : f[k];
      }
      body.fiscal_year_end_month = f.fiscal_year_end_month ? Number(f.fiscal_year_end_month) : null;
      body.filing_extension_months = Number(f.filing_extension_months ?? 0);
      body.assigned_user_id = f.assigned_user_id ? Number(f.assigned_user_id) : null;
      await api(`/companies/${cid}`, { method: "PATCH", json: body });
      toast("保存しました");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!window.confirm(`「${data!.name}」と、すべての年度のデータ・アップロードしたファイルを削除します。元に戻せません。よろしいですか。`)) return;
    await api(`/companies/${cid}`, { method: "DELETE" });
    router.push("/");
  }

  const cand = data.address_candidates;
  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-indigo-600 hover:underline">
            ← 顧問先一覧
          </Link>
          <h1 className="text-xl font-semibold">{data.name}</h1>
          <p className="text-sm text-slate-500">会社の基本情報は年度をまたいで共通です。年度ごとの申告データは右の事業年度から開きます。</p>
        </div>
        {user.role === "admin" && (
          <Button variant="danger" onClick={remove}>
            会社とデータを削除
          </Button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card title="法人基本情報" actions={<Button variant="primary" onClick={save}>保存</Button>}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="法人名">
              <TextInput value={String(f.name ?? "")} onChange={set("name")} />
            </Field>
            <Field label="フリガナ">
              <TextInput value={String(f.name_kana ?? "")} onChange={set("name_kana")} />
            </Field>
            <Field label="法人番号（13桁）" error={cn} hint="検査用数字で入力間違いを確かめます">
              <TextInput value={String(f.corporate_number ?? "")} onChange={set("corporate_number")} onBlur={checkCn} inputMode="numeric" />
            </Field>
            <Field label="法人の種類・区分">
              <div className="flex gap-2">
                <Select value={String(f.corp_kind ?? "kabushiki")} onChange={set("corp_kind")}>
                  <option value="kabushiki">株式会社</option>
                  <option value="godo">合同会社</option>
                  <option value="other">その他</option>
                </Select>
                <Select value={String(f.corp_category ?? "ordinary")} disabled>
                  <option value="ordinary">普通法人</option>
                </Select>
              </div>
            </Field>
            <Field label="本店所在地" hint={`候補：${cand.prefecture ?? "—"} ${cand.municipality ?? ""}（住所から推定。事業所の設置状況は確認してください）`}>
              <TextInput value={String(f.head_office_address ?? "")} onChange={set("head_office_address")} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="都道府県">
                <TextInput value={String(f.prefecture ?? "")} onChange={set("prefecture")} placeholder={cand.prefecture ?? ""} />
              </Field>
              <Field label="市区町村">
                <TextInput value={String(f.municipality ?? "")} onChange={set("municipality")} placeholder={cand.municipality ?? ""} />
              </Field>
            </div>
            <Field
              label="所轄税務署"
              hint={
                <>
                  {data.tax_office_note}{" "}
                  <a href={data.tax_office_url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                    国税庁で確認
                  </a>
                </>
              }
            >
              <TextInput value={String(f.tax_office ?? "")} onChange={set("tax_office")} />
            </Field>
            <Field label="地方税の提出先（確認した値）" hint={data.local_tax_candidates.map((c) => `${c.kind}：${c.office}${c.note ? `（${c.note}）` : ""}`).join(" ／ ") || "本店所在地を入力すると候補を表示します"}>
              <TextInput value={String(f.local_tax_offices ?? "")} onChange={set("local_tax_offices")} />
            </Field>
            <Field label="代表者">
              <TextInput value={String(f.representative ?? "")} onChange={set("representative")} />
            </Field>
            <Field label="電話番号">
              <TextInput value={String(f.phone ?? "")} onChange={set("phone")} />
            </Field>
            <Field label="業種">
              <TextInput value={String(f.industry ?? "")} onChange={set("industry")} />
            </Field>
            <Field label="設立日">
              <TextInput type="date" value={String(f.established_on ?? "")} onChange={set("established_on")} />
            </Field>
            <Field label="決算月">
              <Select value={String(f.fiscal_year_end_month ?? "")} onChange={set("fiscal_year_end_month")}>
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="申告期限の延長の特例" hint="延長を受けている場合の月数（法人税法第75条の2）">
              <Select value={String(f.filing_extension_months ?? 0)} onChange={set("filing_extension_months")}>
                {[0, 1, 2, 3, 4].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "なし" : `${m}か月`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="担当者">
              <Select value={String(f.assigned_user_id ?? "")} onChange={set("assigned_user_id")}>
                <option value="">—</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="事業内容">
                <textarea className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" rows={2} value={String(f.business_description ?? "")} onChange={set("business_description")} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="メモ">
                <textarea className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" rows={2} value={String(f.notes ?? "")} onChange={set("notes")} />
              </Field>
            </div>
          </div>
          <div className="mt-3">
            <ErrorBox message={err} />
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="事業年度" actions={<Button variant="primary" size="sm" onClick={() => setNewFy(true)}>＋ 事業年度を追加</Button>}>
            {data.fiscal_years.length === 0 ? (
              <p className="text-sm text-slate-500">事業年度がまだありません。</p>
            ) : (
              <ul className="space-y-2">
                {data.fiscal_years.map((fy) => (
                  <li key={fy.id}>
                    <Link href={`/years/${fy.id}`} className="block rounded-md border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/40">
                      <div className="flex items-center justify-between">
                        <span className="num font-medium">
                          {dateJa(fy.start_date)}〜{dateJa(fy.end_date)}
                        </span>
                        <StatusBadge status={fy.status} label={fy.status_label} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        申告期限 {dateJa(fy.filing_deadline)}（{daysUntil(fy.filing_deadline) >= 0 ? `あと${daysUntil(fy.filing_deadline)}日` : "期限超過"}）
                        {fy.critical_count !== null && <Badge className="bg-rose-50 text-rose-700 ring-rose-600/20">重大 {fy.critical_count}</Badge>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Notice>
            会社の情報（変わりにくいもの）と、年度ごとの申告データは分けて保存しています。年度の基本情報（期末資本金・中小法人の判定・配当など）は各年度の画面で入力します。
          </Notice>
        </div>
      </div>
      <NewFiscalYear open={newFy} onClose={() => setNewFy(false)} company={data} />
    </div>
  );
}

function NewFiscalYear({ open, onClose, company }: { open: boolean; onClose: () => void; company: CompanyDetail }) {
  const router = useRouter();
  const last = company.fiscal_years[0];
  const defaultStart = () => {
    if (last) {
      const d = new Date(`${last.end_date}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    const m = company.fiscal_year_end_month ?? 3;
    const now = new Date();
    const y = now.getMonth() + 1 > m ? now.getFullYear() : now.getFullYear() - 1;
    return `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, "0")}-01`;
  };
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState("");
  const [capital, setCapital] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!start) return;
    const d = new Date(`${start}T00:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    setEnd(d.toISOString().slice(0, 10));
  }, [start]);

  async function submit() {
    setErr(null);
    try {
      const fy = await api<{ id: number }>(`/companies/${company.id}/fiscal-years`, {
        method: "POST",
        json: { start_date: start, end_date: end, capital_end: capital, dividends: 0 },
      });
      router.push(`/years/${fy.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="事業年度を追加"
      footer={
        <>
          <Button onClick={onClose}>やめる</Button>
          <Button variant="primary" onClick={submit} disabled={!start || !end}>
            追加して作業を始める
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日">
          <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="終了日" hint="設立初年度など短い事業年度は終了日を直してください">
          <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="期末資本金の額" hint="空欄なら、試算表を取り込んだときに資本金の残高を候補として入れます">
        <YenInput value={capital} onChange={setCapital} />
      </Field>
      <ErrorBox message={err} />
    </Modal>
  );
}
