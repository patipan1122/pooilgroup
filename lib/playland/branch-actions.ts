"use server";

// Playland · สลับสาขาที่กำลังทำงาน (set cookie) + ก๊อปตั้งค่าไปสาขาอื่น
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandManage } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { PL_BRANCH_COOKIE } from "./branch-context";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

/** เลือก "สาขาที่กำลังทำงาน" — เก็บใน cookie (ทุกหน้าหลังบ้านจะโฟกัสสาขานี้) */
export async function setActiveBranch(branchId: string): Promise<void> {
  const session = await requireSession();
  // กันตั้ง cookie เป็นสาขานอก org
  if (!(await verifyBranchOrg(branchId, session.user.org_id))) return;
  const store = await cookies();
  store.set(PL_BRANCH_COOKIE, branchId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

/** ก๊อปสินค้าไปสาขาอื่น (เปิดสาขาใหม่ไม่ต้องตั้งซ้ำ) · สต๊อกเริ่มที่ 0 · กันซ้ำด้วยบาร์โค้ด */
export async function cloneProductToBranches(input: { productId: string; targetBranchIds: string[] }): Promise<ActionResult<{ created: number; skipped: number }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์");
  const src = await prisma.playlandProduct.findFirst({ where: { id: input.productId, orgId: session.user.org_id } });
  if (!src) return err("ไม่พบสินค้า");

  let created = 0, skipped = 0;
  for (const bid of input.targetBranchIds) {
    if (bid === src.branchId) { skipped++; continue; }
    if (!(await verifyBranchOrg(bid, session.user.org_id))) { skipped++; continue; }
    if (src.barcode) {
      const dup = await prisma.playlandProduct.findFirst({ where: { branchId: bid, barcode: src.barcode } });
      if (dup) { skipped++; continue; } // สาขานี้มีบาร์โค้ดนี้แล้ว
    }
    await prisma.playlandProduct.create({
      data: {
        orgId: session.user.org_id, branchId: bid, kind: src.kind, name: src.name, sku: src.sku,
        barcode: src.barcode, category: src.category, supplier: src.supplier, priceCents: src.priceCents,
        costCents: src.costCents, stock: 0, reorderLevel: src.reorderLevel, imageR2Path: src.imageR2Path,
        active: src.active, sortOrder: src.sortOrder,
      },
    });
    created++;
  }
  if (created === 0) return err(skipped > 0 ? "สาขาปลายทางมีสินค้านี้อยู่แล้ว" : "ไม่มีสาขาปลายทาง");
  revalidatePath("/playland/settings/products");
  return { ok: true, data: { created, skipped } };
}
