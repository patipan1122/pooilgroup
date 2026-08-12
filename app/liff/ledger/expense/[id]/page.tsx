// LedgerLine — in-LIFF expense edit/confirm · /liff/ledger/expense/[id]
//
// The "✏️ แก้ไข" / "ยืนยัน" buttons on the LINE confirm card open THIS page (inside
// LINE, via the LedgerLine LIFF) — a full Bainy-style edit form on mobile, instead
// of bouncing out to the desktop web review pane. It REUSES the exact same
// ExpenseReviewPane (4-section Bainy form) + server actions the web back-office
// uses, so there's one source of truth and zero dead UI.
//
// Auth comes from the /liff layout's LiffBootstrap (verified LINE id_token → Pool
// session), same as the capture flow. Editing is allowed for anyone with ledger
// access (requireLedgerAccess inside saveExpense); confirm/void stay gated to the
// accountant tier by their own action guards (GOLDEN RULE — never auto-post).

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { resolveScope } from "@/app/(admin)/ledger/_scope";
import { getExpense, listCategories } from "@/app/(admin)/ledger/_data";
import { resolveLedgerActor, ledgerWebCan, ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { listLedgerProjects } from "@/lib/ledger/projects";
import { prisma } from "@/lib/prisma";
import { LiffExpensePane } from "./LiffExpensePane";
import { LedgerMascot } from "@/components/ledger/Brand";

export const dynamic = "force-dynamic";

export default async function LedgerLiffExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await getSession();

  // Not signed in yet → LiffBootstrap (in /liff layout) logs in via the verified
  // LINE id_token and re-renders. Calm waiting state meanwhile.
  if (!session) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="size-12 animate-spin rounded-full border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-800">กำลังเข้าสู่ระบบ</p>
          <p className="text-sm text-zinc-500">
            ถ้าค้างนาน · บัญชีนี้อาจยังไม่ได้เปิดใช้ · ติดต่อออฟฟิศ
          </p>
        </div>
      </div>
    );
  }

  // Signed in but no ledger access (not a member yet, or disabled) → needs-link
  // screen instead of a form whose every button would reject with "ไม่มีสิทธิ์".
  const actor = await resolveLedgerActor();
  if (!actor) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <LedgerMascot size={88} pose="confused" priority />
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-800">บัญชียังไม่เปิดใช้งานสำหรับคุณ</p>
          <p className="text-sm text-zinc-500">
            แจ้งออฟฟิศ/ผู้ดูแลให้เพิ่มคุณเป็นสมาชิก แล้วเปิดสิทธิ์ในระบบบัญชี — จากนั้นเปิดลิงก์นี้อีกครั้ง
          </p>
        </div>
      </div>
    );
  }

  const { id } = await params;
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, { company: sp.company });

  const [expense, categories, projectRows] = await Promise.all([
    scope.companyId
      ? getExpense({ orgId: scope.orgId, companyId: scope.companyId, id, withSlip: true }).catch(() => null)
      : Promise.resolve(null),
    scope.companyId
      ? listCategories(scope.orgId, scope.companyId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listCategories>>),
    // โครงการ active สำหรับ picker (แท็กบิลเข้าโครงการ · F2). company-scoped เสมอ.
    scope.companyId
      ? listLedgerProjects(scope.orgId, scope.companyId, { includeArchived: false }).catch(() => [])
      : Promise.resolve([] as Awaited<ReturnType<typeof listLedgerProjects>>),
  ]);
  const projectOptions = projectRows.map((p) => ({ value: p.id, label: p.name }));

  if (!expense) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <LedgerMascot size={88} pose="confused" priority />
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-800">ไม่พบใบเสร็จนี้</p>
          <p className="text-sm text-zinc-500">
            อาจถูกลบ หรืออยู่คนละบริษัท · ลองเปิดจากการ์ดในแชตอีกครั้ง
          </p>
        </div>
        <Link
          href="/liff/ledger"
          className="rounded-xl bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-semibold text-white active:bg-[var(--color-brand-700)]"
        >
          กลับไปถ่ายใบเสร็จ
        </Link>
      </div>
    );
  }

  // Admin/super_admin have the full web back-office (with the 5-tab bottom nav) —
  // send them back THERE (the "หน้าหลัก" CEO means), not the stripped LIFF list.
  // A field member (no web access) stays on the LIFF "ใบของฉัน" list.
  const companyQs = sp.company ? `?company=${encodeURIComponent(sp.company)}` : "";
  const backHref = isAdminTier(session.user.role)
    ? `/ledger/expenses${companyQs}`
    : `/liff/ledger/my${companyQs}`;

  // ── ขอโอนเงินบนมือถือ (จบในที่เดียว · CEO 2026-07-09) ─────────────────────────
  // สิทธิ์เดียวกับที่ createPaymentRequestAction เช็ก (payment.request · super_admin bypass).
  // ต้องเช็กด้วย ledger role ของ actor (ledgerWebCan) — ไม่ใช่ Pool role (ledgerWebCanForRole):
  // พนักงานไลน์ (member) มีสิทธิ์ payment.request=✅ ใน matrix แต่ Pool role="staff" ทำให้
  // ledgerWebCanForRole คืน false → เดิมพนักงานไม่เห็นปุ่มขอโอนเลย (fix 2026-07-10).
  const companyId = scope.companyId;
  const canRequestTransfer = companyId
    ? await ledgerWebCan(actor, "payment.request")
    : false;
  // ส่ง TRCloud บนมือถือ (โมบายฟังก์ชัน · CEO 2026-07-26) — gate ต้องตรงกับ sendExpenseToTrcloud
  // ที่เช็ก ledgerWebCanForRole (Pool role · ไม่ใช่ actor) → ปุ่มที่โชว์ = กดผ่านจริง (กัน
  // mismatch แบบปุ่มขอโอน 2026-07-10). บัญชี/ผู้ดูแล/viewer(→accountant matrix)=เห็น · staff=ไม่เห็น.
  const canSendTrcloud = companyId
    ? await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.export")
    : false;
  // ตั้งสาขา+หมวดครบ = ขอโอนได้ (ไม่งั้น server reject) · categoryId ว่าง/branchId null = ยังไม่ครบ
  const classified = Boolean(expense.branchId && expense.categoryId);
  // มีคำขอโอน active ของบิลนี้อยู่แล้วไหม (partial-unique กัน 1 บิล 2 คำขอ) → ไม่ให้ขอซ้ำ
  const alreadyRequested =
    companyId && canRequestTransfer
      ? (await prisma.ledgerPaymentRequestBill.count({
          where: { expenseId: id, orgId: scope.orgId, companyId, active: true },
        })) > 0
      : false;

  return (
    <div className="mx-auto w-full max-w-md px-3 pb-10">
      {/* Mobile header — back to list + น้องใบเสร็จ + context. Anchored Bainy-style. */}
      <header className="sticky top-0 z-10 -mx-3 mb-3 flex items-center gap-2 border-b border-zinc-200 bg-white/95 px-3 py-3 backdrop-blur">
        <Link
          href={backHref}
          aria-label="กลับไปหน้ารายการ"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <LedgerMascot size={40} pose="receipt" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-zinc-900">ตรวจ & แก้ไขใบเสร็จ</p>
          <p className="truncate text-[11px] text-zinc-500">
            ฉบับร่าง · {expense.docCode ?? id.slice(0, 8)} — แก้ได้ทุกช่อง แล้วกดยืนยัน
          </p>
        </div>
      </header>

      {/* ทางเชื่อมเข้าเว็บเต็ม — เฉพาะบัญชี/ผู้ดูแล (admin tier). หมวด/สาขา · ส่ง TRCloud · ขอโอน
          ทำบนมือถือนี้ได้เลย (ด้านล่าง). ลิงก์นี้ไว้ต่อไปเครื่องมือบัญชีหนัก (ออกเอกสาร PV/JV ·
          รายงาน) ที่อยู่บนเว็บ. พนักงานหน้างานไม่เห็น. (CEO 2026-07-26) */}
      {isAdminTier(session.user.role) && (
        <Link
          href={`/ledger/expenses?${sp.company ? `company=${encodeURIComponent(sp.company)}&` : ""}selected=${encodeURIComponent(id)}&focus=1`}
          className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-500 active:bg-zinc-50"
        >
          <span>เปิดในเว็บเต็ม — เครื่องมือบัญชีทั้งหมด (ออกเอกสาร · รายงาน)</span>
          <ChevronLeft className="size-3.5 rotate-180" aria-hidden />
        </Link>
      )}

      <LiffExpensePane
        expense={expense}
        replacement={
          expense.replacedById && scope.companyId
            ? await getExpense({
                orgId: scope.orgId,
                companyId: scope.companyId,
                id: expense.replacedById,
              }).catch(() => null)
            : null
        }
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          sort: c.sort,
          trcloudAccCode: c.trcloudAccCode,
        }))}
        branches={scope.branches}
        canConfirm={actor.canConfirm}
        canSendTrcloud={canSendTrcloud}
        currentUserId={actor.userId}
        backHref={backHref}
        projects={projectOptions}
        // ขอโอนเงินบนมือถือ — ปุ่มโผล่ข้าง "บันทึกรายการ" (CEO 2026-08-01). เดิมเป็นการ์ด
        // แยกล่างสุดใต้ฟอร์ม (LiffPayeeRequest) CEO เลื่อนไม่เจอ → ย้ายมาไว้ในแถบล่าง.
        payout={
          companyId
            ? {
                expenseId: id,
                companyId,
                canRequest: canRequestTransfer,
                classified,
                alreadyRequested,
              }
            : null
        }
      />
    </div>
  );
}
