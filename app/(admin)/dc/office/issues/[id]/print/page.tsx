// DC · หน้าพิมพ์ "ใบเบิกออก" (print route → auto-print).
// รายการในใบ = dc.stock_movements ที่ ref_type='dc_issue' ref_id=หัวใบ (kind=ISSUE · qty ติดลบ).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "—";
}

export default async function IssuePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [issue, org] = await Promise.all([
    prisma.dcIssue.findFirst({
      where: { id, orgId },
      select: { issueCode: true, warehouseId: true, note: true, issuedAt: true, actorUserId: true },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } }),
  ]);
  if (!issue) notFound();

  const [moves, actor] = await Promise.all([
    prisma.dcStockMovement.findMany({
      where: { orgId, refType: "dc_issue", refId: id, kind: DcMoveKind.ISSUE },
      orderBy: { occurredAt: "asc" },
      select: { qty: true, note: true, product: { select: { name: true, sku: true } } },
    }),
    issue.actorUserId ? prisma.user.findUnique({ where: { id: issue.actorUserId }, select: { name: true } }) : Promise.resolve(null),
  ]);

  const warehouseName = ctx.warehouses.find((w) => w.id === issue.warehouseId)?.name ?? "—";
  let totQty = 0;
  const rows: PrintRow[] = moves.map((m, i) => {
    const q = Math.abs(m.qty);
    totQty += q;
    return {
      key: String(i),
      cells: {
        no: i + 1,
        name: (
          <>
            {m.product?.name ?? "—"}
            {m.product?.sku ? <span style={{ color: "#888", fontSize: 11 }}> · {m.product.sku}</span> : null}
          </>
        ),
        qty: n0(q),
        reason: m.note && m.note !== "เบิกออก" ? m.note : "-",
      },
    };
  });

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={{ name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null }}
        docTitle="ใบเบิกออก"
        docTitleEn="Stock Issue Note"
        code={issue.issueCode}
        headerRight={[{ label: "วันที่เบิก", value: longDate(issue.issuedAt) }]}
        metaLeft={[
          { label: "คลังที่เบิก", value: warehouseName },
          { label: "ผู้เบิก", value: actor?.name ?? "—" },
        ]}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า" },
          { key: "qty", header: "จำนวนเบิก", align: "right", width: "100px" },
          { key: "reason", header: "เบิกไปใช้/เหตุผล", width: "150px" },
        ]}
        rows={rows}
        totals={[{ label: "รวมเบิก (ชิ้น)", value: n0(totQty), strong: true }]}
        note={issue.note}
        signatures={[{ role: "ผู้เบิก" }, { role: "ผู้จ่ายของ" }, { role: "ผู้อนุมัติ" }]}
      />
    </>
  );
}
