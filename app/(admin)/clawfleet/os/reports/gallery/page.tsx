/**
 * ตู้คีบ OS — รายงาน · แกลเลอรีตู้ (Machine Gallery)
 * "เดินดูหน้าร้านจริง": เลือกสาขา → เห็นตู้ทุกตู้เป็นการ์ดพร้อมรูป · ราคาเล่น
 *   · กดดูสินค้าในตู้ (SKU · จำนวน · ทุน · รวมทุนในตู้).
 * Server: parse ?branch= → getMachineGallery(branchId) (อ่านอย่างเดียว · scope orgId+สาขาที่เห็น).
 * ถ้า query พัง/ว่าง → ส่ง props ว่างให้ client โชว์ EmptyState (ไม่ crash).
 */
import { getMachineGallery, type MachineGalleryResult } from "@/lib/clawfleet/gallery-queries";
import { GalleryClient } from "./gallery-client";
import { requireSession } from "@/lib/auth/session";
import { resolveCompanyFilter } from "@/lib/auth/company-context";

export const dynamic = "force-dynamic";

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; company?: string }>;
}) {
  const sp = await searchParams;
  const branchId = typeof sp.branch === "string" && sp.branch.length > 0 ? sp.branch : undefined;

  // บริษัทที่เลือกไว้ (ตัวสลับบริษัท global) — เลือกทั้งหน้าตามบริษัทนี้ (CEO company-switcher Phase 4)
  let companyId: string | undefined;
  try {
    const s = await requireSession();
    companyId = await resolveCompanyFilter(s.user.org_id, sp.company);
  } catch {
    // graceful: ยังไม่ login → companyId undefined
  }

  let data: MachineGalleryResult = { branchOptions: [], branch: null };
  try {
    data = await getMachineGallery(branchId, companyId);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client โชว์ EmptyState
  }

  return <GalleryClient branchOptions={data.branchOptions} branch={data.branch} />;
}
