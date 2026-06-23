import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// FuelOS · ยอดขาย/ลูกหนี้ — PULL ใบกำกับภาษีจาก TRCloud บริษัท 44 (ขายส่งน้ำมันทั้งหมด)
// แยกขาดจากบัญชี/ledger: env namespaced FUELOS_TRCLOUD_SALES_* · บริษัท 44 (ไม่ใช่ 31/45)
// auth: securekey = md5(encrypt_head + "t" + unixTime) — เหมือน connector ตัวอื่น
const BASE         = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN       = process.env.FUELOS_TRCLOUD_SALES_ORIGIN ?? process.env.TRCLOUD_ORIGIN ?? "https://pooil.trcloud.co";
const COMPANY_ID   = process.env.FUELOS_TRCLOUD_SALES_COMPANY_ID ?? "";
const PASSKEY      = process.env.FUELOS_TRCLOUD_SALES_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.FUELOS_TRCLOUD_SALES_ENCRYPT_HEAD ?? "";

export function salesSyncConfigured(): boolean {
  return !!(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

function authFields() {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = new URLSearchParams({ json: JSON.stringify({ ...authFields(), ...body }) });
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: payload.toString(),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`TRCloud ${path} HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { throw new Error(`TRCloud ${path} non-JSON: ${text.slice(0, 200)}`); }
}

// แต่ละแถวจาก iv/search.php (เก็บเฉพาะที่ใช้ · ที่เหลือเก็บใน raw_json)
type RawIv = Record<string, unknown>;

function str(o: RawIv, key: string): string | null {
  const v = o[key];
  return v == null ? null : String(v);
}
function num(o: RawIv, key: string): number {
  const v = o[key];
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

// วันที่ TRCloud "2026-06-23" → Date · กัน "0000-00-00"/ว่าง → null
function parseDate(raw: string | null): Date | null {
  if (!raw || /^0000/.test(raw)) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  const p = raw.split("/"); // เผื่อ DD/MM/YYYY
  if (p.length === 3) {
    const [d, mo, y] = p.map(Number);
    if (y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00Z`);
  }
  return null;
}
function parseDateTime(raw: string | null): Date | null {
  if (!raw || /^0000/.test(raw)) return null;
  const d = new Date(raw.replace(" ", "T") + (/[zZ]|[+\-]\d\d:?\d\d$/.test(raw) ? "" : "Z"));
  return isNaN(d.getTime()) ? null : d;
}

// สรุปสถานะจ่าย จากยอดจริง (แม่นกว่าสถานะ string) + ใช้ status เป็นตัวช่วยตอนเต็มจำนวน
function derivePaymentState(grand: number, paid: number, status: string | null): "PAID" | "PARTIAL" | "UNPAID" {
  const s = (status ?? "").toLowerCase();
  const looksPaid = /paid|ชำระแล้ว|complete|done|รับชำระ/.test(s) && !/debtor|partial|ค้าง/.test(s);
  if (grand > 0 && paid >= grand - 0.01) return "PAID";
  if (paid <= 0.01) return looksPaid && grand > 0 ? "PAID" : "UNPAID";
  return "PARTIAL";
}

export interface NormalizedIv {
  trcloudInvoiceId: string;
  companyFormat: string | null;
  invoiceNumber: string;
  docNo: string;
  contactId: string | null;
  customerName: string;
  customerOrg: string | null;
  customerBranch: string | null;
  customerTaxId: string | null;
  issueDate: Date;
  dueDate: Date | null;
  netTotal: number;
  vatTotal: number;
  grandTotal: number;
  paidAmount: number;
  outstanding: number;
  trcloudStatus: string | null;
  paymentState: "PAID" | "PARTIAL" | "UNPAID";
  salesman: string | null;
  department: string | null;
  project: string | null;
  docType: string | null;
  quantity: number;
  issuedAt: Date | null;
  raw: RawIv;
}

