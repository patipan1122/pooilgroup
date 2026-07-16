// ClawFleet · หน้าพิมพ์ "ใบรับสินค้า" (print route → auto-print · CEO 2026-07-16 doc-first).
//   reuse ข้อมูลชุดเดียวกับใบรับ PNG (buildClawFleetReceiveDocImage — สิทธิ์สาขา + scope ครบในตัว)
//   → แปลงเป็น DcPrintDoc (เอกสารพิมพ์กลางของ repo · @media print ซ่อน chrome เหลือเฉพาะเอกสาร).
import { notFound } from "next/navigation";
import { buildClawFleetReceiveDocImage, resolveReceiveDocBranch } from "@/lib/clawfleet/receive-doc";
import { DcPrintDoc, type PrintRow } from "@/components/dc/print-doc";
import { AutoPrint } from "@/components/dc/print-controls";

export const dynamic = "force-dynamic";

export default async function ClawFleetReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // หาสาขาของใบรับนี้ (cfDelivery/dcTransfer ใน org ผู้ใช้) — ไม่พบ = 404
  const scope = await resolveReceiveDocBranch(id);
  if (!scope) notFound();
  // สร้างเอกสาร (assertCanAccessBranch ข้างในบังคับสิทธิ์เข้าสาขา · ไม่มีสิทธิ์ → redirect /403)
  const doc = await buildClawFleetReceiveDocImage(scope.orgId, scope.branchId, id);
  if (!doc) notFound();

  // DocImageInput (ใบ PNG) → props ของ DcPrintDoc: cells เป็น string อยู่แล้ว · เติมรูปสินค้าในช่องชื่อ
  const rows: PrintRow[] = doc.rows.map((r, i) => ({
    key: String(i),
    cells: {
      no: i + 1,
      name: (
        <>
          {r.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.imageUrl} alt="" style={{ width: 30, height: 30, objectFit: "contain", borderRadius: 4, verticalAlign: "middle", marginRight: 6, border: "1px solid #e5e7eb" }} />
          ) : null}
          {r.cells.name}
        </>
      ),
      qty: r.cells.qty,
    },
  }));

  return (
    <>
      <AutoPrint />
      <DcPrintDoc
        org={doc.org}
        docTitle={doc.docTitle}
        docTitleEn={doc.docTitleEn}
        code={doc.code}
        headerRight={doc.headerRight}
        metaLeft={doc.metaLeft}
        metaRight={doc.metaRight}
        columns={[
          { key: "no", header: "#", align: "center", width: "36px" },
          { key: "name", header: "สินค้า" },
          { key: "qty", header: "รับเข้า (ชิ้น)", align: "right", width: "110px" },
        ]}
        rows={rows}
        totals={doc.totals}
        note={doc.note}
        signatures={[{ role: "ผู้ส่ง" }, { role: "ผู้รับ" }, { role: "ผู้ตรวจ" }]}
      />
    </>
  );
}
