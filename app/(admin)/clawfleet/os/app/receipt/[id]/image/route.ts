// ClawFleet · "ใบรับสินค้า" เป็นรูป PNG (ส่งลงไลน์) — GET → attachment PNG.
//   READ-ONLY: อ่านจาก ledger (getReceivedHistory) · ไม่เขียนสต๊อก/ต้นทุน.
//   SCOPE: resolve สาขาจาก refId (ใน org ผู้ใช้) → buildClawFleetReceiveDocImage บังคับสิทธิ์เข้าสาขาอีกชั้น.
import { notFound } from "next/navigation";
import { buildClawFleetReceiveDocImage, resolveReceiveDocBranch } from "@/lib/clawfleet/receive-doc";
import { renderDocImage } from "@/lib/dc/doc-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // หาสาขาของใบรับนี้ (cfDelivery/dcTransfer ใน org ผู้ใช้) — ไม่พบ = 404
  const scope = await resolveReceiveDocBranch(id);
  if (!scope) notFound();
  // สร้างเอกสาร (assertCanAccessBranch ข้างในบังคับสิทธิ์เข้าสาขา · ไม่มีสิทธิ์ → redirect /403)
  const doc = await buildClawFleetReceiveDocImage(scope.orgId, scope.branchId, id);
  if (!doc) notFound();
  return renderDocImage(doc);
}
