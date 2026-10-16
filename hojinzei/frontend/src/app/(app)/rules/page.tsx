"use client";

import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, ErrorBox, Field, Notice, Spinner, TextInput } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateJa, dateTimeJa } from "@/lib/format";
import type { RuleVersion } from "@/lib/types";

type Rule = { id: string; title: string; basis: string; description: string; versions: RuleVersion[] };

const STATUS_CLS: Record<string, string> = {
  source_checked: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  unverified: "bg-rose-50 text-rose-700 ring-rose-600/20",
  not_applicable: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export default function RulesPage() {
  const { user } = useApp();
  const rules = useApi<Rule[]>("/rules");
  const [form, setForm] = useState<{ rule: string; version: string } | null>(null);
  const [name, setName] = useState(user.display_name);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (rules.error) return <ErrorBox message={rules.error} />;
  if (!rules.data) return <Spinner />;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">税率・法令（ルールデータ）</h1>
        <p className="max-w-4xl text-sm text-slate-500">
          計算に使う税率・金額基準を、根拠資料・適用期間・確認者とともに版で管理しています。版は削除せず追加するので、過年度の申告も当時の版で計算し直せます。「未確認」の版を使う年度は確定できません。
        </p>
      </div>
      <Notice tone="warning">
        「一次資料と照合済み」は、国税庁の資料と照合したことを示します（照合：Claude（AI））。税理士等の専門家による確認は「専門家レビュー」として別に記録します。税制改正があったら、docs/04_税制改正時の更新方法.md の手順で版を追加してください。
      </Notice>
      {rules.data.map((r) => (
        <Card key={r.id} title={<span>{r.title} <span className="ml-1 text-xs font-normal text-slate-500">（{r.id}・判定の基準日：{r.versions[0]?.basis_label}）</span></span>}>
          {r.description && <p className="mb-3 text-sm text-slate-600">{r.description}</p>}
          <div className="space-y-3">
            {r.versions.map((v) => {
              const current = v.valid_from <= today && (!v.valid_to || today <= v.valid_to);
              return (
                <div key={v.version} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">版 {v.version}</span>
                    <span className="num text-slate-600">
                      {dateJa(v.valid_from)}〜{v.valid_to ? dateJa(v.valid_to) : "（終了日なし）"}
                    </span>
                    <Badge className={STATUS_CLS[v.status]}>{v.status_label}</Badge>
                    {current && <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-600/20">今日に当たる版</Badge>}
                    <span className="text-xs text-slate-500">
                      確認：{v.checked_by || "—"} {v.checked_at}・専門家レビュー：{v.reviews?.length ? `${v.reviews.length}件` : v.expert_review}
                    </span>
                  </div>
                  {v.conditions && <p className="mt-1 text-sm text-slate-700">{v.conditions}</p>}
                  {Object.keys(v.values).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {Object.entries(v.values).map(([k, val]) => (
                        <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                          {k}={val === null ? "—" : String(val)}
                        </span>
                      ))}
                    </div>
                  )}
                  {v.sources.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {v.sources.map((s) => (
                        <li key={s.url + s.title}>
                          <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                            {s.title}
                          </a>
                          {s.provisions && <span className="text-slate-500">（{s.provisions}）</span>}
                          {s.checked && <span className="text-slate-500"> 確認した内容：{s.checked}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {v.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                  {!!v.reviews?.length && (
                    <ul className="mt-2 space-y-0.5 text-xs text-emerald-800">
                      {v.reviews.map((rv, i) => (
                        <li key={i}>
                          ✓ {rv.reviewer_name}（{dateTimeJa(rv.reviewed_at)}）{rv.note ? `：${rv.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(user.role === "reviewer" || user.role === "admin") && v.status === "source_checked" && (
                    <div className="mt-2">
                      {form?.rule === r.id && form.version === v.version ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="確認した専門家">
                            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
                          </Field>
                          <Field label="確認した内容">
                            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：措法42の3の2の条文と照合" />
                          </Field>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={async () => {
                              setErr(null);
                              try {
                                await api(`/rules/${r.id}/${encodeURIComponent(v.version)}/reviews`, { method: "POST", json: { reviewer_name: name, note } });
                                setForm(null);
                                setNote("");
                                await rules.reload();
                              } catch (e) {
                                setErr(e instanceof Error ? e.message : String(e));
                              }
                            }}
                          >
                            記録する
                          </Button>
                          <Button size="sm" onClick={() => setForm(null)}>
                            やめる
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setForm({ rule: r.id, version: v.version })}>
                          専門家の確認を記録
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      <ErrorBox message={err} />
    </div>
  );
}
