import "server-only";
import { prisma } from "@/lib/prisma";
import { bankName } from "@/lib/ledger/payment-request-card";

// LedgerLine · "บิลที่ต้องจ่าย" — คำขอโอนที่ยังไม่จ่าย (open) + จ่ายบางส่วน (partial)
//   รวมในจอเดียวสำหรับ CEO นั่งโอน: ผู้รับ (บัญชี/พร้อมเพย์/QR) · ยอด · ค้างมากี่วัน · เตือนซ้ำ.
//   อ่านอย่างเดียว — ไม่แตะเงินจริง/ไม่เขียน TRCloud. เงินโอนจริง CEO กดเองผ่านแอปธนาคาร.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// เทียบ "อาจซ้ำ" กับใบที่จ่ายไปแล้วภายในกี่วัน (กัน CEO เผลอโอนบิลเดิม 2 รอบ)
const PAID_DUP_WINDOW_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

export type ToPayBill = { docCode: string; amount: number };

export type ToPayDup = {
  otherOpenCount: number; // ผู้ขาย+ยอดเดียวกัน ที่ยังรอโอนอยู่อีกกี่ใบ (ไม่นับใบนี้)
  paidRecently: { when: string; docCode: string | null } | null; // จ่ายไปแล้วเร็ว ๆ นี้ (ใบตัวอย่าง)
};

export type ToPayRow = {
  id: string;
  state: "open" | "partial";
  vendor: string | null;
  expectedTransfer: number;
  paidTotal: number;
  remaining: number; // ยอดที่ยังต้องโอน (expectedTransfer - paidTotal)
  whtTotal: number;
  requestedAt: string;
  daysWaiting: number;
  bills: ToPayBill[];
  payeeAcctName: string | null;
  payeeBankName: string | null; // แปลรหัสธนาคาร → ชื่อแล้ว
  payeeAcctNo: string | null;
  payeePromptpay: string | null;
  payeeQrImageUrl: string | null;
  dup: ToPayDup | null;
};

export type ToPayData = {
  rows: ToPayRow[];
  totalRemaining: number; // รวมยอดที่ยังต้องโอนทั้งหมด
  count: number;
};

const SELECT = {
  id: true,
  state: true,
  vendor: true,
  expectedTransfer: true,
  paidTotal: true,
  whtTotal: true,
  requestedAt: true,
  payeeAcctName: true,
  payeeBankCode: true,
  payeeAcctNo: true,
  payeePromptpay: true,
  payeeQrImageUrl: true,
  bills: { select: { expenseId: true, billAmount: true } },
} as const;

function dupKey(vendor: string | null, amount: number): string {
  return `${(vendor ?? "").trim().toLowerCase()}|${round2(amount).toFixed(2)}`;
}

export async function listToPay(
  orgId: string,
  companyId: string,
  opts?: { branchId?: string | null },
): Promise<ToPayData> {
  const base: { orgId: string; companyId: string; branchId?: string } = { orgId, companyId };
  if (opts?.branchId) base.branchId = opts.branchId;
  const paidSince = new Date(Date.now() - PAID_DUP_WINDOW_DAYS * DAY_MS);

  const [openRows, partialRows, paidRows] = await Promise.all([
    prisma.ledgerPaymentRequest.findMany({ where: { ...base, state: "open" }, select: SELECT, orderBy: { requestedAt: "asc" }, take: 500 }),
    prisma.ledgerPaymentRequest.findMany({ where: { ...base, state: "partial" }, select: SELECT, orderBy: { requestedAt: "asc" }, take: 500 }),
    // ใบที่จ่ายไปแล้วภายใน 30 วัน — ใช้ตรวจซ้ำเท่านั้น
    prisma.ledgerPaymentRequest.findMany({
      where: { ...base, state: "paid", paidAt: { gte: paidSince } },
      select: { id: true, vendor: true, expectedTransfer: true, paidAt: true, bills: { select: { expenseId: true } } },
      orderBy: { paidAt: "desc" },
      take: 500,
    }),
  ]);

  const toPayRaw = [...openRows, ...partialRows];

  // docCodes ของบิลในใบที่ต้องจ่าย — ยิงครั้งเดียว scoped (กัน N+1 + กันข้ามบริษัท)
  const expenseIds = Array.from(new Set(toPayRaw.flatMap((r) => r.bills.map((b) => b.expenseId))));
  const paidExpenseIds = Array.from(new Set(paidRows.flatMap((r) => r.bills.map((b) => b.expenseId))));
  const allExpIds = Array.from(new Set([...expenseIds, ...paidExpenseIds]));
  const docCodeByExpense = new Map<string, string>();
  if (allExpIds.length) {
    const codes = await prisma.ledgerExpense.findMany({
      where: { id: { in: allExpIds }, orgId, companyId },
      select: { id: true, docCode: true },
    });
    for (const c of codes) docCodeByExpense.set(c.id, c.docCode);
  }

  // ดัชนีตรวจซ้ำ: นับ open+partial ต่อ key(ผู้ขาย|ยอด) และเก็บใบ paid ล่าสุดต่อ key
  const openKeyCount = new Map<string, number>();
  for (const r of toPayRaw) {
    const k = dupKey(r.vendor, Number(r.expectedTransfer));
    openKeyCount.set(k, (openKeyCount.get(k) ?? 0) + 1);
  }
  const paidByKey = new Map<string, { when: Date; docCode: string | null }>();
  for (const r of paidRows) {
    if (!r.paidAt) continue;
    const k = dupKey(r.vendor, Number(r.expectedTransfer));
    if (!paidByKey.has(k)) {
      const sampleDoc = r.bills[0] ? (docCodeByExpense.get(r.bills[0].expenseId) ?? null) : null;
      paidByKey.set(k, { when: r.paidAt, docCode: sampleDoc });
    }
  }

  const now = Date.now();
  const rows: ToPayRow[] = toPayRaw.map((r) => {
    const expected = round2(Number(r.expectedTransfer));
    const paid = round2(Number(r.paidTotal));
    const k = dupKey(r.vendor, Number(r.expectedTransfer));
    const otherOpen = (openKeyCount.get(k) ?? 1) - 1;
    const paidHit = paidByKey.get(k) ?? null;
    const dup: ToPayDup | null =
      otherOpen > 0 || paidHit
        ? { otherOpenCount: otherOpen, paidRecently: paidHit ? { when: paidHit.when.toISOString(), docCode: paidHit.docCode } : null }
        : null;
    return {
      id: r.id,
      state: r.state as "open" | "partial",
      vendor: r.vendor,
      expectedTransfer: expected,
      paidTotal: paid,
      remaining: round2(Math.max(0, expected - paid)),
      whtTotal: round2(Number(r.whtTotal)),
      requestedAt: r.requestedAt.toISOString(),
      daysWaiting: Math.max(0, Math.floor((now - r.requestedAt.getTime()) / DAY_MS)),
      bills: r.bills.map((b) => ({ docCode: docCodeByExpense.get(b.expenseId) ?? "—", amount: round2(Number(b.billAmount)) })),
      payeeAcctName: r.payeeAcctName,
      payeeBankName: bankName(r.payeeBankCode),
      payeeAcctNo: r.payeeAcctNo,
      payeePromptpay: r.payeePromptpay,
      payeeQrImageUrl: r.payeeQrImageUrl,
      dup,
    };
  });

  // เรียงค้างนานสุดขึ้นก่อน (เก่าสุด = requestedAt น้อยสุด)
  rows.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  const totalRemaining = round2(rows.reduce((s, r) => s + r.remaining, 0));
  return { rows, totalRemaining, count: rows.length };
}
