// ClawFleet · แหล่งความจริงเดียวสำหรับ "กระทบยอดตอนปิดรอบสาขา" (เงิน + ตุ๊กตา)
// -----------------------------------------------------------------------------
// ทำไมมี (bug-fix 2026-07-20): เดิมมี 2 ทางปิดรอบสาขา
//   (1) พนักงานกดปิดเอง → closeBranchSession (actions.ts) เรียก deriveBranchCrossCheck
//       เขียน expected/actual/variance/ตุ๊กตา/totalCashCents/anomalyFlags ครบ
//   (2) cron ปิดให้ตอนเปิดค้าง >24 ชม. → เดิม "พลิก status = ANOMALY_REVIEW เฉย ๆ"
//       ไม่คำนวณอะไรเลย → totalCashCents ค้าง default 0 → รอบไม่เข้าลิสต์ "เงินค้างมือ
//       ต้องฝาก" (deposit ต้องการ totalCashCents > 0) + ไม่มีธงเงินขาด/ตุ๊กตาหาย
//       → พนักงาน "ไม่กดปิดรอบ" = หนีระบบตรวจเงินได้ทั้งหมด.
//   helper นี้รวมการคำนวณของทาง (1) มาเป็นฟังก์ชันกลางที่ cron เรียกได้ →
//   cron ปิดรอบด้วย "ตัวเลขเดียวกับกดปิดเอง" (ต่างแค่บังคับ ANOMALY_REVIEW เสมอ
//   เพราะพนักงานไม่ยอมปิด = ต้องมีคนตรวจ).
//
// ⚠️ closeBranchSession (actions.ts) ยัง inline logic เดียวกันนี้อยู่ (ไฟล์นั้นมี WIP
//   ของ session อื่นค้าง ณ 2026-07-20 จึงยังไม่ refactor ให้เรียก helper นี้) —
//   เมื่อ WIP นั้นลง setup แล้ว ควรแก้ closeBranchSession ให้เรียก helper นี้ด้วย
//   เพื่อลบ fork ให้หมด. deriveBranchCrossCheck (คณิตหลัก) เป็น pure + shared อยู่แล้ว.

import { prisma } from "@/lib/prisma";
import { deriveBranchCrossCheck, type BranchCrossCheck } from "./validation";
import { ANOMALY_FLAGS } from "./types";

// ราคา/ครั้ง fallback เมื่อไม่มี loadout — mirror ค่าใน actions.ts (CASH_PER_PLAY_CENTS)
const CASH_PER_PLAY_CENTS = 1000; // ฿10/ครั้ง (flat · design model)

// ธง "ตัดสินเงินขาด/เกิน" — รอบ baseline (รอบแรกไม่มีของก่อนหน้าให้เทียบ) ต้องกดธงพวกนี้
// ทิ้ง เหมือน closeBranchSession (ไม่งั้นรอบตั้งต้นจะขึ้นเงินขาด/เกินหลอก).
const MONEY_VERDICT_FLAGS: ReadonlySet<string> = new Set<string>([
  ANOMALY_FLAGS.M2_CASH_SHORT_MINOR,
  ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR,
  ANOMALY_FLAGS.M4_CASH_OVER,
  ANOMALY_FLAGS.M6_CASH_OVER_MAJOR,
]);

export type BranchCloseCrossCheck = {
  expectedCashCents: number;
  actualCashCents: number;
  cashVarianceBps: number;
  prizeMeterOut: number;
  prizeCountedOut: number;
  prizeVariance: number;
  totalCashCents: number; // = actualCashCents (เงินที่นับได้จริงของรอบ · ทำให้เข้าลิสต์ custody)
  anomalyFlags: BranchCrossCheck["flags"];
};

/**
 * คำนวณกระทบยอดปิดรอบ "สาขา" (เฉพาะรอบสาขาแท้ · groupId = null) จาก event จริงในรอบ.
 * คืน null เมื่อ: ไม่พบรอบ / เป็นรอบกลุ่ม (มี token trigger แยก) / ไม่มี event ให้คำนวณ.
 * ไม่แตะ DB write — ผู้เรียกเอา payload ไปเขียนเอง (คุม race/สถานะเองใน updateMany).
 */
export async function computeBranchCloseCrossCheck(
  orgId: string,
  sessionId: string,
): Promise<BranchCloseCrossCheck | null> {
  const cf = await prisma.cfCollectionSession.findFirst({
    where: { id: sessionId, orgId },
    select: {
      id: true,
      branchId: true,
      groupId: true,
      isBaseline: true,
      events: {
        where: { eventType: "COLLECTION" },
        select: {
          machineId: true,
          coinMeterBefore: true,
          coinMeterAfter: true,
          cashCountedCents: true,
          dollMeterBefore: true,
          dollMeterAfter: true,
          stockBefore: true,
          stockAfter: true,
          refillQty: true,
        },
      },
    },
  });
  // รอบกลุ่ม (groupId != null) ใช้ 3-way token cross-check trigger แยก → ไม่คิดแบบสาขาที่นี่
  if (!cf || !cf.branchId || cf.groupId || cf.events.length === 0) return null;

  // ราคา/ครั้งจริงต่อตู้ (ตาม loadout ปัจจุบัน) — ต้องใช้ราคาเดียวกับตอนกดปิดเอง ไม่งั้น
  // ตู้ราคาอื่นจะติดธงเงินขาด/เกินทั้งที่เงินถูก. ตู้ไม่มี loadout → fallback flat.
  const cashMachines = await prisma.cfMachine.findMany({
    where: { orgId, branchId: cf.branchId, kind: "CLAW" },
    select: {
      id: true,
      loadouts: {
        where: { effectiveTo: null },
        take: 1,
        orderBy: { effectiveFrom: "desc" },
        select: { pricePerPlayCoins: true },
      },
    },
  });
  const priceByMachine = new Map<string, number>();
  for (const m of cashMachines) {
    priceByMachine.set(
      m.id,
      m.loadouts[0] ? m.loadouts[0].pricePerPlayCoins * 1000 : CASH_PER_PLAY_CENTS,
    );
  }

  const cc = deriveBranchCrossCheck(
    cf.events.map((e) => ({
      coinMeterBefore: e.coinMeterBefore,
      coinMeterAfter: e.coinMeterAfter,
      cashCountedCents: e.cashCountedCents,
      dollMeterBefore: e.dollMeterBefore ?? 0,
      dollMeterAfter: e.dollMeterAfter ?? 0,
      stockBefore: e.stockBefore ?? 0,
      stockAfter: e.stockAfter ?? 0,
      refillQty: e.refillQty ?? 0,
      cashPerCoinCents: priceByMachine.get(e.machineId) ?? CASH_PER_PLAY_CENTS,
    })),
  );

  const anomalyFlags = cf.isBaseline
    ? cc.flags.filter((f) => !MONEY_VERDICT_FLAGS.has(f))
    : cc.flags;

  return {
    expectedCashCents: cc.expectedCashCents,
    actualCashCents: cc.actualCashCents,
    cashVarianceBps: cc.cashVarianceBps,
    prizeMeterOut: cc.prizeMeterOut,
    prizeCountedOut: cc.prizeCountedOut,
    prizeVariance: cc.prizeVariance,
    totalCashCents: cc.actualCashCents,
    anomalyFlags,
  };
}
