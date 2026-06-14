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
import { classifyTeaChannel, type TeaChannelCode } from "./tea-channels";

const GROSS_COL = "ยอดขาย";
const CHECK_COL = "รวมยอดชำระ";
const BILL_COL = "จำนวนบิล";

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
 * แปลง matrix (xlsx/csv → array of arrays) → หลายสาขา.
 * @param matrix แถวเซลล์จาก XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })
 */
export function parseTeaPos(matrix: unknown[][]): TeaPosParseResult {
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
