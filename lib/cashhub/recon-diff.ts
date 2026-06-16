// CashHub — ตรรกะ "ส่วนต่างเงินเข้า" ร่วมทุกธุรกิจ (pure · server/client ใช้ได้)
//
// diff = เงินเข้าจริง(ธนาคาร) − ยอดที่ควรได้(POS หักค่าธรรมเนียมแล้ว)
//   เป๊ะ (|diff| ≤ ฿1)  → สีรุ้งเหลือบมุก (.cell-matched-iridescent)
//   ขาด (diff < −฿1)    → แดง  (เงินเข้าน้อยกว่าที่ควร = ต้องตรวจ/ทวง)
//   เกิน (diff > +฿1)    → ส้ม  (เงินเข้ามากกว่าที่ควร)
// CEO 2026-06-15: threshold เป๊ะ = ±฿1 · ใช้ทุกธุรกิจ (Amazon/โรงแรม/ชา/ปั๊ม)

export const RECON_EXACT_TOL_BAHT = 1;

export type ReconDiffKind = "exact" | "short" | "excess" | "none";

export function reconDiffKind(
  diffBaht: number | null | undefined,
  tolBaht: number = RECON_EXACT_TOL_BAHT,
): ReconDiffKind {
  if (diffBaht == null || Number.isNaN(diffBaht)) return "none";
  if (Math.abs(diffBaht) <= tolBaht) return "exact";
  return diffBaht < 0 ? "short" : "excess";
}

/** className สำหรับ <td> ช่องตัวเลข (cell-level) */
export function reconDiffCellClass(kind: ReconDiffKind): string {
  switch (kind) {
    case "exact":
      return "cell-matched-iridescent";
    case "short":
      return "bg-red-100 font-bold text-red-800";
    case "excess":
      return "bg-amber-50 font-bold text-amber-700";
    default:
      return "text-zinc-700";
  }
}

/** className สำหรับป้าย/ชิป (text-level — ใช้ในคอลัมน์สถานะ) */
export function reconDiffPillClass(kind: ReconDiffKind): string {
  switch (kind) {
    case "exact":
      return "text-matched-iridescent font-bold";
    case "short":
      return "text-red-700 font-bold";
    case "excess":
      return "text-amber-700 font-bold";
    default:
      return "text-zinc-400";
  }
}

/** ข้อความสั้น เช่น "เป๊ะ" / "ขาด ฿50.00" / "เกิน ฿12.00" */
export function reconDiffLabel(
  diffBaht: number | null | undefined,
  fmt: (n: number) => string,
  tolBaht: number = RECON_EXACT_TOL_BAHT,
): string {
  const kind = reconDiffKind(diffBaht, tolBaht);
  switch (kind) {
    case "exact":
      return "เป๊ะ";
    case "short":
      return `ขาด ฿${fmt(Math.abs(diffBaht!))}`;
    case "excess":
      return `เกิน ฿${fmt(diffBaht!)}`;
    default:
      return "—";
  }
}
