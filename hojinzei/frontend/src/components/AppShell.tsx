"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearSession, getToken, getUser, type SessionUser } from "@/lib/api";
import type { Meta } from "@/lib/types";
import { cx, Spinner } from "./ui";

type Ctx = { user: SessionUser; meta: Meta };
const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppShell の外で使われています");
  return c;
}

const ROLE_LABEL: Record<string, string> = { admin: "管理者", reviewer: "レビュー担当者", staff: "担当者" };

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const user = getUser();
    api<Meta>("/meta")
      .then((meta) => user && setCtx({ user, meta }))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    // 初回だけ確認する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* すでに無効でも構わない */
    }
    clearSession();
    router.replace("/login");
  }

  const nav = [
    { href: "/", label: "顧問先一覧", active: pathname === "/" || pathname.startsWith("/companies") || pathname.startsWith("/years") },
    { href: "/rules", label: "税率・法令", active: pathname.startsWith("/rules") },
    ...(ctx?.user.role === "admin" ? [{ href: "/admin/users", label: "利用者", active: pathname.startsWith("/admin") }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">法</span>
            <span className="text-sm font-semibold text-slate-800">法人税申告書AIアシスタント</span>
          </Link>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cx("rounded-md px-3 py-1.5 text-sm", n.active ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-100")}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {ctx && (
              <span className="text-slate-600">
                {ctx.user.display_name}
                <span className="ml-1 text-xs text-slate-400">（{ROLE_LABEL[ctx.user.role]}）</span>
              </span>
            )}
            <button onClick={logout} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
              ログアウト
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {err && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}
        {ctx ? <AppCtx.Provider value={ctx}>{children}</AppCtx.Provider> : !err && <Spinner />}
      </main>
      <footer className="mx-auto max-w-[1600px] px-4 pb-6 text-xs text-slate-400">
        このシステムは申告書のドラフト作成を支援するものです。最終的な申告内容は税理士等が確認・承認してください。電子申告・納税の送信は行いません。
      </footer>
    </div>
  );
}
