"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, ErrorBox, Field, Money, Notice, Select, Spinner, TextInput, YenInput, useToast } from "@/components/ui";
import { PageFindings, PageTitle, useYear } from "@/components/year";
import { api, useApi } from "@/lib/api";
import { yen } from "@/lib/format";

type Payment = {
  tax: "national" | "prefectural" | "municipal" | "enterprise" | "other";
  period: "prior" | "interim" | "other";
  label: string;
  other_kind: "" | "deductible" | "nondeductible";
  opening_unpaid: number | null;
  accrued: number | null;
  paid_provision: number | null;
  paid_suspense: number | null;
  paid_expense: number | null;
};
type Sections = {
  tax_payments: { payments: Payment[]; interim_corporate_tax: number | null; interim_local_corporate_tax: number | null; interim_defense_tax: number | null };
  provision: { provision_charged: number | null; provision_other_charged: number | null; provision_suspense_cleared: number | null; confirmed: boolean };
  local_taxes: { final_prefectural: number | null; final_municipal: number | null; final_enterprise: number | null; source_note: string };
  withholding: {
    items: { category: string; payer: string; gross_income: number | null; tax_withheld: number | null; booking: string; method: string; calc_months: number | null; owned_months: number | null; received_on: string | null }[];
    none_confirmed: boolean;
  };
  entertainment: { rows: { account: string; spent: number | null; excluded: number | null; food: number | null }[]; reviewed_small_meals: boolean };
};
type Hints = {
  provision_charged_hint: number | null;
  tax_provision_open: number | null;
  tax_provision_close: number | null;
  entertainment_accounts: { name: string; closing: number | null }[];
  meeting_accounts: { name: string; closing: number | null }[];
  income_accounts: { name: string; closing: number | null; category: string }[];
};

const TAX: Record<string, string> = { national: "法人税・地方法人税・防衛特別法人税", prefectural: "道府県民税（都民税）", municipal: "市町村民税", enterprise: "事業税・特別法人事業税", other: "その他の租税公課" };
const PERIOD: Record<string, string> = { prior: "前期以前の分", interim: "当期の中間分", other: "その他" };

