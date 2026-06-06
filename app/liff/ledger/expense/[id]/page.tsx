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
import { resolveScope } from "@/app/(admin)/ledger/_scope";
import { getExpense, listCategories } from "@/app/(admin)/ledger/_data";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
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

  const [expense, categories] = await Promise.all([
    scope.companyId
      ? getExpense({ orgId: scope.orgId, companyId: scope.companyId, id }).catch(() => null)
      : Promise.resolve(null),
    scope.companyId
      ? listCategories(scope.orgId, scope.companyId)
      : Promise.resolve([] as Awaited<ReturnType<typeof listCategories>>),
  ]);

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

  return (
    <div className="mx-auto w-full max-w-md px-3 pb-10">
      {/* Mobile header — back to list + น้องใบเสร็จ + context. Anchored Bainy-style. */}
      <header className="sticky top-0 z-10 -mx-3 mb-3 flex items-center gap-2 border-b border-zinc-200 bg-white/95 px-3 py-3 backdrop-blur">
        <Link
          href={`/liff/ledger/my${sp.company ? `?company=${encodeURIComponent(sp.company)}` : ""}`}
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
        }))}
        branches={scope.branches}
        canConfirm={actor.canConfirm}
        currentUserId={actor.userId}
        backHref={`/liff/ledger/my${sp.company ? `?company=${encodeURIComponent(sp.company)}` : ""}`}
      />
    </div>
  );
}
