// Recruit — แหล่งความจริงเดียว (single source of truth) ว่า "หมวดไหนคือข้อสอบ IQ"
//
// ⚠️ ใช้ตัวนี้ทุกที่เสมอ:
//   - server: computeIqStats (iq.ts), getAnswerColumns (answers.ts)
//   - client: ApplicationTabs (application-tabs.tsx)
// ห้ามก๊อป logic ตรวจ IQ ไปเขียนซ้ำที่อื่น และห้ามใช้ .find() หยิบ "หมวด IQ เดียว"
//
// เหตุผล (bug 2026-07-13): ประกาศงานมีข้อสอบ IQ ได้ "หลายหมวด" พร้อมกัน
//   เช่น "ทดสอบไอคิวทั่วไป" (ตัวหนังสือ) + "ไอคิวจากรูป — ระดับง่าย/กลาง/ยาก"
// เดิมโค้ดใช้ .find() → เจอหมวดแรกแล้วหยุด → นับคะแนนแค่หมวดเดียว
// ข้อ IQ ที่เหลือเลยหลุดไปกองในแท็บ "คำตอบ" และไม่ถูกคิดคะแนน
// (ตัวหารค้างที่ /5 ทั้งที่จริงมีสิบกว่าข้อ) → ใช้ partitionIqSections แทน .find()/filter

/** section นี้เป็น "ข้อสอบ IQ" หรือไม่ — ตัดสินจาก id / ชื่อหมวด */
export function isIqSection(id: string, title: string): boolean {
  return (
    id === "iq_test" ||
    title.toLowerCase().includes("iq") ||
    title.includes("ไอคิว")
  );
}

/**
 * แยก sections เป็น "ทุกหมวด IQ" กับ "หมวดที่เหลือ" ในรอบเดียว.
 * ใช้แทน .find()/filter ทุกที่ เพื่อให้ทั้ง 3 จุด (คิดคะแนน · ตาราง · โปรไฟล์) ตรงกันเสมอ.
 */
export function partitionIqSections<T extends { id: string; title: string }>(
  sections: readonly T[],
): { iqSections: T[]; otherSections: T[] } {
  const iqSections: T[] = [];
  const otherSections: T[] = [];
  for (const s of sections) {
    if (isIqSection(s.id, s.title)) iqSections.push(s);
    else otherSections.push(s);
  }
  return { iqSections, otherSections };
}
