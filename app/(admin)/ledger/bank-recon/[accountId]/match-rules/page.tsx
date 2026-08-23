// LedgerLine — /ledger/bank-recon/[accountId]/match-rules
// "เงื่อนไขการแมตช์" ต่อบัญชี — วันต้องตรงกัน + ยอดห่างกันได้กี่บาท ต่อประเภท (QR/เงินสด/Grab/...)
// ไม่ตั้ง = ใช้ค่าเริ่มต้นของระบบ (reconcile-match-keywords.ts) — ตั้งแล้วมีผลเฉพาะบัญชีนี้เท่านั้น
// sibling ของ [accountId]/keywords/page.tsx — header/back-link เดียวกัน · write = super_admin.

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../../_scope";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listMatchRulesForAccount } from "@/lib/ledger/reconcile-match-rule";
import { prisma } from "@/lib/prisma";
import { BankLogo } from "@/components/ledger/BankLogo";
import { MatchRuleManager } from "./_components/MatchRuleManager";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BankMatchRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ company?: string; branch?: string; period?: string; periodTo?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
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

  const rules = await listMatchRulesForAccount(orgId, accountId);
  const canEdit = session.user.role === "super_admin";

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
          <h1 className="text-lg font-semibold text-zinc-900">เงื่อนไขการแมตช์</h1>
          <p className="text-sm text-zinc-500">{a.accountName} · ****{last4}</p>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
        ว่างไว้ = ใช้ค่าเริ่มต้นของระบบ · <b>&quot;วันต้องตรงกัน&quot; ใส่ 0</b> = ต้องเป็นวันเดียวกันเป๊ะ (กันยอดใกล้เคียงกันมั่วข้ามวัน) ·
        มีผลเฉพาะบัญชีนี้เท่านั้น ไม่กระทบบัญชีอื่น
      </div>

      <MatchRuleManager bankAccountId={accountId} rules={rules} canEdit={canEdit} />
    </div>
  );
}
