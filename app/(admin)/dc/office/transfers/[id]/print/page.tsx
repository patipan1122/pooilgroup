// DC · หน้าพิมพ์ "ใบโอนสินค้า" (print route → auto-print).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
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
  // ปุ่มปริ้นอยู่ในลิสต์หน้าคลัง (floor) ด้วย — เปิดให้ floor role พิมพ์ได้
  // แต่ staff เห็นเฉพาะใบที่เกี่ยวกับคลังตัวเอง (scope check ด้านล่าง หลังโหลดใบ)
  // · manager ขึ้นไป = org-wide เหมือนเดิม
  requireDcFloor(ctx.session.user.role);
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

  // ── SCOPE GATE (เฉพาะ role ต่ำกว่า manager): from- หรือ to-warehouse ต้อง ∈
  // คลังที่ผูกสิทธิ์ (ctx.warehouses) — กันเดา id ปริ้นใบของไซต์อื่น
  // (pattern เดียวกับ transfer-detail-action.ts)
  if (!canDcManage(ctx.session.user.role)) {
    const allowedIds = new Set(ctx.warehouses.map((w) => w.id));
    const inScope =
      allowedIds.has(tf.fromWarehouseId) ||
      (!!tf.toWarehouseId && allowedIds.has(tf.toWarehouseId));
    if (!inScope) notFound();
  }

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

  const totSend = tf.lines.reduce((s, l) => s + l.qty, 0);
  const totRecv = tf.lines.reduce((s, l) => s + (l.qtyReceived ?? 0), 0);
  // ขาด = ส่ง − รับ (เฉพาะบรรทัดที่ยืนยันรับแล้ว · qtyReceived=null = ยังไม่รับ → ไม่นับ)
  const totShort = tf.lines.reduce((s, l) => s + (l.qtyReceived != null ? Math.max(0, l.qty - l.qtyReceived) : 0), 0);
  const rows: PrintRow[] = tf.lines.map((l, i) => {
    // ขาดต่อบรรทัด: null เมื่อยังไม่ยืนยันรับ (แสดง "-")
    const short = l.qtyReceived != null ? Math.max(0, l.qty - l.qtyReceived) : null;
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
        short:
          short == null ? "-" : short > 0
            ? <span style={{ color: "#c0392b", fontWeight: 700 }}>{n0(short)}</span>
            : "0",
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
          { key: "qty", header: "จำนวนส่ง", align: "right", width: "84px" },
          { key: "received", header: "รับแล้ว", align: "right", width: "84px" },
          { key: "short", header: "ขาด", align: "right", width: "70px" },
        ]}
        rows={rows}
        totals={[
          { label: "รวมส่ง (ชิ้น)", value: n0(totSend), strong: true },
          ...(totRecv > 0 ? [{ label: "รวมรับแล้ว (ชิ้น)", value: n0(totRecv) }] : []),
          ...(totShort > 0 ? [{ label: "รวมขาด (ชิ้น)", value: n0(totShort) }] : []),
        ]}
        note={tf.note}
        signatures={[{ role: "ผู้ส่ง" }, { role: "ผู้ขนส่ง" }, { role: "ผู้รับปลายทาง" }]}
      />
    </>
  );
}
