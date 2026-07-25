import "server-only";
import { post, asObj, pick, isSuccess, errMsg } from "@/lib/ledger/trcloud-push";
import { accountName, SYSTEM_ACCOUNTS } from "@/lib/ledger/coa-chart";

// LedgerLine · อ่าน "ไส้ใน" ของ PO/AP หนึ่งใบสด ๆ จาก TRCloud (อ่านอย่างเดียว · on-demand ตอนคลิก).
//   - รายการสินค้า (line items) จาก ap/read.php | po/read.php (body[])
//   - การลงบัญชีจริง (Dr/Cr) จาก gl/search.php → gl/read.php (AP เท่านั้น · PO ยังไม่ลงบัญชี)
//   - flag ใบที่ถูกลง "5919999 รายจ่ายยังไม่ได้แยกประเภท" (ปัญหาที่ CEO อยากจับให้เจอ)
//
// TRCloud shape (ยืนยัน live-probe 2026-07-25):
//   ap/read.php {id}  → { head:{...}, body:[{product_id,description,price,quantity,vat,before_vat,total,acc_code}], ... }
//   gl/search.php {keyword:ref_no} → { result:[{transaction_id,ref_no,engine_reference,formula,...}] }
//   gl/read.php {id:transaction_id} → { head, body:[{acc_code,debit,credit}] }
// เชื่อม AP → journal ด้วย ref_no (เช่น "JPS_AP2607250004") หรือ engine_reference == expense_id.

const UNCLASSIFIED = SYSTEM_ACCOUNTS.fallback.code; // "5919999"

// ── defensive helpers (รับ unknown จาก TRCloud) ──────────────────────────────
type Json = Record<string, unknown>;

