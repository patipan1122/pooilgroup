// CashHub Hotel — แปลงชีต Excel ยอดขายโรงแรม → แถวมาตรฐาน
//
// ชีตมีหัวคอลัมน์กระจาย 3 แถวบน + layout ต่างกันเล็กน้อยรายเดือน → ตรวจหัวด้วย keyword
// (ค่าปรับ/ทิป/ยอดขายรวม/รวมเงินสด/QR/agoda…) ส่วนคอลัมน์ไม่มีหัว (วันที่/กะ/ห้อง/ค่าห้อง/คน)
// ใช้ตำแหน่งคงที่ที่ verify แล้ว: วันที่=0 กะ=1 หมายเหตุ=2 ห้อง=3 ค่าห้อง=4.
//
// 1 วัน = 2 แถว (เช้า/ค่ำ). คืนค่าแถวมาตรฐาน + ผลรวม (ให้ผู้ใช้เทียบกับยอดท้ายชีตก่อน commit).

export type HotelParsedRow = {
  sales_date: string; // YYYY-MM-DD
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
  qr_banked: number | null;
  qr_diff: number | null;
  ota_agoda: number | null;
  ota_agoda_banked: number | null;
  ota_expedia: number | null;
  ota_expedia_banked: number | null;
  ota_booking: number | null;
  ota_booking_banked: number | null;
  staff_name: string | null;
  note: string | null;
  over_short: number | null;
  raw: Record<string, unknown>;
};

export type HotelParseResult = {
  rows: HotelParsedRow[];
  warnings: string[];
  totals: { rooms: number; totalSales: number; qrTotal: number; qrBanked: number };
};

type Cell = string | number | null | undefined;

function toNum(v: Cell): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[, "]/g, "").replace(/\\/g, "").trim();
  if (s === "" || s === "-") return null;
  const f = Number.parseFloat(s);
  return Number.isFinite(f) ? f : null;
}

function txt(v: Cell): string {
  return v == null ? "" : String(v).trim();
}

const THAI_RE = /[฀-๿]/;

/** detect column indices for the labeled columns by scanning header rows */
function detectHeaders(rows: Cell[][]): Record<string, number> {
  const H: Record<string, number> = {};
  const set = (k: string, i: number) => {
    if (H[k] == null) H[k] = i;
  };
  const headerRows = rows.slice(0, 6);
  for (const r of headerRows) {
    for (let i = 0; i < r.length; i++) {
      const c = txt(r[i]).toLowerCase().replace(/\s+/g, "");
      if (!c) continue;
      if (c.includes("ค่าปรับ")) set("fine", i);
      else if (c === "ทิป" || c.includes("ทิป")) set("tip", i);
      else if (c.includes("สินค้าเพื่อขาย") || c.includes("ขายน้ำ")) set("goods", i);
      if (c.includes("ยอดขายรวม")) set("total", i);
      if (c.includes("ยอดส่งเงินสด")) set("cash_remit", i);
      else if (c.includes("รวมเงินสด")) set("cash_pool", i);
      if (c.includes("เงินสดส่ง")) set("cash_deposited", i);
      if (c.includes("ส่วนต่างเงินสด")) set("cash_diff", i);
      if (c.includes("ของล่วงหน้า")) set("advance", i);
      if (c.includes("หลัง23") || c.includes("หลัง23.30")) set("qr_after", i);
      if (c.includes("ยอดรวมqr")) set("qr_total", i);
      if (c.includes("ยอดเข้าบัญชี") || c.includes("ttb")) set("qr_banked", i);
      if (c.includes("ส่วนต่างqr")) set("qr_diff", i);
      if (c.includes("agoda")) set("agoda", i);
      if (c.includes("expedia")) set("expedia", i);
      if (c.includes("booking") || c.includes("bookking")) set("booking", i);
    }
  }
  // QR "เช้า" sub-column = the labeled cell "เช้า" that sits just left of qr_after / qr_total
  if (H.qr_after != null) set("qr_morning", H.qr_after - 1);
  // OTA "เงินเข้า" columns sit immediately right of each platform label
  if (H.agoda != null) set("agoda_banked", H.agoda + 1);
  if (H.expedia != null) set("expedia_banked", H.expedia + 1);
  if (H.booking != null) set("booking_banked", H.booking + 1);
  return H;
}

function pad(d: number): string {
  return String(d).padStart(2, "0");
}

/**
 * @param matrix  rows of cells from the month sheet (xlsx → array of arrays)
 * @param year    full year e.g. 2026
 * @param month   1-12
 */
