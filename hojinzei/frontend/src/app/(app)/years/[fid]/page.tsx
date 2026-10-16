"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Button, Card, ErrorBox, Field, Money, Notice, Select, YenInput, useToast } from "@/components/ui";
import { FindingItem, PageFindings, STEPS, pageOf, useYear } from "@/components/year";
import { api, useApi } from "@/lib/api";
import type { User } from "@/lib/types";

const tri = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const fromTri = (s: string) => (s === "" ? null : s === "yes");

export default function YearOverview() {
  const { fid, fy, ret, reloadFy, reloadReturn, locked } = useYear();
  const { meta } = useApp();
  const users = useApi<User[]>("/users");
  const { toast, toastNode } = useToast();
  const [f, setF] = useState({ ...fy });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setF({ ...fy }), [fy]);

  async function save() {
    setErr(null);
    try {
      await api(`/fiscal-years/${fid}`, {
        method: "PATCH",
        json: {
          capital_end: f.capital_end,
          large_corp_subsidiary: f.large_corp_subsidiary,
          tekiyo_jogai: f.tekiyo_jogai,
          dividends: f.dividends,
          blue_return: f.blue_return,
          return_kind: f.return_kind,
          group_tsusan: f.group_tsusan,
          unsupported_features: f.unsupported_features,
          reviewer_id: f.reviewer_id,
        },
      });
      toast("保存しました。再計算しています");
      await reloadFy();
      await reloadReturn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const open = (ret?.findings ?? []).filter((x) => !x.acknowledged && x.severity !== "info");
  const next = STEPS.slice(1).map((st) => ({ st, n: open.filter((x) => pageOf(x) === st.key) })).filter((x) => x.n.length);
  const s = ret?.summary;
  const reviewers = (users.data ?? []).filter((u) => u.role === "reviewer" || u.role === "admin");

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
      {toastNode}
      <div className="space-y-4">
        <Card title="次にやること">
          {!ret ? (
            <p className="text-sm text-slate-500">計算中…</p>
          ) : next.length === 0 ? (
            <Notice tone="success">未解決の重大エラー・要確認はありません。「最終チェック」でレビュー担当者の承認に進めます。</Notice>
          ) : (
            <ol className="space-y-2">
              {next.map(({ st, n }) => {
                const crit = n.filter((x) => x.severity === "critical").length;
                return (
                  <li key={st.key} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                    <div>
                      <div className="font-medium">{st.label}</div>
                      <div className="text-xs text-slate-500">
                        {crit ? <span className="font-semibold text-rose-700">重大エラー {crit}件</span> : null}
                        {crit && n.length - crit ? "・" : ""}
                        {n.length - crit ? `要確認 ${n.length - crit}件` : ""}　例：{n[0].title}
                      </div>
                    </div>
                    <Link href={`/years/${fid}/${st.key}`} className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
                      開く
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <Card title="年度の基本情報（中小法人の判定など）" actions={!locked && <Button variant="primary" onClick={save}>保存</Button>}>
          <PageFindings page="" />
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="期末資本金の額" hint="試算表の資本金の残高を候補として入れています。登記と一致するか確認してください">
              <YenInput value={f.capital_end} onChange={(v) => setF({ ...f, capital_end: v })} disabled={locked} />
            </Field>
            <Field label="当期に効力が生じた剰余金の配当" hint="別表四「1」の③配当（なければ0）">
              <YenInput value={f.dividends} onChange={(v) => setF({ ...f, dividends: v })} disabled={locked} />
            </Field>
            <Field label="大法人（資本金5億円以上など）の100%子会社等に当たるか" hint="当たると、資本金1億円以下でも中小法人になりません（法人税法第66条第5項）">
              <Select value={tri(f.large_corp_subsidiary)} onChange={(e) => setF({ ...f, large_corp_subsidiary: fromTri(e.target.value) })} disabled={locked}>
                <option value="">未確認</option>
                <option value="no">当たらない</option>
                <option value="yes">当たる</option>
              </Select>
            </Field>
            <Field label="適用除外事業者に当たるか" hint="前3事業年度の所得の平均が年15億円超なら軽減税率は19%">
              <Select value={tri(f.tekiyo_jogai)} onChange={(e) => setF({ ...f, tekiyo_jogai: fromTri(e.target.value) })} disabled={locked}>
                <option value="">未確認</option>
                <option value="no">当たらない</option>
                <option value="yes">当たる</option>
              </Select>
            </Field>
            <Field label="申告の種類">
              <div className="flex gap-2">
                <Select value={f.blue_return ? "blue" : "white"} onChange={(e) => setF({ ...f, blue_return: e.target.value === "blue" })} disabled={locked}>
                  <option value="blue">青色申告</option>
                  <option value="white">白色申告（未対応）</option>
                </Select>
                <Select value={f.return_kind} onChange={(e) => setF({ ...f, return_kind: e.target.value })} disabled={locked}>
                  <option value="final">確定申告</option>
                  <option value="amended">修正申告（未対応）</option>
                  <option value="interim">中間申告（未対応）</option>
                </Select>
              </div>
            </Field>
            <Field label="レビュー担当者" hint="承認できるのはレビュー担当者・管理者です">
              <Select value={f.reviewer_id ?? ""} onChange={(e) => setF({ ...f, reviewer_id: e.target.value ? Number(e.target.value) : null })} disabled={locked}>
                <option value="">未指定</option>
                {reviewers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <div className="mb-1 text-sm font-medium text-slate-700">当期にある論点（本システムでは自動計算しないもの）</div>
              <p className="mb-2 text-xs text-slate-500">当てはまるものに印を付けてください。印があると、確定（承認）できなくなります。</p>
              <div className="grid gap-1 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.group_tsusan} disabled={locked} onChange={(e) => setF({ ...f, group_tsusan: e.target.checked })} />
                  グループ通算制度
                </label>
                {meta.unsupported_features.map((u) => (
                  <label key={u.key} className="flex items-center gap-2 text-sm" title={u.note}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={f.unsupported_features.includes(u.key)}
                      onChange={(e) =>
                        setF({
                          ...f,
                          unsupported_features: e.target.checked ? [...f.unsupported_features, u.key] : f.unsupported_features.filter((k) => k !== u.key),
                        })
                      }
                    />
                    {u.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <ErrorBox message={err} />
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="計算結果の要約">
          {!s ? (
            <p className="text-sm text-slate-500">計算中…</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate-500">中小法人の判定</dt>
              <dd>{s.sme === null ? <span className="text-amber-700">未確定</span> : s.sme ? "中小法人" : "中小法人に当たらない"}</dd>
              <dt className="text-slate-500">所得金額又は欠損金額</dt>
              <dd className="text-right"><Money v={s.income} /></dd>
              <dt className="text-slate-500">欠損金の当期控除額</dt>
              <dd className="text-right"><Money v={s.loss_deduction} /></dd>
              <dt className="text-slate-500">差引所得に対する法人税額</dt>
              <dd className="text-right"><Money v={s.corporate_tax} /></dd>
              <dt className="text-slate-500">差引確定法人税額</dt>
              <dd className="text-right font-semibold"><Money v={s.corporate_final} /></dd>
              <dt className="text-slate-500">差引確定地方法人税額</dt>
              <dd className="text-right font-semibold"><Money v={s.local_corporate_final} /></dd>
              <dt className="text-slate-500">差引確定防衛特別法人税額</dt>
              <dd className="text-right font-semibold">{s.defense_applicable ? <Money v={s.defense_final} /> : <span className="text-xs text-slate-400">課税事業年度でない</span>}</dd>
              <dt className="text-slate-500">還付金額（法人税・地方法人税）</dt>
              <dd className="text-right"><Money v={(s.corporate_refund ?? 0) + (s.local_refund ?? 0)} /></dd>
              <dt className="text-slate-500">翌期へ繰り越す欠損金額</dt>
              <dd className="text-right"><Money v={s.loss_carryforward} /></dd>
              <dt className="text-slate-500">期末の利益積立金額</dt>
              <dd className="text-right"><Money v={s.retained_earnings_close} /></dd>
            </dl>
          )}
        </Card>
        {s && (
          <Card title="計上すべき未払法人税等（参考）">
            <div className="text-right text-lg font-semibold"><Money v={s.recommended_tax_provision} /></div>
            <p className="mt-1 text-xs text-slate-500">{s.recommended_tax_provision_note}。決算で計上した未払法人税等と比べ、決算整理仕訳の要否を確認してください。課税所得は計上額によって変わりません（別表四「4」で全額加算するため）。</p>
          </Card>
        )}
        {ret && open.filter((x) => x.severity === "critical").length > 0 && (
          <Card title="重大エラー（確定を止めているもの）">
            <ul className="space-y-2">
              {open
                .filter((x) => x.severity === "critical")
                .slice(0, 5)
                .map((x) => (
                  <FindingItem key={x.fingerprint} f={x} fid={fid} />
                ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
