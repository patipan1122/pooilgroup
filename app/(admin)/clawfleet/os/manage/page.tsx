/**
 * ตู้คีบ OS — "จัดการ" (management hub)
 * ที่เดียวจบสำหรับแอดมิน: สร้าง/แก้ชื่อ/ลบ "สาขา" · สร้าง/แก้/ย้าย/ปลด "ตู้" ·
 * ดูรายละเอียด+ประวัติตู้ · ดู "คลังประจำสาขา" (stock overview รายสาขา).
 *
 * Server: gate เป็นแอดมิน (cfHasAdminPower) · ถ้าไม่ใช่ → redirect ไปภาพรวม.
 * Parallel-fetch (Promise.all): สาขา+ตู้ (getV2ManageBranches) · ตัวเลือกย้ายตู้
 * (getCfMachinesForBranchAdmin + getV2Branches) · stock overview รายสาขา
 * (getCfStockOverview ต่อสาขา). รายละเอียดตู้ (baseline/loadout/ประวัติ) โหลด
 * on-demand ผ่าน server action ตอนเปิดแผง (ไม่ preload ทุกตู้).
 */
import { redirect } from "next/navigation";
import { requireCfSession, cfHasAdminPower } from "@/lib/clawfleet/role-guard";
import { getV2ManageBranches, getV2Branches } from "@/lib/clawfleet/queries";
import { getCfMachinesForBranchAdmin, getCfStockOverview, getCfWarehousesForBranch, getCfBranchStockProducts, type CfWarehouseRow } from "@/lib/clawfleet/stock-queries";
import { getAwaitingSetupMachines } from "@/lib/clawfleet/baseline-queries";
import { ManageClient, type ManageBranchVM, type BranchStockVM, type MachineOption, type BranchOption, type WarehouseVM, type TransferProductVM } from "./manage-client";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  // ── gate: แอดมินเท่านั้น (server action ก็ assert ซ้ำอยู่แล้ว · นี่แค่ซ่อนหน้า) ──
  let orgId = "";
  try {
    const session = await requireCfSession();
    orgId = session.user.org_id;
    const isAdmin = await cfHasAdminPower(session);
    if (!isAdmin) redirect("/clawfleet/os/dashboard");
  } catch (e) {
    // redirect() โยน error พิเศษของ Next → ต้องปล่อยผ่าน (ไม่กลืน)
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    redirect("/clawfleet/os/dashboard");
  }

  // ── parallel-fetch ข้อมูลหลัก ──
  let manageBranches: Awaited<ReturnType<typeof getV2ManageBranches>> = [];
  let machineRows: Awaited<ReturnType<typeof getCfMachinesForBranchAdmin>> = [];
  let branchRows: Awaited<ReturnType<typeof getV2Branches>> = [];
  let awaiting: Awaited<ReturnType<typeof getAwaitingSetupMachines>> = [];
  try {
    [manageBranches, machineRows, branchRows, awaiting] = await Promise.all([
      getV2ManageBranches(),
      getCfMachinesForBranchAdmin(),
      getV2Branches(),
      getAwaitingSetupMachines(),
    ]);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → หน้าโชว์ EmptyState จริง (ไม่กุข้อมูลปลอม)
  }

  // ── stock overview ต่อสาขา (คลังประจำสาขา) — parallel ทุกสาขา ──
  const stockByBranch = new Map<string, BranchStockVM>();
  // ── คลังหลายห้องต่อสาขา (warehouses) + สินค้าต่อสาขา (สำหรับ modal โอนของ) ──
  const warehousesByBranch: Record<string, WarehouseVM[]> = {};
  const productsByBranch: Record<string, TransferProductVM[]> = {};
  await Promise.all(
    manageBranches.map(async (b) => {
      try {
        const ov = await getCfStockOverview(orgId, b.id);
        stockByBranch.set(b.id, {
          branchId: b.id,
          skuCount: ov.skuCount,
          lowCount: ov.lowCount,
          inventoryValueCents: ov.inventoryValueCents,
        });
      } catch {
        // ข้ามสาขาที่อ่านคลังไม่ได้ (client โชว์ "—")
      }
      try {
        const whs = await getCfWarehousesForBranch(orgId, b.id);
        warehousesByBranch[b.id] = whs.map((w: CfWarehouseRow) => ({
          id: w.id,
          name: w.name,
          isMain: w.isMain,
          isActive: w.isActive,
        }));
      } catch {
        warehousesByBranch[b.id] = [];
      }
      try {
        // สินค้าที่มีในสาขานี้ (มีของ/เคยเคลื่อนไหว) — feed picker ใน modal โอนของ
        const prods = await getCfBranchStockProducts(orgId, b.id);
        productsByBranch[b.id] = prods.map((p) => ({
          id: p.id,
          name: p.name,
          onHand: p.warehouse,
        }));
      } catch {
        productsByBranch[b.id] = [];
      }
    }),
  );

  // ── ตู้ที่ยังรอตั้งค่าครั้งแรก (⚪ AWAITING_SETUP) — set ไว้ให้ client วาด dot ──
  const awaitingIds = new Set(awaiting.map((m) => m.id));

  const branches: ManageBranchVM[] = manageBranches.map((b) => {
    const stock = stockByBranch.get(b.id) ?? null;
    return {
      id: b.id,
      name: b.name,
      code: b.code,
      area: b.area,
      manager: b.manager,
      machineCount: b.machineCount,
      machines: b.machines.map((m) => ({
        id: m.id,
        code: m.code,
        nickname: m.nickname,
        kind: m.kind,
        isActive: m.isActive,
        awaitingSetup: awaitingIds.has(m.id),
      })),
      stock,
    };
  });

  // ตัวเลือกสำหรับ modal ย้ายตู้ (reuse pattern เดิม)
  const machineOptions: MachineOption[] = machineRows.map((m) => ({
    id: m.id,
    code: m.code,
    nickname: m.nickname,
    branchId: m.branchId,
    branchName: m.branchName,
    isActive: m.isActive,
  }));
  const branchOptions: BranchOption[] = branchRows.map((b) => ({ id: b.id, name: b.name, code: b.code }));

  return (
    <ManageClient
      branches={branches}
      machineOptions={machineOptions}
      branchOptions={branchOptions}
      warehousesByBranch={warehousesByBranch}
      productsByBranch={productsByBranch}
    />
  );
}
