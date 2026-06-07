import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveContactId } from "@/lib/ledger/trcloud-push";

// LedgerLine → TRCloud Inventory STOCK-IN (รับเข้าสต๊อก สินค้าซื้อมาขาย).
//
// VERIFIED mechanism (live write-test on company 45, 2026-06-07, doc 528487):
//   ap/create.php + company_format="JPS_AP" + a STOCK product (status='show') +
//   quantity INCREASES the TRCloud on-hand balance immediately (on create, even as
//   draft). So the push IS the stock event — idempotency + correctness at push time
//   are mandatory (no "safe draft" buffer). POS does the stock-OUT (sale) on the
//   same SKU. LedgerLine replaces manual AP keying = single stock-IN writer.
//
// SKUs are NEVER created from OCR — we mirror TRCloud's existing master via
// inventory/search and match receipt line text to a SKU through a learned alias
// table (exact match; no match = flag for an admin, never guess).

const BASE = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN = process.env.TRCLOUD_JPS_ORIGIN ?? "https://pooil.trcloud.co";
const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID ?? "";
const PASSKEY = process.env.TRCLOUD_JPS_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_JPS_ENCRYPT_HEAD ?? "";
const AP_TYPE_CASH = process.env.TRCLOUD_AP_TYPE_CASH ?? "Cash[AP]";
const AP_TYPE_CREDIT = process.env.TRCLOUD_AP_TYPE_CREDIT ?? "Credit[AP]";

