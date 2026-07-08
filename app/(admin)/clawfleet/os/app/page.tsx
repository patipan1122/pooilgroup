/**
 * ตู้คีบ OS — แอปพนักงาน (หน้าบ้าน · mobile employee app)
 * Server: ลองโหลดสาขา/กลุ่ม/ตู้/SKU จริงด้วย getGroupCollectData() ใน try/catch.
 * ถ้าว่าง (DB ยังไม่ seed / ยังไม่ migrate) → client ใช้ demo fallback (id ขึ้นต้น "demo-").
 * หน้านี้แสดงทั้งใน back-office (กรอบมือถือ) และใช้เต็มจอบนมือถือจริง (component เดียว render สองที่).
 */
import { getGroupCollectData } from "@/lib/clawfleet/group-data";
import { getClawfleetPolicy } from "@/lib/clawfleet/policy";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listMyRecentRepairTickets, type RepairTicketRow } from "@/lib/clawfleet/repair-queries";
import { getAwaitingSetupMachines } from "@/lib/clawfleet/baseline-queries";
import { getCfBranchStockProducts, getInboundDeliveries } from "@/lib/clawfleet/stock-queries";
import { StaffAppClient, type StaffHistoryRow, type BranchStockProduct, type InboundDelivery } from "./staff-app-client";
import type { GroupCollectBranch, CollectSku } from "@/lib/clawfleet/group-data";

export const dynamic = "force-dynamic";

