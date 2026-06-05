import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// LedgerLine → TRCloud API push (เชื่อมบัญชี TRCloud แบบสมบูรณ์).
//
// Pushes a CONFIRMED expense INTO TRCloud as an AP (ใบกำกับภาษีซื้อ) via
// api-connector2. The hard rule (proven live 2026-06-05): TRCloud rejects an AP if
// any product_id (SKU) or — implicitly — the vendor doesn't exist. So before the AP
// we run SEARCH-BEFORE-CREATE for the vendor and every line item, caching the
// resolved ids in ledger_trcloud_contact / ledger_trcloud_product so each master is
// created ONCE and reused forever (no duplicate vendors/SKUs in the shared book).
//
// Auth = same md5 scheme as lib/fuelos/trcloud.ts. Creds come from env (CEO sets
// TRCLOUD_* in Vercel; reused with FuelOS — company 31). Never commit/secret-log.
// See [[trcloud-api-ap-create-2026-06-05]].

const BASE = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN = process.env.TRCLOUD_ORIGIN ?? "https://pooil.trcloud.co";
const COMPANY_ID = process.env.TRCLOUD_COMPANY_ID ?? "";
const PASSKEY = process.env.TRCLOUD_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_ENCRYPT_HEAD ?? "";
const APPROVE_ID = process.env.TRCLOUD_APPROVE_ID ?? "1";
// Accounting formula per payment status — overridable if the company names them
// differently (default Cash[AP] = ซื้อเงินสด · Credit[AP] = ซื้อเชื่อ).
const AP_TYPE_CASH = process.env.TRCLOUD_AP_TYPE_CASH ?? "Cash[AP]";
const AP_TYPE_CREDIT = process.env.TRCLOUD_AP_TYPE_CREDIT ?? "Credit[AP]";

export function trcloudPushConfigured(): boolean {
  return !!(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

// ── low-level signed POST ────────────────────────────────────────────────────
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
/** First non-empty string/number value among keys (deep-ish). */
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

async function post(
  path: string,
  payload: Json,
): Promise<{ ok: boolean; status: number; data: Json | null; raw: string }> {
  const body = new URLSearchParams({ json: JSON.stringify({ ...authFields(), ...payload }) });
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: body.toString(),
  });
  const raw = await res.text();
  let data: Json | null = null;
  try {
    data = asObj(JSON.parse(raw));
  } catch {
    /* non-json (e.g. 404 html) */
  }
  return { ok: res.ok, status: res.status, data, raw };
}

/** TRCloud success signal — these endpoints answer {success:1} or {HTTP:"…"} or an id. */
function isSuccess(d: Json | null): boolean {
  if (!d) return false;
  if (d.success === 1 || d.success === "1" || d.success === true) return true;
  const http = pick(d, "HTTP");
  if (http && http.startsWith("2")) return true;
  return false;
}
function errMsg(r: { data: Json | null; raw: string }): string {
  // `??` may not be combined with `||` without parens (SyntaxError) — this broke
  // the whole setup build. Intent: the API message, else the raw body, else a default.
  return pick(r.data, "message", "error") ?? (r.raw.slice(0, 200) || "TRCloud error");
}

// ── helpers ──────────────────────────────────────────────────────────────────
function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}
/** Deterministic, rule-safe (alphanumeric, uppercase) SKU code from a name. Same
 *  name → same code, so even without our map TRCloud would dedup by code. */
