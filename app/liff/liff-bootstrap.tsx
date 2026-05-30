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

export function LiffBootstrap({
  haveSession,
}: {
  haveSession: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<
    "idle" | "linking" | "linked" | "skip" | "needslink" | "failed"
  >("idle");
  const [linkInfo, setLinkInfo] = useState<{
    lineUserId: string;
    displayName: string;
  } | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");

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
    // Optional signed maid-invite token (admin onboarding link).
    const invite =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("invite")
        : null;

    if (haveSession) {
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

    let cancelled = false;
    void (async () => {
      const profile = await getLiffProfile();
      if (cancelled) return;
      if (!profile) {
        const initErr = getLiffInitError();
        failOrSkip(
          initErr
            ? `LIFF init error → ${initErr}`
            : "ไม่ได้ข้อมูลโปรไฟล์ LINE (อาจไม่ได้เปิดใน LINE / ยังไม่ได้กด login)",
        );
        return;
      }
      const idToken = await getLiffIdToken();
      if (cancelled) return;
      if (!idToken) {
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
