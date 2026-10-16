"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, ErrorBox, Field, Modal, Select, Spinner, StatusBadge, TextInput, Tabs, useToast } from "@/components/ui";
import { FindingItem, PageTitle, useYear } from "@/components/year";
import { api, download, useApi } from "@/lib/api";
import { dateTimeJa } from "@/lib/format";
import type { Finding } from "@/lib/types";

type Snapshot = { id: number; kind: string; engine_version: string; input_hash: string; rules_used: { rule_id: string; version: string }[]; critical_count: number; warning_count: number; created_by: { display_name: string } | null; created_at: string };

export default function ReviewPage() {
  const { fid, fy, ret, reloadReturn, reloadFy, locked } = useYear();
  const { user, meta } = useApp();
  const router = useRouter();
  const snaps = useApi<Snapshot[]>(`/fiscal-years/${fid}/snapshots`);
  const [tab, setTab] = useState<"critical" | "warning" | "info" | "done">("critical");
  const [ack, setAck] = useState<Finding | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const { toast, toastNode } = useToast();

  if (!ret) return <Spinner label="計算しています…" />;
  const canApprove = user.role === "reviewer" || user.role === "admin";
  const list = ret.findings.filter((f) => (tab === "done" ? f.acknowledged : !f.acknowledged && f.severity === tab));
  const requiredMissing = ret.required.filter((r) => r.needed && !r.implemented);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setErr(null);
    try {
      await fn();
      toast(msg);
      await reloadFy();
      await reloadReturn();
      await snaps.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      {toastNode}
      <PageTitle
        title="最終チェック"
        help="すべての重大エラーを解決すると、レビュー担当者が承認できます。要確認は内容を確認して「確認済み」にします。承認は申告書の内容を確定する操作で、電子申告の送信や納税はしません。"
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="状態と承認" className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={fy.status} label={fy.status_label} />
            <Badge className={ret.counts.critical ? "bg-rose-50 text-rose-700 ring-rose-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}>重大エラー {ret.counts.critical}</Badge>
            <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">要確認（未確認） {ret.counts.warning_open}</Badge>
            <Badge className="bg-sky-50 text-sky-700 ring-sky-600/20">参考情報 {ret.counts.info}</Badge>
            <span className="text-slate-500">レビュー担当者：{fy.reviewer?.display_name ?? "未指定"}</span>
            {fy.approved_at && <span className="text-slate-500">承認：{fy.approver?.display_name}（{dateTimeJa(fy.approved_at)}）</span>}
          </div>
          {ret.approved_snapshot && (
            <p className="mt-2 text-xs text-slate-500">
              承認時の計算結果を保存済み（{dateTimeJa(ret.approved_snapshot.created_at)}）。
              {ret.approved_snapshot.matches_current ? "現在の入力と一致しています。" : "承認後に入力が変わっています（ルールの版・入力のハッシュが異なる）。"}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {!locked && (
              <Field label="進捗を変える">
                <Select
                  value={fy.status}
                  onChange={(e) => run(() => api(`/fiscal-years/${fid}/status`, { method: "POST", json: { status: e.target.value } }), "進捗を変えました")}
                >
                  {meta.statuses
                    .filter((s) => !["approved", "filed"].includes(s.key))
                    .map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            {!locked && canApprove && (
              <>
                <Field label="承認のメモ">
                  <TextInput value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="任意" />
                </Field>
                <Button variant="primary" disabled={ret.counts.critical > 0} onClick={() => run(() => api(`/fiscal-years/${fid}/approve`, { method: "POST", json: { note: approveNote } }), "承認しました")}>
                  承認する
                </Button>
              </>
            )}
            {!locked && !canApprove && <p className="text-sm text-slate-500">承認はレビュー担当者・管理者が行います。準備ができたら進捗を「レビュー待ち」にしてください。</p>}
            {locked && canApprove && (
              <>
                <Button
                  onClick={() => {
                    const reason = window.prompt("承認を取り消す理由");
                    if (reason) void run(() => api(`/fiscal-years/${fid}/unapprove`, { method: "POST", json: { note: reason } }), "承認を取り消しました");
                  }}
                >
                  承認を取り消す
                </Button>
                {fy.status === "approved" && (
                  <Button onClick={() => run(() => api(`/fiscal-years/${fid}/status`, { method: "POST", json: { status: "filed", note: "申告済み（本システムの外で提出）" } }), "申告済にしました")}>
                    申告済にする
                  </Button>
                )}
              </>
            )}
            {locked && (
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    const n = await api<{ id: number }>(`/fiscal-years/${fid}/next-year`, { method: "POST" });
                    router.push(`/years/${n.id}/opening`);
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                翌期を作って引き継ぐ
              </Button>
            )}
          </div>
          {ret.counts.critical > 0 && !locked && <p className="mt-2 text-sm text-rose-700">重大エラーが {ret.counts.critical} 件あるため、承認できません。</p>}
          <div className="mt-2">
            <ErrorBox message={err} />
          </div>
        </Card>
        <Card title="出力">
          <div className="space-y-2">
            <Button className="w-full" onClick={() => download(`/fiscal-years/${fid}/export.xlsx`, `houjinzei-draft-${fid}.xlsx`)}>
              Excel（別表・計算根拠・指摘）
            </Button>
            <Button className="w-full" onClick={() => download(`/fiscal-years/${fid}/export.csv`, `houjinzei-draft-${fid}.csv`)}>
              CSV（全欄）
            </Button>
            <p className="text-xs text-slate-500">
              確認用のドラフトです。正式様式の PDF・電子申告（e-Tax）用データは未対応です（Phase 5。e-Tax の仕様の検証後に判断）。
            </p>
          </div>
        </Card>
      </div>
      <Card title="指摘一覧">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "critical", label: `重大エラー ${ret.counts.critical}` },
            { key: "warning", label: `要確認 ${ret.counts.warning_open}` },
            { key: "info", label: `参考情報 ${ret.counts.info}` },
            { key: "done", label: `確認済み ${ret.findings.filter((f) => f.acknowledged).length}` },
          ]}
        />
        <ul className="mt-3 space-y-2">
          {list.map((f) => (
            <FindingItem
              key={f.fingerprint}
              f={f}
              fid={fid}
              onAck={locked ? undefined : (x) => setAck(x)}
              onUnack={locked ? undefined : (x) => run(() => api(`/fiscal-years/${fid}/acks/${x.fingerprint}`, { method: "DELETE" }), "確認を取り消しました")}
            />
          ))}
          {list.length === 0 && <li className="py-6 text-center text-sm text-slate-500">該当する指摘はありません。</li>}
        </ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="必要な別表・書類">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {ret.required.map((r) => (
                <tr key={r.form} className={!r.needed ? "text-slate-400" : ""}>
                  <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{r.form}</td>
                  <td className="py-1.5 pr-2 text-xs">{r.reason}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {!r.needed ? (
                      <Badge>不要</Badge>
                    ) : r.implemented ? (
                      r.view ? (
                        <Link href={`/years/${fid}/return?schedule=${r.view}`}>
                          <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">作成済み →</Badge>
                        </Link>
                      ) : (
                        <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">作成済み</Badge>
                      )
                    ) : (
                      <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">別途作成</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {requiredMissing.length > 0 && <p className="mt-2 text-xs text-slate-500">「別途作成」は本システムで未実装の書類です。他の方法で作成して添付してください。</p>}
        </Card>
        <Card title="計算結果の履歴（スナップショット）">
          {!snaps.data ? (
            <Spinner />
          ) : snaps.data.length === 0 ? (
            <p className="text-sm text-slate-500">まだ保存していません。承認すると自動で保存します。</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {snaps.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <Badge className={s.kind === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : undefined}>{s.kind === "approved" ? "承認" : "保存"}</Badge>
                  <span>{dateTimeJa(s.created_at)}</span>
                  <span className="text-slate-500">{s.created_by?.display_name}</span>
                  <span className="text-xs text-slate-400">
                    エンジン {s.engine_version}・重大 {s.critical_count}・ルール {s.rules_used.length}件
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="進捗の履歴">
        <ul className="space-y-1 text-sm">
          {fy.history.map((h, i) => (
            <li key={i}>
              {dateTimeJa(h.at)}　{h.by?.display_name ?? "—"}：{meta.statuses.find((s) => s.key === h.from)?.label ?? "（新規）"} → {meta.statuses.find((s) => s.key === h.to)?.label}
              {h.note ? `（${h.note}）` : ""}
            </li>
          ))}
        </ul>
      </Card>
      <Modal
        open={!!ack}
        onClose={() => setAck(null)}
        title="確認済みにする"
        footer={
          <>
            <Button onClick={() => setAck(null)}>やめる</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const f = ack!;
                setAck(null);
                await run(() => api(`/fiscal-years/${fid}/acks`, { method: "POST", json: { fingerprint: f.fingerprint, code: f.code, note } }), "確認済みにしました");
                setNote("");
              }}
            >
              確認済みにする
            </Button>
          </>
        }
      >
        <p className="text-sm">{ack?.title}</p>
        <Field label="確認した内容（記録に残ります）">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：都民税申告書の控えと一致" />
        </Field>
      </Modal>
    </div>
  );
}
