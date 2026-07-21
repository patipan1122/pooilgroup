"use client";

// Cross-island bridge สำหรับ "เซฟก่อนส่ง TRCloud".
// ปัญหา (CEO 2026-07-21): หน้า admin แยกเป็น 2 island — ฟอร์มแก้ไข (ExpenseReviewPane) กับ
// ปุ่มส่ง (TrcloudButton) — ปุ่มส่งอ่านค่าจาก DB ไม่เห็น draft ที่ยังไม่เซฟ. ผู้ใช้เปลี่ยน
// "สาขา" บนจอแต่ยังไม่กดบันทึก แล้วกดส่ง → ส่งค่าสาขาเก่าจาก DB (จอโชว์สำนักงานใหญ่ แต่ TRCloud
// ได้จักราช). แก้: ฟอร์ม register ฟังก์ชัน "เซฟ draft ปัจจุบัน" ไว้ตาม expenseId → ปุ่มส่ง
// flush (เซฟ) ก่อนยิงเสมอ → ปุ่มส่งเห็นค่าล่าสุดที่จอโชว์ 100%.

const registry = new Map<string, () => Promise<boolean>>();

/** ฟอร์มเรียกตอน mount → คืน cleanup ไว้ unregister ตอน unmount. */
export function registerDraftSaver(
  expenseId: string,
  saver: () => Promise<boolean>,
): () => void {
  registry.set(expenseId, saver);
  return () => {
    if (registry.get(expenseId) === saver) registry.delete(expenseId);
  };
}

/** ปุ่มส่งเรียกก่อนยิง TRCloud. ไม่มีฟอร์มเปิดอยู่ = DB เป็นค่าล่าสุดแล้ว → true. */
export async function flushDraftSave(expenseId: string): Promise<boolean> {
  const saver = registry.get(expenseId);
  if (!saver) return true;
  try {
    return await saver();
  } catch {
    return false;
  }
}
