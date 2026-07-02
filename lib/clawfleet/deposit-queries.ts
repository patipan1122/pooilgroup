// ClawFleet · ตู้คีบ OS — Wave 4a · queries สำหรับ "ฝากเงินเข้าธนาคาร" (custody→deposit)
// -----------------------------------------------------------------------------
// ปิดจุดบอดเงิน "มือพนักงาน → ธนาคาร": เงินที่แม่บ้าน/พนักงานเก็บได้ (ปิดรอบแล้ว)
// ต้องถูกฝากเข้าธนาคารครบ. รอบที่ depositId = null = เงิน "ค้างมือ" ยังไม่ฝาก.
//
// อ่านอย่างเดียว · org-scoped ทุก query · branch scope ด้วย userBranchIds (ALL = ทุกสาขา).
// ⚠️ ไม่ใช้ userBranchIds()==="ALL" ตัดสินสิทธิ์ "เขียน" — ที่นี่อ่านล้วน viewer ได้ ALL ถูกต้อง.
// Date → ISO string (client แปลงเวลาแสดงเอง). branchName ต่อจาก prisma.branch แบบ manual
// (CfCollectionSession/CfCashDeposit ไม่มี relation ตรงไป Branch ที่ join ชื่อได้สะดวก).
// ทุก query try-catch คืน default กันหน้าแตก.

import { prisma } from "@/lib/prisma";
import {
  requireCfSession,
  userBranchIds,
  cfHasAdminPower,
  isCfBranchManager,
} from "./role-guard";

// รอบที่ต้อง "ฝาก" ได้ = ปิดรอบแล้ว (มีเงินในมือ) แต่ยังไม่ฝาก
const DEPOSITABLE_STATUSES = ["CLOSED", "LOCKED", "ANOMALY_REVIEW"] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OVERDUE_DAYS = 2; // เกิน 2 วันหลังปิดรอบยังไม่ฝาก = เกินกำหนด (RULE constant)

export type PendingDepositRow = {
  sessionId: string;
  sessionCode: string;
  branchId: string;
  branchName: string | null;
  holderName: string; // คนถือเงิน (คนปิดรอบ = closedBy)
  closedAt: string; // ISO
  cashCents: number;
  daysOverdue: number;
  overdue: boolean;
};

export type DepositRow = {
  id: string;
  depositCode: string;
  branchId: string;
  branchName: string | null;
  amountCents: number;
  expectedCents: number;
  varianceCents: number;
  status: string; // OK | SHORT | OVER
  // Wave 4b · maker-checker ใบฝากขาด (SHORT) — NONE/PENDING/APPROVED/REJECTED
  //   SHORT ที่สร้างใหม่ → PENDING (รออนุมัติ "รับทราบเงินขาด") · OK/OVER → NONE (ไม่ต้องอนุมัติ)
  approvalStatus: string;
  reviewedByName: string | null; // ใครอนุมัติ/ตีกลับ (checker)
  depositedById: string; // ผู้บันทึกฝาก (maker) — client ใช้เช็ก maker ≠ checker
  sessionCount: number;
  depositedByName: string;
  depositedAt: string; // ISO
  slipPhotoUrl: string | null;
  note: string | null;
  // per-viewer review context (เหมือนกันทุกแถว · denormalize เพื่อไม่ต้องแก้ page.tsx ให้ส่ง prop เพิ่ม)
  //   canReview = ผู้ใช้นี้เป็น ผจก.สาขา/แอดมิน (mirror auth ใน reviewCashDeposit)
  //   currentUserId = ให้ client เทียบ maker ≠ checker (ห้ามอนุมัติใบที่ตัวเองฝาก) · action บังคับซ้ำอีกชั้น
  canReview: boolean;
  currentUserId: string;
};

export type PendingSummary = {
  count: number;
  totalCents: number;
  overdueCount: number;
  overdueCents: number;
};

