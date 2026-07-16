// ClawFleet · "ใบส่งสินค้า" (ใบโอนจากคลังกลาง DC) เป็นรูป PNG — สำหรับพนักงานสาขาปลายทาง.
//   CEO 2026-07-16: คนที่รอรับต้องกดดูใบส่งได้ (เดิมหน้าใบโอนล็อกไว้เฉพาะทีม DC).
//   SCOPE: ใบต้องอยู่ใน org ผู้ใช้ + ปลายทางเป็นสาขา (toBranchId) + ผู้ใช้เข้าถึงสาขานั้นได้
//   (assertCanAccessBranch → /403 ถ้าไม่มีสิทธิ์) — ไม่เปิดหลังบ้าน DC ให้พนักงานสาขา.
//   READ-ONLY: อ่านอย่างเดียว ไม่เขียนสต๊อก/สถานะใด ๆ.
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCfSession, assertCanAccessBranch } from "@/lib/clawfleet/role-guard";
import { buildTransferDocImageCore } from "@/lib/dc/doc-data";
import { renderDocImage } from "@/lib/dc/doc-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireCfSession();
  const orgId = session.user.org_id;

  // ใบโอนนี้ต้องอยู่ใน org เดียวกัน และปลายทางเป็นสาขา (toBranchId nullable → {not:null} ปลอดภัย)
  const tf = await prisma.dcTransfer.findFirst({
    where: { id, orgId, toBranchId: { not: null } },
    select: { toBranchId: true },
  });
  if (!tf?.toBranchId) notFound();

  // สิทธิ์: ผู้ใช้ต้องเข้าถึงสาขาปลายทางของใบนี้ได้ (staff/manager = ต้องสังกัดสาขา)
  await assertCanAccessBranch(tf.toBranchId);

  const doc = await buildTransferDocImageCore(orgId, id);
  if (!doc) notFound();
  return renderDocImage(doc);
}
