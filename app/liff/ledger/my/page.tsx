// LedgerLine — "ใบของฉัน" in LIFF · /liff/ledger/my
//
// The receipt list a field staffer needs on their phone: newest-first cards of
// the receipts THEY submitted (+ receipts in branches they oversee), each opening
// the in-LINE edit page. Kills the post-capture dead-end — before this, once you
// sent a receipt you had no way to find or fix it from your phone.
//
// RLS — scoped by org + actor. Admin/accountant (allBranches) see the org's
// recent receipts; a member sees ONLY their own submissions OR their explicitly
// scoped branches. A loose where-clause here would leak another branch's receipts
// on a LIVE multi-company app, so it is tight and defaults to UNDER-showing.

import Link from "next/link";
import { Camera, Home } from "lucide-react";
import { isAdminTier } from "@/lib/auth/role-guards";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { resolveScope } from "@/app/(admin)/ledger/_scope";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { LedgerMascot } from "@/components/ledger/Brand";

export const dynamic = "force-dynamic";

export default async function LedgerLiffMyPage() {
  const session = await getSession();
  if (!session) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md animate-fade-in flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="size-12 animate-spin rounded-full border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
        <p className="text-base font-semibold text-zinc-800">กำลังเข้าสู่ระบบ…</p>
        <p className="text-sm text-zinc-500">รอสักครู่ กำลังยืนยันตัวตนจาก LINE</p>
      </div>
    );
  }

  const actor = await resolveLedgerActor();
  if (!actor) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md animate-fade-up flex-col items-center justify-center gap-4 px-6 text-center">
        <LedgerMascot size={88} pose="confused" priority />
        <div className="space-y-1.5">
          <p className="text-base font-semibold text-zinc-800">บัญชียังไม่เปิดใช้งานสำหรับคุณ</p>
          <p className="text-sm leading-relaxed text-zinc-600">
            แจ้งออฟฟิศหรือผู้ดูแลให้เพิ่มคุณเป็นสมาชิก แล้วเปิดลิงก์นี้อีกครั้ง
          </p>
        </div>
      </div>
    );
  }

  // COMPANY scope first — LedgerExpense is company-scoped (Pooil Oil + JP Sync are
  // separate legal entities/VAT under one org). Members carry their company; admin/
  // accountant/staff resolve the active/default company (same contract as getExpense
  // + every other ledger query). NEVER fall back to org-wide = cross-company leak.
  const companyId = actor.companyId ?? (await resolveScope(actor.orgId, {})).companyId;
  if (!companyId) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md animate-fade-up flex-col items-center justify-center gap-4 px-6 text-center">
        <LedgerMascot size={88} pose="sleepy" priority />
        <div className="space-y-1.5">
          <p className="text-base font-semibold text-zinc-800">ยังไม่ได้ตั้งค่าบริษัท</p>
          <p className="text-sm leading-relaxed text-zinc-600">แจ้งผู้ดูแลให้ตั้งค่าบริษัทในระบบบัญชีก่อน แล้วลองใหม่อีกครั้ง</p>
        </div>
      </div>
    );
  }

  // Within the company: allBranches (admin/accountant) → company-wide recent.
  // member → own submissions OR their scoped branches only.
  const where: Prisma.LedgerExpenseWhereInput = {
    orgId: actor.orgId,
    companyId,
    status: { not: "void" }, // ซ่อนรายการยกเลิกจากหน้า "ใบของฉัน"
  };
  if (!actor.allBranches) {
    where.OR = [
      { createdBy: actor.userId },
      ...(actor.scopeBranchIds.length ? [{ branchId: { in: actor.scopeBranchIds } }] : []),
    ];
  }

  const rows = await prisma.ledgerExpense.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      docCode: true,
      vendor: true,
      total: true,
      status: true,
      thumbUrl: true,
    },
  });

  // Admin → full web back-office (5-tab nav = "หน้าหลัก"); member → LIFF home.
  const homeHref = isAdminTier(session.user.role) ? "/ledger" : "/liff/ledger";

  return (
    <div className="mx-auto w-full max-w-md animate-fade-in px-4 pt-4 pb-[calc(76px+env(safe-area-inset-bottom))]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={homeHref}
            aria-label="กลับหน้าหลัก"
            className="press grid size-11 shrink-0 place-items-center rounded-xl text-zinc-600 active:bg-zinc-100"
          >
            <Home className="size-5" aria-hidden />
          </Link>
          <h1 className="text-lg font-bold text-zinc-900">ใบของฉัน</h1>
        </div>
        <Link
          href="/liff/ledger"
          className="press inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white active:bg-[var(--color-brand-700)]"
        >
          <Camera className="size-4" aria-hidden /> ถ่ายใหม่
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="flex animate-fade-up flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <LedgerMascot size={72} pose="welcome" />
          <p className="text-sm font-semibold text-zinc-800">ยังไม่มีใบที่คุณส่ง</p>
          <p className="text-sm leading-relaxed text-zinc-600">แตะ “ถ่ายใหม่” ด้านบน หรือปุ่มกล้องด้านล่าง เพื่อถ่ายใบแรก</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id} className="animate-fade-up" style={i < 6 ? { animationDelay: `${i * 40}ms` } : undefined}>
              <Link
                href={`/liff/ledger/expense/${r.id}`}
                className="press flex min-h-[44px] items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 active:bg-zinc-50"
              >
                {r.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumbUrl}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="size-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-zinc-100 text-lg">🧾</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">{r.vendor || "ไม่ระบุผู้ขาย"}</p>
                  <p className="truncate font-mono text-xs text-zinc-500">{r.docCode}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-zinc-900">
                    ฿{Number(r.total ?? 0).toLocaleString("th-TH")}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
