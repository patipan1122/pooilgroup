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
import { getCfBranchStockProducts, getInboundDeliveries, getInboundDcTransfers, getCfWarehousesForBranch, getReceivedHistory, type CfReceivedDoc } from "@/lib/clawfleet/stock-queries";
import { StaffAppClient, type StaffHistoryRow, type BranchStockProduct, type InboundDelivery, type InMachineDoll } from "./staff-app-client";
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

// B3 · วันที่ไทยของ "วันนี้" ในรูป YYYY-MM-DD (ใช้เป็น default ของ date picker ประวัติ)
function todayBangkokYmd(): string {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bkk.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// B3 · ขอบเขตของ "วัน" ตามเวลาไทย จาก YYYY-MM-DD → [gte, lt] ในรูป UTC.
// ymd ไม่ valid (ไม่ตรง pattern) → fallback เป็นวันนี้. ใช้กรองประวัติของวันที่เลือก (look-back).
function bangkokDayRange(ymd: string): { gte: Date; lt: Date; ymd: string } {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : todayBangkokYmd();
  const [y, m, d] = safe.split("-").map(Number);
  // 00:00 ไทยของวันนั้น = ลบ 7 ชม. จาก UTC midnight · lt = +1 วัน (ต้นวันถัดไป)
  const gte = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt, ymd: safe };
}

