// CashHub Café Amazon — แปลงไฟล์ "รายงานปิดกะและปิดสิ้นวัน" (POS) → แถวรายวัน + c-vars (special note)
//
// ไฟล์ POS: หัวกระจายหลายแถว (title/ช่วงวันที่/หัวคอลัมน์/ชื่อสาขา/แถวกะ/แถวสรุปรายวัน)
//   → ใช้แถว "สรุปของวันที่ DD-MM-2569" เป็น 1 วัน (พ.ศ. −543).
//   หัวคอลัมน์ match ด้วย "ชื่อ" (ไม่ใช่ index) — กัน POS สลับคอลัมน์.
//
// แต่ละช่องทางชำระ → special-note c-var ของสูตร TRCloud "AMAZON <สาขา>[IV]"
//   (validated เทียบใบจริง 1048243: Grab/Lineman/Shopee = c20/c21/c22 ไม่ใช่ c3/c4/c5).
//   กฎสูตร: Σ(ช่องทาง) = ยอดขาย = total + vat. VAT 7% รวมใน (total = ยอดขาย/1.07).

/** POS column header (trimmed) → special-note c-var. Validated vs CEO's real IV. */
export const CHANNEL_CVAR: Record<string, string> = {
  "ยอดชำระด้วยเงินสด": "c1",
  QRPayment: "c2",
  // POS แยกยอด QR ที่ชำระผ่าน payment gateway ออกเป็นคอลัมน์นี้ตั้งแต่ ~07/2569
  // (เดิมรวมอยู่ใน "QRPayment" คอลัมน์เดียว — ใบกำกับเก่าที่เคยคีย์ไว้ก็รวมสองยอดนี้เป็น c2 ก้อนเดียว
  // เช่น store 4097 07-01: QRPayment(API) 7,838 + QRPayment 375 = c2 8,213 ตรงกับใบเดิม 100%)
  "QRPayment(API)": "c2",
  "QRCredit(API)": "c2", // ยอดเล็ก (~440/เดือน) — QR ผ่านเครดิตแบ็กเอนด์ ยังนับเป็นรายได้ QR เดียวกัน
  QRManual: "c13",
  "QR Manual(API)": "c13", // เดือน 07/2569 ไฟล์นี้ไม่มีคอลัมน์ "QRManual" เปล่าเลย มีแต่ตัว (API) — map ตรง c13
  "blueplus+ wallet": "c14",
  "blueplus+ wallet (API)": "c14", // เช็คแล้ว: มักมีเงินพร้อมกับคอลัมน์เดิมในวันเดียวกัน (คนละรอบตัดยอด ไม่ใช่ซ้ำ)
  "blueplus+ Credit": "c15",
  "blueplus+ credit(API)": "c15", // เดือนนี้ไม่มีคอลัมน์ "blueplus+ Credit" เปล่าเลย มีแต่ตัว (API)
  "คูปอง blueplus+": "c9",
  "คูปอง blueplus+200 คะแนน ส่วนลด 40 บาท": "c9", // POS แตกคูปองเป็นราย tier แต่เป็นบัญชีเดียวกับคูปอง blueplus+ ทั่วไป
  "คูปอง blueplus+250 คะแนน ส่วนลด 50 บาท": "c9",
  "คูปอง blueplus+ 500 คะแนน ส่วนลด 100 บาท": "c9",
  Redeem: "c11",
  "ส่วนลด 10 บาท AIS": "c7",
  "ส่วนลด 10 บาท TRUE - DTAC": "c8",
  "เครดิต EDC": "c12",
  "Grab เงินเชื่อ": "c20",
  "Lineman เงินเชื่อ": "c21",
  "ShopeeFood เงินเชื่อ": "c22",
};

const GROSS_COL = "ยอดขาย";
const CHECK_COL = "รวมยอดชำระ";

