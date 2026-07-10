// DC · หน้าพิมพ์ "ใบโอนสินค้า" (print route → auto-print).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

const STATUS_TH: Record<string, string> = {
  DISPATCHED: "ส่งออกแล้ว",
  IN_TRANSIT: "กำลังส่ง",
  CONFIRMED: "รับแล้ว",
  AUTO_UNVERIFIED: "รับ (ยังไม่ยืนยัน)",
  CANCELLED: "ยกเลิก",
};

function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "—";
}

export default async function TransferPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [tf, org] = await Promise.all([
    prisma.dcTransfer.findFirst({
      where: { id, orgId },
      select: {
        transferCode: true, status: true, note: true, dispatchedAt: true,
        fromWarehouseId: true, toWarehouseId: true, toBranchId: true, toLabel: true, dispatchedByUserId: true,
        lines: {
          orderBy: { id: "asc" },
          select: { qty: true, qtyReceived: true, product: { select: { name: true, sku: true, imageR2Path: true } } },
        },
      },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } }),
  ]);
  if (!tf) notFound();

  const whIds = [tf.fromWarehouseId, tf.toWarehouseId].filter((x): x is string => !!x);
  const [whs, branch, dispatcher] = await Promise.all([
    prisma.dcWarehouse.findMany({ where: { orgId, id: { in: whIds } }, select: { id: true, name: true } }),
    tf.toBranchId ? prisma.branch.findUnique({ where: { id: tf.toBranchId }, select: { name: true } }) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: tf.dispatchedByUserId }, select: { name: true } }),
  ]);
  const whName = (wid: string | null) => (wid ? whs.find((w) => w.id === wid)?.name ?? "—" : "—");
  const destination = tf.toWarehouseId ? whName(tf.toWarehouseId) : tf.toLabel || branch?.name || "—";

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

  let totSend = 0;
  let totRecv = 0;
  const rows: PrintRow[] = tf.lines.map((l, i) => {
    totSend += l.qty;
    totRecv += l.qtyReceived ?? 0;
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
          </>
        ),
        qty: n0(l.qty),
        received: l.qtyReceived != null ? n0(l.qtyReceived) : "-",
      },
    };
  });

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={{ name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null }}
        docTitle="ใบโอนสินค้า"
        docTitleEn="Stock Transfer Note"
        code={tf.transferCode}
        headerRight={[
          { label: "วันที่ส่ง", value: longDate(tf.dispatchedAt) },
          { label: "สถานะ", value: STATUS_TH[tf.status] ?? tf.status },
        ]}
        metaLeft={[
          { label: "จากคลัง", value: whName(tf.fromWarehouseId) },
          { label: "ผู้ส่ง", value: dispatcher?.name ?? "—" },
        ]}
        metaRight={[{ label: "ไปยัง", value: destination }]}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า" },
          { key: "qty", header: "จำนวนส่ง", align: "right", width: "90px" },
          { key: "received", header: "รับแล้ว", align: "right", width: "90px" },
        ]}
        rows={rows}
        totals={[
          { label: "รวมส่ง (ชิ้น)", value: n0(totSend), strong: true },
          ...(totRecv > 0 ? [{ label: "รวมรับแล้ว (ชิ้น)", value: n0(totRecv) }] : []),
        ]}
        note={tf.note}
        signatures={[{ role: "ผู้ส่ง" }, { role: "ผู้ขนส่ง" }, { role: "ผู้รับปลายทาง" }]}
      />
    </>
  );
}
