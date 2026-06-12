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
import { BankLogo } from "@/components/ledger/BankLogo";
import { Landmark, Settings, TrendingUp, ChevronRight } from "lucide-react";
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

        <div className="flex items-center gap-2">
          <Link
            href={`/ledger/bank-recon/revenue?company=${scope.companyId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
          >
            <TrendingUp size={14} />
            จัดการรายได้
          </Link>
          <Link
            href={`/ledger/bank-recon/accounts?company=${scope.companyId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
          >
            <Settings size={14} />
            จัดการบัญชี
          </Link>
        </div>
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
        <div className="space-y-5">
          {Object.entries(
            accounts.reduce<Record<string, typeof accounts>>((acc, a) => {
              (acc[a.bankCode] ??= []).push(a); return acc;
            }, {}),
          ).map(([bankCode, list]) => (
            <div key={bankCode}>
              <div className="mb-2 flex items-center gap-2">
                <BankLogo code={bankCode} name={BANK_NAMES[bankCode]} size={28} />
                <h3 className="text-sm font-semibold text-zinc-700">{BANK_NAMES[bankCode] ?? bankCode}</h3>
                <span className="text-xs text-zinc-400">({list.length})</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-100">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-50">
                    {list.map((acct) => (
                      <tr key={acct.accountId} className="hover:bg-zinc-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <BankAccountStatusIcon status={acct.status} />
                            <span className="font-mono text-xs text-zinc-500">{acct.accountNo}</span>
                          </div>
                          <p className="mt-0.5 text-zinc-700 max-w-[280px] truncate">{acct.accountName}</p>
                          <p className="text-[11px] text-zinc-400">
                            {acct.lastImportedDate ? `อัพ statement ถึง ${acct.lastImportedDate}` : "ยังไม่ได้นำเข้า statement"}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {acct.unmatchedCount > 0 ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                              ค้าง {acct.unmatchedCount}
                            </span>
                          ) : acct.matchedCount > 0 ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">ครบแล้ว</span>
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Link
                            href={`/ledger/bank-recon/${acct.accountId}?period=${period}&company=${scope.companyId}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                          >
                            เปิด <ChevronRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
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
