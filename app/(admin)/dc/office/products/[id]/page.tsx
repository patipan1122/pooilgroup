// DC · หลังบ้าน · แก้ไขสินค้า (edit mode) + สวิตช์เปิด/ปิดการใช้งาน
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { ProductForm, type ProductFormValues } from "../product-form";
import { ToggleActive } from "./toggle-active";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function DcEditProductPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { id } = await params;
  const [chrome, product] = await Promise.all([
    getDcOfficeChrome(orgId),
    prisma.dcProduct.findFirst({
      where: { id, orgId },
      select: {
        id: true,
        sku: true,
        name: true,
        barcode: true,
        type: true,
        unit: true,
        category: true,
        reorderPoint: true,
        imageR2Path: true,
        active: true,
      },
    }),
  ]);

  if (!product) notFound();

  const initial: ProductFormValues = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    barcode: product.barcode ?? "",
    type: product.type,
    unit: product.unit,
    category: product.category ?? "",
    reorderPoint: product.reorderPoint == null ? "" : String(product.reorderPoint),
    imageR2Path: product.imageR2Path ?? "",
  };

  return (
    <DcOfficeShell active="products" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/products"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#71717a",
              marginBottom: 4,
            }}
          >
            <ArrowLeft size={15} /> กลับทะเบียนสินค้า
          </Link>
          <div className="dc-h1">แก้ไขสินค้า</div>
          <div className="dc-sub">
            {product.name} · {product.sku}
          </div>
          <Link
            href={`/dc/office/products/${product.id}/timeline`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--color-brand-700, #1d4ed8)" }}
          >
            ดูการเดินของสินค้า (timeline) →
          </Link>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <ProductForm initial={initial} />
        <ToggleActive id={product.id} active={product.active} />
      </div>
      </div>
    </DcOfficeShell>
  );
}