export function parseHotelSheet(
  matrix: Cell[][],
  year: number,
  month: number,
): HotelParseResult {
  const warnings: string[] = [];
  const H = detectHeaders(matrix);
  for (const need of ["total", "qr_banked"]) {
    if (H[need] == null)
      warnings.push(`หาคอลัมน์ "${need}" ไม่เจอ — ตรวจหัวตารางในชีต`);
  }

  // detect staff column: text (Thai names) column far right (after qr_diff region)
  const startScan = Math.max(H.qr_diff ?? 0, H.booking ?? 0, 18);
  const nameCount: Record<number, number> = {};
  for (const r of matrix) {
    for (let i = startScan; i < r.length; i++) {
      const v = txt(r[i]);
      if (v && THAI_RE.test(v) && toNum(v) == null) nameCount[i] = (nameCount[i] ?? 0) + 1;
    }
  }
  const staffCol = Object.entries(nameCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const STAFF = staffCol != null ? Number(staffCol) : -1;
  const OVER_SHORT = STAFF >= 0 ? STAFF + 1 : -1;

  const daysInMonth = new Date(year, month, 0).getDate();
  const rows: HotelParsedRow[] = [];
  let curDay: number | null = null;
  // คอลัมน์วันที่ (col0) มี 2 รูปแบบตามแท็บ:
  //   (ก) "เลขวัน" 1-31 ตรง ๆ   (ข) "วันที่จริง" ที่ Excel เก็บเป็น serial (เช่น 24016, +1/วัน)
  // parser เดิมอ่านแบบ (ข) เป็นเลข >31 แล้วข้ามทั้งเดือน → ข้อมูลจริงหายหมด (bug ชีตรูปแบบใหม่)
  // FIX: ยึด "แถวข้อมูลแรก = วันที่ 1" แล้วนับ offset — สูตรเดียวรองรับทั้งสองแบบ
  let baseSerial: number | null = null;

  const g = (r: Cell[], k: string): number | null =>
    H[k] != null ? toNum(r[H[k]]) : null;

  for (const r of matrix) {
    const shiftCell = txt(r[1]);
    const isMorning = shiftCell.includes("เช้า");
    const isEvening = shiftCell.includes("ค่ำ") || shiftCell.includes("ดึก");
    if (!isMorning && !isEvening) continue; // header / total / blank
    const dn = toNum(r[0]);
    if (dn != null) {
      if (baseSerial == null) baseSerial = dn; // แถวแรก = วันที่ 1 (anchor)
      curDay = Math.round(dn - baseSerial) + 1;
    }
    if (curDay == null || curDay < 1 || curDay > daysInMonth) continue;

    const total = g(r, "total");
    const roomRev = toNum(r[4]);
    if (total == null && roomRev == null) continue; // empty day

    const date = `${year}-${pad(month)}-${pad(curDay)}`;
    rows.push({
      sales_date: date,
      shift: isMorning ? "morning" : "evening",
      rooms: toNum(r[3]),
      room_revenue: roomRev,
      fine: g(r, "fine"),
      tip: g(r, "tip"),
      goods_sales: g(r, "goods"),
      total_sales: total,
      cash_to_remit: g(r, "cash_remit"),
      cash_pool: g(r, "cash_pool"),
      cash_deposited: g(r, "cash_deposited"),
      cash_diff: g(r, "cash_diff"),
      advance: g(r, "advance"),
      qr_morning: g(r, "qr_morning"),
      qr_after2330: g(r, "qr_after"),
      qr_total: g(r, "qr_total"),
      qr_banked: g(r, "qr_banked"),
      qr_diff: g(r, "qr_diff"),
      ota_agoda: g(r, "agoda"),
      ota_agoda_banked: g(r, "agoda_banked"),
      ota_expedia: g(r, "expedia"),
      ota_expedia_banked: g(r, "expedia_banked"),
      ota_booking: g(r, "booking"),
      ota_booking_banked: g(r, "booking_banked"),
      staff_name: STAFF >= 0 ? txt(r[STAFF]) || null : null,
      note: txt(r[2]) || null,
      over_short: OVER_SHORT >= 0 ? toNum(r[OVER_SHORT]) : null,
      raw: {},
    });
  }

  const totals = rows.reduce(
    (acc, x) => ({
      rooms: acc.rooms + (x.rooms ?? 0),
      totalSales: acc.totalSales + (x.total_sales ?? 0),
      qrTotal: acc.qrTotal + (x.shift === "morning" ? (x.qr_total ?? 0) : 0),
      qrBanked: acc.qrBanked + (x.shift === "morning" ? (x.qr_banked ?? 0) : 0),
    }),
    { rooms: 0, totalSales: 0, qrTotal: 0, qrBanked: 0 },
  );

  if (rows.length === 0) warnings.push("ไม่พบแถวข้อมูล (เช้า/ค่ำ) ในชีต");
  return { rows, warnings, totals };
}