export default function TaxInputsPage() {
  const { fid, reloadReturn, locked, ret } = useYear();
  const res = useApi<{ sections: Sections; hints: Hints }>(`/fiscal-years/${fid}/inputs`);
  const [s, setS] = useState<Sections | null>(null);
  const [err, setErr] = useState<Record<string, string | null>>({});
  const { toast, toastNode } = useToast();
  useEffect(() => {
    if (res.data) setS(structuredClone(res.data.sections));
  }, [res.data]);

  if (res.error) return <ErrorBox message={res.error} />;
  if (!s || !res.data) return <Spinner />;
  const h = res.data.hints;

  async function save<K extends keyof Sections>(key: K) {
    setErr({ ...err, [key]: null });
    try {
      await api(`/fiscal-years/${fid}/inputs/${key}`, { method: "PUT", json: s![key] });
      toast("保存しました。再計算しています");
      await res.reload();
      await reloadReturn();
    } catch (e) {
      setErr({ ...err, [key]: e instanceof Error ? e.message : String(e) });
    }
  }
  const tp = s.tax_payments;
  const setPay = (i: number, p: Partial<Payment>) => setS({ ...s, tax_payments: { ...tp, payments: tp.payments.map((x, j) => (j === i ? { ...x, ...p } : x)) } });
  const SaveBtn = ({ k }: { k: keyof Sections }) => (!locked ? <Button variant="primary" onClick={() => save(k)}>保存</Button> : null);

  return (
    <div className="space-y-4">
      {toastNode}
      <PageTitle
        title="税額の基礎"
        help="別表四の自動の加算・減算と、別表五(二)・六(一)・十五の元になる入力です。会計でどう処理したか（費用にしたか・未払法人税等を取り崩したか・仮払にしたか）で、別表四の調整が変わります。"
      />
      <PageFindings page="tax-inputs" />
      <nav className="flex flex-wrap gap-2 text-sm">
        {[
          ["payments", "租税公課の納付"],
          ["provision", "納税充当金"],
          ["local", "地方税（当期確定分）"],
          ["withholding", "源泉所得税"],
          ["entertainment", "交際費等"],
        ].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="rounded-md border border-slate-200 bg-white px-3 py-1 hover:bg-slate-50">
            {l}
          </a>
        ))}
      </nav>

      <Section id="payments" title="租税公課の納付（別表五(二)）" actions={<SaveBtn k="tax_payments" />} error={err.tax_payments}>
        <Notice>
          当期に納付した税金を、<b>どう記帳したか</b>で分けて入力します。③充当金取崩し＝未払法人税等を減らした、④仮払経理＝仮払税金などの資産にした、⑤損金経理＝費用（法人税等・租税公課）にした。当期確定分は自動で作ります。
        </Notice>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="中間申告分の法人税額（別表一「14」）">
            <YenInput value={tp.interim_corporate_tax} disabled={locked} onChange={(v) => setS({ ...s, tax_payments: { ...tp, interim_corporate_tax: v } })} />
          </Field>
          <Field label="中間申告分の地方法人税額（「39」）">
            <YenInput value={tp.interim_local_corporate_tax} disabled={locked} onChange={(v) => setS({ ...s, tax_payments: { ...tp, interim_local_corporate_tax: v } })} />
          </Field>
          <Field label="中間申告分の防衛特別法人税額" hint="中間申告は令和9年4月1日以後開始の事業年度から">
            <YenInput value={tp.interim_defense_tax} disabled={locked} onChange={(v) => setS({ ...s, tax_payments: { ...tp, interim_defense_tax: v } })} />
          </Field>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-1">税目</th>
                <th className="py-1 pr-1">区分</th>
                <th className="py-1 pr-1">事業年度・名称</th>
                <th className="py-1 pr-1 text-right">①期首未納</th>
                <th className="py-1 pr-1 text-right">②当期発生</th>
                <th className="py-1 pr-1 text-right">③充当金取崩し</th>
                <th className="py-1 pr-1 text-right">④仮払経理</th>
                <th className="py-1 pr-1 text-right">⑤損金経理</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {tp.payments.map((p, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-1">
                    <Select value={p.tax} disabled={locked} onChange={(e) => setPay(i, { tax: e.target.value as Payment["tax"], period: e.target.value === "other" ? "other" : p.period === "other" ? "prior" : p.period })} className="text-xs">
                      {Object.entries(TAX).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 pr-1">
                    {p.tax === "other" ? (
                      <Select value={p.other_kind} disabled={locked} onChange={(e) => setPay(i, { other_kind: e.target.value as Payment["other_kind"] })} className="text-xs">
                        <option value="">損金算入か選ぶ</option>
                        <option value="deductible">損金算入（利子税など）</option>
                        <option value="nondeductible">損金不算入（延滞税・加算税など）</option>
                      </Select>
                    ) : (
                      <Select value={p.period} disabled={locked} onChange={(e) => setPay(i, { period: e.target.value as Payment["period"] })} className="text-xs">
                        <option value="prior">{PERIOD.prior}</option>
                        <option value="interim">{PERIOD.interim}</option>
                      </Select>
                    )}
                  </td>
                  <td className="py-1 pr-1">
                    <TextInput value={p.label} disabled={locked} onChange={(e) => setPay(i, { label: e.target.value })} className="text-xs" placeholder={p.tax === "other" ? "延滞税 など" : "例：2024-10-01〜2025-09-30"} />
                  </td>
                  <td className="w-28 py-1 pr-1">{p.period !== "interim" ? <YenInput value={p.opening_unpaid} disabled={locked} onChange={(v) => setPay(i, { opening_unpaid: v })} /> : <span className="block text-center text-slate-300">—</span>}</td>
                  <td className="w-28 py-1 pr-1">
                    {p.period === "prior" ? (
                      <span className="block text-center text-slate-300">—</span>
                    ) : p.tax === "national" ? (
                      <span className="block pt-1.5 text-right text-slate-500" title="中間申告分の3税目の合計">
                        {yen((tp.interim_corporate_tax ?? 0) + (tp.interim_local_corporate_tax ?? 0) + (tp.interim_defense_tax ?? 0))}
                      </span>
                    ) : (
                      <YenInput value={p.accrued} disabled={locked} onChange={(v) => setPay(i, { accrued: v })} />
                    )}
                  </td>
                  <td className="w-28 py-1 pr-1">
                    <YenInput value={p.paid_provision} disabled={locked} onChange={(v) => setPay(i, { paid_provision: v })} />
                  </td>
                  <td className="w-28 py-1 pr-1">
                    <YenInput value={p.paid_suspense} disabled={locked} onChange={(v) => setPay(i, { paid_suspense: v })} />
                  </td>
                  <td className="w-28 py-1 pr-1">
                    <YenInput value={p.paid_expense} disabled={locked} onChange={(v) => setPay(i, { paid_expense: v })} />
                  </td>
                  <td className="py-1">
                    {!locked && (
                      <Button size="sm" variant="ghost" onClick={() => setS({ ...s, tax_payments: { ...tp, payments: tp.payments.filter((_, j) => j !== i) } })}>
                        削除
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!locked && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(["national", "prefectural", "municipal", "enterprise"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                onClick={() =>
                  setS({ ...s, tax_payments: { ...tp, payments: [...tp.payments, { tax: t, period: "prior", label: "", other_kind: "", opening_unpaid: 0, accrued: 0, paid_provision: 0, paid_suspense: 0, paid_expense: 0 }] } })
                }
              >
                ＋ {TAX[t]}
              </Button>
            ))}
            <Button
              size="sm"
              onClick={() =>
                setS({ ...s, tax_payments: { ...tp, payments: [...tp.payments, { tax: "other", period: "other", label: "延滞税", other_kind: "nondeductible", opening_unpaid: 0, accrued: 0, paid_provision: 0, paid_suspense: 0, paid_expense: 0 }] } })
              }
            >
              ＋ その他（延滞税・利子税など）
            </Button>
          </div>
        )}
      </Section>

      <Section id="provision" title="納税充当金（未払法人税等）" actions={<SaveBtn k="provision" />} error={err.provision}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="損金経理をした納税充当金（別表五(二)「31」）"
            hint={
              <>
                当期に「法人税、住民税及び事業税」として未払法人税等に計上した額。試算表の未払法人税等の貸方：{yen(h.provision_charged_hint)} 円
                {h.provision_charged_hint !== null && !locked && (
                  <button className="ml-1 text-indigo-700 underline" onClick={() => setS({ ...s, provision: { ...s.provision, provision_charged: h.provision_charged_hint } })}>
                    この額を使う
                  </button>
                )}
              </>
            }
          >
            <YenInput value={s.provision.provision_charged} disabled={locked} onChange={(v) => setS({ ...s, provision: { ...s.provision, provision_charged: v } })} />
          </Field>
          <Field label="その他の繰入額（「32」）">
            <YenInput value={s.provision.provision_other_charged} disabled={locked} onChange={(v) => setS({ ...s, provision: { ...s.provision, provision_other_charged: v } })} />
          </Field>
          <Field label="仮払税金消却（「39」）" hint="前期の仮払税金を未払法人税等と相殺した額">
            <YenInput value={s.provision.provision_suspense_cleared} disabled={locked} onChange={(v) => setS({ ...s, provision: { ...s.provision, provision_suspense_cleared: v } })} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          試算表：未払法人税等 期首 {yen(h.tax_provision_open)} 円・期末 {yen(h.tax_provision_close)} 円。別表五(二)「41」期末納税充当金：{yen(ret?.cells["b5_2:41:value"]?.value)} 円
        </p>
      </Section>

      <Section id="local" title="地方税（当期確定分・手入力）" actions={<SaveBtn k="local_taxes" />} error={err.local_taxes}>
        <Notice tone="warning">
          法人住民税・事業税の税額計算は Phase 3 で実装予定です。今は地方税の申告書（または見込みの計算）の<b>確定申告で納める額</b>（中間納付を除く）を入力してください。入力した値は「要確認」として扱います。法人税が0円でも均等割はかかります。
        </Notice>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="道府県民税（都民税）当期確定分" hint="均等割を含む。東京都23区は市町村民税相当分も含めて都民税で入力">
            <YenInput value={s.local_taxes.final_prefectural} disabled={locked} onChange={(v) => setS({ ...s, local_taxes: { ...s.local_taxes, final_prefectural: v } })} />
          </Field>
          <Field label="市町村民税 当期確定分" hint="均等割を含む。23区は0">
            <YenInput value={s.local_taxes.final_municipal} disabled={locked} onChange={(v) => setS({ ...s, local_taxes: { ...s.local_taxes, final_municipal: v } })} />
          </Field>
          <Field label="事業税・特別法人事業税 当期確定分（参考）" hint="翌期の損金。未払法人税等の計上額の確認に使います">
            <YenInput value={s.local_taxes.final_enterprise} disabled={locked} onChange={(v) => setS({ ...s, local_taxes: { ...s.local_taxes, final_enterprise: v } })} />
          </Field>
          <div className="md:col-span-3">
            <Field label="金額の出所">
              <TextInput value={s.local_taxes.source_note} disabled={locked} onChange={(e) => setS({ ...s, local_taxes: { ...s.local_taxes, source_note: e.target.value } })} placeholder="例：都民税申告書の控え（令和8年11月作成）" />
            </Field>
          </div>
        </div>
      </Section>

      <Section id="withholding" title="源泉所得税（別表六(一)）" actions={<SaveBtn k="withholding" />} error={err.withholding}>
        <p className="mb-2 text-sm text-slate-500">
          預金利子・配当などから源泉徴収された所得税（復興特別所得税を含む）を入力します。
          {h.income_accounts.length > 0 && <> 試算表：{h.income_accounts.map((a) => `${a.name} ${yen(a.closing)}円`).join("、")}</>}
        </p>
        <table className="min-w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-1">区分</th>
              <th className="py-1 pr-1">支払者</th>
              <th className="py-1 pr-1 text-right">収入金額</th>
              <th className="py-1 pr-1 text-right">所得税額</th>
              <th className="py-1 pr-1">記帳方法</th>
              <th className="py-1 pr-1">配当の計算期間／うち所有期間（月）</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {s.withholding.items.map((w, i) => {
              const upd = (p: Partial<typeof w>) => setS({ ...s, withholding: { ...s.withholding, items: s.withholding.items.map((x, j) => (j === i ? { ...x, ...p } : x)) } });
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-1">
                    <Select value={w.category} disabled={locked} onChange={(e) => upd({ category: e.target.value, method: e.target.value === "dividend" || e.target.value === "investment_trust" ? "individual" : "full" })} className="text-xs">
                      <option value="interest">預貯金の利子など</option>
                      <option value="dividend">剰余金の配当など</option>
                      <option value="investment_trust">集団投資信託の収益の分配</option>
                      <option value="discount_bond">割引債の償還差益</option>
                      <option value="other">その他</option>
                    </Select>
                  </td>
                  <td className="py-1 pr-1">
                    <TextInput value={w.payer} disabled={locked} onChange={(e) => upd({ payer: e.target.value })} className="text-xs" />
                  </td>
                  <td className="w-28 py-1 pr-1">
                    <YenInput value={w.gross_income} disabled={locked} onChange={(v) => upd({ gross_income: v })} />
                  </td>
                  <td className="w-28 py-1 pr-1">
                    <YenInput value={w.tax_withheld} disabled={locked} onChange={(v) => upd({ tax_withheld: v })} />
                  </td>
                  <td className="py-1 pr-1">
                    <Select value={w.booking} disabled={locked} onChange={(e) => upd({ booking: e.target.value })} className="text-xs">
                      <option value="expense">費用（法人税等・租税公課）</option>
                      <option value="net">受取額から差し引いて記帳</option>
                      <option value="suspense">仮払税金などの資産</option>
                    </Select>
                  </td>
                  <td className="py-1 pr-1">
                    {w.category === "dividend" || w.category === "investment_trust" ? (
                      <div className="flex gap-1">
                        <TextInput type="number" min={1} value={w.calc_months ?? ""} disabled={locked} onChange={(e) => upd({ calc_months: e.target.value ? Number(e.target.value) : null })} className="w-16 text-xs" />
                        <TextInput type="number" min={0} value={w.owned_months ?? ""} disabled={locked} onChange={(e) => upd({ owned_months: e.target.value ? Number(e.target.value) : null })} className="w-16 text-xs" />
                      </div>
                    ) : (
                      <span className="text-slate-400">全額控除</span>
                    )}
                  </td>
                  <td className="py-1">
                    {!locked && (
                      <Button size="sm" variant="ghost" onClick={() => setS({ ...s, withholding: { ...s.withholding, items: s.withholding.items.filter((_, j) => j !== i) } })}>
                        削除
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!locked && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() =>
                setS({ ...s, withholding: { ...s.withholding, items: [...s.withholding.items, { category: "interest", payer: "", gross_income: null, tax_withheld: null, booking: "expense", method: "full", calc_months: null, owned_months: null, received_on: null }] } })
              }
            >
              ＋ 行を追加
            </Button>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={s.withholding.none_confirmed} onChange={(e) => setS({ ...s, withholding: { ...s.withholding, none_confirmed: e.target.checked } })} />
              源泉徴収された所得税はないことを確認した
            </label>
          </div>
        )}
      </Section>

      <Section id="entertainment" title="交際費等（別表十五）" actions={<SaveBtn k="entertainment" />} error={err.entertainment}>
        <p className="mb-2 text-sm text-slate-500">
          科目ごとに、交際費等の支出額と、そのうち接待飲食費の額を入力します。
          {h.entertainment_accounts.length > 0 && <> 試算表：{h.entertainment_accounts.map((a) => `${a.name} ${yen(a.closing)}円`).join("、")}</>}
          {h.meeting_accounts.length > 0 && <>。会議費（{h.meeting_accounts.map((a) => `${a.name} ${yen(a.closing)}円`).join("、")}）に交際費等が含まれていないかも確認してください</>}
        </p>
        <table className="min-w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-1">科目</th>
              <th className="py-1 pr-1 text-right">支出額（6）</th>
              <th className="py-1 pr-1 text-right">交際費等から控除される費用（7）</th>
              <th className="py-1 pr-1 text-right">うち接待飲食費（9）</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {s.entertainment.rows.map((r, i) => {
              const upd = (p: Partial<typeof r>) => setS({ ...s, entertainment: { ...s.entertainment, rows: s.entertainment.rows.map((x, j) => (j === i ? { ...x, ...p } : x)) } });
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-1">
                    <TextInput value={r.account} disabled={locked} onChange={(e) => upd({ account: e.target.value })} className="text-xs" />
                  </td>
                  <td className="w-36 py-1 pr-1">
                    <YenInput value={r.spent} disabled={locked} onChange={(v) => upd({ spent: v })} />
                  </td>
                  <td className="w-36 py-1 pr-1">
                    <YenInput value={r.excluded} disabled={locked} onChange={(v) => upd({ excluded: v })} />
                  </td>
                  <td className="w-36 py-1 pr-1">
                    <YenInput value={r.food} disabled={locked} onChange={(v) => upd({ food: v })} />
                  </td>
                  <td className="py-1">
                    {!locked && (
                      <Button size="sm" variant="ghost" onClick={() => setS({ ...s, entertainment: { ...s.entertainment, rows: s.entertainment.rows.filter((_, j) => j !== i) } })}>
                        削除
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!locked && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => setS({ ...s, entertainment: { ...s.entertainment, rows: [...s.entertainment.rows, { account: "交際費", spent: null, excluded: 0, food: null }] } })}>
              ＋ 行を追加
            </Button>
            {h.entertainment_accounts.length > 0 && s.entertainment.rows.length === 0 && (
              <Button size="sm" onClick={() => setS({ ...s, entertainment: { ...s.entertainment, rows: h.entertainment_accounts.map((a) => ({ account: a.name, spent: a.closing, excluded: 0, food: null })) } })}>
                試算表の交際費の科目から行を作る
              </Button>
            )}
          </div>
        )}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" disabled={locked} checked={s.entertainment.reviewed_small_meals} onChange={(e) => setS({ ...s, entertainment: { ...s.entertainment, reviewed_small_meals: e.target.checked } })} className="mt-1" />
          <span>
            1人当たり10,000円以下の飲食費（令和6年4月1日以後の支出、社内飲食費を除く）を、書類の保存を確認したうえで交際費等から除いた
            <span className="block text-xs text-slate-500">仕訳の摘要（人数・金額）と領収書で確認します。除いた後の額を「支出額」に入力してください。</span>
          </span>
        </label>
        {ret?.cells["b15:5:value"] && (
          <p className="mt-2 text-sm">
            計算結果：損金不算入額（別表十五「5」）<Money v={ret.cells["b15:5:value"].value} className="font-semibold" /> 円（{ret.cells["b15:4:value"]?.formula}）
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ id, title, actions, children, error }: { id: string; title: string; actions?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <div id={id} className="scroll-mt-24">
      <Card title={title} actions={actions}>
        {children}
        {error && (
          <div className="mt-2">
            <ErrorBox message={error} />
          </div>
        )}
      </Card>
    </div>
  );
}
