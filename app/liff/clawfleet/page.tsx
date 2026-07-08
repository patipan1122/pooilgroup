// ตู้คีบ OS — LINE Mini App (LIFF) staff entry · /liff/clawfleet
//
// เปิดในแอป LINE: LiffBootstrap (app/liff/layout) จัดการ LINE auth → session แล้วเรนเดอร์
// แอปพนักงานหน้าบ้าน "ตู้คีบ OS" ตัวเดียวกับ /clawfleet/os/app (StaffAppClient) — flow เก็บเงิน
// 6 สเต็ป กระทบยอด 3 ทางกันโกง. ใช้ UI ใหม่ (เลิกพึ่ง v2/collect ที่ลบทิ้งแล้ว).
import { getGroupCollectData } from "@/lib/clawfleet/group-data";
import { getClawfleetPolicy } from "@/lib/clawfleet/policy";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listMyRecentRepairTickets, type RepairTicketRow } from "@/lib/clawfleet/repair-queries";
import { getAwaitingSetupMachines } from "@/lib/clawfleet/baseline-queries";
import { getCfBranchStockProducts, getInboundDeliveries } from "@/lib/clawfleet/stock-queries";
import type { GroupCollectBranch, CollectSku } from "@/lib/clawfleet/group-data";
import { StaffAppClient, type StaffHistoryRow, type BranchStockProduct, type InboundDelivery } from "@/app/(admin)/clawfleet/os/app/staff-app-client";
import "@/app/(admin)/clawfleet/os/clawos.css";

export const dynamic = "force-dynamic";

// ต้นวันนี้ตามเวลาไทย (Asia/Bangkok = UTC+7) — กรองรอบที่ปิด "วันนี้"
function startOfTodayBangkok(): Date {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), 0, 0, 0) - 7 * 60 * 60 * 1000);
}

/**
 * กรอง route เหลือ "ตู้ของฉัน" เมื่อผู้เก็บคนนี้มีการมอบหมายตู้ (cf_machines.assigned_staff_id).
 * มีตู้ assign ≥1 → คืน branches ที่ตัดเหลือเฉพาะตู้ของเขา (ทิ้งกลุ่ม/สาขาว่าง) · hasAssignment=true.
 * ไม่มี assign → คืน branches เดิม (เห็นทุกตู้) · hasAssignment=false.
 * graceful: อ่านไม่ได้ / ยังไม่ migrate → แสดงทุกตู้ (ไม่บล็อกการเก็บ).
 */
async function filterRouteToMine(
  orgId: string,
  userId: string,
  branches: GroupCollectBranch[],
): Promise<{ branches: GroupCollectBranch[]; hasAssignment: boolean }> {
  if (!orgId || !userId) return { branches, hasAssignment: false };
  try {
    const mine = await prisma.cfMachine.findMany({
      where: { orgId, assignedStaffId: userId, isActive: true },
      select: { id: true },
    });
    if (mine.length === 0) return { branches, hasAssignment: false };
    const mineIds = new Set(mine.map((m) => m.id));
    const filtered = branches
      .map((b) => ({
        ...b,
        groups: b.groups
          .map((g) => ({ ...g, claws: g.claws.filter((c) => mineIds.has(c.id)) }))
          .filter((g) => g.claws.length > 0),
      }))
      .filter((b) => b.groups.length > 0);
    if (filtered.length === 0) return { branches, hasAssignment: false };
    return { branches: filtered, hasAssignment: true };
  } catch {
    return { branches, hasAssignment: false };
  }
}

