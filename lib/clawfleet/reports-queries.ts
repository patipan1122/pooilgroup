// ClawFleet · Reports (รายงาน) query layer — server-only.
//
// คุณภาพงานพนักงานเก็บเงิน ต่อคน ย้อนหลัง N วัน:
//   rounds   = จำนวน "รอบเก็บ" ที่คนนั้นปิด (distinct session ที่ closedById = user
//              · fallback openedById ถ้ายังไม่มี closedBy) ในช่วง
//   mismatch = จำนวน event ที่คนนั้นเก็บแล้วมี anomalyFlags ไม่ว่าง
//              + รอบ ANOMALY_REVIEW ที่คนนั้นปิด (ยอดไม่ตรง/ตุ๊กตาหาย)
//
// ทุก query scope ด้วย orgId. ผูกกับ session/event ที่ "ปิดรอบแล้ว" เท่านั้น
// (CLOSED/LOCKED/ANOMALY_REVIEW) — รอบที่ยังเปิดอยู่ยังไม่นับเป็นผลงาน.

import { prisma } from "@/lib/prisma";
import { CfSessionStatus } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import { getCfStockOverview } from "./stock-queries";

const CLOSED_STATUSES: CfSessionStatus[] = [
  CfSessionStatus.CLOSED,
  CfSessionStatus.LOCKED,
  CfSessionStatus.ANOMALY_REVIEW,
];

/** ผลงานต่อคน — key = userId */
export type StaffPerf = {
  /** จำนวนรอบเก็บที่คนนี้ปิด */
  rounds: number;
  /** จำนวนครั้งยอดไม่ตรง (event anomaly + รอบ review ที่ปิดเอง) */
  mismatch: number;
};

/**
 * map userId → ผลงาน (rounds / mismatch) ย้อนหลัง N วัน (default 30).
 * นับจากรอบที่ปิดแล้วในช่วง + event anomaly ในรอบเหล่านั้น.
 */
export async function getStaffPerformance(
  opts: { days?: number } = {},
): Promise<Map<string, StaffPerf>> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const days = Math.max(1, Math.min(180, Math.floor(opts.days ?? 30)));
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  // รอบที่ปิดแล้วในช่วง + ใครปิด/เปิด + event (เพื่อหา anomaly + คนเก็บ)
  const sessions = await prisma.cfCollectionSession.findMany({
    where: {
      orgId,
      status: { in: CLOSED_STATUSES },
      closedAt: { gte: since },
    },
    select: {
      status: true,
      openedById: true,
      closedById: true,
      events: {
        where: { eventType: "COLLECTION" },
        select: { collectedById: true, anomalyFlags: true },
      },
    },
  });

  const out = new Map<string, StaffPerf>();
  const ensure = (uid: string): StaffPerf => {
    let p = out.get(uid);
    if (!p) { p = { rounds: 0, mismatch: 0 }; out.set(uid, p); }
    return p;
  };

  for (const s of sessions) {
    // "เจ้าของรอบ" = คนปิด (fallback คนเปิด) → นับเป็น 1 รอบเก็บ
    const owner = s.closedById ?? s.openedById;
    if (owner) ensure(owner).rounds += 1;
    // รอบที่ติดธง ANOMALY_REVIEW → ยอดไม่ตรง 1 ครั้งของเจ้าของรอบ
    if (s.status === CfSessionStatus.ANOMALY_REVIEW && owner) ensure(owner).mismatch += 1;
    // event ที่มี anomalyFlags → ยอดไม่ตรงของคนที่เก็บ event นั้น
    for (const e of s.events) {
      if (e.anomalyFlags.length > 0) ensure(e.collectedById).mismatch += 1;
    }
  }

  return out;
}

// =============================================================
// สินค้าใกล้หมด · รวมทุกสาขาในขอบเขต (reuse getCfStockOverview)
// =============================================================
export type LowStockResult = {
  name: string;
  /** สาขาที่ใกล้หมด */
  branchName: string;
  /** คงคลังในคลังสาขา (ไม่รวมในตู้) */
  qty: number;
  reorderLevel: number;
};

/**
 * สินค้าที่คงคลัง ≤ จุดสั่งเติม รวมจากทุกสาขาในขอบเขตของ user (top N · ต่ำสุดก่อน).
 * scope ด้วย orgId + branch-scope. ใช้ getCfStockOverview เดิม (single source · ไม่ duplicate logic).
 */
export async function getLowStockItems(limit = 6): Promise<LowStockResult[]> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branchIds = await userBranchIds(session);

  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    select: { id: true, name: true },
    orderBy: { code: "asc" },
  });
  if (branches.length === 0) return [];

  const overviews = await Promise.all(
    branches.map((b) =>
      getCfStockOverview(orgId, b.id)
        .then((ov) => ({ name: b.name, low: ov.lowProducts }))
        .catch(() => ({ name: b.name, low: [] })),
    ),
  );

  const items: LowStockResult[] = [];
  for (const ov of overviews) {
    for (const p of ov.low) {
      items.push({ name: p.name, branchName: ov.name, qty: p.warehouse, reorderLevel: p.reorderLevel });
    }
  }
  items.sort((a, b) => a.qty - b.qty);
  return items.slice(0, limit);
}