function productCodeFor(nameKey: string): string {
  const h = createHash("sha1").update(nameKey).digest("hex").slice(0, 10).toUpperCase();
  return `LDG${h}`; // e.g. LDG3A9F2C1B8 (13 chars, ≤150 limit)
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── vendor (contact) resolution ──────────────────────────────────────────────
type Scope = { orgId: string; companyId: string };

async function searchContactByTaxId(taxId: string): Promise<string | null> {
  const r = await post("contact/search.php", { keyword: taxId, group_code: "S", limit: "20" });
  if (!isSuccess(r.data)) return null;
  // Response shape is { ..., data:[{contact_id, tax_id, ...}] } or { body:[…] }.
  const list = asArr(r.data?.data) ?? asArr(r.data?.body) ?? asArr(r.data?.result) ?? [];
  const want = digitsOnly(taxId);
  for (const row of list) {
    const o = asObj(row);
    if (!o) continue;
    if (digitsOnly(pick(o, "tax_id")) === want) {
      const id = pick(o, "contact_id", "id");
      if (id) return id;
    }
  }
  // Fallback: a single result with no tax_id echoed → trust the top hit.
  const first = asObj(list[0]);
  return first ? pick(first, "contact_id", "id") : null;
}

async function createContact(input: {
  name: string;
  taxId: string;
  organization?: string | null;
  address?: string | null;
  accAp?: string | null;
}): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const issue = new Date().toISOString().slice(0, 10);
  const r = await post("contact/create.php", {
    date: issue,
    group_code: "S", // S = supplier (เจ้าหนี้)
    code_number: "", // autorun
    name: input.name,
    organization: input.organization ?? input.name,
    branch: "00000",
    address: input.address ?? "-",
    email: "",
    telephone: "",
    tax_id: input.taxId,
    contact_type: "normal",
    contact_for: "buy", // vendor (we buy from them)
    ...(input.accAp ? { acc_ap: input.accAp } : {}),
  });
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
  const contactId = pick(inner, "contact_id", "id") ?? pick(r.data, "contact_id", "id");
  if (!contactId) return { ok: false, error: "TRCloud ไม่คืน contact_id" };
  return { ok: true, contactId };
}

/** Map the expense's vendor → a TRCloud contact_id, creating it once if new. */
async function resolveContactId(
  scope: Scope,
  v: { vendor: string | null; vendorTaxId: string | null; vendorAddress: string | null },
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const taxId = digitsOnly(v.vendorTaxId); // "" for cash/no-tax-id receipts
  const where = { orgId: scope.orgId, companyId: scope.companyId, taxId };

  const cached = await prisma.ledgerTrcloudContact.findUnique({
    where: { orgId_companyId_taxId: where },
  });
  if (cached) return { ok: true, contactId: cached.contactId };

  // No-tax-id receipts share ONE "เจ้าหนี้เบ็ดเตล็ด" contact (keeps the book clean).
  const name = taxId ? (v.vendor || "ไม่ระบุชื่อผู้ขาย") : "เจ้าหนี้เบ็ดเตล็ด (LedgerLine)";

  let contactId: string | null = null;
  if (taxId) contactId = await searchContactByTaxId(taxId); // reuse a manual/earlier contact

  if (!contactId) {
    const created = await createContact({
      name,
      taxId,
      organization: v.vendor,
      address: v.vendorAddress,
    });
    if (!created.ok) return created;
    contactId = created.contactId;
  }

  await prisma.ledgerTrcloudContact.upsert({
    where: { orgId_companyId_taxId: where },
    update: { contactId, name },
    create: { ...where, contactId, name },
  });
  return { ok: true, contactId };
}

// ── product (inventory) resolution ───────────────────────────────────────────
async function searchInventoryByName(name: string): Promise<string | null> {
  const r = await post("inventory/search.php", { keyword: name, limit: "20" });
  if (!isSuccess(r.data)) return null;
  const list = asArr(r.data?.data) ?? asArr(r.data?.body) ?? asArr(r.data?.result) ?? [];
  const want = normalizeKey(name);
  for (const row of list) {
    const o = asObj(row);
    if (!o) continue;
    // Only reuse on an EXACT normalized-name match (fuzzy contains would wrongly merge).
    const pname = pick(o, "product_name", "product", "name");
    if (pname && normalizeKey(pname) === want) {
      const id = pick(o, "product_id", "id");
      if (id) return id;
    }
  }
  return null;
}

