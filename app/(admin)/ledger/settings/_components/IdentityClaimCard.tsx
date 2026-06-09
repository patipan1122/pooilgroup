"use client";

// LINE identity claim — the fix for "เปิดมินิแอป/ปุ่มแก้ไขแล้วเด้ง 'บัญชียังไม่เปิดใช้งาน'"
// even when you ARE the super_admin (audit 2026-06-05). The bot recognises you via
// the Messaging userId, but the mini-app (LIFF) authenticates via the LINE Login
// channel's id — a different value when the two channels sit under different LINE
// providers. Tapping the self-claim link once (inside LINE) binds your verified
// Login id to your account, so every channel knows you. The admin-invite link does
// the same for a NEW admin (mints a ledger-only account — never touches ChairOps).

import { useState, useTransition } from "react";
import { Crown, Copy, Check, UserPlus, KeyRound, Loader2 } from "lucide-react";
import { createLedgerSelfClaimLink, createLedgerAdminInvite } from "../../_actions";

function LinkBox({ url, hint }: { url: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="text-xs font-medium text-emerald-900">{hint}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-emerald-200 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-700">
          {url}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white active:bg-emerald-700"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "คัดลอกแล้ว" : "คัดลอก"}
        </button>
      </div>
    </div>
  );
}

export function IdentityClaimCard({ companyId }: { companyId: string }) {
  const [selfUrl, setSelfUrl] = useState<string | null>(null);
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingSelf, startSelf] = useTransition();
  const [pendingAdmin, startAdmin] = useTransition();

  function makeSelf() {
    setErr(null);
    startSelf(async () => {
      const res = await createLedgerSelfClaimLink();
      if (res.ok && res.url) setSelfUrl(res.url);
      else setErr(res.error ?? "สร้างลิงก์ไม่สำเร็จ");
    });
  }
  function makeAdmin() {
    setErr(null);
    startAdmin(async () => {
      const res = await createLedgerAdminInvite({ companyId });
      if (res.ok && res.url) setAdminUrl(res.url);
      else setErr(res.error ?? "สร้างลิงก์ไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">เชื่อม LINE กับมินิแอป (สิทธิ์ผู้ดูแล)</h3>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        ถ้าเปิดปุ่ม “แก้ไข” หรือหน้าจัดการในไลน์แล้วเด้ง “บัญชียังไม่เปิดใช้งาน” ทั้งที่คุณเป็นผู้ดูแล —
        กดผูกครั้งเดียวที่นี่ ระบบจะรู้จักคุณทุกช่องทาง
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Self-claim — bind MY login id */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <Crown className="size-4" aria-hidden /> ผูก LINE ของฉัน
          </div>
          <p className="mt-0.5 text-xs text-amber-800/80">
            สร้างลิงก์ แล้ว <span className="font-semibold">เปิดลิงก์นั้นในไลน์ของคุณเอง</span> ครั้งเดียว →
            ใช้ปุ่มแก้ไข + หน้าจัดการในไลน์ได้ทันที
          </p>
          <button
            type="button"
            onClick={makeSelf}
            disabled={pendingSelf}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-amber-700 disabled:opacity-50"
          >
            {pendingSelf ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <KeyRound className="size-3.5" aria-hidden />}
            สร้างลิงก์ผูกบัญชีของฉัน
          </button>
          {selfUrl && <LinkBox url={selfUrl} hint="เปิดลิงก์นี้ในไลน์ของคุณเอง (กดค้าง → เปิด) ครั้งเดียว" />}
        </div>

        {/* Top-down — invite a NEW admin */}
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700">
            <UserPlus className="size-4" aria-hidden /> เชิญผู้ดูแลใหม่
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            สร้างลิงก์ส่งให้คนที่จะเป็นผู้ดูแล → เขากดในไลน์ครั้งเดียว ก็ได้สิทธิ์ผู้ดูแลบัญชี
            (เฉพาะโปรแกรมบัญชี ไม่ปนระบบอื่น)
          </p>
          <button
            type="button"
            onClick={makeAdmin}
            disabled={pendingAdmin}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {pendingAdmin ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UserPlus className="size-3.5" aria-hidden />}
            สร้างลิงก์เชิญผู้ดูแล
          </button>
          {adminUrl && <LinkBox url={adminUrl} hint="ส่งลิงก์นี้ให้ผู้ดูแลใหม่ เปิดในไลน์ครั้งเดียว" />}
        </div>
      </div>

      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
