// DC Redesign v2 · หลังบ้าน · จัดการโกดัง — shell ครีม/ฟ้า (เข้าชุด DC).
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { prisma } from "@/lib/prisma";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { WarehouseManager } from "./warehouse-manager";

export const dynamic = "force-dynamic";

export default async function DcWarehousesPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [chrome, warehouses] = await Promise.all([
    getDcOfficeChrome(orgId),
    prisma.dcWarehouse.findMany({
      where: { orgId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, location: true, isActive: true, isDefault: true },
    }),
  ]);

  return (
    <DcOfficeShell active="warehouses" {...dcShellChrome(ctx, chrome)}>
      <div>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>โกดัง &amp; ที่เก็บ</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>สร้างคลัง · ตั้งคลังเริ่มต้น · เปิด/ปิดการใช้งาน</p>
        </div>
        <WarehouseManager warehouses={warehouses} />
      </div>
    </DcOfficeShell>
  );
}