function normalizeIv(o: RawIv): NormalizedIv | null {
  const trcloudInvoiceId = str(o, "invoice_id") ?? str(o, "id");
  const invoiceNumber = str(o, "invoice_number") ?? str(o, "document_number") ?? "";
  const issueDate = parseDate(str(o, "issue_date") ?? str(o, "tax_date"));
  if (!trcloudInvoiceId || !issueDate) return null; // ใบไม่สมบูรณ์ → ข้าม

  const companyFormat = str(o, "company_format");
  const grandTotal = round2(num(o, "grand_total"));
  const paidAmount = round2(Math.min(num(o, "payment"), grandTotal)); // กันจ่ายเกินยอด
  const outstanding = round2(Math.max(grandTotal - paidAmount, 0));
  const trcloudStatus = str(o, "status");

  return {
    trcloudInvoiceId,
    companyFormat,
    invoiceNumber,
    docNo: companyFormat ? `${companyFormat}${invoiceNumber}` : invoiceNumber,
    contactId: str(o, "contact_id"),
    customerName: str(o, "name") ?? "(ไม่ระบุชื่อ)",
    customerOrg: str(o, "organization"),
    customerBranch: str(o, "branch"),
    customerTaxId: str(o, "tax_id"),
    issueDate,
    dueDate: parseDate(str(o, "due_date")),
    netTotal: round2(num(o, "total")),
    vatTotal: round2(num(o, "tax")),
    grandTotal,
    paidAmount,
    outstanding,
    trcloudStatus,
    paymentState: derivePaymentState(grandTotal, paidAmount, trcloudStatus),
    salesman: str(o, "salesman"),
    department: str(o, "department"),
    project: str(o, "project"),
    docType: str(o, "doc_type"),
    quantity: num(o, "sum_quantity"),
    issuedAt: parseDateTime(str(o, "create_dt")),
    raw: o,
  };
}

export interface SalesSyncResult { ok: boolean; synced: number; error?: string; days: number }

