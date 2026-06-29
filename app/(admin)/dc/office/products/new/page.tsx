// DC · หลังบ้าน · เพิ่มสินค้าใหม่
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { ProductForm } from "../product-form";

export const dynamic = "force-dynamic";

export default async function DcNewProductPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const chrome = await getDcOfficeChrome(ctx.session.user.org_id);

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
          <div className="dc-h1">เพิ่มสินค้าใหม่</div>
          <div className="dc-sub">กรอกข้อมูลสินค้า แล้วบันทึกเข้าทะเบียน</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <ProductForm />
      </div>
    </DcOfficeShell>
  );
}
