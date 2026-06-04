// LedgerLine — daily digest + budget alert builder.
//
// Produces the text the cron DMs to the CEO/accountant (NEVER into a branch
// group — see [[line-channels-separate-per-module]] / budget-alert rule). Pure
// data → string; the cron handles recipients + LINE push.

import { prisma } from "@/lib/prisma";
import { listBudgets } from "@/app/(admin)/ledger/_data";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";

function dec(v: { toNumber: () => number } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

function fmtTHB(n: number): string {
  return `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Asia/Bangkok start-of-today as a UTC Date (for createdAt filtering). */
function bangkokTodayStartUtc(): Date {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 3600_000);
  const y = bkk.getUTCFullYear(), m = bkk.getUTCMonth(), d = bkk.getUTCDate();
  // 00:00 Bangkok = 17:00 UTC the previous day.
  return new Date(Date.UTC(y, m, d) - 7 * 3600_000);
}

export interface LedgerDigest {
  text: string;
  /** true when there's something worth pinging about (captures today or alerts). */
  hasContent: boolean;
  companyName: string;
}

/**
 * Build the daily digest for one company: today's captures, pending drafts,
 * this month's confirmed spend, and any category over its budget alert %.
 */
export async function buildLedgerDigest(
  orgId: string,
  companyId: string,
): Promise<LedgerDigest> {
  const period = currentPeriodBangkok(); // YYYY-MM (Bangkok)
  const [y, m] = period.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 1));
  const todayStart = bangkokTodayStartUtc();

  const [company, capturedToday, pendingDrafts, monthAgg, budgets] = await Promise.all([
    prisma.company.findFirst({ where: { id: companyId, orgId }, select: { name: true } }),
    prisma.ledgerExpense.count({ where: { orgId, companyId, createdAt: { gte: todayStart } } }),
    prisma.ledgerExpense.count({ where: { orgId, companyId, status: "draft" } }),
    prisma.ledgerExpense.aggregate({
      where: { orgId, companyId, status: { in: ["confirmed", "locked"] }, docDate: { gte: monthStart, lt: monthEnd } },
      _sum: { total: true },
    }),
    listBudgets(orgId, companyId, period),
  ]);

  const monthSpend = dec(monthAgg._sum.total);
  const overBudget = budgets.filter((b) => b.amount > 0 && b.used / b.amount >= b.alertPct / 100);

  const companyName = company?.name ?? "บริษัท";
  const lines: string[] = [
    `📒 สรุปบัญชีวันนี้ · ${companyName}`,
    "",
    `📥 วันนี้บันทึกเข้ามา: ${capturedToday} ใบ`,
    `⏳ รอบัญชียืนยัน: ${pendingDrafts} ใบ`,
    `💸 ใช้ไปเดือนนี้ (ยืนยันแล้ว): ${fmtTHB(monthSpend)}`,
  ];

  if (overBudget.length > 0) {
    lines.push("", "🔔 หมวดที่ใกล้/เกินงบ:");
    for (const b of overBudget.slice(0, 8)) {
      const pct = Math.round((b.used / b.amount) * 100);
      lines.push(`• ${b.categoryName ?? "หมวด"}: ${fmtTHB(b.used)} / ${fmtTHB(b.amount)} (${pct}%)`);
    }
  }

  if (pendingDrafts > 0) {
    lines.push("", "👉 เปิดเว็บกดยืนยันได้ที่เมนู “รายจ่าย”");
  }

  return {
    text: lines.join("\n"),
    hasContent: capturedToday > 0 || pendingDrafts > 0 || overBudget.length > 0,
    companyName,
  };
}