function asArr(v: unknown): Json[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : [];
}
function num(o: Json | null, ...keys: string[]): number | null {
  const s = pick(o, ...keys);
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function isoDate(s: string | null): string | null {
  if (!s || s.startsWith("0000")) return null;
  return s.includes(" ") ? s.split(" ")[0] : s;
}

// ── public types ─────────────────────────────────────────────────────────────
export type TrcloudDocLine = {
  productCode: string | null;
  description: string | null;
  quantity: number | null;
  price: number | null;
  beforeVat: number | null;
  vat: number | null;
  total: number | null;
};

export type TrcloudJournalLine = {
  accCode: string;
  accName: string | null; // ชื่อบัญชี (ถ้ารู้จักในผังบัญชีเรา)
  debit: number;
  credit: number;
  unclassified: boolean; // Dr 5919999
};

export type TrcloudDocDetailHeader = {
  docNumber: string | null;
  refNo: string | null;
  reference: string | null;
  vendor: string | null;
  issueDate: string | null;
  total: number | null;
  grandTotal: number | null;
  tax: number | null;
  wht: number | null;
  discount: number | null;
  department: string | null;
  project: string | null;
  status: string | null;
  formulaType: string | null; // head.type — สูตรลงบัญชี (LL / Credit[AP] / Cash[AP] ...)
  pdfUrl: string | null;
};

export type TrcloudDocDetail = {
  ok: boolean;
  kind: "PO" | "AP";
  header: TrcloudDocDetailHeader | null;
  lines: TrcloudDocLine[];
  journal: TrcloudJournalLine[]; // AP เท่านั้น (PO ว่าง)
  hasUnclassified: boolean;       // มี Dr 5919999 ไหม
  journalNote: string | null;     // เหตุผลถ้า journal ว่าง (PO / ยังไม่ลง / อ่านไม่ได้)
  error: string | null;
};

// ── mappers ──────────────────────────────────────────────────────────────────
function mapLine(o: Json): TrcloudDocLine {
  return {
    productCode: pick(o, "product_id", "product_code"),
    description: pick(o, "description", "product_name", "name"),
    quantity: num(o, "quantity"),
    price: num(o, "price"),
    beforeVat: num(o, "before_vat"),
    vat: num(o, "vat"),
    total: num(o, "total", "amount"),
  };
}

function mapHeader(head: Json | null): TrcloudDocDetailHeader | null {
  if (!head) return null;
  return {
    docNumber: pick(head, "invoice_number", "document_number", "no"),
    refNo: pick(head, "ref_no"),
    reference: pick(head, "reference"),
    vendor: pick(head, "name", "organization"),
    issueDate: isoDate(pick(head, "issue_date", "doc_date", "date")),
    total: num(head, "total"),
    grandTotal: num(head, "grand_total", "grandtotal"),
    tax: num(head, "tax"),
    wht: num(head, "wht", "wht_amount"),
    discount: num(head, "discount"),
    department: pick(head, "department"),
    project: pick(head, "project"),
    status: pick(head, "status"),
    formulaType: pick(head, "type"),
    pdfUrl: pick(head, "url"),
  };
}

function mapJournalLine(o: Json): TrcloudJournalLine | null {
  const accCode = pick(o, "acc_code", "account_code", "account");
  if (!accCode) return null;
  const debit = num(o, "debit", "dr") ?? 0;
  const credit = num(o, "credit", "cr") ?? 0;
  if (debit === 0 && credit === 0) return null; // แถวว่าง
  return {
    accCode,
    accName: accountName(accCode),
    debit,
    credit,
    unclassified: accCode === UNCLASSIFIED && debit > 0,
  };
}

// ── อ่าน journal จริงของ AP (best-effort · ไม่ throw) ─────────────────────────
async function readApJournal(
  refNo: string | null,
  expenseId: string,
): Promise<{ journal: TrcloudJournalLine[]; note: string | null }> {
  const key = refNo || expenseId;
  const g = await post("gl/search.php", { keyword: key, limit: "10" });
  if (!isSuccess(g.data)) return { journal: [], note: "อ่านการลงบัญชีจาก TRCloud ไม่ได้ชั่วคราว" };
  const txs = asArr(g.data?.result);
  const tx =
    (refNo ? txs.find((t) => pick(t, "ref_no") === refNo) : null) ??
    txs.find((t) => pick(t, "engine_reference") === expenseId) ??
    null;
  if (!tx) return { journal: [], note: "ยังไม่พบรายการลงบัญชีของใบนี้ใน TRCloud" };
  const txId = pick(tx, "transaction_id", "id");
  if (!txId) return { journal: [], note: "ยังไม่พบรายการลงบัญชีของใบนี้ใน TRCloud" };
  const gr = await post("gl/read.php", { id: txId, transaction_id: txId });
  if (!isSuccess(gr.data)) return { journal: [], note: "อ่านการลงบัญชีจาก TRCloud ไม่ได้ชั่วคราว" };
  const journal = asArr(gr.data?.body)
    .map(mapJournalLine)
    .filter((j): j is TrcloudJournalLine => j != null);
  if (!journal.length) return { journal: [], note: "TRCloud ยังไม่ได้ลงบัญชีใบนี้" };
  return { journal, note: null };
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function readTrcloudDocDetail(
  kind: "PO" | "AP",
  trcloudId: string,
  refNo?: string | null,
): Promise<TrcloudDocDetail> {
  const empty: TrcloudDocDetail = {
    ok: false, kind, header: null, lines: [], journal: [],
    hasUnclassified: false, journalNote: null, error: null,
  };
  if (!trcloudId) return { ...empty, error: "ไม่มีเลขอ้างอิงเอกสาร" };

  const readPath = kind === "PO" ? "po/read.php" : "ap/read.php";
  const idPayload =
    kind === "PO"
      ? { id: trcloudId, po_id: trcloudId }
      : { id: trcloudId, expense_id: trcloudId };

  // อ่านตัวใบ + (ถ้า AP) เริ่ม gl/search ขนานกันด้วย ref_no ที่ส่งมาจากตาราง (snapshot มี ref_no แล้ว)
  const [readRes, journalRes] = await Promise.all([
    post(readPath, idPayload),
    kind === "AP" && refNo ? readApJournal(refNo, trcloudId) : Promise.resolve(null),
  ]);

  if (!isSuccess(readRes.data)) {
    return { ...empty, error: `อ่านใบจาก TRCloud ไม่สำเร็จ: ${errMsg(readRes)}` };
  }
  const head = asObj(readRes.data?.head) ?? asObj(readRes.data?.data) ?? null;
  const header = mapHeader(head);
  const lines = asArr(readRes.data?.body).map(mapLine);

  // journal: ใช้ผลที่ยิงขนานไว้ ถ้ายังไม่มี refNo ให้ลองอีกทีด้วย head.ref_no
  let journal: TrcloudJournalLine[] = [];
  let journalNote: string | null = null;
  if (kind === "PO") {
    journalNote = "ใบสั่งซื้อ (PO) ยังไม่ลงบัญชี — จะลงเมื่อแปลงเป็น AP";
  } else if (journalRes) {
    journal = journalRes.journal;
    journalNote = journalRes.note;
  } else {
    // ไม่มี refNo ตอนแรก → ลองด้วย ref_no จากหัวใบ
    const r2 = await readApJournal(header?.refNo ?? null, trcloudId);
    journal = r2.journal;
    journalNote = r2.note;
  }

  const hasUnclassified = journal.some((j) => j.unclassified);
  return { ok: true, kind, header, lines, journal, hasUnclassified, journalNote, error: null };
}
