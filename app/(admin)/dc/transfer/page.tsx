// DC · หน้ารวม "ส่ง/โอน + ย้ายที่" (floor) — รวม 2 งานที่ CEO สับสนว่าต่างกันยังไง ไว้หน้าเดียว
//   มี toggle บนสุด เลือกได้ 2 โหมด (อธิบายความต่างชัด ๆ):
//     • "ย้ายที่เก็บ — ในคลังนี้"  → ย้ายช่องเก็บภายในคลังเดียว (move flow · moveLocation)
//     • "ส่ง / โอน — ไปคลัง/สาขาอื่น" → ส่งของข้ามคลัง/สาขา (transfer flow · dispatchTransfer)
//   ?mode=move → default แท็บ "ย้ายที่" · ไม่ใส่ / mode อื่น → default "ส่ง/โอน"
//   /dc/move ยัง redirect มาที่ ?mode=move (ดู move/page.tsx)
import Link from "next/link";
import { History } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { listClawfleetBranchTargets } from "@/lib/clawfleet/stock-queries";
import { FloorTransferMove, type DestWarehouseOption } from "./transfer-dispatch";

export const dynamic = "force-dynamic";

export default async function DcTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  const sp = await searchParams;
  const initialTab: "move" | "transfer" = sp?.mode === "move" ? "move" : "transfer";

  // คลังปลายทางที่เลือกได้ = คลังที่ allowed ทั้งหมด ยกเว้นคลังต้นทาง (กรองใน client)
  const destWarehouses: DestWarehouseOption[] = ctx.warehouses.map((w) => ({
    id: w.id,
    name: w.name,
  }));

  // Wave 6 — สาขาตู้คีบ (ClawFleet) ปลายทางที่ผู้ใช้ส่งของไปได้ (scoped ตามสิทธิ์) → dropdown ในโหมด "สาขา/โมดูล"
  const clawBranches = await listClawfleetBranchTargets(ctx.session.user.org_id);

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ส่ง / โอน · ย้ายที่</div>
          <div className="dc-sub">
            {ctx.activeWarehouse ? `คลัง: ${ctx.activeWarehouse.name}` : "ยังไม่มีคลัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/dc/transfers"
            className="dc-chip"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", whiteSpace: "nowrap" }}
            title="ดูประวัติใบโอน — ใบที่ส่งออก + รอรับเข้า"
          >
            <History size={15} aria-hidden /> ประวัติใบโอน
          </Link>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {!ctx.activeWarehouseId || !ctx.activeWarehouse ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลัง — สร้างที่หลังบ้าน</p>
          {canManage && (
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <FloorTransferMove
          initialTab={initialTab}
          warehouseId={ctx.activeWarehouseId}
          warehouseName={ctx.activeWarehouse.name}
          warehouses={destWarehouses}
          clawBranches={clawBranches}
          r2PublicUrl={process.env.R2_PUBLIC_URL ?? ""}
        />
      )}
    </div>
  );
}
