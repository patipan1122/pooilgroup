// F7 — เครื่องคิดราคา 3 ชั้น: ต้นทุนคลัง + กำไรโซน + เซลล์บวกเพิ่ม
// ใช้ number (บาท/ลิตร) ในการคำนวณ → ปัด 4 ตำแหน่งเพื่อความแม่น
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ราคาขาย = ทุนคลัง + ค่าขนส่ง(โซน) + กำไรโซน + เซลล์บวกเพิ่ม
// transportCost แยกจากกำไร → เห็นชัดว่าอันไหนต้นทุนขนส่ง อันไหนกำไรล้วน
export function computeSellPrice(input: {
  costPerL: number;
  transportCost?: number;
  zoneMargin: number;
  salesMargin: number;
}): number {
  return round4(input.costPerL + (input.transportCost ?? 0) + input.zoneMargin + input.salesMargin);
}

// ต้นทุนถึงโซน (landed) = ทุนคลัง + ค่าขนส่ง
export function landedCost(costPerL: number, transportCost?: number): number {
  return round4(costPerL + (transportCost ?? 0));
}

// เช็คว่าราคาขายไม่ต่ำกว่า (ทุน + ขนส่ง + กำไรขั้นต่ำ)
export function belowFloor(input: {
  costPerL: number;
  transportCost?: number;
  finalPrice: number;
  minMargin: number;
}): boolean {
  return input.finalPrice < input.costPerL + (input.transportCost ?? 0) + input.minMargin;
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
