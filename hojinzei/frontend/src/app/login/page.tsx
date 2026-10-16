"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setSession, type SessionUser } from "@/lib/api";
import { Button, ErrorBox, Field, TextInput } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; user: SessionUser }>("/auth/login", { method: "POST", json: { email, password } });
      setSession(r.token, r.user);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="メールアドレス">
        <TextInput type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="パスワード">
        <TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <ErrorBox message={err} />
      <Button variant="primary" className="w-full" disabled={busy}>
        {busy ? "確認中…" : "ログイン"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 font-bold text-white">法</span>
          <div>
            <h1 className="text-base font-semibold">法人税申告書AIアシスタント</h1>
            <p className="text-xs text-slate-500">ログインしてください</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-5 text-xs leading-relaxed text-slate-500">
          開発用の初期データ（すべて架空）では、staff@example.com・reviewer@example.com・admin@example.com を使えます。パスワードは README を参照してください。
        </p>
      </div>
    </div>
  );
}
