// DC · หน้าพิมพ์ "ใบรับสินค้า (GRN)" (print route → auto-print).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "—";
}

export default async function GrnPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [grn, org] = await Promise.all([
    prisma.dcGoodsReceipt.findFirst({
      where: { id, orgId },
      select: {
        grnCode: true, receivedAt: true, note: true, warehouseId: true, poId: true, receivedByUserId: true,
        lines: {
          orderBy: { id: "asc" },
          select: { qtyExpected: true, qtyReceived: true, qtyDamaged: true, note: true, product: { select: { name: true, sku: true, imageR2Path: true } } },
        },
      },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } }),
  ]);
  if (!grn) notFound();

  const [poRow, receiver] = await Promise.all([
    grn.poId
      ? prisma.dcPurchaseOrder.findFirst({ where: { id: grn.poId, orgId }, select: { poCode: true, supplier: { select: { name: true } } } })
      : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: grn.receivedByUserId }, select: { name: true } }),
  ]);

  const warehouseName = ctx.warehouses.find((w) => w.id === grn.warehouseId)?.name ?? "—";
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;
  let totReceived = 0;
  let totDamaged = 0;

  const rows: PrintRow[] = grn.lines.map((l, i) => {
    totReceived += l.qtyReceived;
    totDamaged += l.qtyDamaged;
    const img = toImageUrl(l.product?.imageR2Path);
    return {
      key: String(i),
      cells: {
        no: i + 1,
        name: (
          <>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" style={{ width: 30, height: 30, objectFit: "contain", borderRadius: 4, verticalAlign: "middle", marginRight: 6, border: "1px solid #e5e7eb" }} />
            ) : null}
            {l.product?.name ?? "—"}
            {l.product?.sku ? <span style={{ color: "#888", fontSize: 11 }}> · {l.product.sku}</span> : null}
            {l.note ? <div style={{ color: "#666", fontSize: 11 }}>{l.note}</div> : null}
          </>
        ),
        expected: n0(l.qtyExpected),
        received: n0(l.qtyReceived),
        damaged: l.qtyDamaged > 0 ? n0(l.qtyDamaged) : "-",
      },
    };
  });

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={{ name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null }}
        docTitle="ใบรับสินค้า"
        docTitleEn="Goods Receipt Note"
        code={grn.grnCode}
        headerRight={[{ label: "วันที่รับ", value: longDate(grn.receivedAt) }]}
        metaLeft={[
          { label: "คลังที่รับ", value: warehouseName },
          { label: "ผู้รับ", value: receiver?.name ?? "—" },
        ]}
        metaRight={[
          { label: "อ้างอิงใบสั่งซื้อ", value: poRow?.poCode ?? "—" },
          { label: "ผู้ขาย", value: poRow?.supplier?.name ?? "—" },
        ]}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า" },
          { key: "expected", header: "สั่ง", align: "right", width: "80px" },
          { key: "received", header: "รับจริง", align: "right", width: "90px" },
          { key: "damaged", header: "เสียหาย", align: "right", width: "80px" },
        ]}
        rows={rows}
        totals={[
          { label: "รวมรับจริง (ชิ้น)", value: n0(totReceived), strong: true },
          ...(totDamaged > 0 ? [{ label: "รวมเสียหาย (ชิ้น)", value: n0(totDamaged) }] : []),
        ]}
        note={grn.note}
        signatures={[{ role: "ผู้รับสินค้า" }, { role: "ผู้ตรวจ" }, { role: "ผู้อนุมัติ" }]}
      />
    </>
  );
}
