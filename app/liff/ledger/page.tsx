// LedgerLine — LINE Mini App (LIFF) entry · /liff/ledger
//
// Phone-first capture+confirm for front-line staff (the "Bainy in LINE" flow):
// snap/upload a receipt photo → AI reads it (/api/ledger/ocr) → staff eyeballs
// the read-back fields → edits if wrong → confirms. The expense is created
// status=draft (GOLDEN RULE — NEVER auto-post; an accountant finalises it later
// in the web review pane). This LIFF flow just speeds first capture from the field.
//
// This is a thin SERVER shell: it resolves the signed-in user's org companies
// (+ branches + categories of the default company) so the client capture app can
// post against the real API (which is company-scoped). Auth comes from the /liff
// layout's LiffBootstrap (verified LINE id_token → Pool session), same as
// ChairOps / HotelBook. All interaction lives in the client capture component,
// which talks ONLY to the /api/ledger/* HTTP routes.

import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { listCompanies, listBranches, listCategories } from "@/lib/ledger/queries";
import { LedgerCaptureApp } from "./_components/ledger-capture-app";
import { LedgerMascot } from "@/components/ledger/Brand";

export const dynamic = "force-dynamic";

export default async function LedgerLiffPage() {
  const session = await getSession();

  // Not signed in yet → LiffBootstrap (in the /liff layout) auto-logs-in via the
  // verified LINE id_token and re-renders. Show a calm waiting state meanwhile.
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

  const orgId = session.user.org_id;

  // Resolve companies (+ default company's branches & categories) for the picker.
  let companies: Array<{ id: string; code: string; name: string }> = [];
  let branches: Array<{ id: string; code: string; name: string; businessType: string }> = [];
  let categories: Array<{ id: string; name: string; color: string | null }> = [];
  try {
    companies = await listCompanies(orgId);
    const defaultCompanyId = companies[0]?.id;
    if (defaultCompanyId) {
      [branches, categories] = await Promise.all([
        listBranches(orgId, defaultCompanyId),
        listCategories(orgId, defaultCompanyId).then((cs) =>
          cs.map((c) => ({ id: c.id, name: c.name, color: c.color })),
        ),
      ]);
    }
  } catch {
    // DB hiccup → let the app render with empty pickers (manual entry still works
    // once a company exists). No dead end.
  }

  // No company configured for this org yet → friendly setup nudge (not a crash).
  if (companies.length === 0) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <LedgerMascot size={88} priority />
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-800">
            ยังไม่ได้ตั้งค่าบริษัท
          </p>
          <p className="text-sm text-zinc-500">
            ให้ฝ่ายบัญชีเปิดบริษัทในเมนู “ตั้งค่า” ของ LedgerLine ก่อน แล้วค่อยถ่ายใบเสร็จ
          </p>
        </div>
        <Link
          href="/ledger/settings"
          className="rounded-xl bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-semibold text-white active:bg-[var(--color-brand-700)]"
        >
          ไปหน้าตั้งค่า
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <LedgerCaptureApp
        companies={companies}
        initialBranches={branches}
        initialCategories={categories}
      />
    </div>
  );
}