/** join ชื่อสาขาแบบ manual (org scope) — คืน Map branchId → name. ชื่อเป็นข้อมูลเสริม ล้มแล้วไม่พังหน้า. */
async function loadBranchNames(orgId: string, branchIds: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(branchIds.filter((b) => b.length > 0)));
  if (uniq.length === 0) return new Map();
  try {
    const rows = await prisma.branch.findMany({
      where: { id: { in: uniq }, orgId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch {
    return new Map();
  }
}

/**
 * รายการรอบที่ "เก็บเงินแล้วยังไม่ฝาก" (เงินค้างมือ) · org + branch scope · เรียงเก่าสุดก่อน
 * (รอบที่ค้างนานสุดขึ้นก่อน = ต้องตามฝากก่อน).
 * เงื่อนไข: status ∈ [CLOSED,LOCKED,ANOMALY_REVIEW] & depositId = null & totalCashCents > 0.
 * branchId ของรอบ resolve จาก branchId ตรง ๆ ก่อน (staff-app flow) ไม่งั้น group.branchId (legacy group).
 * รอบที่ resolve สาขาไม่ได้เลย (ทั้งสองเป็น null) → ข้าม (ฝากไม่ได้อยู่แล้ว · ไม่มีสาขาให้ผูก).
 */
export async function getPendingDeposits(opts?: { branchId?: string }): Promise<PendingDepositRow[]> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    const rows = await prisma.cfCollectionSession.findMany({
      where: {
        orgId,
        status: { in: [...DEPOSITABLE_STATUSES] },
        depositId: null,
        totalCashCents: { gt: 0 },
      },
      orderBy: { closedAt: "asc" }, // เก่าสุด (ค้างนานสุด) ก่อน
      take: 1000,
      select: {
        id: true,
        sessionCode: true,
        branchId: true,
        totalCashCents: true,
        closedAt: true,
        closedBy: { select: { name: true } },
        group: { select: { branchId: true } },
      },
    });

    const now = Date.now();
    const allowScope = (b: string): boolean =>
      branchIds === "ALL" ? true : branchIds.includes(b);
    const onlyBranch = opts?.branchId;

    const resolved = rows
      .map((r) => {
        const branchId = r.branchId ?? r.group?.branchId ?? null;
        return branchId ? { row: r, branchId } : null;
      })
      .filter((x): x is { row: (typeof rows)[number]; branchId: string } => x !== null)
      .filter((x) => allowScope(x.branchId))
      .filter((x) => (onlyBranch ? x.branchId === onlyBranch : true));

    const names = await loadBranchNames(
      orgId,
      resolved.map((x) => x.branchId),
    );

    return resolved.map(({ row, branchId }) => {
      // closedAt อาจเป็น null ถ้าสถานะแปลก ๆ — ใช้ createdAt ไม่ได้ (ไม่ได้ select) → fallback now (0 วัน)
      const closedAtDate = row.closedAt ?? null;
      const daysOverdue = closedAtDate
        ? Math.floor((now - closedAtDate.getTime()) / MS_PER_DAY)
        : 0;
      return {
        sessionId: row.id,
        sessionCode: row.sessionCode,
        branchId,
        branchName: names.get(branchId) ?? null,
        holderName: row.closedBy?.name ?? "ไม่ทราบชื่อ",
        closedAt: closedAtDate ? closedAtDate.toISOString() : "",
        cashCents: row.totalCashCents,
        daysOverdue,
        overdue: daysOverdue > OVERDUE_DAYS,
      };
    });
  } catch {
    return [];
  }
}

/**
 * ประวัติใบฝากเงิน (ใหม่สุดก่อน) · org + branch scope · limit default 50.
 * branch scope: ALL = ทุกสาขา · ไม่งั้น branchId ∈ สาขาที่ผู้ใช้เข้าถึง (list ว่าง = ไม่เห็นอะไร).
 */
export async function getDepositHistory(opts?: {
  branchId?: string;
  limit?: number;
}): Promise<DepositRow[]> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    // สร้าง where สำหรับ branchId ตาม scope + filter สาขาเดียว (ถ้าระบุ)
    let branchWhere: { in: string[] } | undefined;
    if (branchIds === "ALL") {
      branchWhere = opts?.branchId ? { in: [opts.branchId] } : undefined;
    } else if (opts?.branchId) {
      branchWhere = branchIds.includes(opts.branchId) ? { in: [opts.branchId] } : { in: [] };
    } else {
      branchWhere = { in: branchIds };
    }

    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 500);
    const rows = await prisma.cfCashDeposit.findMany({
      where: {
        orgId,
        ...(branchWhere ? { branchId: branchWhere } : {}),
      },
      orderBy: { depositedAt: "desc" },
      take: limit,
    });

    const names = await loadBranchNames(
      orgId,
      rows.map((r) => r.branchId),
    );

    // per-viewer review context (denormalize ลงทุกแถว — page.tsx ไม่ต้องส่ง prop เพิ่ม)
    const canReview = (await cfHasAdminPower(session)) || isCfBranchManager(session.user.role);
    const currentUserId = session.user.id;

    return rows.map((r) => ({
      id: r.id,
      depositCode: r.depositCode,
      branchId: r.branchId,
      branchName: names.get(r.branchId) ?? null,
      amountCents: r.amountCents,
      expectedCents: r.expectedCents,
      varianceCents: r.varianceCents,
      status: r.status,
      approvalStatus: r.approvalStatus,
      reviewedByName: r.reviewedByName ?? null,
      depositedById: r.depositedById ?? "", // nullable ใน schema → "" = ไม่ทราบ maker (client ถือว่าไม่ใช่ตัวเอง)
      sessionCount: r.sessionCount,
      depositedByName: r.depositedByName,
      depositedAt: r.depositedAt.toISOString(),
      slipPhotoUrl: r.slipPhotoUrl ?? null,
      note: r.note ?? null,
      canReview,
      currentUserId,
    }));
  } catch {
    return [];
  }
}

