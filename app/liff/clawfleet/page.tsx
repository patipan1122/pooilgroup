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
import { getCfBranchStockProducts, getInboundDeliveries, getInboundDcTransfers, getCfWarehousesForBranch, getReceivedHistory, type CfReceivedDoc } from "@/lib/clawfleet/stock-queries";
import type { GroupCollectBranch, CollectSku } from "@/lib/clawfleet/group-data";
import { StaffAppClient, type StaffHistoryRow, type BranchStockProduct, type InboundDelivery } from "@/app/(admin)/clawfleet/os/app/staff-app-client";
import "@/app/(admin)/clawfleet/os/clawos.css";

export const dynamic = "force-dynamic";

// ต้นวันนี้ตามเวลาไทย (Asia/Bangkok = UTC+7) — กรองรอบที่ปิด "วันนี้"
function startOfTodayBangkok(): Date {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), 0, 0, 0) - 7 * 60 * 60 * 1000);
}

// B3 · วันที่ไทยของ "วันนี้" ในรูป YYYY-MM-DD (default ของ date picker ประวัติ) — sync กับ /clawfleet/os/app
function todayBangkokYmd(): string {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bkk.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// B3 · ขอบเขต "วัน" ตามเวลาไทย จาก YYYY-MM-DD → [gte, lt] (UTC). ไม่ valid → fallback วันนี้.
function bangkokDayRange(ymd: string): { gte: Date; lt: Date; ymd: string } {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : todayBangkokYmd();
  const [y, m, d] = safe.split("-").map(Number);
  const gte = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt, ymd: safe };
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

export default async function ClawfleetLiffPage({
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

  // 📊 ความคืบหน้าวันนี้ (progress bar · ยึด "วันนี้") + ประวัติการเก็บของ "วันที่เลือก" (B3 · ดูย้อนหลัง)
  //  - closedTodayCount = รอบที่ปิดจริง "วันนี้" (progress bar หน้าหลัก ไม่ผูก date picker)
  //  - history = รอบของ "วันที่เลือก" (READ-ONLY · ไม่แตะเงิน) — sync กับ /clawfleet/os/app
  // graceful: อ่านไม่ได้ / ยังไม่ migrate → closedTodayCount=0, history=[] (แอปโชว์ empty state)
  let closedTodayCount = 0;
  let history: StaffHistoryRow[] = [];
  if (orgId && userId) {
    try {
      closedTodayCount = await prisma.cfCollectionEvent.count({
        where: { orgId, collectedById: userId, eventType: "COLLECTION", collectedAt: { gte: startOfTodayBangkok() } },
      });
    } catch {
      // graceful: คงค่า default (0)
    }
    try {
      const events = await prisma.cfCollectionEvent.findMany({
        where: { orgId, collectedById: userId, eventType: "COLLECTION", collectedAt: { gte: dayRange.gte, lt: dayRange.lt } },
        orderBy: { collectedAt: "desc" },
        select: {
          collectedAt: true, cashCountedCents: true, anomalyFlags: true, coinMeterAfter: true,
          machine: { select: { code: true, branch: { select: { name: true } } } },
        },
        take: 50,
      });
      history = events.map((e) => ({
        code: e.machine.code,
        branch: e.machine.branch.name, // B3 · สาขาของตู้
        date: selectedDate, // B3 · วันที่ไทยของรอบ (YYYY-MM-DD)
        time: e.collectedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }),
        cashBaht: Math.round(e.cashCountedCents / 100),
        coinMeter: e.coinMeterAfter, // B3 · เลขมิเตอร์เหรียญที่บันทึกไว้ (look-back)
        ok: e.anomalyFlags.length === 0,
      }));
    } catch {
      // graceful: ยังไม่ migrate / query ล้ม → คงค่า default ([])
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

  // 🆕 bigfeature data (N1 baseline · N3 stock-count · N6 goods-receipt · R4 refill picker · WAVE-3b คลัง)
  //   + F1 onHandByBranch (คลังตอนนี้ต่อสินค้า) + F2 receivedByBranch (ประวัติรับแล้ว)
  const { awaitingSetupIds, branchProducts, inboundByBranch, warehousesByBranch, onHandByBranch, receivedByBranch } = await loadBigfeatureData(orgId, routeBranches);

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
        selectedDate={selectedDate}
        myRecentTickets={myRecentTickets}
        assignedOnly={hasAssignment}
        awaitingSetupIds={awaitingSetupIds}
        branchProducts={branchProducts}
        inboundByBranch={inboundByBranch}
        warehousesByBranch={warehousesByBranch}
        onHandByBranch={onHandByBranch}
        receivedByBranch={receivedByBranch}
      />
    </div>
  );
}

/**
 * โหลดข้อมูล bigfeature (server-side · org/สาขา-scoped ผ่าน query guard) — เหมือน /clawfleet/os/app.
 *  awaitingSetupIds (N1) · branchProducts (N3/R4) · inboundByBranch (N6)
 *  + F1 onHandByBranch (คลังตอนนี้ต่อสินค้า) + F2 receivedByBranch (ประวัติรับแล้ว).
 * graceful: query ล้ม/ยังไม่ migrate → คืนค่าว่าง.
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
    // graceful: ยังไม่ migrate → ไม่มีตู้ awaiting
  }

  await Promise.all(
    branchIds.map(async (bid) => {
      try {
        const products = await getCfBranchStockProducts(orgId, bid);
        branchProducts[bid] = products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku, // item 6 · โชว์ SKU บนรายการเติม/นับ
          imageUrl: p.imageUrl,
          warehouse: p.warehouse,
          defaultPriceCoins: p.defaultPriceCoins, // item 9 · ราคาขาย (display) บนหน้าสินค้า
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
        // WAVE-3b · คลัง active ของสาขา (main มาก่อน · sort ใน query แล้ว). graceful: ยังไม่ migrate → [].
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
