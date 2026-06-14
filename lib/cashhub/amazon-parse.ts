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
  QRManual: "c13",
  "blueplus+ wallet": "c14",
  "blueplus+ Credit": "c15",
  "คูปอง blueplus+": "c9",
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
    if (year < 2020 || year > 2040) continue; // กัน parse เพี้ยน
    const date = `${year}-${mm}-${dd}`;

    const gross = num(r[col[GROSS_COL]]);
    const check = num(r[col[CHECK_COL]]);

    const cvars: Record<string, number> = {};
    let sumChannels = 0;
    const unmapped: string[] = [];
    for (const [label, cvar] of Object.entries(CHANNEL_CVAR)) {
      const idx = col[label];
      if (idx == null) continue; // หัวคอลัมน์นี้ไม่มีในไฟล์ → ข้าม (อาจไม่ใช้ช่องนี้)
      const amt = num(r[idx]);
      if (amt !== 0) {
        cvars[cvar] = round2((cvars[cvar] ?? 0) + amt);
        sumChannels = round2(sumChannels + amt);
      }
    }
    // เผื่อมีหัวคอลัมน์ช่องทางที่ระบบยังไม่รู้จัก (POS เพิ่มช่องใหม่) แต่มีเงิน
    // → ตรวจจาก check vs sumChannels (ถ้า check==gross แต่ Σ ไม่ถึง = มีช่องตกหล่น)

    const total = round2(gross / 1.07);
    const vat = round2(gross - total);

    const sumOk = Math.abs(sumChannels - gross) < 0.5;
    const checkOk = Math.abs(check - gross) < 0.5;
    let blockReason: string | null = null;
    if (gross <= 0) blockReason = "ยอดขายเป็น 0 (ยังไม่มีข้อมูล)";
    else if (!checkOk)
      blockReason = `รวมยอดชำระ (${check.toLocaleString()}) ≠ ยอดขาย (${gross.toLocaleString()}) — ไฟล์อาจเพี้ยน`;
    else if (!sumOk)
      blockReason = `รวมช่องทางที่อ่านได้ (${sumChannels.toLocaleString()}) ≠ ยอดขาย (${gross.toLocaleString()}) — ปิดกะยังไม่เสร็จ หรือมีช่องทางใหม่ที่ระบบยังไม่รู้จัก`;

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
    });
  }

  rows.sort((x, y) => x.date.localeCompare(y.date));
  return { rows, storeLabel, storeCode };
}
