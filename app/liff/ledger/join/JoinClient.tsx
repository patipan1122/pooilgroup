"use client";

import { useEffect, useRef, useState } from "react";
import { getLiff, getLiffInitError } from "@/lib/line/liff-client";
import { LedgerMascot } from "@/components/ledger/Brand";

type State =
  | { kind: "loading" }
  | { kind: "ok"; message: string; role: string }
  | { kind: "error"; message: string };

const LEDGER_LIFF_ID = process.env.NEXT_PUBLIC_LEDGER_LIFF_ID;

export function JoinClient({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      if (!token) {
        setState({ kind: "error", message: "ลิงก์เชิญไม่ถูกต้อง — ขอลิงก์ใหม่จากแอดมิน" });
        return;
      }
      // Init LIFF (12s guard so a hung init shows an error, not an endless spinner).
      const liff = await Promise.race([
        getLiff(LEDGER_LIFF_ID),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
      ]);
      if (!liff) {
        // LIFF SDK failed to init — the known iOS LINE-webview "TypeError: Load failed".
        // Fall back to the OAuth flow (NO LIFF SDK) which binds via /auth/line-start?claim=.
        // Guard against a loop: only auto-redirect once (marker in the URL).
        if (typeof window !== "undefined" && !window.location.search.includes("oauth=1")) {
          window.location.href = `/auth/line-start?claim=${encodeURIComponent(token)}&module=ledger`;
          return;
        }
        const e = getLiffInitError();
        setState({ kind: "error", message: e ? `เปิดระบบ LINE ไม่สำเร็จ (${e})` : "เปิดระบบ LINE ไม่สำเร็จ — ปิดแล้วเปิดลิงก์ใหม่" });
        return;
      }
      // Not logged in yet → trigger the LINE login (redirects, returns to this URL
      // logged-in). getIDToken returns null without this, which was the silent fail.
      if (!liff.isLoggedIn()) {
        try { liff.login(); } catch { /* preview env */ }
        return; // page re-loads after login; the effect runs again
      }
      let idToken: string | null = null;
      try { idToken = liff.getIDToken(); } catch { /* ignore */ }
      if (!idToken) {
        // Logged in but no id_token = the LIFF/Login channel is missing the openid
        // scope (LINE console). Surface it so the office can fix the channel config.
        setState({ kind: "error", message: "ไม่ได้รหัสยืนยันจาก LINE (ตรวจ scope openid ของ LIFF) — แจ้งผู้ดูแล" });
        return;
      }
      try {
        const res = await fetch("/api/ledger/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, idToken }),
        });
        const j = (await res.json()) as { ok: boolean; message?: string; role?: string; error?: string };
        if (j.ok) {
          setState({ kind: "ok", message: j.message ?? "เข้าร่วมเรียบร้อย", role: j.role ?? "staff" });
        } else {
          setState({ kind: "error", message: j.error ?? "เข้าร่วมไม่สำเร็จ" });
        }
      } catch {
        setState({ kind: "error", message: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    })();
  }, [token]);

  const ROLE_LABEL: Record<string, string> = {
    staff: "พนักงานถ่ายใบเสร็จ",
    accountant: "บัญชี (ยืนยันได้)",
    admin: "ผู้ดูแล",
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      {state.kind === "loading" && (
        <>
          <div className="size-12 animate-spin rounded-full border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
          <p className="text-sm text-zinc-500">กำลังเข้าร่วม…</p>
        </>
      )}
      {state.kind === "ok" && (
        <>
          <LedgerMascot pose="celebrate" size={104} priority />
          <div className="space-y-1">
            <p className="text-lg font-bold text-zinc-800">ยินดีต้อนรับ! 🎉</p>
            <p className="text-sm text-zinc-600">{state.message}</p>
            <p className="text-xs text-zinc-400">สิทธิ์: {ROLE_LABEL[state.role] ?? state.role}</p>
          </div>
        </>
      )}
      {state.kind === "error" && (
        <>
          <LedgerMascot pose="confused" size={104} priority />
          <div className="space-y-1">
            <p className="text-base font-semibold text-zinc-800">เข้าร่วมไม่สำเร็จ</p>
            <p className="text-sm text-rose-600">{state.message}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-[var(--color-brand-600,#2563EB)] px-4 py-2 text-sm font-semibold text-white"
            >
              ลองใหม่
            </button>
            <button
              type="button"
              onClick={async () => { (await getLiff(LEDGER_LIFF_ID))?.closeWindow?.(); }}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600"
            >
              ปิด
            </button>
          </div>
        </>
      )}
    </div>
  );
}
