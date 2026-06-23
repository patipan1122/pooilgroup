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
async function fetchDayIvs(day: string): Promise<NormalizedIv[]> {
  const seen = new Map<string, NormalizedIv>();
  for (const status of ["Debtor", "Paid"]) {
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

function ivFields(iv: NormalizedIv) {
  return {
    companyFormat: iv.companyFormat, invoiceNumber: iv.invoiceNumber, docNo: iv.docNo,
    contactId: iv.contactId, customerName: iv.customerName, customerOrg: iv.customerOrg,
    customerBranch: iv.customerBranch, customerTaxId: iv.customerTaxId,
    issueDate: iv.issueDate, dueDate: iv.dueDate,
    netTotal: iv.netTotal, vatTotal: iv.vatTotal, grandTotal: iv.grandTotal,
    paidAmount: iv.paidAmount, outstanding: iv.outstanding,
    trcloudStatus: iv.trcloudStatus, paymentState: iv.paymentState,
    salesman: iv.salesman, department: iv.department, project: iv.project,
    docType: iv.docType, quantity: iv.quantity, issuedAt: iv.issuedAt,
  };
}

// ดึง + upsert ใบของวันที่กำหนด (idempotent ด้วย unique org+trcloudInvoiceId)
export async function syncSalesInvoices(orgId: string, days: string[]): Promise<SalesSyncResult> {
  if (!salesSyncConfigured()) return { ok: false, synced: 0, error: "ยังไม่ได้ตั้งค่ากุญแจ TRCloud บริษัท 44 (env FUELOS_TRCLOUD_SALES_*)", days: 0 };
  let synced = 0;
  try {
    for (const day of days) {
      const ivs = await fetchDayIvs(day);
      for (const iv of ivs) {
        const f = ivFields(iv);
        const raw = iv.raw as object;
        await prisma.salesInvoice.upsert({
          where: { orgId_trcloudInvoiceId: { orgId, trcloudInvoiceId: iv.trcloudInvoiceId } },
          create: { orgId, trcloudInvoiceId: iv.trcloudInvoiceId, rawJson: raw, ...f, syncedAt: new Date() },
          update: { ...f, rawJson: raw, syncedAt: new Date() },
        });
        synced++;
      }
    }
  } catch (err) {
    return { ok: false, synced, error: err instanceof Error ? err.message : "ดึงข้อมูลจาก TRCloud ไม่สำเร็จ", days: days.length };
  }
  return { ok: true, synced, days: days.length };
}

// วันที่ต้อง sync: ล่าสุด N วัน + วันของลูกหนี้ที่ยังค้าง (อัปสถานะใบเก่าที่เพิ่งจ่าย)
// ครั้งแรก (ตารางว่าง) = 60 วัน · ปกติ 45 วัน · cap 90 วัน กันยิง API นานเกิน timeout
// (history เก่ากว่านี้ใช้ backfill offline ครั้งเดียว)
async function computeSyncDays(orgId: string): Promise<string[]> {
  const now = new Date();
  const count = await prisma.salesInvoice.count({ where: { orgId } });
  const recent = count === 0 ? 60 : 45;
  const set = new Set<string>();
  for (let i = 0; i < recent; i++) {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - i);
    set.add(dayKey(d));
  }
  if (count > 0) {
    const open = await prisma.salesInvoice.findMany({
      where: { orgId, paymentState: { not: "PAID" } },
      select: { issueDate: true },
      orderBy: { issueDate: "desc" },
    });
    for (const o of open) set.add(dayKey(new Date(o.issueDate)));
  }
  return [...set].sort().reverse().slice(0, 90);
}

// ดึงล่าสุด (ปุ่ม "ดึงเดี๋ยวนี้" + auto-refresh)
export async function syncRecentSales(orgId: string): Promise<SalesSyncResult> {
  return syncSalesInvoices(orgId, await computeSyncDays(orgId));
}
