"use client";

// Magic-link landing for LIFF logins. The Supabase magic link delivers the
// session in the URL fragment (#access_token=…&refresh_token=…). Server
// components can't read a fragment, and no /liff or /chairops page mounts a
// browser Supabase client — so the session was never captured (→ destination
// 404/bounce). This tiny client page captures it explicitly via setSession()
// (writes the @supabase/ssr cookies) then forwards to ?next.
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/db/client";

function safeNext(): string {
  if (typeof window === "undefined") return "/chairops/m";
  const p = new URLSearchParams(window.location.search).get("next");
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/chairops/m";
}

export default function LiffCompletePage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sb = browserClient();
      const next = safeNext();
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const hp = new URLSearchParams(hash);
      const access_token = hp.get("access_token");
      const refresh_token = hp.get("refresh_token");
      try {
        if (access_token && refresh_token) {
          const { error } = await sb.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        } else {
          // No fragment (PKCE code or already captured) — let the client detect.
          const { data } = await sb.auth.getSession();
          if (!data.session) throw new Error("no-session");
        }
        if (!cancelled) window.location.replace(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center">
      {failed ? (
        <>
          <div className="grid size-14 place-items-center rounded-2xl bg-rose-100 text-2xl">
            ⚠️
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-zinc-800">
              เข้าสู่ระบบไม่สำเร็จ
            </p>
            <p className="text-sm text-zinc-500">
              ลิงก์อาจหมดอายุ · กรุณากดเมนูใน LINE ใหม่อีกครั้ง
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="size-12 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <p className="text-sm text-zinc-500">กำลังเข้าสู่ระบบ...</p>
        </>
      )}
    </div>
  );
}
