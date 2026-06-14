// CashHub Hotel — โครงข้อมูล + ตรรกะตรวจสอบยอดขายโรงแรม (pure · ใช้ได้ทั้ง server/client)
//
// แหล่งความจริง = ชีต Google รายวันของโรงแรม (read-only ในระบบ). 1 วัน = 2 กะ (เช้า/ค่ำ).
// ค่าระดับวัน (รวม QR/เข้าบัญชี/ส่วนต่าง/เงินสดก้อนรอบส่ง) เก็บที่แถวกะเช้า ตามชีต.
//
// หน่วยเงินสด = "รอบส่งเงิน" (กะดึกเมื่อวาน 18:00–07:00 + กะเช้า 07:00–18:00 เก็บ ~10 โมง)
// → cash_pool/cash_deposited = ก้อนที่ต้องตรงกับสลิปฝากธนาคารตอน reconcile.
//
// หลักตรวจสอบ (จากทีมบัญชี FIN/OFC/AUD):
//   • diff คำนวณจากต้นทางเสมอ (banked − total) — ไม่เชื่อ diff ที่กรอกมาในชีต
//   • "ยังไม่กรอกยอดเข้าบัญชี" = สถานะที่ 3 (รอตรวจ) ไม่ใช่ "ผ่าน/เขียว"
//   • OTA โอนสุทธิหลังหักค่าคอม → paid−banked ไม่ใช่ "เงินค้าง" (แค่แสดง ไม่เด้งเตือน)
//   • ส่วนต่างทั้งเดือนใช้ผลรวมสัมบูรณ์ (Σ|diff|) — เงินขาด/เกินไม่หักกลบกัน

export type HotelShiftRow = {
  id: string;
  sales_date: string;
  shift: "morning" | "evening";
  rooms: number | null;
  room_revenue: number | null;
  fine: number | null;
  tip: number | null;
  goods_sales: number | null;
  total_sales: number | null;
  cash_to_remit: number | null;
  cash_pool: number | null;
  cash_deposited: number | null;
  cash_diff: number | null;
  advance: number | null;
  qr_morning: number | null;
  qr_after2330: number | null;
  qr_total: number | null;
  qr_banked: number | null; // เข้าบัญชี (ตัด 23:00) = statement ธนาคาร
  qr_diff: number | null;
  qr_scan_total: number | null; // TTB สแกนรวมทั้งวัน (ตามวันสแกน) — คิดฐานกะ
  qr_overnight: number | null; // TTB สแกน 00:00–07:00 (กะคืนวันก่อน) — คิดฐานกะ
  qr_late: number | null; // TTB สแกน 23:00–00:00 (ธนาคารดันไปวันถัดไป)
  ota_agoda: number | null;
  ota_agoda_banked: number | null;
  ota_expedia: number | null;
  ota_expedia_banked: number | null;
  ota_booking: number | null;
  ota_booking_banked: number | null;
  staff_name: string | null;
  note: string | null;
  over_short: number | null;
};

export type HotelDay = {
  date: string;
  day: number;
  morning: HotelShiftRow | null;
  evening: HotelShiftRow | null;
  rooms: number;
  totalSales: number;
  roomRevenue: number;
  tip: number;
  goods: number;
  fine: number;
  // QR (ระดับวัน)
  qrTotal: number;
  qrBanked: number;
  qrDiff: number; // = banked − total (คำนวณเอง · ติดลบ = เข้าน้อยกว่ายอดสแกน)
  qrChecked: boolean; // กรอกยอดเข้าบัญชีแล้วหรือยัง
  // เงินสด (รอบส่ง)
  cashDeposited: number;
  cashDiff: number;
  // OTA (รวมทุก platform · เก็บก้อนเดียวก่อน)
  otaPaid: number;
  otaBanked: number;
  // ลิ้นชัก
  overShort: number;
  // ธง
  qrFlag: boolean; // QR ไม่เข้าบัญชี (ตรวจแล้ว + ส่วนต่าง ≠ 0) — ตัวหลักตาม CEO
  qrUnchecked: boolean; // มี QR แต่ยังไม่กรอกยอดเข้าบัญชี (รอตรวจ — ไม่ใช่ผ่าน)
  salesIntegrity: boolean; // total = room+fine+tip+goods (ชีตคำนวณตรงไหม)
  cashMismatch: boolean; // เงินสดฝากจริง ≠ ที่ควรส่ง (เด้งจับเงินสดหาย)
  flagged: boolean; // วันนี้มีอะไรผิดปกติ (ไว้ filter "เฉพาะวันผิด")
  hasData: boolean;
};

const n = (v: number | null | undefined): number => (v == null ? 0 : Number(v));

function otaOf(r: HotelShiftRow | null): { paid: number; banked: number } {
  if (!r) return { paid: 0, banked: 0 };
  return {
    paid: n(r.ota_agoda) + n(r.ota_expedia) + n(r.ota_booking),
    banked: n(r.ota_agoda_banked) + n(r.ota_expedia_banked) + n(r.ota_booking_banked),
  };
}

