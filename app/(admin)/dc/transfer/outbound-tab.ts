// แท็บงานขาออก (เบิก · โอน · ย้ายที่) — โมดูล server-safe (ไม่มี "use client")
// แยกออกจาก transfer-dispatch.tsx (ไฟล์ "use client") เพราะหน้า Server Component
// (/dc/office/issue, /dc/transfer) เรียก resolveOutboundTab() ตอน render
// → เรียกฟังก์ชันที่ export จากไฟล์ "use client" บน server = Next.js โยน error → หน้า 500

export type OutboundTab = "issue" | "transfer" | "move";

/** แปลง ?tab= / ?mode= (ลิงก์เก่า) → แท็บที่จะเปิด · ค่าอื่น/ไม่ใส่ = fallback */
export function resolveOutboundTab(
  params: { tab?: string; mode?: string },
  fallback: OutboundTab,
): OutboundTab {
  const raw = params.tab ?? params.mode; // mode=move คือลิงก์เก่าของ /dc/move
  if (raw === "issue" || raw === "transfer" || raw === "move") return raw;
  return fallback;
}