async function createInventory(input: {
  productId: string;
  name: string;
  accBuy?: string | null;
}): Promise<{ ok: true; productId: string } | { ok: false; error: string }> {
  const r = await post("inventory/create.php", {
    product_id: input.productId,
    product_name: input.name.slice(0, 255),
    status: "0", // 0 = Service → NO stock tracking (v1 hybrid: record the line, don't move stock)
    product_for: "buy", // purchase-only expense item
    pvat: "7",
    unit: "หน่วย",
    ...(input.accBuy ? { acc_buy: input.accBuy } : {}),
  });
  if (!isSuccess(r.data)) {
    // If it already exists (created earlier with this exact code) treat as success —
    // the code IS the product_id we wanted.
    const m = errMsg(r);
    if (/exist|ซ้ำ|duplicate/i.test(m)) return { ok: true, productId: input.productId };
    return { ok: false, error: m };
  }
  return { ok: true, productId: input.productId };
}

/** Map a line description → a TRCloud product_id, creating it once (as a Service). */
async function resolveProductId(
  scope: Scope,
  description: string,
  accBuy: string | null,
): Promise<{ ok: true; productId: string } | { ok: false; error: string }> {
  const nameKey = normalizeKey(description) || "ค่าใช้จ่ายทั่วไป";
  const where = { orgId: scope.orgId, companyId: scope.companyId, nameKey };

  const cached = await prisma.ledgerTrcloudProduct.findUnique({
    where: { orgId_companyId_nameKey: where },
  });
  if (cached) return { ok: true, productId: cached.productId };

  // Reuse an existing TRCloud SKU with the exact same name, else create one.
  let productId = await searchInventoryByName(nameKey);
  if (!productId) {
    const code = productCodeFor(nameKey);
    const created = await createInventory({ productId: code, name: description, accBuy });
    if (!created.ok) return created;
    productId = created.productId;
  }

  await prisma.ledgerTrcloudProduct.upsert({
    where: { orgId_companyId_nameKey: where },
    update: { productId, productName: description.slice(0, 255) },
    create: { ...where, productId, productName: description.slice(0, 255) },
  });
  return { ok: true, productId };
}

// ── AP build + create ────────────────────────────────────────────────────────
export type PushableExpense = {
  id: string;
  orgId: string;
  companyId: string;
  docCode: string;
  vendor: string | null;
  vendorTaxId: string | null;
  vendorAddress: string | null;
  docDate: Date | string | null;
  subtotal: number;
  vat: number;
  wht: number;
  discount: number;
  total: number;
  paymentStatus: string | null;
  note: string | null;
  categoryName: string | null;
  categoryAccCode: string | null;
  items: { description: string; qty: number; unitPrice: number; amount: number; vatRate: number | null }[];
};

type ApLine = { product_id: string; product: string; price: string; quantity: string; vat: string };

/** Build AP product lines that reconcile to the expense: Σ(price·qty)=subtotal and
 *  Σ(line vat)=expense.vat. Each line gets a resolved TRCloud product_id. */