export function stockInConfigured(): boolean {
  return !!(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

type Json = Record<string, unknown>;

function authFields(): Json {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}
function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function asArr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
function pick(o: Json | null, ...keys: string[]): string | null {
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    if (v != null && (typeof v === "string" || typeof v === "number")) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
}
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function post(path: string, payload: Json): Promise<{ data: Json | null; raw: string }> {
  const body = new URLSearchParams({ json: JSON.stringify({ ...authFields(), ...payload }) });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { data: null, raw: e instanceof Error ? e.message : String(e) };
  }
  const raw = await res.text();
  let data: Json | null = null;
  try {
    data = asObj(JSON.parse(raw));
  } catch {
    /* html/404 */
  }
  return { data, raw };
}

// success flag is truth — never trust the HTTP:"200 Success" echo (present on failures too).
function isSuccess(d: Json | null): boolean {
  if (!d) return false;
  if (d.success === 1 || d.success === "1" || d.success === true) return true;
  if (d.success === 0 || d.success === "0" || d.success === false) return false;
  const http = pick(d, "HTTP");
  return !!(http && http.startsWith("2"));
}
function errMsg(r: { data: Json | null; raw: string }): string {
  return pick(r.data, "message", "error") ?? (r.raw.slice(0, 200) || "TRCloud error");
}

// ── SKU sync (mirror TRCloud inventory master into our cache) ─────────────────

export type TrcloudSku = {
  productId: string;
  productName: string | null;
  businessGroup: string | null;
  unit: string | null;
  status: string | null;
  balance: number | null;
  cost: number | null;
};

/** Read SKUs from TRCloud. keyword/businessGroup optional (category filter). */
export async function fetchSkusFromTrcloud(opts: { keyword?: string; category?: string; limit?: number }): Promise<TrcloudSku[]> {
  if (!stockInConfigured()) return [];
  const payload: Json = { limit: String(opts.limit ?? 100) };
  if (opts.keyword) payload.keyword = opts.keyword;
  if (opts.category) payload.category = opts.category;
  const r = await post("inventory/search.php", payload);
  const rows = asArr(r.data?.result) ?? asArr(r.data?.data) ?? asArr(r.data?.body) ?? [];
  const out: TrcloudSku[] = [];
  for (const row of rows) {
    const o = asObj(row);
    if (!o) continue;
    const productId = pick(o, "product_id", "code");
    if (!productId) continue;
    out.push({
      productId,
      productName: pick(o, "product_name", "name"),
      businessGroup: pick(o, "category"),
      unit: pick(o, "unit"),
      status: pick(o, "status"),
      balance: num(o.balance),
      cost: num(o.cost_price) ?? num(o.ma) ?? num(o.last_cost_price),
    });
  }
  return out;
}

/** Upsert fetched SKUs into ledger_trcloud_sku (preserve admin flags: stock_tracked,
 *  pack_factor are only set on first insert; later syncs refresh name/unit/balance). */
export async function syncSkuCache(args: {
  orgId: string;
  companyId: string;
  keyword?: string;
  category?: string;
}): Promise<{ ok: true; synced: number } | { ok: false; error: string }> {
  if (!stockInConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  const skus = await fetchSkusFromTrcloud({ keyword: args.keyword, category: args.category });
  if (skus.length === 0) return { ok: false, error: "ไม่พบสินค้าจาก TRCloud (ลองคำค้น/หมวดอื่น)" };
  const now = new Date();
  let synced = 0;
  for (const s of skus) {
    try {
      await prisma.ledgerTrcloudSku.upsert({
        where: { orgId_companyId_productId: { orgId: args.orgId, companyId: args.companyId, productId: s.productId } },
        update: {
          productName: s.productName,
          businessGroup: s.businessGroup,
          unit: s.unit,
          status: s.status,
          balanceCached: s.balance ?? undefined,
          costCached: s.cost ?? undefined,
          syncedAt: now,
        },
        create: {
          orgId: args.orgId,
          companyId: args.companyId,
          productId: s.productId,
          productName: s.productName,
          businessGroup: s.businessGroup,
          unit: s.unit,
          status: s.status,
          balanceCached: s.balance ?? undefined,
          costCached: s.cost ?? undefined,
          syncedAt: now,
        },
      });
      synced++;
    } catch {
      /* skip a bad row, keep going */
    }
  }
  return { ok: true, synced };
}

// ── alias matching (receipt text → SKU) ──────────────────────────────────────

/** Normalize receipt line text into a stable alias key (lower/trim/collapse-space). */
export function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

export type SkuMatch = { skuId: string; productId: string; productName: string | null; unit: string | null; packFactor: number };

/** Resolve a receipt line text to a stock-tracked SKU via the alias table (exact only). */
export async function resolveSku(orgId: string, companyId: string, text: string): Promise<SkuMatch | null> {
  const key = normalizeAlias(text);
  if (!key) return null;
  const alias = await prisma.ledgerSkuAlias.findUnique({
    where: { orgId_companyId_aliasKey: { orgId, companyId, aliasKey: key } },
    include: { sku: true },
  });
  if (!alias || !alias.sku.stockTracked) return null;
  return {
    skuId: alias.sku.id,
    productId: alias.sku.productId,
    productName: alias.sku.productName,
    unit: alias.sku.unit,
    packFactor: Number(alias.sku.packFactor) || 1,
  };
}

// ── stock-IN push ─────────────────────────────────────────────────────────────

export type StockInLine = { productId: string; productName: string; quantity: number; unitCost: number };

/** Push a stock-IN AP into TRCloud (JPS_AP + stock products). Stock increases on
 *  create. Returns the doc id/no. Idempotency + the confirmed-only gate are the
 *  caller's responsibility (sendExpenseStockIn). */
export async function pushStockIn(args: {
  vendor: string | null;
  vendorTaxId: string | null;
  vendorAddress: string | null;
  orgId: string;
  companyId: string;
  docDate: Date | null;
  reference: string;
  note: string | null;
  project: string | null; // สาขา
  department: string | null; // BU code
  paymentStatus: string | null;
  lines: StockInLine[];
}): Promise<{ ok: true; docId: string | null; docNo: string | null } | { ok: false; error: string }> {
  if (!stockInConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  if (args.lines.length === 0) return { ok: false, error: "ไม่มีรายการสินค้าให้รับเข้าคลัง" };
  if (!args.project) return { ok: false, error: "ยังไม่ได้ตั้งรหัสโครงการ (สาขา) ของใบนี้ใน TRCloud" };

  const contact = await resolveContactId(
    { orgId: args.orgId, companyId: args.companyId },
    { vendor: args.vendor, vendorTaxId: args.vendorTaxId, vendorAddress: args.vendorAddress },
  );
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };

  const issue = (args.docDate ?? new Date()).toISOString().slice(0, 10);
  const apType = (args.paymentStatus ?? "paid") === "paid" ? AP_TYPE_CASH : AP_TYPE_CREDIT;
  const payload: Json = {
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: "JPS_AP",
    document_number: "",
    payment_term: "0",
    reference: args.reference,
    discount: "0",
    wht: "0",
    tax_option: "in",
    tax_report: "1",
    type: apType,
    approve_status: "wait", // draft for the accountant to approve/post; stock moves on create
    department: args.department ?? "",
    project: args.project,
    invoice_note: args.note ? `${args.note} · อ้างอิง ${args.reference}` : `LedgerLine รับเข้าคลัง · อ้างอิง ${args.reference}`,
    customer: {
      group_code: "S",
      code_number: (contact.ref.codeNumber ?? "").replace(/^\D+/, ""),
      name: args.vendor || "ไม่ระบุชื่อผู้ขาย",
      organization: args.vendor || "",
      branch: "00000",
      address: args.vendorAddress || "-",
      email: "-",
      telephone: "-",
      tax_id: (args.vendorTaxId ?? "").replace(/\D/g, ""),
      contact_type: "normal",
      contact_id: contact.ref.contactId,
      add_contact: "0",
    },
    product: args.lines.map((l) => ({
      product_id: l.productId,
      product: l.productName,
      price: String(l.unitCost),
      quantity: String(l.quantity),
      vat: "0",
    })),
  };

  const r = await post("ap/create.php", payload);
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
  const docId = pick(inner, "id", "document_id", "doc") ?? pick(r.data, "id", "document_id", "doc");
  const docNo = pick(inner, "document_number", "no") ?? pick(r.data, "document_number", "no");
  if (!docId && !docNo) return { ok: false, error: `TRCloud ไม่คืนเลขเอกสาร — รับเข้าคลังไม่สำเร็จ (${errMsg(r)})` };
  return { ok: true, docId, docNo };
}

/** Delete a stock-IN AP (reverses the stock movement) — for retry/undo. */
export async function deleteStockIn(docId: string): Promise<{ ok: boolean; error?: string }> {
  if (!stockInConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud" };
  const r = await post("ap/delete.php", { id: docId });
  return isSuccess(r.data) ? { ok: true } : { ok: false, error: errMsg(r) };
}
