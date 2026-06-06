import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// LedgerLine → TRCloud AP push v2 (JP Sync company 45)
//
// KEY CHANGES from v1:
// - company_format="JPS_AP" (JP Sync custom format, not generic "AP")
// - tax_option="in" (VAT-inclusive prices, matching live JPS AP docs)
// - Fixed SKU taxonomy: only JPS-100/101/103 — never auto-create new SKUs
// - acc_code per AP line (from LedgerCategory.trcloudAccCode)
// - department (นิติบุคคล/VAT branch) + project (สาขา) per AP
// - Validation gate: block push if any required mapping missing
// - Uses TRCLOUD_JPS_* env vars (company 45) not the shared company 31
//
// See docs/WORKSHOP_ledger-trcloud-v2.md for full spec.

const BASE        = process.env.TRCLOUD_BASE        ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN      = process.env.TRCLOUD_JPS_ORIGIN  ?? "https://pooil.trcloud.co";
// MUST use JPS-specific creds (company 45). No fallback to company-31 shared account.
const COMPANY_ID  = process.env.TRCLOUD_JPS_COMPANY_ID   ?? "";
const PASSKEY     = process.env.TRCLOUD_JPS_PASSKEY       ?? "";
const ENCRYPT_HEAD= process.env.TRCLOUD_JPS_ENCRYPT_HEAD  ?? "";

const AP_TYPE_CASH   = process.env.TRCLOUD_AP_TYPE_CASH   ?? "Cash[AP]";
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
  try { data = asObj(JSON.parse(raw)); } catch { /* 404 html etc */ }
  return { ok: res.ok, status: res.status, data, raw };
}

function isSuccess(d: Json | null): boolean {
  if (!d) return false;
  if (d.success === 1 || d.success === "1" || d.success === true) return true;
  const http = pick(d, "HTTP");
  if (http && http.startsWith("2")) return true;
  return false;
}
function errMsg(r: { data: Json | null; raw: string }): string {
  return pick(r.data, "message", "error") ?? (r.raw.slice(0, 200) || "TRCloud error");
}
function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── vendor (contact) resolution ──────────────────────────────────────────────
type Scope = { orgId: string; companyId: string };
type ContactRef = { contactId: string; codeNumber: string | null };

async function searchContactByTaxId(taxId: string): Promise<ContactRef | null> {
  const r = await post("contact/search.php", { keyword: taxId, group_code: "S", limit: "20" });
  if (!isSuccess(r.data)) return null;
  const list = asArr(r.data?.result) ?? asArr(r.data?.data) ?? asArr(r.data?.body) ?? [];
  const want = digitsOnly(taxId);
  const refOf = (o: Json): ContactRef | null => {
    const id = pick(o, "contact_id", "id");
    return id ? { contactId: id, codeNumber: pick(o, "title", "code_number") } : null;
  };
  for (const row of list) {
    const o = asObj(row);
    if (o && digitsOnly(pick(o, "tax_id")) === want) {
      const ref = refOf(o);
      if (ref) return ref;
    }
  }
  const first = asObj(list[0]);
  return first ? refOf(first) : null;
}

async function createContact(input: {
  name: string; taxId: string; organization?: string | null; address?: string | null;
}): Promise<{ ok: true; ref: ContactRef } | { ok: false; error: string }> {
  const issue = new Date().toISOString().slice(0, 10);
  const r = await post("contact/create.php", {
    date: issue, group_code: "S", code_number: "", name: input.name,
    organization: input.organization ?? input.name, branch: "00000",
    address: input.address ?? "-", email: "", telephone: "",
    tax_id: input.taxId, contact_type: "normal", contact_for: "buy",
  });
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
  const contactId = pick(inner, "contact_id", "id") ?? pick(r.data, "contact_id", "id");
  if (!contactId) return { ok: false, error: "TRCloud ไม่คืน contact_id" };
  const codeNumber = pick(r.data, "last", "title") ?? pick(inner, "title", "code_number");
  return { ok: true, ref: { contactId, codeNumber } };
}

async function resolveContactId(
  scope: Scope,
  v: { vendor: string | null; vendorTaxId: string | null; vendorAddress: string | null },
): Promise<{ ok: true; ref: ContactRef } | { ok: false; error: string }> {
  const taxId = digitsOnly(v.vendorTaxId);
  const where = { orgId: scope.orgId, companyId: scope.companyId, taxId };
  const cached = await prisma.ledgerTrcloudContact.findUnique({ where: { orgId_companyId_taxId: where } });
  if (cached) return { ok: true, ref: { contactId: cached.contactId, codeNumber: cached.codeNumber } };

  const name = taxId ? (v.vendor || "ไม่ระบุชื่อผู้ขาย") : "เจ้าหนี้เบ็ดเตล็ด (LedgerLine)";
  let ref: ContactRef | null = null;
  if (taxId) ref = await searchContactByTaxId(taxId);
  if (!ref) {
    const created = await createContact({ name, taxId, organization: v.vendor, address: v.vendorAddress });
    if (!created.ok) return created;
    ref = created.ref;
  }
  await prisma.ledgerTrcloudContact.upsert({
    where: { orgId_companyId_taxId: where },
    update: { contactId: ref.contactId, codeNumber: ref.codeNumber, name },
    create: { ...where, contactId: ref.contactId, codeNumber: ref.codeNumber, name },
  });
  return { ok: true, ref };
}

