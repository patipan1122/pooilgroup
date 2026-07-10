// DC · หลังบ้าน · สินค้า — Redesign v2 (shell ครีม/ฟ้าเต็มจอ ตาม prototype).
// โหลดสินค้า active + คงเหลือรวม (DcStockBalance ทุกคลังที่เห็นได้) + จัดหมวด/สี/ของใกล้หมด
// → ส่งให้ ProductsClient (การ์ด/ตาราง/ค้นหา). ไม่โชว์ต้นทุน (CEO ขอซ่อน 2026-06-25).
import { prisma } from "@/lib/prisma";
import { DcPoStatus, DcShipmentStatus, DcPostStatus } from "@/lib/generated/prisma/enums";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { ProductsClient, type ProductRow, type CatChip } from "./products-client";
import { OfficeWarehouseSelect } from "./office-warehouse-select";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", org_admin: "Admin", admin: "Admin", program_admin: "Program Admin",
  area_manager: "Area Manager", branch_manager: "Manager", staff: "Staff", viewer: "Viewer",
};

// จานสี (จาก prototype + เสริม) — หมวดที่รู้จักแมปตรง · ที่เหลือ hash แบบคงที่
const PALETTE = [
  { c: "#2AA3A3", soft: "#D9F0EC" }, { c: "#E0922F", soft: "#FEF1DE" },
  { c: "#5B53D8", soft: "#EDEAFB" }, { c: "#64748B", soft: "#EEF1F5" },
  { c: "#2E9D6B", soft: "#DFF1E8" }, { c: "#8B5CD8", soft: "#F0E8FB" },
  { c: "#1F4FD6", soft: "#E9F0FF" }, { c: "#DC5B53", soft: "#FBE3E1" },
];
const KNOWN_CAT: Record<string, { c: string; soft: string }> = {
  "เครื่องดื่ม": PALETTE[0], "ขนม": PALETTE[1], "ของเล่น": PALETTE[2],
  "อะไหล่ตู้คีบ": PALETTE[3], "อะไหล่": PALETTE[3], "สินค้าขาย": PALETTE[6],
};
function catColor(label: string): { c: string; soft: string } {
  if (KNOWN_CAT[label]) return KNOWN_CAT[label];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default async function DcProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string }>;
}) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const allowedIds = ctx.warehouses.map((w) => w.id);

  // ตัวเลือกคลัง (office-only · ?wh=) — ค่าเริ่มต้น "รวมทุกคลัง" (ตัวเลขเท่าเดิม).
  // 🔒 SECURITY (house rule optional-scope-param=auth-skip): assert scope ∈ allowedIds ที่ server เสมอ.
  //    ถ้าส่ง wh ที่ไม่ได้รับสิทธิ์ → fall back เป็น aggregate (ห้าม query คลังที่ไม่ได้รับมอบหมาย).
  const sp = await searchParams;
  const scope = sp.wh && sp.wh !== "all" && allowedIds.includes(sp.wh) ? sp.wh : null;
  // ค่าที่โชว์ใน select: ตรงกับ scope ที่ผ่านการตรวจแล้ว (param ที่ไม่ถูกสิทธิ์ → กลับเป็น "all")
  const selectValue = scope ?? "all";

  const productsRaw = await prisma.dcProduct.findMany({
    where: { orgId, active: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true, sku: true, name: true, barcode: true, type: true,
      unit: true, category: true, reorderPoint: true, imageR2Path: true,
    },
  });
  const ids = productsRaw.map((p) => p.id);

  const [balances, poOpen, shipOpen, grnPending, poOrdered, shipInTransit] = await Promise.all([
    ids.length && allowedIds.length
      ? prisma.dcStockBalance.findMany({
          // scope===null → รวมทุกคลังที่เห็นได้ (aggregate เดิม) · มีคลังเจาะจง → เฉพาะคลังนั้น (ผ่าน assert แล้ว)
          where: {
            orgId,
            productId: { in: ids },
            warehouseId: scope ? scope : { in: allowedIds },
          },
          select: { productId: true, qtyOnHand: true },
        })
      : Promise.resolve([] as { productId: string; qtyOnHand: number }[]),
    prisma.dcPurchaseOrder.count({ where: { orgId, status: { notIn: [DcPoStatus.RECEIVED, DcPoStatus.CLOSED, DcPoStatus.CANCELLED] } } }),
    prisma.dcShipment.count({ where: { orgId, status: { not: DcShipmentStatus.RECEIVED } } }),
    prisma.dcGoodsReceipt.count({ where: { orgId, postStatus: DcPostStatus.PENDING } }),
    prisma.dcPurchaseOrder.count({ where: { orgId, status: DcPoStatus.ORDERED } }),
    prisma.dcShipment.count({ where: { orgId, status: DcShipmentStatus.IN_TRANSIT } }),
  ]);

  // รวมคงเหลือต่อสินค้า (ทุกคลังที่เห็นได้)
  const onHand = new Map<string, number>();
  for (const b of balances) onHand.set(b.productId, (onHand.get(b.productId) ?? 0) + b.qtyOnHand);

  // resolve รูปสินค้าเป็น URL เต็ม (R2 key หรือ http เต็ม) — เดิม drop R2 key ทิ้ง รูปเลยไม่ขึ้น
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

  const rows: ProductRow[] = productsRaw.map((p) => {
    const catLabel = (p.category?.trim() || PRODUCT_TYPE_LABEL[p.type] || p.type).trim();
    const catKey = p.category?.trim() || `__type_${p.type}`;
    const { c, soft } = catColor(catLabel);
    const oh = onHand.get(p.id) ?? 0;
    const low = p.reorderPoint != null && oh <= p.reorderPoint;
    const img = toImageUrl(p.imageR2Path);
    return {
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit,
      catKey, catLabel, catC: c, catSoft: soft,
      onhand: oh, reorder: p.reorderPoint, low,
      imageUrl: img,
    };
  });

  // chips หมวด (เรียงตามจำนวนมาก→น้อย)
  const byCat = new Map<string, CatChip>();
  for (const r of rows) {
    const ex = byCat.get(r.catKey);
    if (ex) ex.count++;
    else byCat.set(r.catKey, { key: r.catKey, label: r.catLabel, count: 1 });
  }
  const chips = [...byCat.values()].sort((a, b) => b.count - a.count);
  const lowCount = rows.filter((r) => r.low).length;

  return (
    <DcOfficeShell
      active="products"
      warehouseName={ctx.activeWarehouse?.name ?? "DC คลังกลาง"}
      userName={ctx.session.user.name || ctx.session.user.email || "ผู้ใช้"}
      userRole={ROLE_LABEL[ctx.session.user.role] ?? ctx.session.user.role}
      badges={{ po: poOpen, ship: shipOpen, grn: grnPending }}
      taskStrip={{ tracking: poOrdered, grn: grnPending, inTransit: shipInTransit }}
    >
      <ProductsClient
        products={rows}
        chips={chips}
        total={rows.length}
        lowCount={lowCount}
        headerExtra={
          ctx.warehouses.length > 1 ? (
            <OfficeWarehouseSelect
              warehouses={ctx.warehouses.map((w) => ({ id: w.id, name: w.name }))}
              value={selectValue}
            />
          ) : null
        }
      />
    </DcOfficeShell>
  );
}