// dayKey = YYMMDD — เลขใบ TRCloud ขึ้นต้นด้วยรูปนี้ (2026-06-23 → "260623")
function dayKey(d: Date): string {
  const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

// ดึงใบของ "วันเดียว" (day = YYMMDD)
// ⚠️ TRCloud iv/search: page/limit/offset/date_from ถูกเมินหมด · คืน ≤100 ใบเสมอ (เพดานแข็ง)
// ใช้ได้แค่ keyword(ค้นเลขใบ) + status → ไล่ทีละวัน + แยก Debtor/Paid (กันเพดาน 100 ต่อสถานะ)
// keyword เป็น text-search กว้าง → เก็บเฉพาะใบที่เลขขึ้นต้น day จริง (กัน match field อื่น)
async function fetchDayIvs(day: string, statuses: string[] = ["Debtor", "Paid"]): Promise<NormalizedIv[]> {
  const seen = new Map<string, NormalizedIv>();
  for (const status of statuses) {
    const data = await post("iv/search.php", { keyword: day, status, limit: 100 });
    const list = (Array.isArray(data.data) ? data.data
      : Array.isArray(data.list) ? data.list
      : Array.isArray(data.result) ? data.result
      : []) as RawIv[];
    for (const row of list) {
      const iv = normalizeIv(row);
      if (!iv || !iv.invoiceNumber.startsWith(day)) continue;
      seen.set(iv.trcloudInvoiceId, iv);
    }
  }
  return [...seen.values()];
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function ivPayload(iv: NormalizedIv) {
  return {
    trcloud_invoice_id: iv.trcloudInvoiceId, company_format: iv.companyFormat, invoice_number: iv.invoiceNumber,
    doc_no: iv.docNo, contact_id: iv.contactId, customer_name: iv.customerName, customer_org: iv.customerOrg,
    customer_branch: iv.customerBranch, customer_tax_id: iv.customerTaxId,
    issue_date: isoDate(iv.issueDate), due_date: isoDate(iv.dueDate),
    net_total: iv.netTotal, vat_total: iv.vatTotal, grand_total: iv.grandTotal,
    paid_amount: iv.paidAmount, outstanding: iv.outstanding,
    trcloud_status: iv.trcloudStatus, payment_state: iv.paymentState,
    salesman: iv.salesman, department: iv.department, project: iv.project,
    doc_type: iv.docType, quantity: iv.quantity, issued_at: iv.issuedAt ? iv.issuedAt.toISOString() : null,
    raw_json: iv.raw,
  };
}

// upsert หลายใบในคำสั่งเดียว (jsonb) — เร็วกว่ายิงทีละใบมาก กัน timeout ตอนกด "ดึงข้อมูล"
async function bulkUpsertIvs(orgId: string, ivs: NormalizedIv[]): Promise<void> {
  if (ivs.length === 0) return;
  const payload = JSON.stringify(ivs.map(ivPayload));
  await prisma.$executeRaw`
    INSERT INTO fuel.sales_invoices (
      org_id, trcloud_invoice_id, company_format, invoice_number, doc_no, contact_id,
      customer_name, customer_org, customer_branch, customer_tax_id, issue_date, due_date,
      net_total, vat_total, grand_total, paid_amount, outstanding, trcloud_status, payment_state,
      salesman, department, project, doc_type, quantity, issued_at, raw_json, synced_at)
    SELECT ${orgId}::uuid, x.trcloud_invoice_id, x.company_format, x.invoice_number, x.doc_no, x.contact_id,
      x.customer_name, x.customer_org, x.customer_branch, x.customer_tax_id, x.issue_date, x.due_date,
      x.net_total, x.vat_total, x.grand_total, x.paid_amount, x.outstanding, x.trcloud_status, x.payment_state,
      x.salesman, x.department, x.project, x.doc_type, x.quantity, x.issued_at, x.raw_json, now()
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(
      trcloud_invoice_id text, company_format text, invoice_number text, doc_no text, contact_id text,
      customer_name text, customer_org text, customer_branch text, customer_tax_id text, issue_date date, due_date date,
      net_total numeric, vat_total numeric, grand_total numeric, paid_amount numeric, outstanding numeric,
      trcloud_status text, payment_state text, salesman text, department text, project text, doc_type text,
      quantity numeric, issued_at timestamptz, raw_json jsonb)
    ON CONFLICT (org_id, trcloud_invoice_id) DO UPDATE SET
      company_format=EXCLUDED.company_format, invoice_number=EXCLUDED.invoice_number, doc_no=EXCLUDED.doc_no,
      contact_id=EXCLUDED.contact_id, customer_name=EXCLUDED.customer_name, customer_org=EXCLUDED.customer_org,
      customer_branch=EXCLUDED.customer_branch, customer_tax_id=EXCLUDED.customer_tax_id,
      issue_date=EXCLUDED.issue_date, due_date=EXCLUDED.due_date, net_total=EXCLUDED.net_total,
      vat_total=EXCLUDED.vat_total, grand_total=EXCLUDED.grand_total, paid_amount=EXCLUDED.paid_amount,
      outstanding=EXCLUDED.outstanding, trcloud_status=EXCLUDED.trcloud_status, payment_state=EXCLUDED.payment_state,
      salesman=EXCLUDED.salesman, department=EXCLUDED.department, project=EXCLUDED.project, doc_type=EXCLUDED.doc_type,
      quantity=EXCLUDED.quantity, issued_at=EXCLUDED.issued_at, raw_json=EXCLUDED.raw_json, synced_at=now(), updated_at=now()`;
}

// ดึงใบเสร็จ (RV) ที่ "ออกในวันนั้น" → คืน [เลขใบที่จ่าย (reference=IV docNo), วันจ่าย]
// ใช้เติม paid_date ให้ใบกำกับภาษี ("จ่ายวันไหน") · RV ออกวันไหนก็ได้หลังออกบิล
async function fetchDayRvs(day: string): Promise<Array<{ reference: string; date: Date }>> {
  const out: Array<{ reference: string; date: Date }> = [];
  const data = await post("rv/search.php", { keyword: day, limit: 100 });
  const list = (Array.isArray(data.data) ? data.data
    : Array.isArray(data.list) ? data.list
    : Array.isArray(data.result) ? data.result
    : []) as RawIv[];
  for (const row of list) {
    const docNum = str(row, "document_number") ?? "";
    if (!docNum.startsWith(day)) continue; // ใบเสร็จที่ออกวันนี้จริง (กัน keyword match field อื่น)
    const reference = str(row, "reference"); // = doc_no ของใบกำกับที่จ่าย
    const date = parseDate(str(row, "issue_date") ?? str(row, "complete_date"));
    if (reference && date) out.push({ reference, date });
  }
  return out;
}

// ดึง + upsert ใบ — แบ่ง 2 ชั้นกัน timeout:
//   fullDays (วันล่าสุด) = ดึงเต็ม Debtor+Paid + ใบเสร็จ RV (3 call/วัน)
//   paidDays (วันที่มีลูกหนี้ค้าง) = ดึงแค่ "Paid" เพื่อจับใบที่เพิ่งจ่าย (1 call/วัน)
export async function syncSalesInvoices(orgId: string, fullDays: string[], paidDays: string[] = []): Promise<SalesSyncResult> {
  if (!salesSyncConfigured()) return { ok: false, synced: 0, error: "ยังไม่ได้ตั้งค่ากุญแจ TRCloud บริษัท 44 (env FUELOS_TRCLOUD_SALES_*)", days: 0 };
  let synced = 0;
  const rvMap = new Map<string, Date>(); // docNo → วันจ่ายล่าสุด
  try {
    for (const day of fullDays) {
      const ivs = await fetchDayIvs(day);
      await bulkUpsertIvs(orgId, ivs); // อัปทีเดียวทั้งวัน (เร็ว · กัน timeout)
      synced += ivs.length;
      for (const rv of await fetchDayRvs(day)) {
        const cur = rvMap.get(rv.reference);
        if (!cur || rv.date > cur) rvMap.set(rv.reference, rv.date);
      }
    }
    for (const day of paidDays) {
      const ivs = await fetchDayIvs(day, ["Paid"]); // จับเฉพาะใบที่ flip เป็นจ่ายแล้ว
      await bulkUpsertIvs(orgId, ivs);
      synced += ivs.length;
    }
    // เติม paid_date แบบ bulk (1 query) จาก map ใบเสร็จ
    if (rvMap.size > 0) {
      const docnos = [...rvMap.keys()];
      const dates = docnos.map((k) => rvMap.get(k)!.toISOString().slice(0, 10));
      await prisma.$executeRaw`
        UPDATE fuel.sales_invoices s SET paid_date = v.d::date
        FROM (SELECT unnest(${docnos}::text[]) AS docno, unnest(${dates}::text[]) AS d) v
        WHERE s.org_id = ${orgId}::uuid AND s.doc_no = v.docno
          AND (s.paid_date IS NULL OR s.paid_date < v.d::date)`;
    }
  } catch (err) {
    return { ok: false, synced, error: err instanceof Error ? err.message : "ดึงข้อมูลจาก TRCloud ไม่สำเร็จ", days: fullDays.length + paidDays.length };
  }
  return { ok: true, synced, days: fullDays.length + paidDays.length };
}

// คำนวณวันที่ sync (กันยิง API นานเกิน timeout):
//   fullDays = 20 วันล่าสุด (ของใหม่ + จ่ายล่าสุด) · paidDays = วันลูกหนี้ค้าง (cap 100 · เช็คจ่าย)
async function computeSyncDays(orgId: string): Promise<{ fullDays: string[]; paidDays: string[] }> {
  const now = new Date();
  const count = await prisma.salesInvoice.count({ where: { orgId } });
  const recent = count === 0 ? 45 : 20;
  const full = new Set<string>();
  for (let i = 0; i < recent; i++) {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - i);
    full.add(dayKey(d));
  }
  const paid = new Set<string>();
  if (count > 0) {
    const open = await prisma.salesInvoice.findMany({
      where: { orgId, paymentState: { not: "PAID" } },
      select: { issueDate: true },
      orderBy: { issueDate: "desc" },
    });
    for (const o of open) { const k = dayKey(new Date(o.issueDate)); if (!full.has(k)) paid.add(k); }
  }
  return { fullDays: [...full], paidDays: [...paid].sort().reverse().slice(0, 100) };
}

// ดึงล่าสุด (ปุ่ม "ดึงเดี๋ยวนี้" + auto-refresh)
export async function syncRecentSales(orgId: string): Promise<SalesSyncResult> {
  const { fullDays, paidDays } = await computeSyncDays(orgId);
  return syncSalesInvoices(orgId, fullDays, paidDays);
}