/** ค่าระดับวันลงที่แถวเช้าตามชีต — fallback ไปกะดึกถ้าแถวเช้าว่าง (กัน "ลงผิดกะแล้วหาย") */
function dayLevel(
  m: HotelShiftRow | null,
  e: HotelShiftRow | null,
  key: keyof HotelShiftRow,
): number | null {
  const mv = m?.[key] as number | null | undefined;
  if (mv != null) return Number(mv);
  const ev = e?.[key] as number | null | undefined;
  return ev != null ? Number(ev) : null;
}

export function groupByDay(rows: HotelShiftRow[]): HotelDay[] {
  const byDate = new Map<string, HotelDay>();
  for (const r of rows) {
    let d = byDate.get(r.sales_date);
    if (!d) {
      d = {
        date: r.sales_date, day: Number(r.sales_date.slice(8, 10)),
        morning: null, evening: null,
        rooms: 0, totalSales: 0, roomRevenue: 0, tip: 0, goods: 0, fine: 0,
        qrTotal: 0, qrBanked: 0, qrDiff: 0, qrChecked: false,
        cashDeposited: 0, cashDiff: 0, otaPaid: 0, otaBanked: 0, overShort: 0,
        qrFlag: false, qrUnchecked: false, salesIntegrity: true,
        cashMismatch: false, flagged: false, hasData: false,
      };
      byDate.set(r.sales_date, d);
    }
    if (r.shift === "morning") d.morning = r;
    else d.evening = r;
  }

  for (const d of byDate.values()) {
    const m = d.morning, e = d.evening;
    d.rooms = n(m?.rooms) + n(e?.rooms);
    d.totalSales = n(m?.total_sales) + n(e?.total_sales);
    d.roomRevenue = n(m?.room_revenue) + n(e?.room_revenue);
    d.tip = n(m?.tip) + n(e?.tip);
    d.goods = n(m?.goods_sales) + n(e?.goods_sales);
    d.fine = n(m?.fine) + n(e?.fine);
    d.overShort = n(m?.over_short) + n(e?.over_short);

    // QR ระดับวัน — qr_total: IV เก็บต่อกะ (เช้า+ค่ำ) · Sheet เก็บระดับวันที่แถวเช้า (ค่ำ null)
    // → รวมทั้งคู่ถูกทั้งสองแบบ (ค่ำ null = +0) และตรงกับ recorded ใน computeShiftBasis
    d.qrTotal =
      m?.qr_total != null || e?.qr_total != null
        ? n(m?.qr_total) + n(e?.qr_total)
        : n(m?.qr_morning) + n(m?.qr_after2330) + n(e?.qr_morning) + n(e?.qr_after2330);
    const bankedRaw = dayLevel(m, e, "qr_banked");
    d.qrChecked = bankedRaw != null;
    d.qrBanked = n(bankedRaw);
    // คำนวณ diff เองเสมอ (ไม่เชื่อ qr_diff จากชีต — นั่นคือสิ่งที่เรากำลังตรวจ)
    d.qrDiff = d.qrChecked ? d.qrBanked - d.qrTotal : 0;

    // เงินสดรอบส่ง
    d.cashDeposited = n(dayLevel(m, e, "cash_deposited"));
    d.cashDiff = n(dayLevel(m, e, "cash_diff"));

    // OTA
    const om = otaOf(m), oe = otaOf(e);
    d.otaPaid = om.paid + oe.paid;
    d.otaBanked = om.banked + oe.banked;

    // ── ธงตรวจสอบ ──
    d.hasData = d.totalSales !== 0 || d.rooms !== 0;
    d.qrFlag = d.qrTotal > 0 && d.qrChecked && Math.abs(d.qrDiff) >= 1;
    d.qrUnchecked = d.qrTotal > 0 && !d.qrChecked;
    // ยอดขายรวม = ผลรวมองค์ประกอบไหม (จับชีตพิมพ์ผิด)
    const compSum = d.roomRevenue + d.fine + d.tip + d.goods;
    d.salesIntegrity = Math.abs(d.totalSales - compSum) < 1;
    // เงินสดฝากจริง vs ที่ควรส่ง (= ยอดขาย − QR − OTA) → จับเงินสดหาย
    const expectedRemit = d.totalSales - d.qrTotal - d.otaPaid;
    d.cashMismatch =
      d.cashDeposited > 0 && Math.abs(d.cashDeposited - expectedRemit) >= 1;
    d.flagged = d.qrFlag || d.overShort < 0 || !d.salesIntegrity;
  }

  return [...byDate.values()].sort((a, b) => a.day - b.day);
}

export type HotelMonthSummary = {
  totalSales: number;
  roomRevenue: number;
  goods: number;
  tip: number;
  cashDeposited: number;
  qrTotal: number;
  qrBanked: number;
  qrDiffAbs: number; // Σ|diff| — ไม่หักกลบ
  otaPaid: number;
  otaBanked: number;
  overShort: number;
  daysWithData: number;
  qrFlagCount: number;
  qrUncheckedCount: number;
  integrityCount: number;
};

