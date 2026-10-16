"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Money, Notice, Spinner, TextInput, YenInput, useToast } from "@/components/ui";
import { PageFindings, PageTitle, useYear } from "@/components/year";
import { api, useApi } from "@/lib/api";

type Carry = {
  id: number;
  kind: "retained" | "loss";
  key: string | null;
  name: string;
  amount: number | null;
  loss_fy_start: string | null;
  loss_fy_end: string | null;
  source: string;
  confirmed: boolean;
};
type OpeningMeta = { losses_confirmed: boolean; prior_retained_total: number | null; prior_unpaid_national: number | null; first_year: boolean; prior_provision_close: number | null };

const SOURCE: Record<string, string> = { carryover: "前期の計算結果から引継ぎ", manual: "手入力", pdf: "PDFから読取" };

export default function OpeningPage() {
  const { fid, ret, reloadReturn, locked } = useYear();
  const carry = useApi<Carry[]>(`/fiscal-years/${fid}/carryforward`);
  const inputs = useApi<{ sections: { opening_meta: OpeningMeta } }>(`/fiscal-years/${fid}/inputs`);
  const [meta, setMeta] = useState<OpeningMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  useEffect(() => {
    if (inputs.data) setMeta(inputs.data.sections.opening_meta);
  }, [inputs.data]);

  async function saveMeta() {
    setErr(null);
    try {
      await api(`/fiscal-years/${fid}/inputs/opening_meta`, { method: "PUT", json: meta });
      toast("保存しました");
      await reloadReturn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveItem(c: Partial<Carry> & { kind: "retained" | "loss" }, id?: number) {
    setErr(null);
    try {
      const body = { kind: c.kind, key: c.key ?? null, name: c.name, amount: c.amount ?? null, loss_fy_start: c.loss_fy_start || null, loss_fy_end: c.loss_fy_end || null, source: c.source ?? "manual", confirmed: !!c.confirmed };
      await api(id ? `/carryforward/${id}` : `/fiscal-years/${fid}/carryforward`, { method: id ? "PUT" : "POST", json: body });
      await carry.reload();
      await reloadReturn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeItem(id: number) {
    await api(`/carryforward/${id}`, { method: "DELETE" });
    await carry.reload();
    await reloadReturn();
  }

  if (!carry.data || !meta) return <Spinner />;
  const retained = carry.data.filter((c) => c.kind === "retained");
  const losses = carry.data.filter((c) => c.kind === "loss");
  const opening31 = ret?.cells["b5_1:31:1"]?.value ?? null;

  return (
    <div className="space-y-4">
      {toastNode}
      <PageTitle
        title="期首情報（前期からの引継ぎ）"
        help="前期の申告書（別表五(一)・五(二)・七(一)）から引き継ぐ金額です。前期を本システムで承認していれば自動で入ります。手入力・PDFから読み取った値は、前期の申告書の控えと照合して「確認済み」にしてください。"
      />
      <PageFindings page="opening" />
      <Card title="前期の申告書との照合" actions={!locked && <Button variant="primary" onClick={saveMeta}>保存</Button>}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={meta.first_year} disabled={locked} onChange={(e) => setMeta({ ...meta, first_year: e.target.checked })} />
            設立初年度（前期の申告書がない）
          </label>
          <Field label="前期の別表五(一)「31」④ 差引翌期首現在利益積立金額 合計" hint={opening31 !== null ? `当期の別表五(一)「31」① は ${opening31.toLocaleString()} 円です。一致しないと重大エラーになります。` : undefined}>
            <YenInput value={meta.prior_retained_total} allowNegative disabled={locked} onChange={(v) => setMeta({ ...meta, prior_retained_total: v })} />
          </Field>
          <Field label="前期の別表五(二)「5」⑥ 期末現在未納税額（法人税等）" hint="当期の「前期分」の期首未納と照合します">
            <YenInput value={meta.prior_unpaid_national} disabled={locked} onChange={(v) => setMeta({ ...meta, prior_unpaid_national: v })} />
          </Field>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={meta.losses_confirmed} disabled={locked} onChange={(e) => setMeta({ ...meta, losses_confirmed: e.target.checked })} />
            期首の繰越欠損金を前期の別表七(一)「5」で確認した（ない場合も印を付けます）
          </label>
        </div>
        <div className="mt-3">
          <ErrorBox message={err} />
        </div>
      </Card>
      <Card title="別表五(一)の期首の項目（繰越損益金・納税充当金・未納税額以外）">
        <p className="mb-3 text-sm text-slate-500">
          減価償却超過額・仮払税金など、前期までの税務調整で生じた差額です。繰越損益金・納税充当金・未納法人税等は試算表と別表五(二)から自動で入ります。
        </p>
        <ItemTable items={retained} kind="retained" locked={locked} onSave={saveItem} onRemove={removeItem} />
      </Card>
      <Card title="繰越欠損金（別表七(一)）">
        <p className="mb-3 text-sm text-slate-500">
          前期の別表七(一)「5」翌期繰越額を、生じた事業年度ごとに入力します。平成30年4月1日以後に開始した事業年度の欠損金は10年、それより前は9年繰り越せます。
        </p>
        <ItemTable items={losses} kind="loss" locked={locked} onSave={saveItem} onRemove={removeItem} />
      </Card>
      <Notice>前期の申告書 PDF から金額を読み取る機能は Phase 3 で実装予定です（読み取った値は原文・ページ番号・確信度と並べて表示し、人が確定する仕組みにします）。</Notice>
    </div>
  );
}

function ItemTable({ items, kind, locked, onSave, onRemove }: {
  items: Carry[];
  kind: "retained" | "loss";
  locked: boolean;
  onSave: (c: Partial<Carry> & { kind: "retained" | "loss" }, id?: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}) {
  const blank = { kind, name: kind === "loss" ? "欠損金" : "", amount: null, loss_fy_start: "", loss_fy_end: "", confirmed: false } as Partial<Carry> & { kind: typeof kind };
  const [draft, setDraft] = useState(blank);
  return (
    <table className="min-w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr>
          {kind === "loss" ? (
            <>
              <th className="py-1 pr-2">生じた事業年度（開始）</th>
              <th className="py-1 pr-2">（終了）</th>
            </>
          ) : (
            <th className="py-1 pr-2">名称</th>
          )}
          <th className="py-1 pr-2 text-right">{kind === "loss" ? "控除未済欠損金額" : "期首現在の金額"}</th>
          <th className="py-1 pr-2">出所</th>
          <th className="py-1 pr-2">確認</th>
          <th className="py-1"></th>
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <Row key={c.id} c={c} locked={locked} onSave={onSave} onRemove={onRemove} />
        ))}
        {!locked && (
          <tr className="border-t border-slate-200 bg-slate-50/60">
            {kind === "loss" ? (
              <>
                <td className="py-1 pr-2">
                  <TextInput type="date" value={draft.loss_fy_start ?? ""} onChange={(e) => setDraft({ ...draft, loss_fy_start: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <TextInput type="date" value={draft.loss_fy_end ?? ""} onChange={(e) => setDraft({ ...draft, loss_fy_end: e.target.value })} />
                </td>
              </>
            ) : (
              <td className="py-1 pr-2">
                <TextInput value={draft.name ?? ""} placeholder="例：減価償却超過額" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </td>
            )}
            <td className="py-1 pr-2">
              <YenInput value={draft.amount ?? null} allowNegative={kind === "retained"} onChange={(v) => setDraft({ ...draft, amount: v })} />
            </td>
            <td className="py-1 pr-2 text-xs text-slate-500">手入力</td>
            <td className="py-1 pr-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={!!draft.confirmed} onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })} />
                前期の申告書で確認した
              </label>
            </td>
            <td className="py-1 text-right">
              <Button
                size="sm"
                variant="primary"
                disabled={kind === "loss" ? !draft.loss_fy_start || !draft.loss_fy_end : !draft.name}
                onClick={async () => {
                  const key = kind === "retained" && draft.name === "減価償却超過額" ? "depreciation_excess" : undefined;
                  await onSave({ ...draft, key, name: kind === "loss" ? `${draft.loss_fy_start}〜${draft.loss_fy_end} の欠損金` : draft.name });
                  setDraft(blank);
                }}
              >
                追加
              </Button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Row({ c, locked, onSave, onRemove }: { c: Carry; locked: boolean; onSave: (c: Partial<Carry> & { kind: "retained" | "loss" }, id?: number) => Promise<void>; onRemove: (id: number) => Promise<void> }) {
  return (
    <tr className="border-t border-slate-100">
      {c.kind === "loss" ? (
        <>
          <td className="py-1.5 pr-2 num">{c.loss_fy_start}</td>
          <td className="py-1.5 pr-2 num">{c.loss_fy_end}</td>
        </>
      ) : (
        <td className="py-1.5 pr-2">{c.name}</td>
      )}
      <td className="py-1.5 pr-2 text-right">
        <Money v={c.amount} />
      </td>
      <td className="py-1.5 pr-2 text-xs text-slate-500">{SOURCE[c.source] ?? c.source}</td>
      <td className="py-1.5 pr-2">
        {c.confirmed ? (
          <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">確認済み</Badge>
        ) : (
          <Button size="sm" disabled={locked} onClick={() => onSave({ ...c, confirmed: true }, c.id)}>
            確認済みにする
          </Button>
        )}
      </td>
      <td className="py-1.5 text-right">
        {!locked && (
          <Button size="sm" variant="ghost" onClick={() => onRemove(c.id)}>
            削除
          </Button>
        )}
      </td>
    </tr>
  );
}
