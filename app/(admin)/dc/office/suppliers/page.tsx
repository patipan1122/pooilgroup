// DC Redesign v2 · หลังบ้าน · ทะเบียนผู้ขาย (Suppliers) — shell ครีม/ฟ้า (เข้าชุด DC).
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { PurchasingSubnav } from "@/components/dc/purchasing-subnav";
import { SuppliersManager, type SupplierRow } from "./suppliers-manager";

export const dynamic = "force-dynamic";

export default async function DcSuppliersPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [chrome, suppliers] = await Promise.all([
    getDcOfficeChrome(orgId),
    prisma.dcSupplier.findMany({
      where: { orgId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, country: true, contact: true,
        wechat: true, paymentTerms: true, note: true, active: true,
      },
    }),
  ]);

  const rows: SupplierRow[] = suppliers.map((s) => ({
    id: s.id, name: s.name, country: s.country, contact: s.contact,
    wechat: s.wechat, paymentTerms: s.paymentTerms, note: s.note, active: s.active,
  }));

  return (
    <DcOfficeShell active="suppliers" {...dcShellChrome(ctx, chrome)}>
      <div>
        <PurchasingSubnav active="suppliers" />
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ผู้ขาย</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>ทะเบียนโรงงาน/ผู้ขาย (จีนเป็นหลัก) · ติดต่อ · WeChat · เงื่อนไขชำระ</p>
        </div>
        <SuppliersManager suppliers={rows} />
      </div>
    </DcOfficeShell>
  );
}
