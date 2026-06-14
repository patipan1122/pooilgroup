// CashHub ร้านชาไข่มุก — แปลงไฟล์ Foodstory "รายงานปิดกะและปิดสิ้นวัน" (POS) → ยอดขายรายวัน
//
// ⚠️ 1 ไฟล์ "มีได้หลายสาขา" (Foodstory export รวมหลายสาขาในไฟล์เดียว) → parse ทุก section
//   section เริ่มที่แถว "<เลขร้าน>:<ชื่อสาขา>" · แถว "สรุปของวันที่ DD-MM-2569" = 1 วันของ section นั้น.
//   พ.ศ.−543 = ค.ศ. · คอลัมน์ "ยอดขาย" = รวม VAT (เทียบ iv_gross).
//
// แยกยอดช่องทางชำระ: อ่านเฉพาะคอลัมน์ "ระหว่าง ยอดขาย ↔ รวมยอดชำระ" (กันชนคอลัมน์เงินทอน/นับเงิน)
//   แล้วจับเข้า bucket มาตรฐาน (cash/qr/card/grab/lineman/shopee/wallet/discount) ด้วย keyword.
//
// ⚠️ ไฟล์นี้ import ฝั่ง client (tea-view) → ห้าม import tea-trcloud (มี crypto/process.env).
//    route validate สาขาด้วย teaBranchByCode เอง.
import { classifyTeaChannel, classifyTeaPayment, type TeaChannelCode } from "./tea-channels";

const GROSS_COL = "ยอดขาย";
const CHECK_COL = "รวมยอดชำระ";
const BILL_COL = "จำนวนบิล";

/**
 * แปลงข้อความ CSV → matrix (array of arrays) เก็บค่าเป็น "ข้อความดิบ" ไม่แปลงชนิด
 * ⚠️ จำเป็นสำหรับรายงานแยกตามบิล: ถ้าให้ XLSX แปลง CSV จะตีความวันที่ DD/MM/YYYY ผิดเป็นแบบอเมริกา.
 */
export function csvToMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** คำหลักของแต่ละสาขา (จาก project TRCloud หลัง "ปตท.") ไว้เดาสาขาจากชื่อในไฟล์ */
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
  channels: Partial<Record<TeaChannelCode, number>>; // ยอดแยกช่องทาง (บาท)
};

export type TeaPosBranch = {
  storeCode: string | null; // เลขร้านใน Foodstory เช่น "5157"
  storeLabel: string | null; // ชื่อสาขาในไฟล์ เช่น "OWL CHA สาขา ปตท.พิมาย"
  detectedBranchCode: string | null; // เดา branch_code จากคำหลัก (null = เดาไม่ได้)
  rows: TeaPosRow[];
};

export type TeaPosParseResult = {
  branches: TeaPosBranch[];
  error?: string;
};

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** เดา branch_code จากชื่อสาขาในไฟล์ */
export function detectTeaBranch(storeLabel: string | null): string | null {
  if (!storeLabel) return null;
  for (const { code, keyword } of TEA_POS_KEYWORDS) {
    if (storeLabel.includes(keyword)) return code;
  }
  return null;
}

type ColMap = {
  grossIdx: number;
  billIdx: number;
  // คอลัมน์ช่องทางชำระ (อยู่ระหว่าง ยอดขาย ↔ รวมยอดชำระ) → channel bucket
  channelCols: { idx: number; code: TeaChannelCode }[];
};

/** อ่านหัวคอลัมน์ → ตำแหน่ง ยอดขาย/บิล + คอลัมน์ช่องทาง (เฉพาะช่วง ยอดขาย→รวมยอดชำระ) */
function readHeader(row: unknown[]): ColMap | null {
  const idxOf = (name: string) =>
    row.findIndex((c) => String(c ?? "").trim() === name);
  const grossIdx = idxOf(GROSS_COL);
  if (grossIdx < 0) return null;
  const checkIdx = idxOf(CHECK_COL);
  const billIdx = idxOf(BILL_COL);
  const channelCols: { idx: number; code: TeaChannelCode }[] = [];
  const end = checkIdx > grossIdx ? checkIdx : row.length;
  for (let i = grossIdx + 1; i < end; i++) {
    const code = classifyTeaChannel(String(row[i] ?? ""));
    if (code) channelCols.push({ idx: i, code });
  }
  return { grossIdx, billIdx, channelCols };
}

/**
 * จุดเข้าหลัก — auto-detect รูปแบบไฟล์ Foodstory แล้วแยกเป็นหลายสาขา.
 * รองรับ 2 รูปแบบ:
 *   1) "รายงานปิดกะและปิดสิ้นวัน" (EOD) — section <เลข>:<ชื่อ> + แถวสรุปรายวัน + คอลัมน์ช่องทาง
 *   2) "รายงานสรุปยอดขายแยกตามบิล" (รายบิล) — มีคอลัมน์ สาขา/วันที่ชำระเงิน/รวมสุทธิ/ประเภทการชำระเงิน
 */
export function parseTeaPos(matrix: unknown[][]): TeaPosParseResult {
  if (!Array.isArray(matrix) || matrix.length === 0)
    return { branches: [], error: "ไฟล์ว่าง" };
  if (isBillReport(matrix)) return parseBillReport(matrix);
  return parseEodReport(matrix);
}

/** ไฟล์เป็นรายงาน "แยกตามบิล" ไหม (มีหัวคอลัมน์ วันที่ชำระเงิน) */
function isBillReport(matrix: unknown[][]): boolean {
  return matrix
    .slice(0, 8)
    .some((r) => Array.isArray(r) && r.some((c) => String(c ?? "").includes("วันที่ชำระเงิน")));
}