async function buildLines(
  scope: Scope,
  e: PushableExpense,
): Promise<{ ok: true; lines: ApLine[] } | { ok: false; error: string }> {
  const acc = e.categoryAccCode;
  // Source rows: real OCR items if their amounts add up; else a single category line.
  const itemsSum = round2(e.items.reduce((s, it) => s + (it.amount || 0), 0));
  const useItems = e.items.length > 0 && Math.abs(itemsSum - e.subtotal) < 0.05;

  const rows = useItems
    ? e.items.map((it) => ({ desc: it.description || e.categoryName || "ค่าใช้จ่าย", amount: round2(it.amount), qty: it.qty || 1 }))
    : [{ desc: e.categoryName ? `ค่าใช้จ่าย: ${e.categoryName}` : (e.vendor || "ค่าใช้จ่าย"), amount: round2(e.subtotal), qty: 1 }];

  // Distribute the document VAT across lines proportionally to amount (last line
  // absorbs the rounding remainder so the totals match exactly).
  const baseSum = rows.reduce((s, r) => s + r.amount, 0) || 1;
  let vatLeft = round2(e.vat);
  const lines: ApLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineVat = i === rows.length - 1 ? vatLeft : round2((r.amount / baseSum) * e.vat);
    vatLeft = round2(vatLeft - lineVat);
    const resolved = await resolveProductId(scope, r.desc, acc);
    if (!resolved.ok) return resolved;
    const qty = r.qty && r.qty > 0 ? r.qty : 1;
    // price is per-unit (TRCloud computes price·qty); keep 4dp to avoid drift.
    const price = Math.round((r.amount / qty) * 10000) / 10000;
    lines.push({
      product_id: resolved.productId,
      product: r.desc.slice(0, 2000),
      price: String(price),
      quantity: String(qty),
      vat: String(i === rows.length - 1 ? round2(lineVat + vatLeft) : lineVat),
    });
  }
  return { ok: true, lines };
}

function toIsoDate(d: Date | string | null): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Push ONE confirmed expense into TRCloud as an AP. Resolves vendor + every line's
 * SKU first (search-before-create), then creates the AP. Returns the TRCloud doc
 * id/number for idempotent storage. Idempotency (don't double-push) is enforced by
 * the caller via expense.trcloudDocId.
 */
export async function pushExpenseToTrcloud(
  e: PushableExpense,
): Promise<{ ok: true; docId: string | null; docNo: string | null } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_*)" };
  }
  const scope: Scope = { orgId: e.orgId, companyId: e.companyId };

  // 1) vendor → contact_id
  const contact = await resolveContactId(scope, {
    vendor: e.vendor,
    vendorTaxId: e.vendorTaxId,
    vendorAddress: e.vendorAddress,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };

  // 2) line items → product_ids (each resolved/created)
  const built = await buildLines(scope, e);
  if (!built.ok) return { ok: false, error: `สินค้า: ${built.error}` };

  // 3) create the AP
  const issue = toIsoDate(e.docDate);
  const apType = (e.paymentStatus ?? "paid") === "paid" ? AP_TYPE_CASH : AP_TYPE_CREDIT;
  const payload: Json = {
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: "AP",
    document_number: "", // autorun (avoid colliding with manual entries)
    payment_term: "0",
    reference: e.docCode, // back-reference to our internal doc
    discount: String(round2(e.discount)),
    wht: String(round2(e.wht)),
    tax_option: "ex",
    tax_report: "1", // include in ภพ.30 purchase tax report
    type: apType,
    approve_id: APPROVE_ID,
    approve_status: "wait",
    invoice_note: `ระบบบัญชี (LedgerLine) · อ้างอิง ${e.docCode}`,
    customer: {
      group_code: "S",
      name: e.vendor || "ไม่ระบุชื่อผู้ขาย",
      organization: e.vendor || "",
      branch: "00000",
      address: e.vendorAddress || "-",
      email: "",
      telephone: "",
      tax_id: digitsOnly(e.vendorTaxId),
      contact_type: "normal",
      contact_id: contact.contactId, // reuse the resolved contact (no duplicate)
      add_contact: "0",
    },
    product: built.lines,
  };

  const r = await post("ap/create.php", payload);
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
  const docId = pick(inner, "id", "document_id") ?? pick(r.data, "id", "document_id");
  const docNo = pick(inner, "document_number", "no") ?? pick(r.data, "document_number", "no");
  return { ok: true, docId, docNo };
}

/** Delete an AP (used for test cleanup / future "ยกเลิกการส่ง"). */
export async function deleteTrcloudAp(docId: string): Promise<{ ok: boolean; error?: string }> {
  if (!trcloudPushConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud" };
  const r = await post("ap/delete.php", { id: docId });
  return isSuccess(r.data) ? { ok: true } : { ok: false, error: errMsg(r) };
}
