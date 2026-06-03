// F7 — เครื่องคิดราคา 3 ชั้น: ต้นทุนคลัง + กำไรโซน + เซลล์บวกเพิ่ม
// ใช้ number (บาท/ลิตร) ในการคำนวณ → ปัด 4 ตำแหน่งเพื่อความแม่น
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeSellPrice(input: {
  costPerL: number;
  zoneMargin: number;
  salesMargin: number;
}): number {
  return round4(input.costPerL + input.zoneMargin + input.salesMargin);
}

// เช็คว่าราคาขายไม่ต่ำกว่าต้นทุน + กำไรขั้นต่ำ (minMargin)
export function belowFloor(input: {
  costPerL: number;
  finalPrice: number;
  minMargin: number;
}): boolean {
  return input.finalPrice < input.costPerL + input.minMargin;
}

export const PRODUCT_LABELS: Record<string, string> = {
  B7: "ดีเซล B7",
  B10: "ดีเซล B10",
  B20: "ดีเซล B20",
  GASOHOL_91: "แก๊สโซฮอล์ 91",
  GASOHOL_95: "แก๊สโซฮอล์ 95",
  E20: "แก๊สโซฮอล์ E20",
  E85: "แก๊สโซฮอล์ E85",
};

export const PRODUCT_ORDER = [
  "B7",
  "B10",
  "B20",
  "GASOHOL_91",
  "GASOHOL_95",
  "E20",
  "E85",
] as const;