export default async function ClawfleetLiffPage() {
  let orgId = "";
  let branches: GroupCollectBranch[] = [];
  let skus: CollectSku[] = [];
  try {
    const data = await getGroupCollectData();
    orgId = data.orgId;
    branches = data.branches;
    skus = data.skus;
  } catch {
    // graceful: ยังไม่ migrate / DB ว่าง → StaffAppClient ใช้ demo fallback เอง
  }

  // นโยบายถ่ายรูป (photoRequired) — บังคับถ่ายก่อนไปต่อใน flow เก็บเงิน
  let photoRequired = false;
  try {
    const policy = await getClawfleetPolicy();
    photoRequired = policy.photoRequired;
  } catch {
    // graceful: ใช้ default (ไม่บังคับ) เมื่ออ่าน policy ไม่ได้
  }

  // ชื่อพนักงานที่ล็อกอิน (โชว์ทักทาย) — graceful: ถ้าอ่านไม่ได้ → ปล่อยว่าง
  let userName = "";
  let userId = "";
  try {
    const session = await getSession();
    userName = session?.user.name ?? "";
    userId = session?.user.id ?? "";
    orgId = orgId || (session?.user.org_id ?? "");
  } catch {
    // graceful: อ่าน session ไม่ได้ → ไม่โชว์ชื่อจริง
  }

  // 📊 ความคืบหน้าวันนี้ + ประวัติการเก็บของฉันวันนี้ (ของจริง จาก cf_collection_events ที่ "ฉัน" เก็บ)
  // graceful: อ่านไม่ได้ / ยังไม่ migrate → closedTodayCount=0, history=[] (แอปโชว์ empty state)
  let closedTodayCount = 0;
  let history: StaffHistoryRow[] = [];
  if (orgId && userId) {
    try {
      const events = await prisma.cfCollectionEvent.findMany({
        where: { orgId, collectedById: userId, eventType: "COLLECTION", collectedAt: { gte: startOfTodayBangkok() } },
        orderBy: { collectedAt: "desc" },
        select: { collectedAt: true, cashCountedCents: true, anomalyFlags: true, machine: { select: { code: true } } },
        take: 50,
      });
      closedTodayCount = events.length;
      history = events.map((e) => ({
        code: e.machine.code,
        time: e.collectedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }),
        cashBaht: Math.round(e.cashCountedCents / 100),
        ok: e.anomalyFlags.length === 0,
      }));
    } catch {
      // graceful: ยังไม่ migrate / query ล้ม → คงค่า default (0 / [])
    }
  }

  // 🛠️ ตั๋วแจ้งซ่อมล่าสุดของฉัน → RepairPanel. graceful: อ่านไม่ได้ → [] (โชว์ "ยังไม่มีตั๋วซ่อม")
  let myRecentTickets: RepairTicketRow[] = [];
  try {
    myRecentTickets = await listMyRecentRepairTickets();
  } catch {
    // graceful: คงค่า default ([])
  }

  // กรอง route เหลือ "ตู้ของฉัน" ถ้ามีการมอบหมาย (ไม่งั้นแสดงทุกตู้ในสาขาเหมือนเดิม)
  const { branches: routeBranches, hasAssignment } = await filterRouteToMine(orgId, userId, branches);

  // 🆕 bigfeature data (N1 baseline · N3 stock-count · N6 goods-receipt · R4 refill picker)
  const { awaitingSetupIds, branchProducts, inboundByBranch } = await loadBigfeatureData(orgId, routeBranches);

  return (
    <div className="clawos">
      <StaffAppClient
        orgId={orgId}
        branches={routeBranches}
        skus={skus}
        photoRequired={photoRequired}
        userName={userName}
        closedTodayCount={closedTodayCount}
        history={history}
        myRecentTickets={myRecentTickets}
        assignedOnly={hasAssignment}
        awaitingSetupIds={awaitingSetupIds}
        branchProducts={branchProducts}
        inboundByBranch={inboundByBranch}
      />
    </div>
  );
}

/**
 * โหลดข้อมูล bigfeature (server-side · org/สาขา-scoped ผ่าน query guard) — เหมือน /clawfleet/os/app.
 *  awaitingSetupIds (N1) · branchProducts (N3/R4) · inboundByBranch (N6).
 * graceful: query ล้ม/ยังไม่ migrate → คืนค่าว่าง.
 */
async function loadBigfeatureData(
  orgId: string,
  branches: GroupCollectBranch[],
): Promise<{
  awaitingSetupIds: string[];
  branchProducts: Record<string, BranchStockProduct[]>;
  inboundByBranch: Record<string, InboundDelivery[]>;
}> {
  const branchIds = branches.map((b) => b.id);
  let awaitingSetupIds: string[] = [];
  const branchProducts: Record<string, BranchStockProduct[]> = {};
  const inboundByBranch: Record<string, InboundDelivery[]> = {};

  if (!orgId || branchIds.length === 0) return { awaitingSetupIds, branchProducts, inboundByBranch };

  try {
    const awaiting = await getAwaitingSetupMachines();
    awaitingSetupIds = awaiting.map((m) => m.id);
  } catch {
    // graceful: ยังไม่ migrate → ไม่มีตู้ awaiting
  }

  await Promise.all(
    branchIds.map(async (bid) => {
      try {
        const products = await getCfBranchStockProducts(orgId, bid);
        branchProducts[bid] = products.map((p) => ({
          id: p.id,
          name: p.name,
          imageUrl: p.imageUrl,
          warehouse: p.warehouse,
        }));
      } catch {
        branchProducts[bid] = [];
      }
      try {
        const inbound = await getInboundDeliveries(bid);
        const deliveryIds = inbound.map((d) => d.id);
        const lineRows = deliveryIds.length
          ? await prisma.cfDeliveryLine.findMany({
              where: { deliveryId: { in: deliveryIds } },
              select: { id: true, deliveryId: true, productId: true },
            })
          : [];
        const lineIdMap = new Map<string, string>();
        for (const lr of lineRows) lineIdMap.set(`${lr.deliveryId}:${lr.productId}`, lr.id);
        inboundByBranch[bid] = inbound.map((d) => ({
          id: d.id,
          status: d.status,
          itemsCount: d.itemsCount,
          unitsCount: d.unitsCount,
          lines: d.lines.map((l) => ({
            lineId: lineIdMap.get(`${d.id}:${l.productId}`) ?? "",
            productId: l.productId,
            productName: l.productName,
            qty: l.qty,
            receivedQty: l.receivedQty,
          })),
        }));
      } catch {
        inboundByBranch[bid] = [];
      }
    }),
  );

  return { awaitingSetupIds, branchProducts, inboundByBranch };
}
