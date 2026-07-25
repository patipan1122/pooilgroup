// LedgerLine — เครื่องคิดเลขตรวจยอด (reconciler).
//
// แนวคิด (CEO 2026-07-25 + research GitHub/PAL): "อย่าให้ AI ดูเลขเอง — ให้โค้ด
// บวกลบคูณ + ลองทุกการตีความจนยอดลงตัว." LLM เก่งอ่าน "ชิ้นส่วน" (รายการ/ราคา/
// ส่วนลด/ยอดสุทธิ) แต่ห่วยคิดเลขหลายชั้น → เอาโค้ดคำนวณแทน (แม่น 100% · สตางค์เต็ม).
//
// อัลกอริทึม: ยึด "ยอดสุทธิ" (เลขที่เชื่อถือสุด — คือเงินที่จ่ายจริง) + Σรายการ เป็น
// หลัก แล้วลองทุกการตีความบันได (VAT แยก/รวม × ส่วนลดอยู่ในรายการ/ท้ายบิล) เลือก
// อันที่คำนวณแล้ว "ยอดสุทธิลงตัวพอดี". ไม่พึ่งการอ่าน VAT/ส่วนลดของ AI (จุดที่พลาดบ่อย).
//   ลงตัวแบบเดียว   → adjusted/ok  (แก้ตัวเลขให้ถูก)
//   ลงตัวหลายแบบต่าง → ambiguous    (ให้คนเลือก)
//   ไม่ลงตัวเลย      → no_fit       (น่าจะอ่านเลขผิด · ทักให้คนตรวจ)

export type ReconcileStatus = "ok" | "adjusted" | "ambiguous" | "no_fit";

export interface ReconcileResult {
  status: ReconcileStatus;
  subtotal: number;
  discount: number;
  vat: number;
  wht: number;
  total: number;
  /** คำอธิบายภาษาคน (ว่าปรับอะไร/ทำไมทัก) หรือ null ถ้าตัวเลขที่อ่านมาถูกอยู่แล้ว */
  note: string | null;
  /** เปลี่ยนค่าจากที่ AI อ่านมาหรือไม่ */
  changed: boolean;
}

// baht → satang (integer · กันปัดทศนิยมเพี้ยน)
const toS = (n: number | null | undefined): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : 0;
const toB = (satang: number): number => Math.round(satang) / 100;

const TOL = 100; // satang = 1 บาท (ให้ตรงกับ recheck MONEY_TOL)
const VAT_RATE = 7; // %

type Mode = "exclusive" | "zero";
interface Candidate {
  mode: Mode;
  footerInLines: boolean;
  subtotal: number;
  discount: number;
  vat: number;
  wht: number;
  grand: number;
  err: number;
}

export function reconcileReceipt(p: {
  items?: ({ amount: number | null } | null)[] | null;
  subtotal?: number | null;
  discount?: number | null;
  vat?: number | null;
  wht?: number | null;
  total?: number | null;
}): ReconcileResult {
  const readSub = toS(p.subtotal);
  const readDisc = toS(p.discount);
  const readVat = toS(p.vat);
  const wht = toS(p.wht);
  const readTotal = toS(p.total);

  const itemAmts = (p.items ?? [])
    .map((it) => toS(it?.amount))
    .filter((a) => a > 0);
  const itemsSum = itemAmts.reduce((s, a) => s + a, 0);

  // ยอดรวมรายการที่เชื่อถือได้: Σรายการ (ถ้ามี) ไม่งั้นใช้ที่ AI อ่าน
  const subtotal = itemAmts.length > 0 && itemsSum > 0 ? itemsSum : readSub;

  const asRead: Omit<ReconcileResult, "status" | "note" | "changed"> = {
    subtotal: toB(subtotal),
    discount: toB(readDisc),
    vat: toB(readVat),
    wht: toB(wht),
    total: toB(readTotal),
  };

  // ไม่มียอดสุทธิให้ยึด → คืนค่าที่อ่าน ให้คนตรวจ
  if (readTotal <= 0) {
    return { status: "no_fit", ...asRead, note: "อ่านยอดสุทธิไม่ได้ — กรุณาตรวจ", changed: false };
  }

  const vatOf = (base: number) => Math.round((base * VAT_RATE) / 100);

  const cands: Candidate[] = [];
  for (const mode of ["exclusive", "zero"] as const) {
    for (const footerInLines of [false, true]) {
      const discount = footerInLines ? 0 : readDisc;
      const base = subtotal - discount;
      if (base < 0) continue;
      let vat: number;
      let grand: number;
      if (mode === "exclusive") {
        vat = vatOf(base);
        grand = base + vat - wht;
      } else {
        vat = 0;
        grand = base - wht;
      }
      cands.push({ mode, footerInLines, subtotal, discount, vat, wht, grand, err: Math.abs(grand - readTotal) });
    }
  }

  // err น้อยสุดก่อน · เสมอ → เลือกอันที่ใกล้ค่าที่ AI อ่าน (vat+discount) มากกว่า
  cands.sort(
    (a, b) =>
      a.err - b.err ||
      Math.abs(a.vat - readVat) + Math.abs(a.discount - readDisc) -
        (Math.abs(b.vat - readVat) + Math.abs(b.discount - readDisc)),
  );
  const best = cands[0];

  if (!best || best.err > TOL) {
    // ไม่มีการตีความไหนทำให้ยอดลงตัว → น่าจะอ่านเลขผิดจริง · ทัก
    const calc = best ? toB(best.grand) : 0;
    return {
      status: "no_fit",
      ...asRead,
      note: `ยอดไม่ลงตัว (คำนวณได้ ${calc.toLocaleString()} แต่บิลว่า ${toB(readTotal).toLocaleString()}) — ตรวจตัวเลขบิล`,
      changed: false,
    };
  }

  // ลงตัวหลายแบบที่ได้ "ยอดต่างกัน" → คลุมเครือ (เช่น เดาไม่ออกว่ารวม VAT หรือแยก)
  const fits = cands.filter((c) => c.err <= TOL);
  const ambiguous = fits.some((c) => Math.abs(c.grand - best.grand) > TOL || Math.abs(c.vat - best.vat) > TOL);

  const out = {
    subtotal: toB(best.subtotal),
    discount: toB(best.discount),
    vat: toB(best.vat),
    wht: toB(wht),
    total: toB(readTotal),
  };
  const changed = best.vat !== readVat || best.discount !== readDisc || best.subtotal !== readSub;

  if (ambiguous) {
    return { status: "ambiguous", ...out, note: "ยอดตีความได้หลายแบบ (บิลรวม VAT หรือแยก VAT?) — ยืนยันยอดอีกครั้ง", changed };
  }
  if (!changed) {
    return { status: "ok", ...out, note: null, changed: false };
  }
  const note =
    best.mode === "zero"
      ? "ปรับ VAT = 0 (บิลราคารวม VAT / ไม่มี VAT แยก) เพื่อให้ยอดลงตัว"
      : `คำนวณ VAT ${toB(best.vat).toLocaleString()} จากฐานหลังหักส่วนลด เพื่อให้ยอดลงตัว`;
  return { status: "adjusted", ...out, note, changed: true };
}
