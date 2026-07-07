// LedgerLine — /ledger/bank-recon: Bank Statement Reconciliation Hub
// Overview of all bank accounts + reconciliation status per month.
// Matches PEAK Account "บัญชีธนาคาร" hub page.
//
// Multi-tenant: scoped by orgId + companyId (W-025).
// Feature-flagged: LEDGER_BANK_RECON_V1

import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { ledgerBankReconV1, ledgerRevenueGlV1 } from "@/lib/ledger/flags";
import { listBankAccountsWithStatus } from "@/lib/ledger/bank-statement-reconcile";
import { reconcileCoverage } from "@/lib/ledger/recon-controls";
import { CoverageCard } from "./_components/CoverageCard";
import { BankAccountStatusIcon } from "./_components/ConfidencePill";
import { SmartImportButton } from "./_components/SmartImportButton";
import { BANK_LABELS } from "@/lib/ledger/bank-adapters/types";
import { BankLogo } from "@/components/ledger/BankLogo";
import {
  Landmark, Settings, TrendingUp, ChevronRight,
  CalendarCheck2, CalendarOff, Database, Inbox,
  Archive, ClipboardCheck, ArrowLeftRight, Sparkles,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const BANK_NAMES = BANK_LABELS;

// "2026-06-14" / "2026-06-15 04:37:..." → "14 มิ.ย. 2569" (parse components → no TZ shift)
function thDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", {
    day: "numeric", month: "short", year: "numeric",
  });
}

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

  // ภาพรวมทุกบัญชี: กระทบยอดไปกี่ % (count + ฿) ของเดือนนี้
  const periodStart = `${period}-01`;
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  const coverage = await reconcileCoverage({
    orgId: scope.orgId, companyId: scope.companyId, periodStart, periodEnd,
  });

  // Month navigation
  const prevMonth = new Date(year, month - 2, 1);
  const nextMonth = new Date(year, month, 1);
  const prevPeriod = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const nextPeriod = nextMonth > now ? null : `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

  // Portfolio-level rollup (answers the CEO's "ข้อมูลล่าสุดคือวันไหน" at a glance)
  const totalUnmatched = accounts.reduce((s, a) => s + a.unmatchedCount, 0);
  const withData = accounts.filter((a) => a.lastImportedDate).length;
  const noData = accounts.length - withData;
  // newest statement date across every account (ISO strings compare correctly)
  const latestData = accounts.reduce<string | null>(
    (m, a) => (a.lastImportedDate && (!m || a.lastImportedDate > m) ? a.lastImportedDate : m),
    null,
  );

  const cp = `company=${scope.companyId}`;

  // status → left accent colour on each account card
  function accentClass(a: (typeof accounts)[number]): string {
    if (a.status === "locked") return "bg-zinc-300";
    if (a.unmatchedCount > 0) return "bg-rose-400";
    if (a.status === "completed") return "bg-emerald-400";
    return "bg-zinc-200";
  }

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader title="กระทบยอดธนาคาร" scope={scope} />

      {/* ── Hero: latest data + portfolio stats + primary import CTA ───────── */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-soft">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <Database size={22} />
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-400">ข้อมูลล่าสุดในระบบ</p>
              {latestData ? (
                <p className="text-xl font-bold text-zinc-900 tabular-num">
                  ถึงวันที่ {thDate(latestData)}
                </p>
              ) : (
                <p className="text-base font-semibold text-zinc-500">ยังไม่มี statement ในระบบ</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:shrink-0">
            <SmartImportButton companyId={scope.companyId} period={period} />
            <Link
              href={`/ledger/bank-recon/revenue?${cp}`}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 sm:min-h-0 sm:py-2"
              title="จัดการรายได้"
            >
              <TrendingUp size={14} />
              <span className="hidden sm:inline">จัดการรายได้</span>
            </Link>
            <Link
              href={`/ledger/bank-recon/accounts?${cp}`}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 sm:min-h-0 sm:py-2"
              title="จัดการบัญชี"
            >
              <Settings size={14} />
              <span className="hidden sm:inline">จัดการบัญชี</span>
            </Link>
            {ledgerRevenueGlV1() && (
              <Link
                href={`/ledger/bank-recon/revenue-channels?${cp}`}
                className="press hidden min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 sm:inline-flex sm:min-h-0 sm:py-2"
                title="ผังบัญชีรายได้"
              >
                <Settings size={14} />
                ผังบัญชีรายได้
              </Link>
            )}
          </div>
        </div>

        {/* mini stats */}
        {accounts.length > 0 && (
          <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 border-t border-zinc-100 sm:grid-cols-4 sm:divide-y-0">
            {[
              { label: "บัญชีทั้งหมด",     value: accounts.length,  color: "text-zinc-800" },
              { label: "มีข้อมูลแล้ว",     value: withData,         color: "text-emerald-600" },
              { label: "ค้างกระทบยอด",     value: totalUnmatched,   color: totalUnmatched > 0 ? "text-rose-600" : "text-zinc-400" },
              { label: "ยังไม่นำเข้า",     value: noData,           color: noData > 0 ? "text-amber-600" : "text-zinc-400" },
            ].map((s) => (
              <div key={s.label} className="px-4 py-3 text-center">
                <p className={`text-2xl font-bold tabular-num ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-zinc-400">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── ภาพรวมการกระทบยอดทุกบัญชี (กี่ % · count + ฿) ───────────────────────── */}
      {accounts.length > 0 && (
        <div className="mb-4">
          <CoverageCard coverage={coverage} title="กระทบยอดไปกี่ % — ทุกบัญชีรวมกัน" subtitle={periodLabel} />
        </div>
      )}

      {/* ── Workspace links: คลัง · คำขออนุมัติ · โยกเงิน · รายการพิเศษ (แถบกระชับ) ── */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { href: "archive",       label: "คลัง",          hint: "รายการที่กระทบยอดแล้ว", Icon: Archive },
          { href: "approvals",     label: "คำขออนุมัติ",   hint: "อนุมัติย้อนรายการ",      Icon: ClipboardCheck },
          { href: "transfers",     label: "โยกเงิน",        hint: "ระหว่างบัญชี",          Icon: ArrowLeftRight },
          { href: "special-items", label: "รายการพิเศษ",   hint: "โยกเงิน + ข้าม/ไม่มีคู่", Icon: Sparkles },
        ].map(({ href, label, hint, Icon }) => (
          <Link
            key={href}
            href={`/ledger/bank-recon/${href}?${cp}`}
            title={hint}
            className="press group flex items-center gap-2 rounded-xl border border-zinc-100 bg-white px-3 py-2 transition-colors hover:border-brand-200 hover:shadow-soft focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-zinc-800">{label}</span>
              <span className="hidden truncate text-[10px] leading-tight text-zinc-400 sm:block">{hint}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* ── Month selector (drives the per-account status/ค้าง counts) ───────── */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-zinc-400">สถานะกระทบยอดของเดือน</span>
        <Link
          href={`?${cp}&period=${prevPeriod}`}
          className="press rounded-lg border border-zinc-200 px-2.5 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          ←
        </Link>
        <span className="text-sm font-semibold text-zinc-800">{periodLabel}</span>
        {nextPeriod ? (
          <Link
            href={`?${cp}&period=${nextPeriod}`}
            className="press rounded-lg border border-zinc-200 px-2.5 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            →
          </Link>
        ) : (
          <span className="rounded-lg border border-zinc-100 px-2.5 py-1 text-sm text-zinc-300">→</span>
        )}
      </div>

      {/* ── Account cards, grouped by bank ──────────────────────────────────── */}
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-16 text-center">
          <Landmark size={32} className="mx-auto mb-3 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600">ยังไม่มีบัญชีธนาคาร</p>
          <Link
            href={`/ledger/bank-recon/accounts?${cp}`}
            className="press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700 sm:min-h-0 sm:py-2"
          >
            <Settings size={12} />
            เพิ่มบัญชีธนาคาร
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(
            accounts.reduce<Record<string, typeof accounts>>((acc, a) => {
              (acc[a.bankCode] ??= []).push(a); return acc;
            }, {}),
          ).map(([bankCode, list]) => (
            <div key={bankCode}>
              <div className="mb-2 flex items-center gap-2">
                <BankLogo code={bankCode} name={BANK_NAMES[bankCode]} size={22} />
                <h3 className="text-sm font-semibold text-zinc-700">{BANK_NAMES[bankCode] ?? bankCode}</h3>
                <span className="rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-400">{list.length}</span>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map((acct) => {
                  const hasData = !!acct.lastImportedDate;
                  return (
                    <Link
                      key={acct.accountId}
                      href={`/ledger/bank-recon/${acct.accountId}?period=${period}&${cp}`}
                      className="press group relative flex flex-col gap-2 overflow-hidden rounded-xl border border-zinc-100 bg-white p-3 transition-colors hover:border-brand-200 hover:shadow-soft"
                    >
                      {/* status accent rail */}
                      <span className={`absolute inset-y-2.5 left-0 w-1 rounded-r-full ${accentClass(acct)}`} aria-hidden />

                      {/* header: logo + name + chevron */}
                      <div className="flex items-start gap-2 pl-1.5">
                        <BankLogo code={acct.bankCode} name={BANK_NAMES[acct.bankCode]} size={28} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-800">{acct.accountName}</p>
                          <p className="font-mono text-[11px] text-zinc-400 tabular-num">{acct.accountNo}</p>
                        </div>
                        <ChevronRight size={16} className="shrink-0 text-zinc-300 transition-colors group-hover:text-brand-500" />
                      </div>

                      {/* DATA FRESHNESS — บรรทัดเดียว กระชับ */}
                      {hasData ? (
                        <div className="flex items-center gap-1.5 rounded-lg bg-brand-50/60 px-2.5 py-1.5">
                          <CalendarCheck2 size={14} className="shrink-0 text-brand-600" />
                          <span className="text-[11px] text-zinc-400">ถึง</span>
                          <span className="text-[13px] font-semibold text-zinc-800 tabular-num">{thDate(acct.lastImportedDate)}</span>
                          {acct.lastUploadedAt && (
                            <span className="ml-auto shrink-0 text-[10px] text-zinc-400">นำเข้า {thDate(acct.lastUploadedAt)}</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 text-zinc-400">
                          <CalendarOff size={14} className="shrink-0" />
                          <p className="text-[11px]">ยังไม่มีข้อมูล · แตะเพื่อนำเข้า statement</p>
                        </div>
                      )}

                      {/* footer: status + pending count */}
                      <div className="flex items-center justify-between pl-1.5">
                        <BankAccountStatusIcon status={acct.status} />
                        {acct.unmatchedCount > 0 ? (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 tabular-num">
                            ค้าง {acct.unmatchedCount}
                          </span>
                        ) : acct.matchedCount > 0 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">ครบแล้ว</span>
                        ) : hasData ? (
                          <span className="text-xs text-zinc-400">ไม่มีรายการเดือนนี้</span>
                        ) : (
                          <span className="text-xs text-zinc-300">—</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* gentle nudge when nothing has been imported yet */}
          {withData === 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/50 px-4 py-4">
              <Inbox size={22} className="shrink-0 text-brand-600" />
              <div className="flex-1 text-sm text-zinc-600">
                <p className="font-medium text-zinc-800">ยังไม่มี statement ในระบบ</p>
                <p className="text-xs text-zinc-500">กด “นำเข้า statement” แล้วลากไฟล์วาง — ระบบจะรู้เองว่าเป็นธนาคารและบัญชีไหน</p>
              </div>
              <SmartImportButton companyId={scope.companyId} period={period} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
