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
import { classifyTeaChannel, classifyTeaPayment, TEA_CHANNEL_BY_CODE, type TeaChannelCode } from "./tea-channels";

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
  // รายบิล (เฉพาะรายงาน "แยกตามบิล" — ไว้ทำหน้าไส้ใน) — undefined = ไม่มี (มาจากรายงาน EOD)
  transactions?: { channel: TeaChannelCode; amount: number }[];
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
  warning?: string; // เช่น มีบางบรรทัดอ่านวันที่ไม่ได้ → เตือนผู้ใช้ (ไม่ block)
  // ชนิดรายงาน Foodstory ที่ตรวจพบ — ใช้เตือน UI:
  //   summary = "สรุปยอดขายแยกตามบิล" (รวมสุทธิ = ยอดบิลจริง · ตรง TRCloud) ✅
  //   detail  = "ยอดขายแยกตามรายละเอียดบิล" (ราคาสุทธิ = รวมรายเมนู · อาจคลาดเคลื่อน) ⚠️
  //   eod     = "ปิดกะ/ปิดสิ้นวัน" (ยอดรวมวัน · ตรง)
  reportType?: "summary" | "detail" | "eod";
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

/**
 * normalize หัวคอลัมน์: ลบ NBSP/zero-width (Foodstory บางทีแทรกอักขระล่องหน) +
 * ยุบช่องว่างซ้ำ + ตัดหัวท้าย → กันชื่อคอลัมน์ "ดูเหมือนตรง" แต่ match ไม่ติดเพราะมีช่องว่างแปลก.
 */
function normHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF\u3000]/g, " ") // NBSP/zero-width/BOM/full-width -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** ไฟล์เป็นรายงาน "แยกตามบิล" ไหม (มีหัวคอลัมน์ วันที่ชำระเงิน) — สแกน 15 แถวแรกเผื่อมีหัวเรื่องยาว */
function isBillReport(matrix: unknown[][]): boolean {
  return matrix
    .slice(0, 15)
    .some((r) => Array.isArray(r) && r.some((c) => normHeader(c).includes("วันที่ชำระเงิน")));
}

