// DC · หลังบ้าน · ทะเบียนผู้ขาย (Suppliers master, ส่วนใหญ่โรงงานจีน)
// แสดงรายชื่อผู้ขายทั้งหมดของ org + สร้าง/แก้/เปิด-ปิด (ใน suppliers-manager).
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { PurchasingTabs } from "@/components/dc/purchasing-tabs";
import { SuppliersManager, type SupplierRow } from "./suppliers-manager";

export const dynamic = "force-dynamic";

export default async function DcSuppliersPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const suppliers = await prisma.dcSupplier.findMany({
    where: { orgId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      country: true,
      contact: true,
      wechat: true,
      paymentTerms: true,
      note: true,
      active: true,
    },
  });

  const rows: SupplierRow[] = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    country: s.country,
    contact: s.contact,
    wechat: s.wechat,
    paymentTerms: s.paymentTerms,
    note: s.note,
    active: s.active,
  }));

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ผู้ขาย</div>
          <div className="dc-sub">ทะเบียนโรงงาน/ผู้ขาย (จีนเป็นหลัก) · ติดต่อ · WeChat · เงื่อนไขชำระ</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <PurchasingTabs />

      <SuppliersManager suppliers={rows} />
    </div>
  );
}
