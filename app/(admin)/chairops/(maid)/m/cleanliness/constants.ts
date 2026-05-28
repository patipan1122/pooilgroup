// Maid mobile cleanliness checklist · 10 display items (mockup Phone "CleanForm").
// The server action `createCleanlinessReport` stores a FIXED 6-key checklist
// (floor/chairs/restroom/trash/signage/lighting). To honor the mockup's 10-row
// UX without a schema/zod migration, each display item maps onto one of those
// 6 server keys. When ANY display item under a key is off, that server key is
// reported off — preserving the existing PASS/WARN/FAIL grading.
import type { ChecklistKey } from "@/app/(admin)/chairops/cleanliness/constants";

export interface MaidCleanItem {
  /** stable id for React + state */
  id: string;
  label: string;
  /** server checklist key this item folds into */
  key: ChecklistKey;
}

export const MAID_CLEAN_ITEMS: ReadonlyArray<MaidCleanItem> = [
  { id: "seat", label: "เบาะ + แขนเก้าอี้สะอาด", key: "chairs" },
  { id: "floor", label: "พื้น + พรมไม่มีคราบ", key: "floor" },
  { id: "remote", label: "รีโมท + ปุ่ม ใช้งานได้", key: "chairs" },
  { id: "screen", label: "จอแสดงผลใส มองเห็นชัด", key: "chairs" },
  { id: "signage", label: "ป้าย + สติกเกอร์ราคาครบ", key: "signage" },
  { id: "trash", label: "ถังขยะไม่ล้น", key: "trash" },
  { id: "plug", label: "ปลั๊กไฟไม่ชำรุด", key: "lighting" },
  { id: "smell", label: "ไม่มีกลิ่นเหม็น/อับ", key: "restroom" },
  { id: "light", label: "แสงสว่างเพียงพอ", key: "lighting" },
  { id: "access", label: "ลูกค้าเข้าใช้สะดวก", key: "restroom" },
] as const;
