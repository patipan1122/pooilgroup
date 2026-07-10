// DC · หน้าพิมพ์ "ใบนับสต๊อก" (print route → auto-print → Save as PDF).
// ใช้ getCountSheet (gate floor role + scope คลังที่เข้าถึงได้อยู่แล้ว) + <DcPrintDoc> + <AutoPrint>.
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { requireDcFloor } from "@/lib/dc/role-guard";
import { getCountSheet } from "@/lib/dc/count-actions";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
/** ส่วนต่าง: 0=ตรง · >0=เกิน · <0=ขาด */
function varianceText(v: number): string {
  if (v === 0) return "ตรง";
  return v > 0 ? `+${n0(v)} เกิน` : `${n0(v)} ขาด`;
}

export default async function CountPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireDcFloor(session.user.role);
  const orgId = session.user.org_id;

  // getCountSheet ทำ gate role + scope คลัง + orgId ให้แล้ว (คืน {ok:false} ถ้าไม่มีสิทธิ์/ไม่พบ)
  const [res, org] = await Promise.all([
    getCountSheet(id),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } }),
  ]);
  if (!res.ok) notFound();
  const sheet = res.sheet;

  const rows: PrintRow[] = sheet.lines.map((l, i) => {
    const img = l.imageUrl;
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
            {l.name}
            {l.sku && l.sku !== "—" ? <span style={{ color: "#888", fontSize: 11 }}> · {l.sku}</span> : null}
          </>
        ),
        systemQty: `${n0(l.systemQty)}${l.unit ? ` ${l.unit}` : ""}`,
        countedQty: n0(l.countedQty),
        variance: varianceText(l.variance),
      },
    };
  });

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={{ name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null }}
        docTitle="ใบนับสต๊อก"
        docTitleEn="Stock Count Sheet"
        code={sheet.countCode}
        headerRight={[
          { label: "วันที่นับ", value: longDateTime(sheet.countedAt) },
          {
            label: "ส่วนต่างรวม",
            value: sheet.netVariance === 0 ? "ตรงพอดี" : `${sheet.netVariance > 0 ? "+" : ""}${n0(sheet.netVariance)}`,
          },
        ]}
        metaLeft={[
          { label: "คลัง", value: sheet.warehouseName ?? "—" },
          { label: "ผู้นับ", value: sheet.actorName ?? "—" },
        ]}
        metaRight={[{ label: "จำนวนรายการ", value: `${n0(sheet.lines.length)} รายการ` }]}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า / SKU" },
          { key: "systemQty", header: "ระบบมี", align: "right", width: "90px" },
          { key: "countedQty", header: "นับได้", align: "right", width: "80px" },
          { key: "variance", header: "ส่วนต่าง (ขาด/เกิน)", align: "right", width: "120px" },
        ]}
        rows={rows}
        totals={[
          {
            label: "ส่วนต่างรวม (ขาดหักเกิน)",
            value: sheet.netVariance === 0 ? "ตรงพอดี" : `${sheet.netVariance > 0 ? "+" : ""}${n0(sheet.netVariance)}`,
            strong: true,
          },
        ]}
        note={sheet.note}
        signatures={[{ role: "ผู้นับ" }, { role: "ผู้ตรวจ" }, { role: "ผู้อนุมัติ" }]}
      />
    </>
  );
}
