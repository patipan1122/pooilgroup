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
          // POST tokens to server which writes the Supabase session cookies
          // via Set-Cookie response header (iOS webview-safe — document.cookie
          // partitioning would otherwise drop them). Skip the client-side
          // setSession entirely: it can hang on iOS LINE WKWebView when it
          // tries to read its own cookies back, and we don't actually need a
          // client-side session here (next page load reads cookies SSR).
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          let r: Response;
          try {
            r = await fetch("/api/auth/set-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ access_token, refresh_token }),
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(
              `server set-session ${r.status}: ${j?.error ?? "unknown"}`,
            );
          }
          // Verify the cookie actually landed in the browser's jar AND is
          // readable on a fresh server request. If this fails, navigating to
          // /chairops/m would just bounce to /login with no diagnostic — catch
          // it here so the user sees a specific iOS-cookie-drop error.
          const who = await fetch("/api/auth/whoami", {
            credentials: "include",
            cache: "no-store",
          });
          const whoJson = (await who.json().catch(() => ({}))) as {
            authenticated?: boolean;
            reason?: string;
            hasPoolUser?: boolean;
            hasChairopsUser?: boolean;
          };
          if (!whoJson.authenticated) {
            throw new Error(
              `cookie-not-readable: setSession ok but next request had no session (${whoJson.reason ?? "unknown"})`,
            );
          }
          if (!whoJson.hasPoolUser) {
            throw new Error(
              "missing-pool-user: session is set but no public.users row exists (ensurePoolMembership failed silently somewhere)",
            );
          }
          if (!whoJson.hasChairopsUser) {
            throw new Error(
              "missing-chairops-user: session is set, pool user exists, but no ChairopsUser row",
            );
          }
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
