// DC · หลังบ้าน · หน้ารวม "เบิก · โอน · ย้ายที่" — 3 งานที่เอาของออกจากคลัง ไว้หน้าเดียว กดสลับแท็บ
//   ใช้ <DcOutboundTabs> ตัวเดียวกับหน้าคลัง (floor) → flow/สัญญาณตัดสต๊อกเหมือนกันเป๊ะ ต่างแค่กรอบหลังบ้าน + ตัวเลือกคลัง
//   สิทธิ์: หน้า = requireDcManager · ตัว action ทั้ง 3 (postIssue/dispatchTransfer/moveLocation) ยัง guard canDcFloor ของตัวเองอยู่
//          (DC_MANAGER_ROLES ⊂ DC_FLOOR_ROLES → ผู้จัดการยิงได้ทั้ง 3 งาน)
//   ?tab=issue|transfer|move → เปิดแท็บนั้น · ไม่ใส่ = "เบิกออก" (ความหมายเดิมของ /dc/office/issue)
import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { listClawfleetBranchTargets } from "@/lib/clawfleet/stock-queries";
import { getRecentMovements } from "@/lib/dc/reports";
import { DcRecentActivityPanel } from "@/components/dc/recent-activity-panel";
import {
  DcOutboundTabs,
  resolveOutboundTab,
  type DestWarehouseOption,
} from "../../transfer/transfer-dispatch";

export const dynamic = "force-dynamic";

export default async function DcOfficeIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; tab?: string }>;
}) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const chrome = await getDcOfficeChrome(ctx.session.user.org_id);

  const sp = await searchParams;
  const initialTab = resolveOutboundTab(sp ?? {}, "issue");

  // คลังปลายทางที่เลือกได้ = คลังที่ allowed ทั้งหมด ยกเว้นคลังต้นทาง (กรองใน client)
  const destWarehouses: DestWarehouseOption[] = ctx.warehouses.map((w) => ({
    id: w.id,
    name: w.name,
  }));
  // สาขาตู้คีบ (ClawFleet) ที่เป็นปลายทางโอนได้ (scoped ตามสิทธิ์)
  const clawBranches = await listClawfleetBranchTargets(ctx.session.user.org_id);

  // เวฟ 2 — แผง "ประวัติล่าสุด (Log)" ด้านขวา (mockup CEO) · อ่านจาก ledger เดียวกับหน้ารายงาน
  // ดึงเฉพาะคลังที่เลือกอยู่ (ctx.activeWarehouseId ผ่านการเช็คสิทธิ์ใน getDcContext แล้ว)
  const recent = ctx.activeWarehouseId
    ? await getRecentMovements(ctx.session.user.org_id, { warehouseId: ctx.activeWarehouseId, limit: 12 })
    : [];

  return (
    <DcOfficeShell {...dcShellChrome(ctx, chrome)}>
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>
              เบิก · โอน · ย้ายที่
            </h1>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
              เอาของออกจากคลัง — เลือกงานจากแท็บด้านล่าง แล้วสแกน/พิมพ์รหัส หรือกดเลือกจากรายการ
              {ctx.activeWarehouse ? ` · คลัง ${ctx.activeWarehouse.name}` : ""}
            </p>
          </div>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
        </div>

        {!ctx.activeWarehouseId || !ctx.activeWarehouse ? (
          <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
            <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลัง — สร้างที่หลังบ้านก่อน</p>
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          </div>
        ) : (
          <>
            {/* 2 คอลัมน์บนจอกว้าง: งานหลักซ้าย · แผง Log ขวา — จอแคบ (<1350px — sidebar หลักกินไป 256px) แผง Log ตกลงมาต่อท้าย */}
            <div
              className="dc-outbound-grid"
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "minmax(0, 1fr) 330px",
                alignItems: "start",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <DcOutboundTabs
                  initialTab={initialTab}
                  warehouseId={ctx.activeWarehouseId}
                  warehouseName={ctx.activeWarehouse.name}
                  warehouses={destWarehouses}
                  clawBranches={clawBranches}
                  r2PublicUrl={process.env.R2_PUBLIC_URL ?? ""}
                />
              </div>
              <DcRecentActivityPanel rows={recent} />
            </div>
            <style>{`@media (max-width: 1350px) { .dc-outbound-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
          </>
        )}
      </div>
    </DcOfficeShell>
  );
}
