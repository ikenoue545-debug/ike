"use client";

import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, ErrorBox, Field, Select, Spinner, TextInput } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { User } from "@/lib/types";

export default function UsersPage() {
  const { user, meta } = useApp();
  const users = useApi<User[]>("/users");
  const [f, setF] = useState({ email: "", display_name: "", role: "staff", password: "" });
  const [err, setErr] = useState<string | null>(null);

  if (user.role !== "admin") return <ErrorBox message="管理者だけが使える画面です" />;
  if (!users.data) return <Spinner />;

  async function create() {
    setErr(null);
    try {
      await api("/users", { method: "POST", json: f });
      setF({ email: "", display_name: "", role: "staff", password: "" });
      await users.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function patch(id: number, body: Partial<User>) {
    setErr(null);
    try {
      await api(`/users/${id}`, { method: "PATCH", json: body });
      await users.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">利用者</h1>
      <Card title="利用者の一覧">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">名前</th>
              <th className="py-1 pr-2">メールアドレス</th>
              <th className="py-1 pr-2">役割</th>
              <th className="py-1 pr-2">状態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.data.map((u) => (
              <tr key={u.id}>
                <td className="py-1.5 pr-2">{u.display_name}</td>
                <td className="py-1.5 pr-2">{u.email}</td>
                <td className="py-1.5 pr-2">
                  <Select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} className="py-0.5 text-xs" disabled={u.id === user.id}>
                    {Object.entries(meta.roles).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1.5 pr-2">
                  {u.is_active ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">有効</Badge> : <Badge>停止</Badge>}
                  {u.id !== user.id && (
                    <Button size="sm" variant="ghost" onClick={() => patch(u.id, { is_active: !u.is_active })}>
                      {u.is_active ? "停止する" : "有効にする"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="利用者を追加">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="名前">
            <TextInput value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          </Field>
          <Field label="メールアドレス">
            <TextInput type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="役割">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {Object.entries(meta.roles).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="初期パスワード（8文字以上）">
            <TextInput type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={create} disabled={!f.email || !f.display_name || f.password.length < 8}>
            追加
          </Button>
          <ErrorBox message={err} />
        </div>
        <p className="mt-2 text-xs text-slate-500">会社ごとのアクセス権は、会社の担当者・レビュー担当者に指定すると付きます（管理者はすべての会社を見られます）。</p>
      </Card>
    </div>
  );
}
