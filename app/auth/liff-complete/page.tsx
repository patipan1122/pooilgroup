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
  const [errMsg, setErrMsg] = useState<string>("");

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
      const supaError = hp.get("error");
      const supaErrorDesc = hp.get("error_description");
      try {
        if (supaError) {
          throw new Error(`supabase: ${supaError} / ${supaErrorDesc ?? ""}`);
        }
        if (access_token && refresh_token) {
          // iOS LINE WKWebView drops cookies written via document.cookie
          // (which is what sb.auth.setSession does in the browser). POST
          // tokens to a server route that calls setSession server-side and
          // writes cookies via Set-Cookie response header — iOS always
          // honors those. We also call client setSession AFTER so the
          // in-memory client has the session for any client-side queries.
          const r = await fetch("/api/auth/set-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ access_token, refresh_token }),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(
              `server set-session ${r.status}: ${j?.error ?? "unknown"}`,
            );
          }
          // Best-effort client-side sync — failures are non-fatal because the
          // server already wrote the cookies.
          await sb.auth.setSession({ access_token, refresh_token }).catch(() => {});
        } else {
          // No fragment (PKCE code or already captured) — let the client detect.
          const { data } = await sb.auth.getSession();
          if (!data.session) {
            throw new Error(
              `no-fragment (hash="${hash.slice(0, 80)}" url="${window.location.href.slice(0, 120)}")`,
            );
          }
        }
        if (!cancelled) window.location.replace(next);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "unknown";
        setErrMsg(msg);
        // Surface to /auth/line-error so the error is visible + retry button
        // routes back through /auth/line-start (skipping the LIFF SDK init).
        const u = new URL("/auth/line-error", window.location.href);
        u.searchParams.set("reason", "liff-complete");
        u.searchParams.set("detail", msg.slice(0, 280));
        window.location.replace(u.toString());
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
