// ClawFleet · "ใบนับสต๊อก" เป็นรูป PNG (ส่งลงไลน์) — GET → attachment PNG.
//   READ-ONLY: อ่านจาก CfStockCount + CfStockCountLine · ไม่เขียนสต๊อก/ต้นทุน.
//   SCOPE: resolve สาขาจาก countId (ใน org ผู้ใช้) → buildClawFleetCountDocImage บังคับสิทธิ์เข้าสาขาอีกชั้น.
import { notFound } from "next/navigation";
import { buildClawFleetCountDocImage, resolveCountDocBranch } from "@/lib/clawfleet/count-doc";
import { renderDocImage } from "@/lib/dc/doc-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // หาสาขาของใบนับนี้ (CfStockCount ใน org ผู้ใช้) — ไม่พบ = 404
  const scope = await resolveCountDocBranch(id);
  if (!scope) notFound();
  // สร้างเอกสาร (assertCanAccessBranch ข้างในบังคับสิทธิ์เข้าสาขา · ไม่มีสิทธิ์ → redirect /403)
  const doc = await buildClawFleetCountDocImage(scope.orgId, scope.branchId, id);
  if (!doc) notFound();
  return renderDocImage(doc);
}