/**
 * สรุปเงินค้างมือทั้งหมด (ในสิทธิ์ที่เห็น) — จำนวนรอบ · ยอดรวม · จำนวน+ยอดที่เกินกำหนด.
 * ใช้โชว์การ์ดสรุปหัวหน้า deposits + badge เตือน "เงินค้างมือเกินกำหนด".
 *
 * ⚠️ นับตรงจาก DB ด้วย count/_sum(totalCashCents) — ไม่ derive จาก getPendingDeposits ที่ถูก cap take:1000
 * (ถ้าเงินค้าง >1000 รอบ list จะถูกตัด → ยอดรวม/overdue นับไม่ครบ = ตัวเลขกันโกงหลุด silent).
 * where เดียวกับ getPendingDeposits เป๊ะ: status ∈ depositable · depositId=null · totalCashCents>0 · org+branch scope.
 * overdue = closedAt <= (now - (OVERDUE_DAYS+1) วัน) (ตรงกับ daysOverdue > OVERDUE_DAYS ใน list).
 *
 * ข้อจำกัด: branch scope ที่นี่กรองด้วย branchId ตรง ๆ (field cfCollectionSession.branchId) เท่านั้น —
 * รอบ legacy ที่ผูกสาขาผ่าน group.branchId (branchId=null) จะไม่ถูกนับใน scope non-ALL (aggregate ที่ DB
 * join ผ่าน group ไม่ได้สะดวก). viewer ที่เห็น ALL นับครบทุกรอบ. คืน 0 เมื่อ error.
 */
export async function getPendingDepositSummary(): Promise<PendingSummary> {
  const empty: PendingSummary = { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0 };
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    // where ฐาน = เงื่อนไข depositable เดียวกับ getPendingDeposits + branch scope (ตรงจาก field branchId)
    const baseWhere = {
      orgId,
      status: { in: [...DEPOSITABLE_STATUSES] },
      depositId: null,
      totalCashCents: { gt: 0 },
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    };

    // ยอดรวม/จำนวนทั้งหมด (ไม่ cap) จาก aggregate
    const total = await prisma.cfCollectionSession.aggregate({
      where: baseWhere,
      _count: { _all: true },
      _sum: { totalCashCents: true },
    });

    // overdue = ปิดรอบเกินกำหนดยังไม่ฝาก. ให้ตรงกับ list เป๊ะ: list ใช้ daysOverdue > OVERDUE_DAYS
    // โดย daysOverdue = floor((now - closedAt)/DAY). daysOverdue > 2 ⟺ >= 3 ⟺ closedAt <= now - 3*DAY.
    const overdueCutoff = new Date(Date.now() - (OVERDUE_DAYS + 1) * MS_PER_DAY);
    const overdue = await prisma.cfCollectionSession.aggregate({
      where: { ...baseWhere, closedAt: { lte: overdueCutoff } },
      _count: { _all: true },
      _sum: { totalCashCents: true },
    });

    return {
      count: total._count._all,
      totalCents: total._sum.totalCashCents ?? 0,
      overdueCount: overdue._count._all,
      overdueCents: overdue._sum.totalCashCents ?? 0,
    };
  } catch {
    return empty;
  }
}
