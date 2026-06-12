// LedgerLine — /ledger/bank-recon: Bank Statement Reconciliation Hub
// Overview of all bank accounts + reconciliation status per month.
// Matches PEAK Account "บัญชีธนาคาร" hub page.
//
// Multi-tenant: scoped by orgId + companyId (W-025).
// Feature-flagged: LEDGER_BANK_RECON_V1

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { ledgerBankReconV1 } from "@/lib/ledger/flags";
import { listBankAccountsWithStatus } from "@/lib/ledger/bank-statement-reconcile";
import { BankAccountStatusIcon } from "./_components/ConfidencePill";
import { BANK_LABELS } from "@/lib/ledger/bank-adapters/types";
import { Landmark, Upload, Settings } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const BANK_NAMES = BANK_LABELS;

export default async function BankReconHubPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; period?: string }>;
}) {
  const session = await requireRole(
    "super_admin", "org_admin", "admin", "area_manager", "viewer",
  );
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="กระทบยอดธนาคาร" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  if (!ledgerBankReconV1()) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="กระทบยอดธนาคาร" scope={scope} />
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
          ระบบกระทบยอดธนาคารยังไม่เปิดใช้ — เปิดได้ที่ Vercel (LEDGER_BANK_RECON_V1=1)
        </div>
      </div>
    );
  }

  // Current period (default = current month)
  const now = new Date();
  const period = sp.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);
  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("th-TH", {
    year: "numeric", month: "long",
  });

  const accounts = await listBankAccountsWithStatus({
    orgId: scope.orgId,
    companyId: scope.companyId,
    period,
  });

  // Month navigation
  const prevMonth = new Date(year, month - 2, 1);
  const nextMonth = new Date(year, month, 1);
  const prevPeriod = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const nextPeriod = nextMonth > now ? null : `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

  const totalUnmatched = accounts.reduce((s, a) => s + a.unmatchedCount, 0);
  const subtitle = accounts.length === 0
    ? "ยังไม่มีบัญชีธนาคาร"
    : `${accounts.length} บัญชี · ค้างกระทบยอด ${totalUnmatched} รายการ`;

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="กระทบยอดธนาคาร"
        subtitle={subtitle}
        scope={scope}
      />

      {/* Period selector */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`?company=${scope.companyId}&period=${prevPeriod}`}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            ←
          </Link>
          <span className="text-sm font-semibold text-zinc-800">{periodLabel}</span>
          {nextPeriod ? (
            <Link
              href={`?company=${scope.companyId}&period=${nextPeriod}`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              →
            </Link>
          ) : (
            <span className="rounded-lg border border-zinc-100 px-3 py-1.5 text-sm text-zinc-300">→</span>
          )}
        </div>

        <Link
          href={`/ledger/bank-recon/accounts?company=${scope.companyId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
        >
          <Settings size={14} />
          จัดการบัญชี
        </Link>
      </div>

      {/* Account table */}
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-16 text-center">
          <Landmark size={32} className="mx-auto mb-3 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600">ยังไม่มีบัญชีธนาคาร</p>
          <Link
            href={`/ledger/bank-recon/accounts?company=${scope.companyId}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Settings size={12} />
            เพิ่มบัญชีธนาคาร
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
                <th className="px-4 py-3">ธนาคาร</th>
                <th className="px-4 py-3">เลขที่บัญชี</th>
                <th className="px-4 py-3">ชื่อบัญชี</th>
                <th className="px-4 py-3 text-center">สถานะ</th>
                <th className="px-4 py-3 text-right">ค้างกระทบยอด</th>
                <th className="px-4 py-3 text-right">กระทบยอดแล้ว</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {accounts.map((acct) => (
                <tr key={acct.accountId} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-800">
                    {BANK_NAMES[acct.bankCode] ?? acct.bankCode}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-600">{acct.accountNo}</td>
                  <td className="px-4 py-3 text-zinc-600 max-w-[200px] truncate">{acct.accountName}</td>
                  <td className="px-4 py-3 text-center">
                    <BankAccountStatusIcon status={acct.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {acct.unmatchedCount > 0 ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        {acct.unmatchedCount}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-600">{acct.matchedCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/ledger/bank-recon/${acct.accountId}?period=${period}&company=${scope.companyId}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Upload size={10} />
                      กระทบยอด
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary counts */}
      {accounts.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "ล็อคแล้ว",         count: accounts.filter((a) => a.status === "locked").length,      color: "text-purple-600" },
            { label: "เสร็จแล้ว",         count: accounts.filter((a) => a.status === "completed").length,  color: "text-emerald-600" },
            { label: "กำลังทำ",           count: accounts.filter((a) => a.status === "in_progress").length, color: "text-blue-600" },
            { label: "ยังไม่เริ่ม",       count: accounts.filter((a) => a.status === "not_started").length, color: "text-zinc-400" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-zinc-100 bg-white p-3 text-center">
              <p className={`text-2xl font-bold ${item.color}`}>{item.count}</p>
              <p className="text-xs text-zinc-400">{item.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
