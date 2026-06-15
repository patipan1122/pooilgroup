// LedgerLine — /ledger/bank-recon/[accountId]/keywords
// "สมุดจำคีย์เวิร์ด" ต่อบัญชี — ชื่อในสเตทเมนต์ ↔ ประเภท (Grab/Shopee/EDC/QR/...).
// matcher "ดูชื่อ" ใช้คีย์เหล่านี้ + คีย์ในระบบ. ระบบจะ "จำ" คีย์ใหม่เองตอนคนยืนยันแมตช์.
// sibling ของ [accountId]/page.tsx — header/back-link เดียวกัน · write = super_admin.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listKeywordsForAccount } from "@/lib/ledger/reconcile-keyword-dict";
import { prisma } from "@/lib/prisma";
import { BankLogo } from "@/components/ledger/BankLogo";
import { KeywordManager } from "./_components/KeywordManager";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BankKeywordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ company?: string; branch?: string; period?: string; periodTo?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { accountId } = await params;
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);
  if (!ledgerBankReconV1() || !scope.companyId) redirect("/ledger/bank-recon");
  const orgId = session.user.org_id;

  const acct = await prisma.$queryRaw<{ bankCode: string; accountNo: string; accountName: string }[]>`
    SELECT a.bank_code as "bankCode", a.account_no as "accountNo", a.account_name as "accountName"
    FROM ledger_bank_account a
    WHERE a.id = ${accountId}::uuid AND a.org_id = ${orgId}::uuid LIMIT 1`;
  if (!acct.length) redirect("/ledger/bank-recon");
  const a = acct[0];
  const last4 = (a.accountNo ?? "").slice(-4);

  const { builtin, custom } = await listKeywordsForAccount(orgId, accountId);
  const canEdit = session.user.role === "super_admin";

  // กลับไปหน้ากระทบยอด (คงงวด/บริษัทที่เลือกไว้)
  const qs = new URLSearchParams();
  if (sp.company) qs.set("company", sp.company);
  if (sp.period) qs.set("period", sp.period);
  if (sp.periodTo) qs.set("periodTo", sp.periodTo);
  const backHref = `/ledger/bank-recon/${accountId}/reconcile${qs.toString() ? `?${qs}` : ""}`;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ChevronLeft className="h-4 w-4" /> กลับหน้ากระทบยอด
      </Link>

      <div className="mb-5 flex items-center gap-3">
        <BankLogo code={a.bankCode} size={40} />
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">สมุดจำคีย์เวิร์ด</h1>
          <p className="text-sm text-zinc-500">{a.accountName} · ****{last4}</p>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
        เวลาจับคู่ยอด ระบบดู <b>ชื่อในสเตทเมนต์</b> ให้ตรงประเภทก่อน (กันจับผิดเจ้าที่ยอดบังเอิญเท่ากัน).
        คำหลักด้านล่างคือ &quot;ชื่อที่ระบบรู้จัก&quot; ของบัญชีนี้ — และจะ <b>จำเพิ่มเองทุกครั้งที่คุณกดยืนยันแมตช์</b>.
      </div>

      <KeywordManager
        bankAccountId={accountId}
        builtin={builtin}
        custom={custom}
        canEdit={canEdit}
      />
    </div>
  );
}
