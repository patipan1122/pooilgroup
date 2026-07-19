// DC · หน้ารวม "เบิกออก + โอนออก + ย้ายที่" (floor) — 3 งานที่เอาของออกจากคลัง ไว้หน้าเดียว กดสลับแท็บ
//     • "เบิกออก" → เบิกของออกไปใช้ ไม่มีปลายทาง (issue flow · postIssue)
//     • "โอนออก" → ส่งของข้ามคลัง/สาขา ปลายทางกดรับ (transfer flow · dispatchTransfer)
//     • "ย้ายที่" → ย้ายช่องเก็บภายในคลังเดียว (move flow · moveLocation)
//   ?tab=issue|transfer|move → เปิดแท็บนั้น · ไม่ใส่ = "โอนออก" (ความหมายเดิมของ /dc/transfer — กันคนบุ๊กมาร์กงง)
//   ลิงก์เก่า /dc/issue + /dc/move redirect มาที่นี่พร้อม ?tab= (ดู issue/page.tsx · move/page.tsx) · ?mode=move ยังรับอยู่
import Link from "next/link";
import { History } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { listClawfleetBranchTargets } from "@/lib/clawfleet/stock-queries";
import { DcOutboundTabs, type DestWarehouseOption } from "./transfer-dispatch";
import { resolveOutboundTab } from "./outbound-tab";

export const dynamic = "force-dynamic";

export default async function DcTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; tab?: string }>;
}) {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  const sp = await searchParams;
  const initialTab = resolveOutboundTab(sp ?? {}, "transfer");

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
          <div className="dc-h1">เบิก · โอน · ย้ายที่</div>
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
        <DcOutboundTabs
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