/** Excel serial number → YYYY-MM-DD (epoch 1899-12-30) */
function excelSerialToISO(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null; // กรอบ ~1954–2089 กันค่าเพี้ยน
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * ตรวจว่าไฟล์ใช้วันที่แบบ วัน/เดือน (dmy) หรือ เดือน/วัน (mdy) — กัน XLSX อ่าน DD/MM/YYYY เพี้ยนเป็น US.
 * สแกนทุกวัน: ถ้ามีตัวแรก > 12 = วันต้องมาก่อน (dmy) · ถ้าตัวแรก ≤12 แต่ตัวสอง > 12 = (mdy) · ไม่งั้น default dmy (ไทย).
 */
function detectSlashOrder(matrix: unknown[][], cDate: number, start: number): "dmy" | "mdy" {
  let mdy = false;
  for (let i = start; i < matrix.length; i++) {
    const r = matrix[i];
    if (!Array.isArray(r)) continue;
    const m = String(r[cDate] ?? "").match(/^(\d{1,2})\/(\d{1,2})\//);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) return "dmy"; // ตัวแรกเป็นวันแน่นอน
    if (b > 12) mdy = true; // ตัวสองเป็นวัน → เดือนมาก่อน
  }
  return mdy ? "mdy" : "dmy";
}

/** parse วันที่ 1 ค่า → YYYY-MM-DD (รองรับ DD/MM, MM/DD, ISO, Excel serial) */
function parseBillCellDate(raw: string, order: "dmy" | "mdy"): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    const day = order === "dmy" ? slash[1] : slash[2];
    const mon = order === "dmy" ? slash[2] : slash[1];
    let year = slash[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${mon.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s)); // Excel date serial
  return null;
}

/** parse รายงาน "แยกตามบิล" → รวมต่อ (สาขา, วัน) + แยกช่องทางจากประเภทการชำระเงิน */
function parseBillReport(matrix: unknown[][]): TeaPosParseResult {
  const hi = matrix.findIndex(
    (r) => Array.isArray(r) && r.some((c) => normHeader(c).includes("วันที่ชำระเงิน")),
  );
  if (hi < 0)
    return { branches: [], error: 'รายงานแยกตามบิล: ไม่พบแถวหัวตาราง "วันที่ชำระเงิน"' };
  const header = (matrix[hi] as unknown[]).map(normHeader);
  // หาคอลัมน์แบบ "ใจกว้าง" ตามลำดับความเฉพาะเจาะจง — เจอตัวแรกที่เข้าเงื่อนไขก็ใช้เลย
  // กัน Foodstory เปลี่ยนชื่อรายงาน: "ราคาสุทธิ"(รายละเอียดบิล) vs "รวมสุทธิ"(สรุปต่อบิล) · "ชื่อสาขา" vs "สาขา"
  const findCol = (...preds: ((h: string) => boolean)[]) => {
    for (const p of preds) {
      const i = header.findIndex(p);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cDate = findCol(
    (h) => h.includes("วันที่ชำระเงิน"),
    (h) => h.startsWith("วันที่"),
  );
  const cNet = findCol(
    (h) => h.startsWith("รวมสุทธิ") || h.startsWith("ราคาสุทธิ"),
    (h) => h === "สุทธิ",
    (h) => h.includes("สุทธิ") && !h.includes("ภาษี") && !h.includes("ก่อน"),
  );
  const cPay = findCol(
    (h) => h === "ประเภทการชำระเงิน",
    (h) => h.includes("ประเภทการชำระ"),
    (h) => h.includes("ช่องทางการชำระ"),
  );
  const cBranch = findCol(
    (h) => h === "สาขา" || h === "ชื่อสาขา",
    (h) => h.endsWith("สาขา") && !h.startsWith("รหัส"),
  );
  // "ช่องทาง" (หน้าร้าน/Online Order) — คนละคอลัมน์กับ "ช่องทางการชำระ" (cPay ด้านบน) ห้ามชนกัน
  const cChannel = findCol((h) => h === "ช่องทาง" || (h.includes("ช่องทาง") && !h.includes("การชำระ")));
  if (cDate < 0 || cNet < 0 || cBranch < 0) {
    const miss = [
      cDate < 0 ? "วันที่ชำระเงิน" : null,
      cNet < 0 ? "ยอดสุทธิ (รวมสุทธิ/ราคาสุทธิ)" : null,
      cBranch < 0 ? "สาขา" : null,
    ].filter(Boolean) as string[];
    return {
      branches: [],
      error: `รายงานแยกตามบิล: ไม่พบคอลัมน์ ${miss.join(" · ")} — กรุณาเลือกรายงาน "ยอดขายแยกตามรายละเอียดบิล" หรือ "สรุปยอดขายแยกตามบิล" จาก Foodstory`,
    };
  }

  // "รวมสุทธิ" = ยอดบิลจริง (สรุปต่อบิล · ตรง TRCloud) · "ราคาสุทธิ" = รวมรายเมนู (รายละเอียดบิล · อาจคลาดเคลื่อน)
  const reportType: "summary" | "detail" = header[cNet].startsWith("ราคาสุทธิ")
    ? "detail"
    : "summary";

  const order = detectSlashOrder(matrix, cDate, hi + 1);
  const bag = new Map<string, { storeLabel: string; byDate: Map<string, TeaPosRow> }>();
  let dropped = 0; // บรรทัดที่มีสาขา+ยอด แต่อ่านวันที่ไม่ได้
  for (let i = hi + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!Array.isArray(r)) continue;
    const br = String(r[cBranch] ?? "").trim();
    if (!br) continue; // ข้ามแถว Total (สาขาว่าง)
    const date = parseBillCellDate(String(r[cDate] ?? ""), order);
    const net = round2(num(r[cNet]));
    if (!date) {
      if (net > 0) dropped++; // มียอดแต่วันที่อ่านไม่ได้ → นับไว้เตือน
      continue;
    }
    // บิลออนไลน์ (คอลัมน์ "ช่องทาง" = Online Order) → เข้าถัง "online" เสมอ ไม่ว่าบันทึกวิธีชำระเป็นอะไร
    // (เงินออนไลน์เข้าแยกยอด/รอบต่างหาก — เช็คก่อนเสมอ แล้วค่อย fallback ไปดูประเภทการชำระตามปกติ)
    const channelCell = cChannel >= 0 ? String(r[cChannel] ?? "").trim().toLowerCase() : "";
    const isOnline = channelCell && TEA_CHANNEL_BY_CODE.online.match.some((m) => channelCell.includes(m));
    const code = isOnline ? "online" : cPay >= 0 ? classifyTeaPayment(String(r[cPay] ?? "")) : "other";
    let b = bag.get(br);
    if (!b) {
      b = { storeLabel: br, byDate: new Map() };
      bag.set(br, b);
    }
    let d = b.byDate.get(date);
    if (!d) {
      d = { date, gross: 0, bills: 0, channels: {}, transactions: [] };
      b.byDate.set(date, d);
    }
    d.gross = round2(d.gross + net);
    d.bills += 1;
    d.channels[code] = round2((d.channels[code] ?? 0) + net);
    d.transactions!.push({ channel: code, amount: net });
  }

  const branches: TeaPosBranch[] = [...bag.values()].map((b) => ({
    storeCode: null,
    storeLabel: b.storeLabel,
    detectedBranchCode: detectTeaBranch(b.storeLabel),
    rows: [...b.byDate.values()].sort((a, z) => a.date.localeCompare(z.date)),
  }));
  if (branches.length === 0)
    return { branches: [], error: "รายงานแยกตามบิล: ไม่พบข้อมูลสาขา/ยอดขาย (อ่านวันที่ไม่ได้?)" };
  const warning =
    dropped > 0
      ? `มี ${dropped} บิลที่อ่านวันที่ไม่ได้ → ไม่ถูกนำเข้า (แนะนำอัปเป็นไฟล์ .csv จะแม่นกว่า)`
      : undefined;
  return { branches, warning, reportType };
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