// ── product (SKU) resolution — FIXED 3-SKU model ────────────────────────────
// v2: only JPS-100/101/103 exist; we verify they exist in TRCloud once then cache.
// Never auto-create new SKUs (that was the v1 "SKU explosion" bug).

async function resolveFixedSku(
  scope: Scope,
  productCode: string, // e.g. "JPS-101"
): Promise<{ ok: true; productId: string } | { ok: false; error: string }> {
  const nameKey = normalizeKey(productCode);
  const where = { orgId: scope.orgId, companyId: scope.companyId, nameKey };
  const cached = await prisma.ledgerTrcloudProduct.findUnique({ where: { orgId_companyId_nameKey: where } });
  if (cached) return { ok: true, productId: cached.productId };

  // Verify SKU exists in TRCloud
  const r = await post("inventory/search.php", { keyword: productCode, limit: "10" });
  const list = asArr(r.data?.data) ?? asArr(r.data?.result) ?? asArr(r.data?.body) ?? [];
  let foundId: string | null = null;
  for (const row of list) {
    const o = asObj(row);
    if (!o) continue;
    const code = pick(o, "product_id", "code");
    if (code && normalizeKey(code) === normalizeKey(productCode)) {
      foundId = pick(o, "id", "product_id") ?? code;
      break;
    }
  }
  if (!foundId) {
    return { ok: false, error: `ไม่พบ SKU "${productCode}" ใน TRCloud — กรุณาสร้าง ${productCode} ใน TRCloud ก่อน` };
  }
  await prisma.ledgerTrcloudProduct.upsert({
    where: { orgId_companyId_nameKey: where },
    update: { productId: foundId, productName: productCode },
    create: { ...where, productId: foundId, productName: productCode },
  });
  return { ok: true, productId: foundId };
}

// ── AP line builder ──────────────────────────────────────────────────────────
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
  categoryAccCode: string | null;      // GL code e.g. "5220020"
  trcloudProductCode: string | null;   // fixed SKU e.g. "JPS-101"
  inputVatClaimable: boolean;          // false → tax_report=0 (ไม่เข้า ภ.พ.30)
  branchTrcloudProject: string | null;    // TRCloud project code (สาขา)
  branchTrcloudDepartment: string | null; // TRCloud department code (นิติบุคคล)
  items: { description: string; qty: number; unitPrice: number; amount: number; vatRate: number | null }[];
};

type ApLine = {
  product_id: string;
  product: string;
  price: string;
  quantity: string;
  vat: string;    // always "7" (rate, not amount) for tax_option="in"
  acc_code: string;
};

/** Build AP lines. tax_option="in" → price = VAT-inclusive amount per unit. */
async function buildLines(
  scope: Scope,
  e: PushableExpense,
): Promise<{ ok: true; lines: ApLine[] } | { ok: false; error: string }> {
  const productCode = e.trcloudProductCode;
  if (!productCode) {
    return { ok: false, error: `หมวด "${e.categoryName}" ยังไม่มีรหัส SKU — กรุณาตั้งค่าใน LedgerLine Settings` };
  }
  const accCode = e.categoryAccCode;
  if (!accCode) {
    return { ok: false, error: `หมวด "${e.categoryName}" ยังไม่มีรหัสบัญชี GL — กรุณาตั้งค่าใน LedgerLine Settings` };
  }

  const skuResult = await resolveFixedSku(scope, productCode);
  if (!skuResult.ok) return skuResult;

  // For tax_option="in": line price = VAT-inclusive = base + VAT
  // Use items if they sum to subtotal, else one summary line
  const itemsSum = round2(e.items.reduce((s, it) => s + (it.amount || 0), 0));
  const useItems = e.items.length > 0 && Math.abs(itemsSum - e.subtotal) < 0.05;

  const rows = useItems
    ? e.items.map((it) => ({
        desc: it.description || e.categoryName || "ค่าใช้จ่าย",
        baseAmount: round2(it.amount),
        qty: it.qty || 1,
      }))
    : [{
        desc: e.categoryName ? `${e.categoryName}${e.vendor ? ` - ${e.vendor}` : ""}` : (e.vendor || "ค่าใช้จ่าย"),
        baseAmount: round2(e.subtotal),
        qty: 1,
      }];

  // Distribute VAT proportionally across rows (last row absorbs rounding)
  const baseSum = rows.reduce((s, r) => s + r.baseAmount, 0) || 1;
  let vatLeft = round2(e.vat);
  const lines: ApLine[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isLast = i === rows.length - 1;
    const lineVat = isLast ? vatLeft : round2((r.baseAmount / baseSum) * e.vat);
    vatLeft = round2(vatLeft - lineVat);
    const qty = r.qty > 0 ? r.qty : 1;
    // tax_option="in" → send VAT-inclusive price per unit
    const inclPrice = round2((r.baseAmount + lineVat) / qty);
    lines.push({
      product_id: skuResult.productId,
      product: r.desc.slice(0, 2000),
      price: String(inclPrice),
      quantity: String(qty),
      vat: lineVat === 0 ? "0" : "7", // rate — "0" for VAT-exempt lines
      acc_code: accCode,
    });
  }
  return { ok: true, lines };
}

