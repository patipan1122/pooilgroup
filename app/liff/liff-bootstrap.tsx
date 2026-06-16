"use client";

// LIFF bootstrap — when running inside LINE webview, auto-login user.
// Falls back to normal Supabase session login if LIFF is not configured or login fails.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getLiffProfile,
  getLiffIdToken,
  getLiffInitError,
} from "@/lib/line/liff-client";
import { lineModuleFromPath, liffIdForModule } from "@/lib/line/channels";
import { JoinClient } from "./ledger/join/JoinClient";

export function LiffBootstrap({
  haveSession,
}: {
  haveSession: boolean;
}) {
  const router = useRouter();
  // LedgerLine invite/claim: run the bind INLINE on the first-loaded page (the LIFF
  // endpoint /liff/ledger). With the corrected deep-link liff.line.me/{id}?invite=…
  // there is NO sub-path → NO liff.state → liff.init() won't bounce, so we DON'T need
  // (and must NOT) rewrite the URL: history.replaceState here was stripping LINE's
  // login params (code/state) BEFORE liff.init() consumed them → login never
  // established → getIDToken() null → "เข้าร่วมไม่สำเร็จ". LINE's docs are explicit:
  // do not modify SDK-provided query params until liff.init() resolves. So we just
  // capture the token and render JoinClient; liff.init() handles the URL itself.
  const [ledgerInvite] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    if (lineModuleFromPath(window.location.pathname) !== "ledger") return null;
    const sp = new URLSearchParams(window.location.search);
    let inv = sp.get("invite");
    if (!inv) {
      const state = sp.get("liff.state");
      if (state) {
        const q = state.indexOf("?");
        if (q >= 0) inv = new URLSearchParams(state.slice(q + 1)).get("invite");
      }
    }
    return inv;
  });
  const [phase, setPhase] = useState<
    "idle" | "linking" | "linked" | "skip" | "needslink" | "failed"
  >("idle");
  const [linkInfo, setLinkInfo] = useState<{
    lineUserId: string;
    displayName: string;
  } | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    // Ledger invite/claim is handled INLINE (JoinClient rendered below) — skip the
    // whole line-login flow so nothing races the bind / re-triggers liff.state.
    if (ledgerInvite) return;
    // Read a deep-link param (next/invite). Normally it's a top-level query param
    // (?next=…) — set either directly or by /liff/page.tsx re-expanding LINE's
    // ?liff.state. BUT when a module's LIFF Endpoint URL is a sub-path (e.g.
    // ledger's is /liff/ledger, NOT /liff), LINE loads that page directly with the
    // original query BURIED inside ?liff.state and /liff/page.tsx never runs to
    // expand it. So we also dig the param out of liff.state's query part. This is
    // what made the LedgerLine edit button never navigate.
    const readDeepLinkParam = (name: string): string | null => {
      if (typeof window === "undefined") return null;
      const sp = new URLSearchParams(window.location.search);
      const direct = sp.get(name);
      if (direct) return direct;
      const state = sp.get("liff.state"); // e.g. "/ledger?next=/liff/ledger/expense/X" or "?next=…"
      if (state) {
        const q = state.indexOf("?");
        if (q >= 0) {
          const v = new URLSearchParams(state.slice(q + 1)).get(name);
          if (v) return v;
        }
      }
      return null;
    };
    // Optional deep-link target — Rich Menu / confirm-card buttons open the LIFF
    // with ?next=/<path>.
    const rawNext = readDeepLinkParam("next");
    const next =
      rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
        ? rawNext
        : null;
    // Optional signed invite token (onboarding link).
    const invite = readDeepLinkParam("invite");
    // Which module's LINE channel are we on? /liff/ledger → LedgerLine's own
    // channel; everything else → the shared default (unchanged behaviour).
    const lineModule =
      typeof window !== "undefined"
        ? lineModuleFromPath(window.location.pathname)
        : "default";
    const liffId = liffIdForModule(lineModule);

    // An invite token means "log in AS the user this link was issued for" — so
    // we must ALWAYS run the bind/login when one is present, even if a session
    // already exists. Short-circuiting here on a leftover/stale session (the
    // LINE webview keeps cookies across taps; repeated failed attempts leave a
    // wrong-user or half-written session) would skip the invite entirely and
    // navigate straight to `next`, where requireSession then bounces the maid to
    // /login — looking like the link "doesn't work" with no diagnostic. The
    // login below mints a fresh session for the invited user, overwriting any
    // stale one. See memory chairops-invite-link-liff-endpoint-url-2026-06-16.
    if (haveSession && !invite) {
      // Already authenticated (e.g. opened a second time) → go straight in.
      if (next) window.location.replace(next);
      return;
    }
    // In a ChairOps deep-link (next set) surface failures so we can debug,
    // instead of a silent stuck spinner. Generic LIFF keeps the quiet skip.
    const failOrSkip = (msg: string) => {
      if (cancelled) return;
      if (next) {
        setErrMsg(msg);
        setPhase("failed");
      } else {
        setPhase("skip");
      }
    };

    // LIFF SDK is flaky on iOS LINE webview ("TypeError: Load failed" during
    // liff.init). When it fails AND we have a deep-link context, fall back to
    // direct LINE OAuth via /auth/line-start (no LIFF SDK, standard authcode
    // flow). The OAuth callback ends up calling the same /api/auth/line-login
    // downstream, so the user experience after the LINE consent screen is
    // identical to the LIFF path.
    const fallbackToOAuth = () => {
      if (cancelled || !next) return false;
      const u = new URL("/auth/line-start", window.location.href);
      u.searchParams.set("next", next);
      if (lineModule !== "default") u.searchParams.set("module", lineModule);
      window.location.replace(u.toString());
      return true;
    };

    let cancelled = false;
    void (async () => {
      const profile = await getLiffProfile(liffId);
      if (cancelled) return;
      if (!profile) {
        const initErr = getLiffInitError();
        // LIFF SDK actually attempted init and failed (network/SDK error) →
        // try the OAuth fallback. Only surface the error if no `next` (generic
        // LIFF context) or fallback navigation cannot be triggered.
        if (initErr && fallbackToOAuth()) return;
        failOrSkip(
          initErr
            ? `LIFF init error → ${initErr}`
            : "ไม่ได้ข้อมูลโปรไฟล์ LINE (อาจไม่ได้เปิดใน LINE / ยังไม่ได้กด login)",
        );
        return;
      }
      const idToken = await getLiffIdToken(liffId);
      if (cancelled) return;
      if (!idToken) {
        // Missing openid scope or LIFF token API failed. OAuth fallback grants
        // openid via its own scope param, side-stepping LIFF channel config.
        if (fallbackToOAuth()) return;
        const initErr = getLiffInitError();
        failOrSkip(
          initErr
            ? `LIFF token error → ${initErr}`
            : "ไม่ได้ id_token จาก LIFF (ตรวจ scope openid)",
        );
        return;
      }
      setPhase("linking");
      try {
        const res = await fetch("/api/auth/line-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            displayName: profile.displayName,
            redirectTo: next ?? undefined,
            invite: invite ?? undefined,
            module: lineModule,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && json.ready && json.completeUrl) {
          // Navigate to the server route; the Supabase action_link is held
          // in an httpOnly cookie set by line-login (never seen by JS).
          window.location.href = json.completeUrl as string;
          return;
        }
        if (!cancelled && json.needsLink) {
          // Unbound LINE user. In a module deep-link context (next set, e.g.
          // ChairOps Rich Menu) show their verified LINE ID so the office can
          // bind it. Otherwise (generic LIFF) fall back to web login silently.
          if (next && json.lineUserId) {
            setLinkInfo({
              lineUserId: json.lineUserId as string,
              displayName: profile.displayName,
            });
            setPhase("needslink");
          } else {
            setPhase("skip");
          }
          return;
        }
        if (!res.ok) {
          failOrSkip(`เข้าระบบไม่สำเร็จ (HTTP ${res.status}): ${json.error ?? ""}`);
          return;
        }
        failOrSkip(`ตอบกลับไม่คาดคิด: ${JSON.stringify(json).slice(0, 180)}`);
      } catch (e) {
        failOrSkip(`ข้อผิดพลาด: ${e instanceof Error ? e.message : "unknown"}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [haveSession, router, ledgerInvite]);

  // LedgerLine claim/invite — bind RIGHT HERE on the first-loaded page (LIFF context
  // is fresh, liff.state already stripped above). No navigation = no loop.
  if (ledgerInvite) {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-white">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
          <JoinClient token={ledgerInvite} />
        </div>
      </div>
    );
  }

  if (phase === "linking") {
    return (
      <div className="fixed inset-0 z-50 bg-white/95 flex items-center justify-center">
        <div className="text-center">
          <div className="size-12 border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)] rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-zinc-500">กำลังตรวจสอบบัญชี LINE...</p>
        </div>
      </div>
    );
  }
  if (phase === "needslink" && linkInfo) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-100 text-3xl">
            🔑
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-zinc-900">บัญชียังไม่เปิดใช้งาน</h1>
            <p className="text-sm text-zinc-500">
              แจ้ง LINE ID ด้านล่างให้ออฟฟิศ เพื่อเปิดใช้งานให้คุณ
            </p>
          </div>
          <div className="space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left">
            <div className="text-xs text-zinc-500">ชื่อ LINE</div>
            <div className="text-sm font-medium text-zinc-800">
              {linkInfo.displayName}
            </div>
            <div className="mt-2 text-xs text-zinc-500">LINE ID (ส่งให้ออฟฟิศ)</div>
            <div className="select-all break-all font-mono text-sm text-zinc-900">
              {linkInfo.lineUserId}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(linkInfo.lineUserId);
            }}
            className="h-12 w-full rounded-md bg-emerald-600 text-base font-semibold text-white active:bg-emerald-700"
          >
            คัดลอก LINE ID
          </button>
        </div>
      </div>
    );
  }
  if (phase === "failed") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-100 text-2xl">
            ⚠️
          </div>
          <p className="text-base font-semibold text-zinc-800">
            เข้าสู่ระบบไม่สำเร็จ
          </p>
          <p className="select-all break-words rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left font-mono text-xs text-zinc-700">
            {errMsg}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-11 w-full rounded-md bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700"
          >
            ลองใหม่
          </button>
        </div>
      </div>
    );
  }
  return null;
}