/** parse รายงาน "แยกตามบิล" → รวมต่อ (สาขา, วัน) + แยกช่องทางจากประเภทการชำระเงิน */
function parseBillReport(matrix: unknown[][]): TeaPosParseResult {
  const hi = matrix.findIndex(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").includes("วันที่ชำระเงิน")),
  );
  const header = (matrix[hi] as unknown[]).map((h) => String(h ?? "").trim());
  const find = (pred: (h: string) => boolean) => header.findIndex(pred);
  const cDate = find((h) => h.includes("วันที่ชำระเงิน"));
  const cNet = find((h) => h.startsWith("รวมสุทธิ"));
  const cPay = find((h) => h === "ประเภทการชำระเงิน");
  const cBranch = find((h) => h === "สาขา");
  if (cDate < 0 || cNet < 0 || cBranch < 0)
    return {
      branches: [],
      error: "รายงานแยกตามบิล: ไม่พบคอลัมน์ที่ต้องการ (วันที่ชำระเงิน / รวมสุทธิ / สาขา)",
    };

  const bag = new Map<string, { storeLabel: string; byDate: Map<string, TeaPosRow> }>();
  for (let i = hi + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!Array.isArray(r)) continue;
    const br = String(r[cBranch] ?? "").trim();
    if (!br) continue; // ข้ามแถว Total (สาขาว่าง)
    const dm = String(r[cDate] ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!dm) continue; // วันที่ = DD/MM/YYYY (ไทย day-first)
    const date = `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    const net = round2(num(r[cNet]));
    const code = cPay >= 0 ? classifyTeaPayment(String(r[cPay] ?? "")) : "qr";
    let b = bag.get(br);
    if (!b) {
      b = { storeLabel: br, byDate: new Map() };
      bag.set(br, b);
    }
    let d = b.byDate.get(date);
    if (!d) {
      d = { date, gross: 0, bills: 0, channels: {} };
      b.byDate.set(date, d);
    }
    d.gross = round2(d.gross + net);
    d.bills += 1;
    d.channels[code] = round2((d.channels[code] ?? 0) + net);
  }

  const branches: TeaPosBranch[] = [...bag.values()].map((b) => ({
    storeCode: null,
    storeLabel: b.storeLabel,
    detectedBranchCode: detectTeaBranch(b.storeLabel),
    rows: [...b.byDate.values()].sort((a, z) => a.date.localeCompare(z.date)),
  }));
  if (branches.length === 0)
    return { branches: [], error: "รายงานแยกตามบิล: ไม่พบข้อมูลสาขา/ยอดขาย" };
  return { branches };
}

/** parse รายงาน "ปิดกะและปิดสิ้นวัน" (EOD) */
function parseEodReport(matrix: unknown[][]): TeaPosParseResult {
  if (!Array.isArray(matrix) || matrix.length === 0)
    return { branches: [], error: "ไฟล์ว่าง" };

  let col: ColMap | null = null;
  const branches: TeaPosBranch[] = [];
  let cur: TeaPosBranch | null = null;
  let curByDate: Map<string, TeaPosRow> | null = null;

  const flush = () => {
    if (cur && curByDate) {
      cur.rows = [...curByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (cur.rows.length > 0 || cur.storeCode) branches.push(cur);
    }
  };

  for (const r of matrix) {
    if (!Array.isArray(r)) continue;
    const a = String(r[0] ?? "");

    // หัวคอลัมน์ (อาจซ้ำต่อสาขา) → อัปเดต mapping
    if (r.some((c) => String(c ?? "").trim() === GROSS_COL)) {
      const m = readHeader(r);
      if (m) col = m;
      continue;
    }

    // เริ่ม section สาขาใหม่
    const sm = a.match(/^\s*(\d{3,6})\s*:\s*(.+)$/);
    if (sm) {
      flush();
      const storeLabel = sm[2].trim();
      cur = {
        storeCode: sm[1],
        storeLabel,
        detectedBranchCode: detectTeaBranch(storeLabel),
        rows: [],
      };
      curByDate = new Map();
      continue;
    }

    // แถวสรุปรายวัน
    const dm = a.match(/สรุปของวันที่\s*:?\s*(\d{2})-(\d{2})-(\d{4})/);
    if (dm && col && cur && curByDate) {
      const [, dd, mm, by] = dm;
      const year = Number.parseInt(by, 10) - 543;
      if (year < 2020 || year > 2040) continue;
      const date = `${year}-${mm}-${dd}`;
      const gross = round2(num(r[col.grossIdx]));
      const bills = num(col.billIdx >= 0 ? r[col.billIdx] : 0);
      const channels: Partial<Record<TeaChannelCode, number>> = {};
      for (const { idx, code } of col.channelCols) {
        const amt = round2(num(r[idx]));
        if (amt) channels[code] = round2((channels[code] ?? 0) + amt);
      }
      const existing = curByDate.get(date);
      if (existing) {
        existing.gross = round2(existing.gross + gross);
        existing.bills += bills;
        for (const k of Object.keys(channels) as TeaChannelCode[])
          existing.channels[k] = round2((existing.channels[k] ?? 0) + (channels[k] ?? 0));
      } else {
        curByDate.set(date, { date, gross, bills, channels });
      }
    }
  }
  flush();

  if (!col)
    return {
      branches: [],
      error:
        "อ่านไฟล์ไม่ออก — ไม่พบหัวคอลัมน์ 'ยอดขาย' (ไฟล์อาจไม่ใช่รายงานปิดสิ้นวันของ Foodstory)",
    };
  if (branches.length === 0)
    return { branches: [], error: "ไม่พบข้อมูลสาขา/ยอดขายรายวันในไฟล์" };

  return { branches };
}
