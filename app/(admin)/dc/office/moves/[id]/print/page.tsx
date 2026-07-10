// DC · หน้าพิมพ์ "ใบย้ายที่" (print route → auto-print).
// รายการ = dc.stock_movements ที่ ref_type='dc_move' ref_id=หัวใบ (kind=MOVE · qty=0).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

function longDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "—";
}

export default async function MovePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [mv, org] = await Promise.all([
    prisma.dcMove.findFirst({
      where: { id, orgId },
      select: { moveCode: true, warehouseId: true, note: true, movedAt: true, actorUserId: true },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } }),
  ]);
  if (!mv) notFound();

  const [moves, actor] = await Promise.all([
    prisma.dcStockMovement.findMany({
      where: { orgId, refType: "dc_move", refId: id, kind: DcMoveKind.MOVE },
      orderBy: { occurredAt: "asc" },
      select: { locationFrom: true, locationTo: true, product: { select: { name: true, sku: true } } },
    }),
    mv.actorUserId ? prisma.user.findUnique({ where: { id: mv.actorUserId }, select: { name: true } }) : Promise.resolve(null),
  ]);

  const warehouseName = ctx.warehouses.find((w) => w.id === mv.warehouseId)?.name ?? "—";
  const rows: PrintRow[] = moves.map((m, i) => ({
    key: String(i),
    cells: {
      no: i + 1,
      name: (
        <>
          {m.product?.name ?? "—"}
          {m.product?.sku ? <span style={{ color: "#888", fontSize: 11 }}> · {m.product.sku}</span> : null}
        </>
      ),
      from: m.locationFrom || "-",
      to: m.locationTo || "-",
    },
  }));

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={{ name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null }}
        docTitle="ใบย้ายที่จัดเก็บ"
        docTitleEn="Bin/Location Move Note"
        code={mv.moveCode}
        headerRight={[{ label: "วันที่ย้าย", value: longDate(mv.movedAt) }]}
        metaLeft={[
          { label: "คลัง", value: warehouseName },
          { label: "ผู้ย้าย", value: actor?.name ?? "—" },
        ]}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า" },
          { key: "from", header: "จากตำแหน่ง", align: "center", width: "120px" },
          { key: "to", header: "ไปตำแหน่ง", align: "center", width: "120px" },
        ]}
        rows={rows}
        note={mv.note}
        signatures={[{ role: "ผู้ย้าย" }, { role: "ผู้ตรวจ" }]}
      />
    </>
  );
}
