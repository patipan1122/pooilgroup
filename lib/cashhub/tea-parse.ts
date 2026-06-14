// CashHub ร้านชาไข่มุก — แปลงไฟล์ Foodstory "รายงานปิดกะและปิดสิ้นวัน" (POS) → ยอดขายรายวัน
//
// ไฟล์ POS ของ Foodstory มีหัวกระจายหลายแถว (title / ช่วงวันที่ / หัวคอลัมน์ / ชื่อสาขา /
// แถวกะ / แถวสรุปรายวัน). 1 ไฟล์ = 1 สาขา. เราใช้แถว "สรุปของวันที่ DD-MM-2569" เป็น 1 วัน
// (พ.ศ. −543 = ค.ศ.) แล้วอ่านคอลัมน์ "ยอดขาย" (รวม VAT แล้ว) มาเทียบกับ iv_gross.
//
// ต่างจาก Amazon (amazon-parse.ts): ร้านชา = IV ถูกคีย์ไว้แล้ว → เราแค่ดึงยอด POS มา "เทียบ"
//   ไม่ต้องแยกช่องทางชำระ (c-vars) เพราะไม่ได้สร้าง IV. โครงไฟล์เหมือนกันเป๊ะ.
//
// หัวคอลัมน์ match ด้วย "ชื่อ" (ไม่ใช่ index) — กัน Foodstory สลับ/เพิ่มคอลัมน์.
// ⚠️ ไฟล์นี้ import ในฝั่ง client (tea-view) → ห้าม import tea-trcloud (มี crypto/process.env)
//    ให้ route ทำ validate สาขาด้วย teaBranchByCode เอง.

const GROSS_COL = "ยอดขาย";
const BILL_COL = "จำนวนบิล";

/**
 * คำหลักของแต่ละสาขา (ดึงจาก project ใน TRCloud — ส่วนหลัง "ปตท.") ไว้เดาว่าไฟล์เป็นสาขาไหน.
 * ถ้าเดาไม่ได้ ผู้ใช้เลือกเองจาก dropdown.
 */
export const TEA_POS_KEYWORDS: { code: string; keyword: string }[] = [
  { code: "OWLCHA-001", keyword: "โนนคอย" },
  { code: "OWLCHA-002", keyword: "ชุมพวง" },
  { code: "OWLCHA-003", keyword: "พิมาย" },
  { code: "OWLCHA-004", keyword: "ลำทะเมนชัย" },
  { code: "OWLCHA-005", keyword: "รังกาใหญ่" },
  { code: "MRWOOF-001", keyword: "โนนแดง" },
  { code: "SNOWDIP-002", keyword: "ตลาดแค" },
  { code: "SNOWDIP-001", keyword: "แคนดง" },
];

export type TeaPosRow = {
  date: string; // YYYY-MM-DD (Gregorian)
  gross: number; // ยอดขาย (รวม VAT)
  bills: number; // จำนวนบิล
};

export type TeaPosParseResult = {
  rows: TeaPosRow[];
  storeLabel: string | null; // ชื่อสาขาในไฟล์ เช่น "OWL CHA สาขา ปตท.พิมาย"
  storeCode: string | null; // เลขร้านใน Foodstory เช่น "5157"
  detectedBranchCode: string | null; // เดา branch_code จากคำหลัก (null = เดาไม่ได้ → ให้เลือกเอง)
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

/** เดา branch_code จากชื่อสาขาในไฟล์ (match คำหลักของสาขา) */
export function detectTeaBranch(storeLabel: string | null): string | null {
  if (!storeLabel) return null;
  for (const { code, keyword } of TEA_POS_KEYWORDS) {
    if (storeLabel.includes(keyword)) return code;
  }
  return null;
}

/**
 * แปลง matrix (xlsx/csv → array of arrays) → ยอดขายรายวัน.
 * @param matrix แถวเซลล์จาก XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })
 */
export function parseTeaPos(matrix: unknown[][]): TeaPosParseResult {
  const empty = { rows: [], storeLabel: null, storeCode: null, detectedBranchCode: null };
  if (!Array.isArray(matrix) || matrix.length === 0)
    return { ...empty, error: "ไฟล์ว่าง" };

  // หัวคอลัมน์ = แถวที่มีคำว่า "ยอดขาย"
  const headerRow = matrix.find(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() === GROSS_COL),
  );
  if (!headerRow)
    return {
      ...empty,
      error:
        "อ่านไฟล์ไม่ออก — ไม่พบหัวคอลัมน์ 'ยอดขาย' (ไฟล์อาจไม่ใช่รายงานปิดสิ้นวันของ Foodstory)",
    };
  const col: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const key = String(h ?? "").trim();
    if (key) col[key] = i;
  });
  if (col[GROSS_COL] == null)
    return { ...empty, error: "ไม่พบคอลัมน์ 'ยอดขาย'" };

  // ชื่อ/เลขสาขา — แถวที่ขึ้นต้นด้วย "<เลข>:<ชื่อสาขา>" (เช่น "5157:OWL CHA สาขา ปตท.พิมาย")
  let storeLabel: string | null = null;
  let storeCode: string | null = null;
  for (const r of matrix) {
    const a = String(r?.[0] ?? "");
    const m = a.match(/^\s*(\d{3,6})\s*:\s*(.+)$/);
    if (m) {
      storeCode = m[1];
      storeLabel = m[2].trim();
      break;
    }
  }

  // แถวสรุปรายวัน → 1 วัน
  const byDate = new Map<string, TeaPosRow>();
  for (const r of matrix) {
    if (!Array.isArray(r)) continue;
    const a = String(r[0] ?? "");
    const dm = a.match(/สรุปของวันที่\s*:?\s*(\d{2})-(\d{2})-(\d{4})/);
    if (!dm) continue;
    const [, dd, mm, by] = dm;
    const year = Number.parseInt(by, 10) - 543; // พ.ศ. → ค.ศ.
    if (year < 2020 || year > 2040) continue; // กัน parse เพี้ยน
    const date = `${year}-${mm}-${dd}`;
    const gross = round2(num(r[col[GROSS_COL]]));
    const bills = num(r[col[BILL_COL]] ?? 0);
    // กันไฟล์มีวันซ้ำ (ปกติไม่ควรมี) → บวกรวม
    const cur = byDate.get(date);
    if (cur) {
      cur.gross = round2(cur.gross + gross);
      cur.bills += bills;
    } else {
      byDate.set(date, { date, gross, bills });
    }
  }

  const rows = [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
  if (rows.length === 0)
    return {
      ...empty,
      storeLabel,
      storeCode,
      error: "ไม่พบแถวสรุปรายวัน ('สรุปของวันที่ …') ในไฟล์",
    };

  return {
    rows,
    storeLabel,
    storeCode,
    detectedBranchCode: detectTeaBranch(storeLabel),
  };
}
