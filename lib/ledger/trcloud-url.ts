// Client-safe helper สำหรับสร้างลิงก์ "เปิดเอกสารใน TRCloud" (ไม่มี "server-only" —
// เรียกได้ทั้งฝั่ง client + server). ค่า base เป็น URL หน้าจอ TRCloud ที่ตายตัว ไม่ใช่ความลับ.

// Public TRCloud UI base for JP Sync (company 45) — not a secret, the fixed instance.
const TRCLOUD_UI_BASE = "https://pooil.trcloud.co/application/expense";

/** Build the clickable link to open a pushed doc in TRCloud. AP preferred over PO.
 *  apDocId → manage-ap.php?id=; else poDocId (numeric) → manage-po.php?id=.
 *  Returns null when there's no numeric id to link (e.g. sentinel "sent"/"pending"/"error"). */
export function trcloudDocUrl(opts: { apDocId?: string | null; poDocId?: string | null }): string | null {
  const isNumeric = (s: string | null | undefined): s is string => !!s && /^\d+$/.test(s);
  if (isNumeric(opts.apDocId)) return `${TRCLOUD_UI_BASE}/manage-ap.php?id=${opts.apDocId}`;
  if (isNumeric(opts.poDocId)) return `${TRCLOUD_UI_BASE}/manage-po.php?id=${opts.poDocId}`;
  return null;
}
