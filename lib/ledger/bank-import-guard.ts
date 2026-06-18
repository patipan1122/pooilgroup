// CashHub/LedgerLine — ตัวกันนำเข้า statement ผิดพลาด (pure · ไม่มี side-effect · ใช้ได้ทั้ง action + lib)
// ใช้คู่กับ computeLineHash (externalRef) ที่กันซ้ำข้าม export แล้ว — โมดูลนี้เพิ่มด่าน "ยอดต่อเนื่อง".
import type { NormalizedRow } from "./bank-adapters/types";

export type ContinuityResult =
  | { ok: true }
  | { ok: false; rowIndex: number; expectedSatang: number; gotSatang: number };

/** ไฟล์ statement ของบัญชีเดียว ยอดคงเหลือต้องไหลต่อกัน: balance[i] = balance[i-1] + amount[i].
 *  - ลองทั้ง 2 ทิศ (ไฟล์เรียงเก่า→ใหม่ หรือ ใหม่→เก่า) — ผ่านทิศใดทิศหนึ่ง = ต่อเนื่อง (กัน false-block)
 *  - ข้ามถ้า balance เป็น 0 ทั้งไฟล์ (ไฟล์ตัวอย่าง/คีย์มือ ไม่มียอดคงเหลือ) หรือมีแถวเดียว
 *  - tol = ค่าคลาดเคลื่อนที่ยอมรับ (default ฿1 = 100 สตางค์) */
export function checkIntraFileContinuity(rows: NormalizedRow[], tolSatang = 100): ContinuityResult {
  if (rows.length < 2) return { ok: true };
  if (rows.every((r) => r.balanceSatang === 0)) return { ok: true };

  const breakAt = (seq: NormalizedRow[]): { i: number; expected: number; got: number } | null => {
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1];
      const curr = seq[i];
      // ข้ามแถวที่ไม่มียอดคงเหลือ (เช่น ยอดยกมา/รายการพิเศษ) — เทียบไม่ได้ ไม่ถือว่าขาด
      if (prev.balanceSatang === 0 || curr.balanceSatang === 0) continue;
      const expected = prev.balanceSatang + curr.amountSatang;
      if (Math.abs(expected - curr.balanceSatang) > tolSatang)
        return { i, expected, got: curr.balanceSatang };
    }
    return null;
  };

  const forward = breakAt(rows);
  if (!forward) return { ok: true }; // เรียงเก่า→ใหม่ ต่อเนื่อง
  const reversed = breakAt([...rows].reverse());
  if (!reversed) return { ok: true }; // เรียงใหม่→เก่า ต่อเนื่อง

  // ไม่ต่อเนื่องทั้ง 2 ทิศ → ไฟล์ผิดปกติ/ปนหลายบัญชี/มีรายการขาด
  return { ok: false, rowIndex: forward.i, expectedSatang: forward.expected, gotSatang: forward.got };
}

/** ข้อความอธิบายเมื่อยอดไม่ต่อเนื่อง (ภาษาคน) */
export function continuityErrorMessage(r: Extract<ContinuityResult, { ok: false }>): string {
  const b = (s: number) => (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 });
  return (
    `ยอดคงเหลือในไฟล์ไม่ต่อเนื่องที่แถวที่ ${r.rowIndex + 1} ` +
    `(ควรเป็น ฿${b(r.expectedSatang)} แต่ในไฟล์เป็น ฿${b(r.gotSatang)}) — ` +
    `อาจมีรายการขาดหายไป หรือไฟล์ปนหลายบัญชี · ไม่อนุญาตให้นำเข้าจนกว่าจะได้ไฟล์ที่ยอดต่อเนื่อง`
  );
}