export function summarize(days: HotelDay[]): HotelMonthSummary {
  const s: HotelMonthSummary = {
    totalSales: 0, roomRevenue: 0, goods: 0, tip: 0, cashDeposited: 0,
    qrTotal: 0, qrBanked: 0, qrDiffAbs: 0, otaPaid: 0, otaBanked: 0,
    overShort: 0, daysWithData: 0, qrFlagCount: 0, qrUncheckedCount: 0,
    integrityCount: 0,
  };
  for (const d of days) {
    if (!d.hasData) continue;
    s.totalSales += d.totalSales;
    s.roomRevenue += d.roomRevenue;
    s.goods += d.goods;
    s.tip += d.tip;
    s.cashDeposited += d.cashDeposited;
    s.qrTotal += d.qrTotal;
    s.qrBanked += d.qrBanked;
    s.qrDiffAbs += Math.abs(d.qrDiff);
    s.otaPaid += d.otaPaid;
    s.otaBanked += d.otaBanked;
    s.overShort += d.overShort;
    s.daysWithData += 1;
    if (d.qrFlag) s.qrFlagCount += 1;
    if (d.qrUnchecked) s.qrUncheckedCount += 1;
    if (!d.salesIntegrity) s.integrityCount += 1;
  }
  return s;
}

// ── ฐานกะ (shift-basis) ──────────────────────────────────────────────
// พนักงานนับ QR ตามกะ (กะดึก 18:00–07:00 คร่อมเที่ยงคืน) แต่ธนาคารตัด 23:00 ตามวันปฏิทิน
// → QR ช่วง 00:00–07:00 เป็นของ "กะคืนวันก่อน". ฐานกะของวัน N:
//     shiftBanked(N) = สแกนรวม(N) − ดึก(N) [ยกออกไปวันก่อน] + ดึก(N+1) [ยกเข้ามาจากเช้าวันถัดไป]
// → ตรงกับยอดที่พนักงานคีย์ (IV). ขอบเดือนต้องมีข้อมูลวัน N+1 (อัปไฟล์เดือนถัดไป) ถึงครบ.
export type ShiftBasis = {
  date: string;
  recorded: number; // ยอด QR ที่คีย์ (IV) ระดับวัน = เช้า+ค่ำ
  settlement: number | null; // qr_banked (ตัด 23:00) = statement ธนาคาร
  shiftBanked: number | null; // ฐานกะ (ตรงกับที่คีย์)
  shiftDiff: number | null; // shiftBanked − recorded (ตามแบบ "เข้าบัญชี − รวม QR" · ควร ~0)
  late: number | null; // ยอด QR 23:00–00:00 ของวันนี้ (ธนาคารดันไปวันถัดไป)
  overnight: number | null; // ยอด QR 00:00–07:00 ของวันนี้ (เป็นของกะคืนวันก่อน)
  hasTtb: boolean; // มีข้อมูล TTB ของวันนี้
  incomplete: boolean; // ขาดยอดดึกของวันถัดไป (ยังไม่อัปไฟล์/เดือนถัดไป)
};

const nextIso = (iso: string): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

/** คิดฐานกะต่อวันจาก rows (ต้องมีวัน N+1 อยู่ใน rows ด้วยถึงจะครบที่วันสุดท้าย) */
export function computeShiftBasis(rows: HotelShiftRow[]): Map<string, ShiftBasis> {
  const by = new Map<string, { morning?: HotelShiftRow; evening?: HotelShiftRow }>();
  for (const r of rows) {
    const e = by.get(r.sales_date) ?? {};
    if (r.shift === "morning") e.morning = r;
    else e.evening = r;
    by.set(r.sales_date, e);
  }
  const out = new Map<string, ShiftBasis>();
  for (const [date, { morning, evening }] of by) {
    const scanTotal = morning?.qr_scan_total;
    const ovn = morning?.qr_overnight;
    const recorded = n(morning?.qr_total) + n(evening?.qr_total);
    const settlement = morning?.qr_banked ?? null;
    const hasTtb = scanTotal != null;
    let shiftBanked: number | null = null;
    let incomplete = false;
    if (scanTotal != null) {
      const nd = by.get(nextIso(date));
      const nextUploaded = nd?.morning?.qr_scan_total != null;
      if (nextUploaded) {
        shiftBanked = n(scanTotal) - n(ovn) + n(nd?.morning?.qr_overnight);
      } else {
        incomplete = true; // ขาดยอดดึก (00:00–07:00) ของวันถัดไป
        shiftBanked = n(scanTotal) - n(ovn);
      }
    }
    out.set(date, {
      date,
      recorded,
      settlement,
      shiftBanked,
      shiftDiff: shiftBanked != null ? shiftBanked - recorded : null,
      late: morning?.qr_late ?? null,
      overnight: ovn ?? null,
      hasTtb,
      incomplete,
    });
  }
  return out;
}

export const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
