// DC · หน้าพิมพ์ "ใบสั่งซื้อ" (print route · เปิดแท็บใหม่ → auto-print).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { PO_STATUS_LABEL, PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

function money(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function longDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "—";
}

export default async function PoPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [po, org] = await Promise.all([
    prisma.dcPurchaseOrder.findFirst({
      where: { id, orgId },
      select: {
        poCode: true, status: true, origin: true, currency: true, fxRate: true,
        orderedAt: true, createdAt: true, note: true, warehouseId: true,
        supplier: { select: { name: true } },
        lines: {
          orderBy: { id: "asc" },
          select: { qty: true, unitPriceCny: true, unitPriceThb: true, note: true, product: { select: { name: true, sku: true } } },
        },
      },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } }),
  ]);
  if (!po) notFound();

  const isChina = po.origin === "CHINA";
  const sym = isChina ? "¥" : "฿";
  const fx = po.fxRate != null ? Number(po.fxRate) : null;
  const warehouseName = ctx.warehouses.find((w) => w.id === po.warehouseId)?.name ?? "—";

  let sum = 0;
  const rows: PrintRow[] = po.lines.map((l, i) => {
    const price = Number(l.unitPriceCny);
    const lineTotal = l.qty * price;
    sum += lineTotal;
    return {
      key: String(i),
      cells: {
        no: i + 1,
        name: (
          <>
            {l.product?.name ?? "—"}
            {l.product?.sku ? <span style={{ color: "#888", fontSize: 11 }}> · {l.product.sku}</span> : null}
            {l.note ? <div style={{ color: "#666", fontSize: 11 }}>{l.note}</div> : null}
          </>
        ),
        qty: money(l.qty, 0),
        price: `${sym}${money(price)}`,
        total: `${sym}${money(lineTotal)}`,
      },
    };
  });

  const thb = isChina && fx != null ? sum * fx : null;

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={{ name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null }}
        docTitle="ใบสั่งซื้อ"
        docTitleEn="Purchase Order"
        code={po.poCode}
        headerRight={[
          { label: "วันที่สั่ง", value: longDate(po.orderedAt ?? po.createdAt) },
          { label: "สถานะ", value: PO_STATUS_LABEL[po.status] ?? po.status },
        ]}
        metaLeft={[
          { label: "ผู้ขาย", value: po.supplier?.name ?? "— ไม่ระบุ —" },
          { label: "คลังปลายทาง", value: warehouseName },
        ]}
        metaRight={[
          { label: "ประเภท", value: PO_ORIGIN_LABEL[po.origin] ?? po.origin },
          ...(isChina && fx != null ? [{ label: "เรต ฿/¥", value: money(fx, 4) }] : []),
        ]}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า" },
          { key: "qty", header: "จำนวน", align: "right", width: "70px" },
          { key: "price", header: `ราคา/หน่วย (${sym})`, align: "right", width: "110px" },
          { key: "total", header: `รวม (${sym})`, align: "right", width: "120px" },
        ]}
        rows={rows}
        totals={[
          { label: `ยอดรวมทั้งใบ (${sym})`, value: `${sym}${money(sum)}`, strong: true },
          ...(thb != null ? [{ label: "≈ เป็นเงินบาท", value: `฿${money(thb)}` }] : []),
        ]}
        note={po.note}
      />
    </>
  );
}
