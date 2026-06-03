// LedgerLine — cheap duplicate guard for LINE capture.
//
// CEO rule: "เช็คยอดเงินซ้ำก่อน ง่ายๆ จะได้ไม่เปลือง token" — compare the AMOUNT
// only, and only within today + yesterday (Asia/Bangkok). Pure DB lookup, no AI.
// Used by the "จด" text path (images already dedup by sha256). On a hit we don't
// block — we still create the draft (lossless) but flag it so the card warns and
// the accountant eyeballs it on the web.

import { prisma } from "@/lib/prisma";

/** Start of YESTERDAY 00:00 Asia/Bangkok, as a real UTC Date. */
function bangkokYesterdayStart(): Date {
  const bkk = new Date(Date.now() + 7 * 3600 * 1000); // shift to Bangkok wall-clock
  const ms = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() - 1, 0, 0, 0);
  return new Date(ms - 7 * 3600 * 1000); // back to real UTC
}

export interface RecentDuplicate {
  id: string;
  docCode: string;
  createdAt: Date;
}

/**
 * Find a non-void expense with the SAME total created today or yesterday
 * (Asia/Bangkok) in the same org+company. Returns the most recent, or null.
 */
export async function findRecentAmountDuplicate(
  orgId: string,
  companyId: string,
  total: number | null,
): Promise<RecentDuplicate | null> {
  if (!total || total <= 0) return null;
  const rounded = Math.round(total * 100) / 100;
  const dup = await prisma.ledgerExpense.findFirst({
    where: {
      orgId,
      companyId,
      total: rounded,
      status: { not: "void" },
      createdAt: { gte: bangkokYesterdayStart() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, docCode: true, createdAt: true },
  });
  return dup;
}