/** ป้ายช่องทางสำหรับโชว์ในตารางรีวิว (c-var → label ไทย) */
export const CVAR_LABEL: Record<string, string> = {
  c1: "เงินสด",
  c2: "QR",
  c13: "QR Manual",
  c14: "blueplus wallet",
  c15: "blueplus credit",
  c9: "คูปอง blueplus",
  c11: "Redeem",
  c7: "ส่วนลด AIS",
  c8: "ส่วนลด TRUE",
  c12: "เครดิต EDC",
  c20: "Grab",
  c21: "Lineman",
  c22: "ShopeeFood",
};

export type AmazonDayRow = {
  date: string; // YYYY-MM-DD (Gregorian)
  gross: number; // ยอดขาย (รวม VAT)
  total: number; // ก่อน VAT (= gross/1.07)
  vat: number; // VAT 7%
  cvars: Record<string, number>; // special-note c-vars (channel → amount)
  sumChannels: number;
  balanced: boolean; // Σchannels==gross && total+vat==gross → พร้อมคีย์ IV
  blockReason: string | null; // เหตุผลที่ยังคีย์ไม่ได้ (ปิดกะไม่เสร็จ/ช่องไม่รู้จัก)
  unmapped: string[]; // หัวคอลัมน์ที่มีเงินแต่ map c-var ไม่ได้
  // ไส้ในก่อนรวม cvar — หัวคอลัมน์ POS จริง (เช่น "QRPayment(API)") → ยอดวันนั้น (เฉพาะที่มีเงิน)
  // ใช้แค่ "แสดงผล" (ดูรายละเอียดว่า cvar ไหนรวมมาจากคอลัมน์อะไรบ้าง) — ห้ามใช้แทน cvars ใน logic คำนวณ/ส่งเงิน
  posBreakdown?: Record<string, number>;
};

export type AmazonParseResult = {
  rows: AmazonDayRow[];
  storeLabel: string | null; // ชื่อสาขาจากไฟล์ เช่น "Cafe Amazon สาขา ชุมชนหัวทะเล"
  storeCode: string | null; // เลขสาขา เช่น "5157"
  error?: string;
};

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * แปลง matrix (xlsx → array of arrays) → แถวรายวันพร้อม c-vars + VAT + checksum.
 * @param matrix แถวเซลล์จาก XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })
 */
