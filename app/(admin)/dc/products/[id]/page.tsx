// DC · log รายสินค้า (per-product stock log) — server page
//   ดูสินค้า 1 ตัว: ชื่อ + รูป + คงเหลือรวม + ประวัติการเคลื่อนไหว (รับเข้า/เบิก/นับ/ย้าย…).
//   เข้าจากหน้า "ดูสินค้า" (แตะแถวสินค้า). server shell gate floor role.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { getProductStockLog } from "@/lib/dc/count-actions";
import { ProductLogView } from "./product-log-view";
import { ProductPhotoEditor } from "./product-photo-editor";

export const dynamic = "force-dynamic";

export default async function DcProductLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  const res = await getProductStockLog(id, { limit: 60 });
  if (!res.ok) notFound();

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ประวัติสินค้า</div>
          <div className="dc-sub">การเคลื่อนไหวของสินค้าชิ้นนี้ (รับเข้า · เบิก · นับ · ย้าย)</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/dc/products"
            className="dc-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 14px",
              borderRadius: 10,
              border: "1.5px solid var(--dc-line)",
              background: "var(--dc-paper)",
              color: "var(--dc-ink)",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ← กลับ
          </Link>
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <ProductPhotoEditor
          productId={res.product.id}
          imageUrl={res.product.imageUrl}
          productName={res.product.name}
        />
      </div>

      <ProductLogView
        product={res.product}
        onHand={res.onHand}
        entries={res.entries}
      />
    </div>
  );
}