/**
 * กรอง route เหลือ "ตู้ของฉัน" เมื่อผู้เก็บคนนี้มีการมอบหมายตู้ (cf_machines.assigned_staff_id).
 * - ถ้ามีตู้ที่ assign ให้เขาอย่างน้อย 1 ตู้ → คืน branches ที่ตัดเหลือเฉพาะตู้ (claws) ที่เป็นของเขา
 *   + ตัดกลุ่ม/สาขาที่ว่างทิ้ง (ไม่ให้หัวข้อสาขาลอยไม่มีตู้) · hasAssignment = true.
 * - ถ้าไม่มีตู้ assign เลย → คืน branches เดิมทั้งหมด (fallback เห็นทุกตู้ในสาขา) · hasAssignment = false.
 * graceful: อ่าน assignment ไม่ได้ (ยังไม่ migrate / query ล้ม) → fallback แสดงทุกตู้ (ไม่บล็อกการเก็บ).
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
    // ตัดต้นไม้ branch>group>claw เหลือเฉพาะตู้ของฉัน · ทิ้งกลุ่ม/สาขาที่ว่าง
    const filtered = branches
      .map((b) => ({
        ...b,
        groups: b.groups
          .map((g) => ({ ...g, claws: g.claws.filter((c) => mineIds.has(c.id)) }))
          .filter((g) => g.claws.length > 0),
      }))
      .filter((b) => b.groups.length > 0);
    // ถ้ากรองแล้วไม่เหลือตู้ในสโคปที่โหลดมา (เช่น ตู้ที่ assign อยู่คนละสาขาที่ไม่ได้โหลด)
    // → fallback แสดงทุกตู้เดิม ดีกว่าโชว์หน้าว่าง
    if (filtered.length === 0) return { branches, hasAssignment: false };
    return { branches: filtered, hasAssignment: true };
  } catch {
    // graceful: ยังไม่ migrate / query ล้ม → แสดงทุกตู้เหมือนเดิม
    return { branches, hasAssignment: false };
  }
}

// ต้นวันนี้ตามเวลาไทย (Asia/Bangkok = UTC+7) — ใช้กรองรอบที่ปิด "วันนี้"
function startOfTodayBangkok(): Date {
  const now = new Date();
  // เลื่อนเป็นเวลาไทยแล้วตัดเวลาให้เหลือ 00:00 ของวันไทย จากนั้นแปลงกลับ UTC
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = bkk.getUTCFullYear();
  const m = bkk.getUTCMonth();
  const d = bkk.getUTCDate();
  // 00:00 ไทย = 17:00 UTC ของวันก่อนหน้า → ลบ 7 ชม.
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - 7 * 60 * 60 * 1000);
}

export default async function StaffAppPage() {
  let orgId = "";
  let branches: GroupCollectBranch[] = [];
  let skus: CollectSku[] = [];
  try {
    const data = await getGroupCollectData();
    orgId = data.orgId;
    branches = data.branches;
    skus = data.skus;
  } catch {
    // graceful: ยังไม่ migrate / DB ว่าง → client จะ demo fallback เอง
  }

  // ชื่อพนักงานที่ล็อกอิน (โชว์ทักทาย) — graceful: ถ้าไม่ login → ปล่อยว่าง (client ใช้ default)
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

  // 📊 ความคืบหน้าวันนี้ (ของจริง) + ประวัติการเก็บของฉันวันนี้ —
  // นับ/ดึงจาก cf_collection_events ที่ "ฉัน" (userId) เก็บ ตั้งแต่ต้นวันไทย.
  // ใช้ COLLECTION event เป็นตัวแทน "รอบที่เก็บเสร็จจริง" (draft ที่ยังไม่ปิด ไม่ถูกนับ).
  // graceful: อ่านไม่ได้ / ยังไม่ migrate → closedTodayCount=0, history=[] (แอปโชว์ empty state).
  let closedTodayCount = 0;
  let history: StaffHistoryRow[] = [];
  if (orgId && userId) {
    try {
      const since = startOfTodayBangkok();
      const events = await prisma.cfCollectionEvent.findMany({
        where: {
          orgId,
          collectedById: userId,
          eventType: "COLLECTION",
          collectedAt: { gte: since },
        },
        orderBy: { collectedAt: "desc" },
        select: {
          collectedAt: true,
          cashCountedCents: true,
          anomalyFlags: true,
          machine: { select: { code: true } },
        },
        take: 50,
      });
      closedTodayCount = events.length;
      history = events.map((e) => ({
        code: e.machine.code,
        time: e.collectedAt.toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Bangkok",
        }),
        cashBaht: Math.round(e.cashCountedCents / 100),
        ok: e.anomalyFlags.length === 0,
      }));
    } catch {
      // graceful: ยังไม่ migrate / query ล้ม → คงค่า default (0 / [])
    }
  }

  // นโยบายถ่ายรูป (photoRequired) — อ่าน server-side ส่งให้แอปพนักงานบังคับถ่ายรูป.
  // graceful: ถ้าอ่านไม่ได้ (ยังไม่ login / DB ว่าง) → ใช้ default false (ถ่ายได้-ข้ามได้).
  let photoRequired = false;
  try {
    const policy = await getClawfleetPolicy();
    photoRequired = policy.photoRequired;
  } catch {
    // graceful: ใช้ default (ไม่บังคับ) เมื่ออ่าน policy ไม่ได้
  }

  // 🛠️ ตั๋วแจ้งซ่อมล่าสุดของฉัน → RepairPanel (ตั๋วซ่อมของฉันล่าสุด).
  // graceful: ยังไม่ migrate / query ล้ม → [] (RepairPanel โชว์ "ยังไม่มีตั๋วซ่อม").
  let myRecentTickets: RepairTicketRow[] = [];
  try {
    myRecentTickets = await listMyRecentRepairTickets();
  } catch {
    // graceful: อ่านไม่ได้ → คงค่า default ([])
  }

  // กรอง route เหลือ "ตู้ของฉัน" ถ้ามีการมอบหมาย (ไม่งั้นแสดงทุกตู้ในสาขาเหมือนเดิม)
  const { branches: routeBranches, hasAssignment } = await filterRouteToMine(orgId, userId, branches);

  // 🆕 bigfeature data (N1 baseline · N3 stock-count · N6 goods-receipt · R4 refill picker)
  const { awaitingSetupIds, branchProducts, inboundByBranch } = await loadBigfeatureData(orgId, routeBranches);

  return (
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
  );
}

/**
 * โหลดข้อมูล bigfeature (server-side · ทุกอย่าง org/สาขา-scoped ผ่าน query guard):
 *  - awaitingSetupIds: ตู้ที่ยังไม่ตั้ง baseline (N1) → HOME route ไปฟอร์มตั้งค่าครั้งแรก
 *  - branchProducts: สินค้าคลังต่อสาขา (N3 นับสต๊อก · R4 picker เติม)
 *  - inboundByBranch: ใบกระจายขาเข้าที่ยังไม่รับ ต่อสาขา (N6 รับสินค้า)
 * graceful: query ล้ม/ยังไม่ migrate → คืนค่าว่าง (แอปยังเดินได้ · demo/empty state).
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
    // graceful: ยังไม่ migrate → ไม่มีตู้ awaiting (ทุกตู้เข้า wizard ปกติ)
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
        // getInboundDeliveries คืน line โดยไม่มี lineId แต่ confirmShipmentReceived ต้องใช้ lineId
        // → ดึง lineId ต่อ (delivery,product) เพิ่มใน 1 query (page loader ทำได้ · ไม่แตะ lib/*)
        const deliveryIds = inbound.map((d) => d.id);
        const lineRows = deliveryIds.length
          ? await prisma.cfDeliveryLine.findMany({
              where: { deliveryId: { in: deliveryIds } },
              select: { id: true, deliveryId: true, productId: true },
            })
          : [];
        const lineIdMap = new Map<string, string>(); // `${deliveryId}:${productId}` → lineId
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