export function parseAmazonPos(matrix: unknown[][]): AmazonParseResult {
  if (!Array.isArray(matrix) || matrix.length === 0)
    return { rows: [], storeLabel: null, storeCode: null, error: "ไฟล์ว่าง" };

  // หัวคอลัมน์ = แถวที่มีคำว่า "ยอดขาย"
  const headerRow = matrix.find(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() === GROSS_COL),
  );
  if (!headerRow)
    return {
      rows: [],
      storeLabel: null,
      storeCode: null,
      error: "อ่านไฟล์ไม่ออก — ไม่พบหัวคอลัมน์ 'ยอดขาย' (ไฟล์อาจไม่ใช่รายงานปิดกะ Café Amazon)",
    };
  const col: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const key = String(h ?? "").trim();
    if (key) col[key] = i;
  });

  // ชื่อ/เลขสาขา — แถวที่ขึ้นต้นด้วย "<เลข>:Cafe Amazon" หรือมี "Cafe Amazon สาขา"
  let storeLabel: string | null = null;
  let storeCode: string | null = null;
  for (const r of matrix) {
    const a = String(r?.[0] ?? "");
    const m = a.match(/(\d{3,6})\s*:?\s*(Cafe Amazon[^|]*)/i);
    if (m) {
      storeCode = m[1];
      storeLabel = m[2].trim();
      break;
    }
  }

  const rows: AmazonDayRow[] = [];
  for (const r of matrix) {
    if (!Array.isArray(r)) continue;
    const a = String(r[0] ?? "");
    const dm = a.match(/สรุปของวันที่\s*:?\s*(\d{2})-(\d{2})-(\d{4})/);
    if (!dm) continue;
    const [, dd, mm, by] = dm;
    const year = Number.parseInt(by, 10) - 543;
    const mmN = Number.parseInt(mm, 10);
    const ddN = Number.parseInt(dd, 10);
    if (year < 2020 || year > 2040) continue; // กัน parse เพี้ยน
    if (mmN < 1 || mmN > 12 || ddN < 1 || ddN > 31) continue; // กันวันที่เพี้ยน (เดือน>12/วัน>31)
    const date = `${year}-${mm}-${dd}`;

    const gross = num(r[col[GROSS_COL]]);
    const check = num(r[col[CHECK_COL]]);

    const cvars: Record<string, number> = {};
    const posBreakdown: Record<string, number> = {};
    let sumChannels = 0;
    const unmapped: string[] = [];
    for (const [label, cvar] of Object.entries(CHANNEL_CVAR)) {
      const idx = col[label];
      if (idx == null) continue; // หัวคอลัมน์นี้ไม่มีในไฟล์ → ข้าม (อาจไม่ใช้ช่องนี้)
      const amt = num(r[idx]);
      if (amt !== 0) {
        cvars[cvar] = round2((cvars[cvar] ?? 0) + amt);
        sumChannels = round2(sumChannels + amt);
        // เก็บยอดดิบต่อหัวคอลัมน์ไว้ด้วย (ก่อนรวม) — แสดง breakdown ให้ดูได้ เช่น
        // QRPayment(API) 4,505 / QRPayment 65 → รวมเป็น c2 4,570 (cvars ไม่เปลี่ยนพฤติกรรม)
        posBreakdown[label] = round2(amt);
      }
    }
    // เผื่อมีหัวคอลัมน์ช่องทางที่ระบบยังไม่รู้จัก (POS เพิ่มช่องใหม่) แต่มีเงิน
    // → สแกนเฉพาะคอลัมน์ที่อยู่ระหว่าง "ยอดขาย"(gross) กับ "รวมยอดชำระ"(check) เพราะ
    //   ช่วงนี้คือโซนช่องทางจ่ายเงินของรายงานเสมอ (ก่อนหน้า=เมทาดาต้ากะ, หลังจาก=เงินสดในลิ้นชัก/ขาดเกิน)
    const gCol = col[GROSS_COL];
    const cCol = col[CHECK_COL];
    if (gCol != null && cCol != null) {
      for (const [label, idx] of Object.entries(col)) {
        if (idx <= gCol || idx >= cCol) continue;
        if (CHANNEL_CVAR[label]) continue;
        if (num(r[idx]) !== 0) unmapped.push(label);
      }
    }

    const total = round2(gross / 1.07);
    const vat = round2(gross - total);

    const sumOk = Math.abs(sumChannels - gross) < 0.5;
    const checkOk = Math.abs(check - gross) < 0.5;
    let blockReason: string | null = null;
    if (gross <= 0) blockReason = "ยอดขายเป็น 0 (ยังไม่มีข้อมูล)";
    else if (!checkOk)
      blockReason = `รวมยอดชำระ (${check.toLocaleString()}) ≠ ยอดขาย (${gross.toLocaleString()}) — ไฟล์อาจเพี้ยน`;
    else if (!sumOk)
      blockReason = `รวมช่องทางที่อ่านได้ (${sumChannels.toLocaleString()}) ≠ ยอดขาย (${gross.toLocaleString()}) — ปิดกะยังไม่เสร็จ หรือมีช่องทางใหม่ที่ระบบยังไม่รู้จัก${unmapped.length ? ` (คอลัมน์: ${unmapped.join(", ")})` : ""}`;

    rows.push({
      date,
      gross,
      total,
      vat,
      cvars,
      sumChannels,
      balanced: blockReason === null,
      blockReason,
      unmapped,
      posBreakdown,
    });
  }

  rows.sort((x, y) => x.date.localeCompare(y.date));
  return { rows, storeLabel, storeCode };
}