export default async function StaffAppPage({
  searchParams,
}: {
  // B3 · Next 15 ส่ง searchParams เป็น Promise — อ่าน ?date=YYYY-MM-DD เพื่อดูประวัติย้อนหลัง
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // B3 · วันที่ที่เลือกดูประวัติ (default = วันนี้ตามเวลาไทย)
  const sp = await searchParams;
  const rawDate = typeof sp.date === "string" ? sp.date : "";
  const dayRange = bangkokDayRange(rawDate || todayBangkokYmd());
  const selectedDate = dayRange.ymd;

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

  // 📊 ความคืบหน้าวันนี้ (progress bar · ยึด "วันนี้" เสมอ) + ประวัติการเก็บของ "วันที่เลือก" —
  // นับ/ดึงจาก cf_collection_events ที่ "ฉัน" (userId) เก็บ.
  //  - closedTodayCount = รอบที่ปิดจริง "วันนี้" (progress bar หน้าหลัก ไม่ผูกกับ date picker)
  //  - history = รอบของ "วันที่เลือก" (B3 · date picker ดูย้อนหลังได้ · READ-ONLY ไม่แตะเงิน)
  // ใช้ COLLECTION event เป็นตัวแทน "รอบที่เก็บเสร็จจริง" (draft ที่ยังไม่ปิด ไม่ถูกนับ).
  // graceful: อ่านไม่ได้ / ยังไม่ migrate → closedTodayCount=0, history=[] (แอปโชว์ empty state).
  let closedTodayCount = 0;
  let history: StaffHistoryRow[] = [];
  if (orgId && userId) {
    // progress bar "วันนี้" — นับแยกจากประวัติที่เลือก (กันเลือกวันอื่นแล้ว progress เพี้ยน)
    try {
      closedTodayCount = await prisma.cfCollectionEvent.count({
        where: {
          orgId,
          collectedById: userId,
          eventType: "COLLECTION",
          collectedAt: { gte: startOfTodayBangkok() },
        },
      });
    } catch {
      // graceful: คงค่า default (0)
    }
    // ประวัติของ "วันที่เลือก" (ในช่วงเวลาไทยของวันนั้น · gte..lt)
    try {
      const events = await prisma.cfCollectionEvent.findMany({
        where: {
          orgId,
          collectedById: userId,
          eventType: "COLLECTION",
          collectedAt: { gte: dayRange.gte, lt: dayRange.lt },
        },
        orderBy: { collectedAt: "desc" },
        select: {
          collectedAt: true,
          cashCountedCents: true,
          anomalyFlags: true,
          coinMeterAfter: true,
          machine: { select: { code: true, branch: { select: { name: true } } } },
        },
        take: 50,
      });
      history = events.map((e) => ({
        code: e.machine.code,
        // B3 · สาขาของตู้ (โชว์ในประวัติ · ช่วยจำว่าเก็บที่ไหน)
        branch: e.machine.branch.name,
        // B3 · วันที่ไทยของรอบ (YYYY-MM-DD) · ใช้ label เมื่อดูย้อนหลัง
        date: selectedDate,
        time: e.collectedAt.toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Bangkok",
        }),
        cashBaht: Math.round(e.cashCountedCents / 100),
        // B3 · เลขมิเตอร์เหรียญที่บันทึกไว้ (look-back หลักฐานตัวเลขที่กรอก)
        coinMeter: e.coinMeterAfter,
        ok: e.anomalyFlags.length === 0,
      }));
    } catch {
      // graceful: ยังไม่ migrate / query ล้ม → คงค่า default ([])
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

  // 🆕 bigfeature data (N1 baseline · N3 stock-count · N6 goods-receipt · R4 refill picker · WAVE-3b คลัง)
  //   + F1 onHandByBranch (คลังตอนนี้ต่อสินค้า) + F2 receivedByBranch (ประวัติรับแล้ว)
  const { awaitingSetupIds, branchProducts, inboundByBranch, warehousesByBranch, onHandByBranch, receivedByBranch } = await loadBigfeatureData(orgId, routeBranches);

  // 🆕 คืนตุ๊กตาเข้าคลัง (return-dolls) — ต่อตู้: ตุ๊กตาที่ "อยู่ในตู้ตอนนี้" (ราย SKU + รูป + จำนวน)
  //   + ต่อสาขา: "ของว่างในคลัง" ต่อสินค้า (คลัง − ในตู้) เพื่อโชว์ยอดคลังเพิ่มขึ้นหลังคืน.
  //   คิดจาก ledger จริง (source of truth) — เลขที่โชว์ = เลขที่ server จะ enforce.
  const { inMachineByMachine, netAvailableByBranch } = await loadReturnDollsData(orgId, routeBranches);

  return (
    <StaffAppClient
      orgId={orgId}
      branches={routeBranches}
      skus={skus}
      photoRequired={photoRequired}
      userName={userName}
      closedTodayCount={closedTodayCount}
      history={history}
      selectedDate={selectedDate}
      myRecentTickets={myRecentTickets}
      assignedOnly={hasAssignment}
      awaitingSetupIds={awaitingSetupIds}
      branchProducts={branchProducts}
      inboundByBranch={inboundByBranch}
      warehousesByBranch={warehousesByBranch}
      onHandByBranch={onHandByBranch}
      receivedByBranch={receivedByBranch}
      inMachineByMachine={inMachineByMachine}
      netAvailableByBranch={netAvailableByBranch}
    />
  );
}

/**
 * โหลดข้อมูลสำหรับ "คืนตุ๊กตาจากตู้เข้าคลัง" (return-dolls · ราย SKU · READ-ONLY display):
 *  - inMachineByMachine: map machineId → รายการตุ๊กตาที่ "อยู่ในตู้ตอนนี้" (name/sku/imageUrl/qty)
 *      qty ในตู้ = |Σ qty ของ movement ที่ machineId = ตู้นี้| (ledger = source of truth) · เก็บเฉพาะ qty > 0.
 *      คำนวณ 1 grouped query ต่อสาขา (by machineId+productId · where machineId in [...]) แล้ว map ตามตู้.
 *  - netAvailableByBranch: map branchId → { productId → "ของว่างในคลัง" } = คลัง(warehouse) − ในตู้(inMachines)
 *      mirror getCfBranchStockProducts (warehouse=machineId null · inMachines=|Σ machineId not null|).
 *      ใช้โชว์ context "ของว่างในคลัง A → A+N" หลังคืน (เลขจาก server · ไม่ใช่ client เดา).
 * graceful: query ล้ม/ยังไม่ migrate → คืนค่าว่าง (แอปเดินได้ · sheet โชว์ empty).
 */
async function loadReturnDollsData(
  orgId: string,
  branches: GroupCollectBranch[],
): Promise<{
  inMachineByMachine: Record<string, InMachineDoll[]>;
  netAvailableByBranch: Record<string, Record<string, number>>;
}> {
  const inMachineByMachine: Record<string, InMachineDoll[]> = {};
  const netAvailableByBranch: Record<string, Record<string, number>> = {};
  if (!orgId || branches.length === 0) return { inMachineByMachine, netAvailableByBranch };

  await Promise.all(
    branches.map(async (b) => {
      try {
        // id ตู้ทั้งหมดของสาขา (จาก tree ที่ผู้ใช้เห็น · CLAW ทุกกลุ่ม)
        const machineIds = b.groups.flatMap((g) => g.claws.map((c) => c.id));
        if (machineIds.length === 0) {
          netAvailableByBranch[b.id] = {};
          return;
        }

        // 1) ในตู้ต่อ (ตู้, สินค้า) — 1 grouped query ต่อสาขา (efficient · machineId in [...])
        const inMachineMoves = await prisma.cfStockMovement.groupBy({
          by: ["machineId", "productId"],
          where: { orgId, branchId: b.id, machineId: { in: machineIds } },
          _sum: { qty: true },
        });

        // 2) ยอดคลังสาขา (warehouse = machineId null) ต่อสินค้า — สำหรับ net-available
        const warehouseMoves = await prisma.cfStockMovement.groupBy({
          by: ["productId"],
          where: { orgId, branchId: b.id, machineId: null },
          _sum: { qty: true },
        });

        // สินค้าทั้งหมดที่โผล่ (ในตู้ + คลัง) → join ชื่อ/รูป/sku ครั้งเดียว
        const productIds = Array.from(
          new Set([
            ...inMachineMoves.map((m) => m.productId),
            ...warehouseMoves.map((m) => m.productId),
          ]),
        );
        const products = productIds.length
          ? await prisma.cfProduct.findMany({
              where: { id: { in: productIds }, orgId },
              select: { id: true, name: true, sku: true, imageUrl: true },
            })
          : [];
        const pmap = new Map(products.map((p) => [p.id, p]));

        // ในตู้ต่อสินค้ารวมทั้งสาขา (สำหรับ net-available) + ต่อตู้ (สำหรับ sheet)
        const inMachineByProduct = new Map<string, number>();
        for (const m of inMachineMoves) {
          const mid = m.machineId;
          if (!mid) continue;
          const qty = Math.abs(m._sum.qty ?? 0);
          const p = pmap.get(m.productId);
          if (!p) continue;
          // ต่อสินค้า (รวมทุกตู้ในสาขา) — ใช้คิด net-available
          inMachineByProduct.set(m.productId, (inMachineByProduct.get(m.productId) ?? 0) + qty);
          // ต่อตู้ — เฉพาะที่ยังมีของในตู้ (qty > 0)
          if (qty > 0) {
            (inMachineByMachine[mid] ??= []).push({
              productId: p.id,
              name: p.name,
              sku: p.sku,
              imageUrl: p.imageUrl,
              qty,
            });
          }
        }

        // net-available ต่อสินค้า = คลัง − ในตู้ (mirror getCfBranchStockProducts)
        const warehouseByProduct = new Map(warehouseMoves.map((m) => [m.productId, m._sum.qty ?? 0]));
        const netMap: Record<string, number> = {};
        for (const pid of productIds) {
          const warehouse = warehouseByProduct.get(pid) ?? 0;
          const inMachine = inMachineByProduct.get(pid) ?? 0;
          netMap[pid] = warehouse - inMachine;
        }
        netAvailableByBranch[b.id] = netMap;

        // เรียงรายการในตู้แต่ละตู้ตามชื่อ (อ่านง่าย)
        for (const mid of machineIds) {
          if (inMachineByMachine[mid]) {
            inMachineByMachine[mid].sort((a, x) => a.name.localeCompare(x.name, "th"));
          }
        }
      } catch {
        // graceful: ยังไม่ migrate / query ล้ม → คงค่าว่างของสาขานี้
        netAvailableByBranch[b.id] = netAvailableByBranch[b.id] ?? {};
      }
    }),
  );

  return { inMachineByMachine, netAvailableByBranch };
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
  // WAVE-3b · คลัง active ต่อสาขา (picker เติม R4 + นับสต๊อก N3 · โชว์เมื่อ >1 ห้อง)
  warehousesByBranch: Record<string, Array<{ id: string; name: string; isMain: boolean }>>;
  // F1 · ยอด "คลังตอนนี้" ต่อสินค้า ต่อสาขา (productId → คงคลังสาขา) — โชว์ "คลังตอนนี้ N → หลังรับ N+x"
  //   derive จาก branchProducts (warehouse = คงคลังสาขา · ไม่ต้อง query ซ้ำ) — เลขจาก server ledger.
  onHandByBranch: Record<string, Record<string, number>>;
  // F2 · ประวัติ "รับแล้ว" ต่อสาขา (จาก ledger · READ-ONLY)
  receivedByBranch: Record<string, CfReceivedDoc[]>;
}> {
  const branchIds = branches.map((b) => b.id);
  let awaitingSetupIds: string[] = [];
  const branchProducts: Record<string, BranchStockProduct[]> = {};
  const inboundByBranch: Record<string, InboundDelivery[]> = {};
  const warehousesByBranch: Record<string, Array<{ id: string; name: string; isMain: boolean }>> = {};
  const onHandByBranch: Record<string, Record<string, number>> = {};
  const receivedByBranch: Record<string, CfReceivedDoc[]> = {};

  if (!orgId || branchIds.length === 0)
    return { awaitingSetupIds, branchProducts, inboundByBranch, warehousesByBranch, onHandByBranch, receivedByBranch };

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
        // F1 · ยอดคลังตอนนี้ต่อสินค้า (จาก ledger ผ่าน getCfBranchStockProducts.warehouse) → การ์ดรับโชว์ "N → N+รับ"
        onHandByBranch[bid] = Object.fromEntries(products.map((p) => [p.id, p.warehouse]));
      } catch {
        branchProducts[bid] = [];
        onHandByBranch[bid] = {};
      }
      try {
        // F2 · ประวัติ "รับแล้ว" ล่าสุดของสาขา (จาก movement ledger · READ-ONLY · scope orgId+branchId)
        receivedByBranch[bid] = await getReceivedHistory(orgId, bid, 50);
      } catch {
        // graceful: ยังไม่ migrate / query ล้ม → ประวัติว่าง (แท็บ "รับแล้ว" โชว์ empty)
        receivedByBranch[bid] = [];
      }
      try {
        // WAVE-3b · คลัง active ของสาขา (main มาก่อน · getCfWarehousesForBranch sort isMain desc แล้ว)
        // → ตัด id/name/isMain ให้ client ตัดสิน picker (>1 ห้อง = โชว์). graceful: ยังไม่ migrate → [].
        const whs = await getCfWarehousesForBranch(orgId, bid);
        warehousesByBranch[bid] = whs
          .filter((w) => w.isActive)
          .map((w) => ({ id: w.id, name: w.name, isMain: w.isMain }));
      } catch {
        warehousesByBranch[bid] = [];
      }
      try {
        // 2 แหล่งของ "ของรอรับ" ที่รวมในหน้ามือถือ (ต่างกันที่ write path):
        //   • cfDelivery (source=cf_delivery) → รับด้วย confirmShipmentReceived
        //   • ใบโอนจากคลังกลาง DC ปลายทางสาขาตู้คีบนี้ (source=dc_transfer) → รับด้วย confirmTransfer
        // ทั้งคู่คืน lineId มากับใบแล้ว (cf=DeliveryLine.id · dc=DcTransferLine.id) → ไม่ต้อง lookup แยก.
        const [deliveries, dcTransfers] = await Promise.all([
          getInboundDeliveries(bid),
          getInboundDcTransfers(bid),
        ]);
        // รวม 2 แหล่ง แล้วเรียงใหม่สุดก่อน (dispatchedAt/createdAt) — ของล่าสุดขึ้นบน
        const merged = [...deliveries, ...dcTransfers].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        inboundByBranch[bid] = merged.map((d) => ({
          id: d.id,
          status: d.status,
          itemsCount: d.itemsCount,
          unitsCount: d.unitsCount,
          source: d.source,
          transferId: d.transferId,
          lines: d.lines.map((l) => ({
            lineId: l.lineId,
            productId: l.productId,
            productName: l.productName,
            qty: l.qty,
            receivedQty: l.receivedQty,
            imageUrl: l.imageUrl, // F1 · รูปสินค้า → thumbnail บนการ์ดรับ
          })),
        }));
      } catch {
        inboundByBranch[bid] = [];
      }
    }),
  );

  return { awaitingSetupIds, branchProducts, inboundByBranch, warehousesByBranch, onHandByBranch, receivedByBranch };
}
