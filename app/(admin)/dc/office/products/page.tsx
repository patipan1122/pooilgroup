// DC · หลังบ้าน · ทะเบียนสินค้า (master list)
// แสดงสินค้าทั้งหมดของ org · ค้นหาด้วย ?q= (ชื่อ/SKU/บาร์โค้ด) ฝั่ง server.
import Link from "next/link";
import { Boxes } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { PurchasingTabs } from "@/components/dc/purchasing-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { SeedSampleButton } from "./seed-button";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string }>;

export default async function DcProductsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const products = await prisma.dcProduct.findMany({
    where: {
      orgId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { sku: { contains: query, mode: "insensitive" } },
              { barcode: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ active: "desc" }, { type: "asc" }, { sku: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      type: true,
      unit: true,
      reorderPoint: true,
      active: true,
    },
  });

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">สินค้า</div>
          <div className="dc-sub">ทะเบียนสินค้า · บาร์โค้ด · สินค้าขาย/อะไหล่</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <PurchasingTabs />

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <form method="get" style={{ flex: 1, minWidth: 220 }}>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด…"
            style={{
              width: "100%",
              height: 44,
              borderRadius: 12,
              border: "1px solid var(--dc-line, #e4e4e7)",
              padding: "0 14px",
              fontSize: 15,
              background: "#fff",
              color: "#18181b",
              outline: "none",
            }}
          />
        </form>
        <Link href="/dc/office/products/new" className="dc-btn-xl" style={{ width: "auto", minHeight: 44, padding: "0 18px", fontSize: 15 }}>
          ＋ เพิ่มสินค้า
        </Link>
        <SeedSampleButton />
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={<Boxes size={26} />}
          title={query ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้าในทะเบียน"}
          description={
            query
              ? "ลองคำค้นอื่น หรือเพิ่มสินค้าใหม่"
              : "เริ่มด้วยการเพิ่มสินค้าเอง หรือกด “เพิ่มสินค้าตัวอย่าง” เพื่อทดลองระบบ"
          }
        />
      ) : (
        <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>ชื่อสินค้า</th>
                <th style={cellHead}>SKU</th>
                <th style={cellHead}>บาร์โค้ด</th>
                <th style={cellHead}>ประเภท</th>
                <th style={{ ...cellHead, textAlign: "right" }}>จุดสั่งซ้ำ</th>
                <th style={cellHead}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    <Link
                      href={`/dc/office/products/${p.id}`}
                      style={{ fontWeight: 600, color: "var(--color-brand-700, #1d4ed8)" }}
                    >
                      {p.name}
                    </Link>
                    <div style={{ fontSize: 12, color: "#a1a1aa" }}>หน่วย: {p.unit}</div>
                  </td>
                  <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>{p.sku}</td>
                  <td style={{ ...cell, fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {p.barcode ?? "—"}
                  </td>
                  <td style={cell}>
                    <StatusPill tone={p.type === "SPARE" ? "amber" : "brand"} size="sm">
                      {PRODUCT_TYPE_LABEL[p.type] ?? p.type}
                    </StatusPill>
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {p.reorderPoint ?? "—"}
                  </td>
                  <td style={cell}>
                    <StatusPill tone={p.active ? "success" : "neutral"} size="sm" dot>
                      {p.active ? "ใช้งาน" : "ปิด"}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "top",
};
