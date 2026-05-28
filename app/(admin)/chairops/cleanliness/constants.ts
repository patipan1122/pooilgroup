// Pure constants · safe to import from both Server and Client components.
// Kept out of actions.ts because Next.js requires "use server" files to export
// only async functions.
export const CHECKLIST_ITEMS = [
  { key: "floor", label: "พื้น" },
  { key: "chairs", label: "เก้าอี้นวด" },
  { key: "restroom", label: "ห้องน้ำ" },
  { key: "trash", label: "ขยะ" },
  { key: "signage", label: "ป้าย/ตกแต่ง" },
  { key: "lighting", label: "ไฟส่องสว่าง" },
] as const;

export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];
