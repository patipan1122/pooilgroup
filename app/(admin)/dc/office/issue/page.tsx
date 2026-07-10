// DC · หลังบ้าน · "เบิกออก" — เบิกของออกจากคลังจากฝั่ง office (เดิม /dc/issue มีแต่หน้าคลัง).
// ใช้ IssueWorkspace ตัวเดียวกับหน้าคลัง (สแกน/พิมพ์รหัส + ป็อปอัป "ดูสินค้า" เลือกจากรายการ)
// แต่ห่อด้วย DcOfficeShell (กรอบ/เมนูหลังบ้านเดียวกับหน้าอื่น) + มีตัวเลือกคลังให้เลือกก่อนเบิก.
import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { IssueWorkspace } from "../../issue/issue-workspace";

export const dynamic = "force-dynamic";

export default async function DcOfficeIssuePage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const chrome = await getDcOfficeChrome(ctx.session.user.org_id);

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
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>เบิกออก</h1>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
              เบิกของ/อะไหล่ออกจากคลัง — สแกน/พิมพ์รหัส หรือกด “ดูสินค้า” เลือกจากรายการ
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
          <IssueWorkspace
            warehouseId={ctx.activeWarehouseId}
            warehouseName={ctx.activeWarehouse.name}
          />
        )}
      </div>
    </DcOfficeShell>
  );
}