function toIsoDate(d: Date | string | null): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ── main push ────────────────────────────────────────────────────────────────

/**
 * Push ONE confirmed expense into TRCloud as a JPS_AP (company 45, VAT-in, draft).
 * Validates all required mappings before sending; blocks with clear Thai error if missing.
 */
export async function pushExpenseToTrcloud(
  e: PushableExpense,
): Promise<{ ok: true; docId: string | null; docNo: string | null } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  }

  // ── Validation gate ────────────────────────────────────────────────────────
  if (!e.trcloudProductCode) {
    return { ok: false, error: `หมวด "${e.categoryName}" ไม่มีรหัส SKU — ตั้งค่าใน Settings → หมวดค่าใช้จ่าย` };
  }
  if (!e.categoryAccCode) {
    return { ok: false, error: `หมวด "${e.categoryName}" ไม่มีรหัสบัญชี GL — ตั้งค่าใน Settings → หมวดค่าใช้จ่าย` };
  }
  if (!e.branchTrcloudProject) {
    return { ok: false, error: "สาขานี้ยังไม่มีรหัสโครงการ TRCloud — ตั้งค่าใน Settings → สาขา → TRCloud" };
  }
  if (!e.branchTrcloudDepartment) {
    return { ok: false, error: "สาขานี้ยังไม่มีรหัสแผนก TRCloud — ตั้งค่าใน Settings → สาขา → TRCloud" };
  }

  const scope: Scope = { orgId: e.orgId, companyId: e.companyId };

  // 1) vendor → contact_id
  const contact = await resolveContactId(scope, {
    vendor: e.vendor, vendorTaxId: e.vendorTaxId, vendorAddress: e.vendorAddress,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };

  // 2) line items (fixed SKU + acc_code)
  const built = await buildLines(scope, e);
  if (!built.ok) return { ok: false, error: `สินค้า: ${built.error}` };

  // 3) create AP
  const issue = toIsoDate(e.docDate);
  const apType = (e.paymentStatus ?? "paid") === "paid" ? AP_TYPE_CASH : AP_TYPE_CREDIT;
  const payload: Json = {
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: "JPS_AP",  // JP Sync custom format (NOT generic "AP")
    document_number: "",        // autorun
    payment_term: "0",
    reference: e.docCode,
    discount: String(round2(e.discount)),
    wht: String(round2(e.wht)),
    tax_option: "in",           // VAT-inclusive (matches live JPS AP docs)
    tax_report: e.inputVatClaimable ? "1" : "0", // 0 = ไม่เข้า ภ.พ.30
    type: apType,
    approve_status: "wait",     // always draft; accountant approves in TRCloud
    department: e.branchTrcloudDepartment,  // นิติบุคคล/VAT branch
    project: e.branchTrcloudProject,        // สาขา
    invoice_note: e.note
      ? `${e.note} · อ้างอิง ${e.docCode}`
      : `LedgerLine · อ้างอิง ${e.docCode}`,
    customer: {
      group_code: "S",
      code_number: (contact.ref.codeNumber ?? "").replace(/^\D+/, ""),
      name: e.vendor || "ไม่ระบุชื่อผู้ขาย",
      organization: e.vendor || "",
      branch: "00000",
      address: e.vendorAddress || "-",
      email: "",
      telephone: "",
      tax_id: digitsOnly(e.vendorTaxId),
      contact_type: "normal",
      contact_id: contact.ref.contactId,
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

/** Delete an AP (test cleanup / future "ยกเลิกการส่ง"). */
export async function deleteTrcloudAp(docId: string): Promise<{ ok: boolean; error?: string }> {
  if (!trcloudPushConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud" };
  const r = await post("ap/delete.php", { id: docId });
  return isSuccess(r.data) ? { ok: true } : { ok: false, error: errMsg(r) };
}
