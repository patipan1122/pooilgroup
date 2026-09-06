"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import {
  syncTrcloudDocs,
  syncTrcloudDocsPage,
  type TrcloudDocSyncResult,
  type TrcloudSyncPageResult,
  type DocKind,
} from "@/lib/ledger/trcloud-docs";
import { readTrcloudDocDetail, type TrcloudDocDetail } from "@/lib/ledger/trcloud-doc-detail";
import { sendPoDocsToAp, type SendPoToApInput, type SendPoToApResult } from "@/lib/ledger/trcloud-doc-to-ap";

// รีเฟรช: ดึง PO/AP ล่าสุดจาก TRCloud มาเก็บ snapshot (อ่านล้วนจาก TRCloud + เขียนแค่ตารางสำเนาเรา).
export async function actSyncTrcloudDocs(): Promise<TrcloudDocSyncResult> {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin");
  const res = await syncTrcloudDocs(session.user.org_id);
  revalidatePath("/ledger/trcloud-docs");
  return res;
}

// รีเฟรชทีละหน้า — ให้หน้าเว็บโชว์ "เปอร์เซ็นต์การโหลด" (โหลดถึงหน้าไหนแล้ว) ระหว่างดึงจาก TRCloud.
//   client เรียกซ้ำ start=0,100,200… ต่อชนิด (AP ก่อน แล้ว PO) จนกว่า hasMore=false หรือชนเพดานหน้า.
export async function actSyncTrcloudDocsPage(kind: DocKind, start: number): Promise<TrcloudSyncPageResult> {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin");
  return syncTrcloudDocsPage(session.user.org_id, kind, start);
}

// เปิด "ไส้ใน" ของใบเดียวสด ๆ จาก TRCloud (อ่านอย่างเดียว · ตอนผู้ใช้คลิกใบในตาราง):
//   รายการสินค้า + การลงบัญชีจริง (Dr/Cr) + จับใบที่ตก 5919999.
export async function actReadTrcloudDocDetail(
  kind: "PO" | "AP",
  trcloudId: string,
  refNo: string | null,
): Promise<TrcloudDocDetail> {
  await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin");
  return readTrcloudDocDetail(kind, trcloudId, refNo);
}

// 💰 ติ๊ก → ส่งเข้า AP: บันทึกใบสั่งซื้อ (PO) เป็นค่าใช้จ่าย (AP) จริงใน TRCloud ตามหมวดที่เลือก.
//   เป็น "การเขียนเงินจริง" → จำกัดสิทธิ์ระดับผู้ดูแล (ไม่ให้ viewer/area_manager) + มี guard หลายชั้นใน core.
export async function actSendPoDocsToAp(
  items: SendPoToApInput[],
): Promise<{ ok: boolean; results: SendPoToApResult[]; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  if (!Array.isArray(items) || items.length === 0) return { ok: false, results: [], error: "ไม่มีใบที่เลือก" };
  if (items.length > 50) return { ok: false, results: [], error: "ส่งได้ครั้งละไม่เกิน 50 ใบ" };
  const results = await sendPoDocsToAp(session.user.org_id, items);
  revalidatePath("/ledger/trcloud-docs");
  return { ok: true, results };
}
