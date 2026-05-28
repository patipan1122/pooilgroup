"use client";

// LIFF bootstrap — when running inside LINE webview, auto-login user.
// Falls back to normal Supabase session login if LIFF is not configured or login fails.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getLiffProfile, getLiffIdToken } from "@/lib/line/liff-client";

export function LiffBootstrap({
  haveSession,
}: {
  haveSession: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "linking" | "linked" | "skip">(
    "idle",
  );

  useEffect(() => {
    // Optional deep-link target — ChairOps Rich Menu opens the LIFF with
    // ?next=/chairops/m/<screen>. Read from the URL (not useSearchParams, to
    // avoid a CSR-bailout/Suspense requirement on every /liff page).
    const rawNext =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("next")
        : null;
    const next =
      rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
        ? rawNext
        : null;

    if (haveSession) {
      // Already authenticated (e.g. opened a second time) → go straight in.
      if (next) window.location.replace(next);
      return;
    }
    let cancelled = false;
    void (async () => {
      const profile = await getLiffProfile();
      if (cancelled) return;
      if (!profile) {
        setPhase("skip");
        return;
      }
      const idToken = await getLiffIdToken();
      if (cancelled) return;
      if (!idToken) {
        // ไม่มี id_token — fail close (server-side verify ต้องใช้ token)
        setPhase("skip");
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
          }),
        });
        const json = await res.json();
        if (!cancelled && json.ready && json.completeUrl) {
          // Navigate to the server route; the Supabase action_link is held
          // in an httpOnly cookie set by line-login (never seen by JS).
          window.location.href = json.completeUrl as string;
          return;
        }
        if (!cancelled && json.needsLink) {
          // First-time LINE — fall back to web login. Keep the LIFF page visible.
          setPhase("skip");
          return;
        }
        setPhase("linked");
      } catch {
        setPhase("skip");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [haveSession, router]);

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
  return null;
}
