import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizePurchaseType, type PurchaseType } from "@/lib/ledger/types";
import { llCSlotForGl, LL_SLOT_VAT_CLAIMABLE, LL_SLOT_VAT_NONCLAIM } from "@/lib/ledger/coa-chart";
import { isAutoPvEnabled } from "@/lib/ledger/trcloud-pv";
import { toAbbr } from "@/lib/ledger/bank-logos";

// LedgerLine → TRCloud PO push (JP Sync company 45)
//
// CEO 2026-06-13: push เป็น "ใบสั่งซื้อ (PO)" แทน AP. PO ไม่ลงบัญชี/ไม่เข้า ภ.พ.30
// /ไม่ขยับสต๊อก — เป็นเอกสารตั้งต้นให้ "บัญชีแปลง PO→AP ใน TRCloud เอง" ตอนนั้นถึงลง
// ค่าใช้จ่าย+VAT+GL จริง. (ดู memory trcloud-po-create-probe-2026-06-13: live test ยืนยัน
// PO โชว์ VAT ได้ แต่ไม่มี tax_report และไม่เก็บ acc_code รายบรรทัด.)
//
// KEY POINTS:
// - company_format="PO" + type="po" + status="New" (status บังคับ) + delivery_due
// - tax_option="in" (VAT-inclusive prices) — VAT ยังโชว์บน PO เพื่อให้บัญชีเห็นยอด
// - Fixed SKU taxonomy: only JPS-100/101/103 — never auto-create new SKUs
// - department (นิติบุคคล/VAT branch) + project (สาขา) per PO
// - Uses TRCLOUD_JPS_* env vars (company 45) not the shared company 31
// - acc_code ส่งไปด้วย (PO เมิน — แต่ส่งไว้เผื่อ TRCloud แปลง PO→AP หยิบไปใช้)

const BASE        = process.env.TRCLOUD_BASE        ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN      = process.env.TRCLOUD_JPS_ORIGIN  ?? "https://pooil.trcloud.co";
// MUST use JPS-specific creds (company 45). No fallback to company-31 shared account.
const COMPANY_ID  = process.env.TRCLOUD_JPS_COMPANY_ID   ?? "";
const PASSKEY     = process.env.TRCLOUD_JPS_PASSKEY       ?? "";
const ENCRYPT_HEAD= process.env.TRCLOUD_JPS_ENCRYPT_HEAD  ?? "";

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
// exported for lib/ledger/trcloud-pv.ts reuse (same TRCloud auth/parse contract)
export function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function asArr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
export function pick(o: Json | null, ...keys: string[]): string | null {
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

// exported for lib/ledger/trcloud-pv.ts — the ONE signed POST helper (same auth/signing)
export async function post(
  path: string,
  payload: Json,
): Promise<{ ok: boolean; status: number; data: Json | null; raw: string }> {
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
    const msg =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        ? "TRCloud ไม่ตอบสนองภายใน 15 วินาที — กรุณาลองใหม่"
        : `TRCloud network error: ${e instanceof Error ? e.message : String(e)}`;
    return { ok: false, status: 0, data: null, raw: msg };
  }
  const raw = await res.text();
  let data: Json | null = null;
  try { data = asObj(JSON.parse(raw)); } catch { /* 404 html etc */ }
  return { ok: res.ok, status: res.status, data, raw };
}

export function isSuccess(d: Json | null): boolean {
  if (!d) return false;
  // The `success` flag is TRCloud's REAL operation result. Trust it absolutely.
  if (d.success === 1 || d.success === "1" || d.success === true) return true;
  // CRITICAL (2026-06-07): TRCloud puts `"HTTP":"200 Success"` in EVERY response —
  // including FAILURES that carry `success:0`. The old code returned true whenever
  // HTTP started with "2", so a failed ap/create.php (success:0) was marked "sent"
  // even though no AP was created (e.g. EXP-202606-0024 → false "sent"). So an
  // EXPLICIT success:0/false is ALWAYS a failure — never fall back to the HTTP field.
  if (d.success === 0 || d.success === "0" || d.success === false) return false;
  // Only when there is NO `success` flag at all do we fall back to the HTTP status
  // (some lightweight endpoints omit it).
  const http = pick(d, "HTTP");
  if (http && http.startsWith("2")) return true;
  return false;
}
export function errMsg(r: { data: Json | null; raw: string }): string {
  return pick(r.data, "message", "error") ?? (r.raw.slice(0, 200) || "TRCloud error");
}
export function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── vendor (contact) resolution ──────────────────────────────────────────────
type Scope = { orgId: string; companyId: string };
export type ContactRef = { contactId: string; codeNumber: string | null };

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
  // No exact tax_id match → return null so the caller creates a NEW contact.
  // Falling back to list[0] risks assigning a random vendor's AP to a different
  // creditor when TRCloud returns partial search results.
  return null;
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

export async function resolveContactId(
  scope: Scope,
  v: { vendor: string | null; vendorTaxId: string | null; vendorAddress: string | null },
): Promise<{ ok: true; ref: ContactRef } | { ok: false; error: string }> {
  const taxId = digitsOnly(v.vendorTaxId);

  // Only use the cache when we have a real tax ID — empty string is NOT a unique key.
  // Using "" as a cache key would map ALL no-taxId vendors to the first vendor ever
  // cached, assigning a wrong TRCloud contact_id to every subsequent no-taxId AP.
  if (taxId) {
    const where = { orgId: scope.orgId, companyId: scope.companyId, taxId };
    const cached = await prisma.ledgerTrcloudContact.findUnique({ where: { orgId_companyId_taxId: where } });
    if (cached) return { ok: true, ref: { contactId: cached.contactId, codeNumber: cached.codeNumber } };
  }

  const name = taxId ? (v.vendor || "ไม่ระบุชื่อผู้ขาย") : "เจ้าหนี้เบ็ดเตล็ด (LedgerLine)";
  let ref: ContactRef | null = null;
  if (taxId) ref = await searchContactByTaxId(taxId);
  if (!ref) {
    const created = await createContact({ name, taxId, organization: v.vendor, address: v.vendorAddress });
    if (!created.ok) return created;
    ref = created.ref;
  }
  // Only upsert the cache for a real tax ID — no-taxId vendors are never cached.
  if (taxId) {
    const where = { orgId: scope.orgId, companyId: scope.companyId, taxId };
    await prisma.ledgerTrcloudContact.upsert({
      where: { orgId_companyId_taxId: where },
      update: { contactId: ref.contactId, codeNumber: ref.codeNumber, name },
      create: { ...where, contactId: ref.contactId, codeNumber: ref.codeNumber, name },
    });
    // P0#12 / P1#10 FIX — concurrent race: two requests both miss the cache and both
    // call createContact before either upsert commits.  The upsert above resolves the
    // DB row but `ref` still holds whichever TRCloud contact_id this request created
    // (the other request may have won with a different contact_id).  Re-read the
    // canonical row from the DB so both requests converge on the same contact_id.
    const canonical = await prisma.ledgerTrcloudContact.findUnique({ where: { orgId_companyId_taxId: where } });
    if (canonical) {
      ref = { contactId: canonical.contactId, codeNumber: canonical.codeNumber };
    }
  }
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

// ── ประเภทการซื้อ → SKU อัตโนมัติ (CEO 2026-06-10) ────────────────────────────
// ไม่ต้องตั้ง SKU มือต่อประเภทค่าใช้จ่าย: ถ้า trcloudProductCode ว่าง → ใช้ประเภทที่ AI
// อ่านได้ (purchaseType) แปลงเป็น 1 ใน 3 SKU. ถ้า AI ไม่ได้ระบุ (บิลเก่า) → เดาจากชื่อ
// ประเภทค่าใช้จ่าย. default ไม่ชัด = service (JPS-101) ตามที่ CEO เลือก "นำด้วย 101".
// (สินค้าทำสต๊อกใช้เมนู "รับเข้าคลัง" แยกต่างหาก — ไม่เกี่ยวกับ AP push นี้.)
const SKU_BY_TYPE: Record<PurchaseType, string> = {
  goods: "JPS-100",
  service: "JPS-101",
  construction: "JPS-103",
};

/** GL สำรองเมื่อประเภทค่าใช้จ่ายยังไม่ได้ตั้งรหัสบัญชี — "รายจ่ายยังไม่ได้แยกประเภท"
 *  (นักบัญชีไปจัดประเภทใน TRCloud ภายหลัง). push จะไม่บล็อกเพราะขาด GL อีกต่อไป. */
const GL_FALLBACK = "5919999";

/** เดาประเภทการซื้อจากชื่อประเภทค่าใช้จ่าย — ใช้เมื่อ AI ไม่ได้ระบุ (บิลเก่า).
 *  ลำดับสำคัญ: construction → goods (จับ "น้ำมัน"/วัสดุ/สินค้า) → service.
 *  goods ต้องมาก่อน service เพราะ "ค่าน้ำมัน..." มี "น้ำ" ที่ service จับ → จะเพี้ยนเป็นบริการ. */
function inferPurchaseTypeFromCategory(categoryName: string | null): PurchaseType {
  const n = (categoryName ?? "").toLowerCase();
  if (n.includes("ก่อสร้าง") || n.includes("ต่อเติม") || n.includes("รับเหมา")) return "construction";
  // goods ก่อน: น้ำมัน(เชื้อเพลิง)/สินค้า/วัตถุดิบ/วัสดุ/อุปกรณ์/เครื่องเขียน
  if (
    n.includes("น้ำมัน") || n.includes("สินค้า") || n.includes("วัตถุดิบ") ||
    n.includes("วัสดุ") || n.includes("อุปกรณ์") || n.includes("เครื่องเขียน")
  )
    return "goods";
  // service: ใช้ "ประปา" (ไม่ใช่ "น้ำ" เปล่า — กันชนน้ำมัน), ไฟ/เน็ต/โทร/เช่า/จ้าง/บริการ/วิชาชีพ ฯลฯ
  if (
    n.includes("บริการ") || n.includes("จ้าง") || n.includes("เช่า") || n.includes("ธรรมเนียม") ||
    n.includes("ที่ปรึกษา") || n.includes("ซ่อม") || n.includes("ประปา") || n.includes("ไฟ") ||
    n.includes("เน็ต") || n.includes("อินเทอร์เน็ต") || n.includes("โทรศัพท์") || n.includes("ขนส่ง") ||
    n.includes("เดินทาง") || n.includes("โฆษณา") || n.includes("การตลาด") || n.includes("บัญชี") ||
    n.includes("ภาษี") || n.includes("เงินเดือน") || n.includes("รับรอง")
  )
    return "service";
  return "service";
}

/** SKU ที่จะใช้จริง: ตั้งมือ (ถ้ามี) > AI purchaseType > เดาจากชื่อประเภท. ไม่มีวันว่าง. */
function resolveEffectiveSku(e: PushableExpense): string {
  if (e.trcloudProductCode) return e.trcloudProductCode;
  const type = normalizePurchaseType(e.purchaseType) ?? inferPurchaseTypeFromCategory(e.categoryName);
  return SKU_BY_TYPE[type];
}

// ── AP line builder ──────────────────────────────────────────────────────────
export type PushableExpense = {
  id: string;
  orgId: string;
  companyId: string;
  docCode: string;
  docType?: string | null;             // 'quotation' → tax_report forced to "0" (P1#24)
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
  trcloudProductCode: string | null;   // fixed SKU e.g. "JPS-101" — null → เลือกอัตโนมัติจาก purchaseType
  purchaseType: string | null;         // AI: goods/service/construction → เลือก SKU อัตโนมัติเมื่อ trcloudProductCode ว่าง
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
  vat: string;    // VAT AMOUNT for this line (TRCloud's PO `vat` field = amount, not rate)
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

  // P0#11 FIX — discount double-counting:
  // TRCloud applies header-level "discount" on top of line subtotals, so sending
  // both header discount AND lines built from e.subtotal (pre-discount) deducts
  // the discount twice.  Fix: embed discount into the line amount and send
  // header discount="0".  The caller must set payload.discount="0" accordingly.
  //
  // Net base = e.subtotal - e.discount (what TRCloud should see before VAT).
  const netBase = round2(e.subtotal - (e.discount > 0 ? e.discount : 0));

  // For tax_option="in": line price = VAT-inclusive = base + VAT
  // Use items if they sum to subtotal, else one summary line.
  // When a header discount exists, bypass per-item breakdown and use one net line
  // to avoid complex per-item discount splitting.
  const itemsSum = round2(e.items.reduce((s, it) => s + (it.amount || 0), 0));
  const useItems = e.items.length > 0
    && Math.abs(itemsSum - e.subtotal) < 0.05
    && e.discount === 0;  // if there's a discount, use single net-base line

  const rows = useItems
    ? e.items.map((it) => ({
        desc: it.description || e.categoryName || "ค่าใช้จ่าย",
        baseAmount: round2(it.amount),
        qty: it.qty || 1,
      }))
    : [{
        desc: e.categoryName ? `${e.categoryName}${e.vendor ? ` - ${e.vendor}` : ""}` : (e.vendor || "ค่าใช้จ่าย"),
        baseAmount: netBase,
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
      // TRCloud's PO `vat` field is an AMOUNT (proven by live test 2026-06-13: sending
      // "7" booked VAT=฿7 not 7%). Send this line's actual VAT amount (฿), not the rate.
      vat: String(round2(lineVat)),
      acc_code: accCode,
    });
  }
  return { ok: true, lines };
}

export function toIsoDate(d: Date | string | null): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ── main push ────────────────────────────────────────────────────────────────

/**
 * Push ONE confirmed expense into TRCloud as a PO (ใบสั่งซื้อ, company 45, VAT-in, draft).
 * บัญชีจะแปลง PO→AP ใน TRCloud เพื่อลงบัญชี+VAT จริง.
 * Validates all required mappings before sending; blocks with clear Thai error if missing.
 */
export async function pushExpenseToTrcloud(
  e: PushableExpense,
): Promise<{ ok: true; docId: string | null; docNo: string | null } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  }

  // ── Auto-resolve SKU + GL (CEO 2026-06-10) ─────────────────────────────────
  // SKU ไม่ต้องตั้งมือ: AI เลือก 1 ใน 3 (JPS-100/101/103) จากประเภทการซื้อ. GL ถ้าหมวด
  // ยังไม่ได้ตั้ง → ใช้ 5919999 (ยังไม่แยกประเภท) — push ไม่บล็อกเพราะขาด SKU/GL อีกต่อไป.
  const eff: PushableExpense = {
    ...e,
    trcloudProductCode: resolveEffectiveSku(e),
    categoryAccCode: e.categoryAccCode || GL_FALLBACK,
  };
  // แผนก (นิติบุคคล) จำเป็น — ต้องรู้ว่าลงบัญชีบริษัทไหน.
  // โครงการ (สาขา/cost center) เป็น optional: ค่าใช้จ่ายส่วนกลางไม่ต้องผูกสาขา (CEO 2026-06-23).
  if (!eff.branchTrcloudDepartment) {
    return { ok: false, error: "สาขานี้ยังไม่มีรหัสแผนก TRCloud — ตั้งค่าใน Settings → สาขา → TRCloud" };
  }

  const scope: Scope = { orgId: eff.orgId, companyId: eff.companyId };

  // 1) vendor → contact_id
  const contact = await resolveContactId(scope, {
    vendor: e.vendor, vendorTaxId: e.vendorTaxId, vendorAddress: e.vendorAddress,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };

  // 2) line items (fixed SKU + acc_code) — eff has SKU/GL auto-resolved
  const built = await buildLines(scope, eff);
  if (!built.ok) return { ok: false, error: `สินค้า: ${built.error}` };

  // 3) create PO
  // P1#19 FIX — idempotent PO push (timeout + retry dedup):
  // If a previous push timed out TRCloud may have already created the PO.
  // Search by reference (e.docCode) before creating; if found, return it directly.
  {
    const searchR = await post("po/search.php", { keyword: e.docCode, limit: "5" });
    const searchList = asArr(searchR.data?.data) ?? asArr(searchR.data?.result) ?? asArr(searchR.data?.body) ?? [];
    for (const row of searchList) {
      const o = asObj(row);
      if (!o) continue;
      const ref = pick(o, "reference", "ref");
      if (ref && ref.trim() === e.docCode.trim()) {
        const docId = pick(o, "id", "document_id");
        const docNo = pick(o, "document_number", "no");
        return { ok: true, docId, docNo };
      }
    }
  }

  const issue = toIsoDate(e.docDate);
  const payload: Json = {
    issue_date: issue,
    delivery_due: issue,        // PO: กำหนดส่งของ (แทน due_date/tax_date ของ AP)
    company_format: "PO",       // ใบสั่งซื้อ — บัญชีแปลง PO→AP ใน TRCloud เพื่อลงบัญชีจริง
    type: "po",
    status: "New",              // PO บังคับช่อง status (ไม่ใส่ = 406)
    document_number: "",        // autorun
    payment_term: "0",
    reference: e.docCode,
    // P0#11 FIX — discount already embedded into line baseAmount inside buildLines().
    // Sending a non-zero header discount here would deduct it a second time in TRCloud.
    discount: "0",
    wht: String(round2(e.wht)),
    tax_option: "in",           // VAT-inclusive (VAT ยังโชว์บน PO ให้บัญชีเห็นยอด)
    // หมายเหตุ: PO ไม่มีช่อง tax_report และไม่ post GL — VAT/บัญชีจริงเกิดตอนแปลงเป็น AP.
    approve_status: "",         // ว่าง = ไม่ติดรอแก้ไข + ลบได้ (เหมือน PO จริงทุกใบใน TRCloud)
    department: e.branchTrcloudDepartment,  // นิติบุคคล/VAT branch
    project: e.branchTrcloudProject ?? "",  // สาขา (optional — ส่วนกลางเว้นว่างได้)
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

  const r = await post("po/create.php", payload);
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
  const docId = pick(inner, "id", "document_id", "doc") ?? pick(r.data, "id", "document_id", "doc");
  const docNo = pick(inner, "document_number", "no") ?? pick(r.data, "document_number", "no");
  // Defence-in-depth: a genuine create ALWAYS returns a document id/number. If we
  // get neither, treat it as a failure rather than stamping a phantom "sent" — the
  // accountant should re-push, not believe a row reached TRCloud when it didn't.
  if (!docId && !docNo) {
    return { ok: false, error: `TRCloud ไม่คืนเลขเอกสาร — ส่งไม่สำเร็จ (${errMsg(r)})` };
  }
  return { ok: true, docId, docNo };
}

// ── PO → AP conversion (ลงบัญชีจริง) ─────────────────────────────────────────
// CEO 2026-07-21: พอได้สลิปโอน หรือกดเองในโปรแกรม → แปลง PO ตั้งต้นเป็น AP (ใบกำกับภาษีซื้อ)
// ที่ลงบัญชีจริง. ผังบัญชี Dr ค่าใช้จ่าย(GL) + Dr ภาษีซื้อ 1432000 / Cr เจ้าหนี้ 2101000 →
// TRCloud ลงให้อัตโนมัติจาก acc_code(รายบรรทัด) + tax_report + AP type → พนักงานไม่ต้องเลือก
// เดบิต/เครดิตเอง (แก้ปัญหาเลือกผิด). AP เป็น "ร่าง" (approve_status=wait) ให้บัญชี approve ก่อน post.
//
// วิธี: สร้าง AP แบบ standalone ผ่าน ap/create.php (แบบเดียวกับ path รับเข้าคลังที่พิสูจน์แล้ว)
// แล้วลบ PO ตั้งต้นทิ้ง (PO เป็น seed doc ไม่ post GL). ไม่ใช้ช่อง `po` linkage เพราะ TRCloud
// ต้องการ id ตัวเลขและ error ง่าย ("Linkage ID cannot be ZERO", live test 2026-07-21) —
// reference=docCode ผูก PO↔AP เชิงตรรกะอยู่แล้ว.
const AP_TYPE_CASH   = process.env.TRCLOUD_AP_TYPE_CASH   ?? "Cash[AP]";
const AP_TYPE_CREDIT = process.env.TRCLOUD_AP_TYPE_CREDIT ?? "Credit[AP]";
// สูตร "LL" (LedgerLine) — 1 สูตร ลงบัญชีต่อหมวดผ่าน "ช่อง c" (c1..c21 หมวด · c22/c23 ภาษีซื้อ).
// ใบ AP เครดิตส่ง type:"LL" + ค่าเข้า c-slot ของหมวด → journal ลงบัญชีถูกในตัวใบ (ไม่ตก 5919999).
// ต้องมีสูตร "LL" ใน TRCloud ก่อน (นักบัญชีสร้าง). ไม่มี/หมวดไม่รู้จัก → fallback Credit[AP] (เดิม).
const AP_FORMULA_LL = process.env.LEDGER_TRCLOUD_AP_FORMULA ?? "LL";
// company_format ของใบ AP — ต้องตรงกับที่ PV (trcloud-pv.ts) อ้างถึงในช่อง ITEM.company_format
// (live PV จริงใช้ค่านี้ ไม่ใช่ "AP" ตามตัวอย่างในเอกสาร). One source of truth. ค่า default = ค่าเดิม "JPS_AP".
export const AP_COMPANY_FORMAT = process.env.TRCLOUD_AP_COMPANY_FORMAT ?? "JPS_AP";

export async function convertExpensePoToAp(
  e: PushableExpense,
  opts: { poDocId?: string | null; slipUrl?: string | null; creditForm?: boolean } = {},
): Promise<{ ok: true; apDocId: string | null; apDocNo: string | null } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  }
  // SKU + GL auto-resolve (เหมือน push PO): SKU 1 ใน 3, GL จากหมวด (ไม่มี → 5919999).
  const eff: PushableExpense = {
    ...e,
    trcloudProductCode: resolveEffectiveSku(e),
    categoryAccCode: e.categoryAccCode || GL_FALLBACK,
  };
  if (!eff.branchTrcloudDepartment) {
    return { ok: false, error: "สาขานี้ยังไม่มีรหัสแผนก TRCloud — ตั้งค่าใน Settings → สาขา → TRCloud" };
  }
  const scope: Scope = { orgId: eff.orgId, companyId: eff.companyId };

  // 1) vendor → contact_id
  const contact = await resolveContactId(scope, {
    vendor: e.vendor, vendorTaxId: e.vendorTaxId, vendorAddress: e.vendorAddress,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };

  // 2) line items (fixed SKU + acc_code GL)
  const built = await buildLines(scope, eff);
  if (!built.ok) return { ok: false, error: `สินค้า: ${built.error}` };

  // 3) idempotency — AP อาจมีอยู่แล้ว (retry หลัง timeout). เจอ = คืนเลย ไม่สร้างซ้ำ.
  {
    const sr = await post("ap/search.php", { keyword: e.docCode, limit: "5" });
    const list = asArr(sr.data?.data) ?? asArr(sr.data?.result) ?? asArr(sr.data?.body) ?? [];
    for (const row of list) {
      const o = asObj(row);
      const ref = pick(o, "reference", "ref");
      if (ref && ref.trim() === e.docCode.trim()) {
        const apDocId = pick(o, "expense_id", "id", "document_id");
        const apDocNo = pick(o, "document_number", "no");
        if (apDocId || apDocNo) return { ok: true, apDocId, apDocNo };
      }
    }
  }

  // 4) create AP (บัญชีจริง). ใบเสนอราคา / VAT ขอคืนไม่ได้ → tax_report=0 (ไม่เข้า ภ.พ.30).
  const issue = toIsoDate(e.docDate);
  const taxReport = e.docType === "quotation" || !eff.inputVatClaimable ? "0" : "1";
  // AP ต้องเป็น "เครดิต/ตั้งเจ้าหนี้" (ไม่ใช่ Cash[AP]) เมื่อจะมีใบ PV มาจ่ายทีหลัง — ไม่งั้น Cash[AP]
  // เครดิตเงินสดในตัว AP เลย = จ่ายซ้ำกับ PV + ไม่มีเจ้าหนี้ให้ PV อ้าง. สองทางที่ทำให้เป็นเครดิต:
  //  • creditForm (เส้น PV per-request ของเรา · active) — บังคับเครดิตแม้บิลถูก mark paid แล้ว.
  //  • autoPv (flag LEDGER_AUTO_PV_ENABLED · dormant/OFF default · เส้น per-expense ของ session อื่น).
  // ทั้งคู่ OFF → พฤติกรรมเดิม 100% (Cash ถ้าจ่าย/Credit ถ้ายัง · approve_status="wait" · company_format เดิม).
  const autoPv = isAutoPvEnabled();
  const apType = (opts.creditForm || autoPv)
    ? AP_TYPE_CREDIT
    : ((e.paymentStatus ?? "unpaid") === "paid" ? AP_TYPE_CASH : AP_TYPE_CREDIT);
  // approve_status = "" (ว่าง) เหมือนเอกสารจริงทุกใบใน TRCloud (survey: AP 95/100 · PO/PV 100/100 = "")
  // → โพสต์เป็น Debtor ปกติ "ไม่ติดรอแก้ไข" (ที่ "wait" ทำ) และ "ลบ/แก้ได้" (ที่ "yes" ล็อกถาวร ทำไม่ได้).
  // CEO 2026-07-26: "เอกสารใบอื่นไม่ติดอนุมัติ ปล่อยโล่งได้ ดูใบอื่นสิ" → ตรงกับค่าว่างนี้.
  const apApproveStatus = "";
  const apCompanyFormat = autoPv ? AP_COMPANY_FORMAT : "JPS_AP";
  const slipNote = opts.slipUrl ? ` · สลิปโอน: ${opts.slipUrl}` : "";
  // สูตร "LL" — ลงบัญชีต่อหมวดผ่าน "ช่อง c" ในตัวใบ AP (เฉพาะเคสเครดิต + หมวดมาตรฐานที่มี c-slot).
  // ส่ง c<หมวด>=ยอดสุทธิ (net) + c22/c23=VAT (ถ้ามี) → grand_total(เจ้าหนี้) auto จาก product.
  // journal อยู่ในตัวใบ → ไม่ตก 5919999 · ไม่มีชุดแยก · ไม่ต้องลบ. หมวดไม่รู้จัก/จ่ายสด → fallback Credit[AP].
  // creditForm/autoPv → ใช้ LL แม้ paid (ผังบัญชีถูก + มีเจ้าหนี้ให้ PV เคลียร์). เส้นปกติ: LL เฉพาะบิลยังไม่จ่าย.
  // 🔴 FIX 2026-08-11: เดิมเช็คแค่ opts.creditForm — ไม่เช็ค autoPv เหมือน apType ด้านบน (บรรทัด 590)
  // → เปิด LEDGER_AUTO_PV_ENABLED แล้ว apType ไปเป็น Credit[AP] ถูก แต่ llSlot ยังโดนบังคับ null เพราะ
  // paymentStatus==="paid" && !creditForm → Credit[AP] "เปล่า" (ไม่มี c-slot) = ตก 5919999 เหมือนเดิม
  // (พิสูจน์จาก AP 551563 · ดู memory ledger-trcloud-auto-pv-flag-never-enabled-2026-08-11). เพิ่ม autoPv
  // เข้าเงื่อนไขให้ตรงกับ apType — autoPv เปิด = ทุกบิลจ่ายแล้วก็ยังพยายาม LL ก่อนเสมอ.
  const llSlot = (opts.creditForm || autoPv || (e.paymentStatus ?? "unpaid") !== "paid")
    ? llCSlotForGl(eff.categoryAccCode)
    : null;
  const useLL = !!llSlot;
  const llNet = round2(eff.subtotal - (eff.discount || 0));
  const llVat = round2(eff.vat);
  const llSlots: Json = useLL
    ? {
        [llSlot!]: llNet.toFixed(2),
        ...(llVat > 0
          ? { [eff.inputVatClaimable ? LL_SLOT_VAT_CLAIMABLE : LL_SLOT_VAT_NONCLAIM]: llVat.toFixed(2) }
          : {}),
      }
    : {};
  const payload: Json = {
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: apCompanyFormat,
    document_number: "",
    payment_term: "0",
    reference: e.docCode,
    discount: "0",
    // WHT: เส้น LL (เครดิต) เจ้าหนี้ = ยอดเต็ม (gross) · หัก ณ ที่จ่ายไปลงตอน "จ่ายจริง" (PV)
    // ไม่ใช่ตอนตั้งหนี้ (AP) — กันจอง 2325300 ซ้ำ 2 เด้ง (AP+PV). เส้น Cash/Credit[AP] เดิมคงพฤติกรรมเดิม.
    wht: useLL ? "0" : String(round2(e.wht)),
    tax_option: "in",           // ราคา VAT-inclusive (ค่าใช้จ่ายเก็บยอดรวม VAT)
    tax_report: taxReport,
    type: useLL ? AP_FORMULA_LL : apType, // LL ลงบัญชีต่อหมวด · ไม่งั้น Cash/Credit[AP] (apType: flag ON=Credit)
    approve_status: apApproveStatus, // flag ON: "yes" (auto-approve) · OFF: "wait" (ร่าง — บัญชี approve)
    department: eff.branchTrcloudDepartment,
    project: eff.branchTrcloudProject ?? "",
    invoice_note: (e.note ? `${e.note} · ` : "") + `LedgerLine · อ้างอิง ${e.docCode}${slipNote}`,
    ...(opts.slipUrl ? { url: opts.slipUrl } : {}), // แนบลิงก์สลิปโอน (ถ้า TRCloud รับ)
    // ช่อง c ของสูตร LL → journal ลงบัญชีถูกในตัวใบ (CEO 2026-07-25 · แทน Path A formula:manual ที่ TRCloud เมิน)
    ...llSlots,
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
  const apDocId = pick(inner, "id", "expense_id", "document_id", "doc") ?? pick(r.data, "id", "expense_id", "document_id");
  const apDocNo = pick(inner, "document_number", "no") ?? pick(r.data, "document_number", "no");
  if (!apDocId && !apDocNo) {
    return { ok: false, error: `TRCloud ไม่คืนเลขเอกสาร AP — แปลงไม่สำเร็จ (${errMsg(r)})` };
  }

  // 5) ลบ PO ตั้งต้นทิ้ง (best-effort) — PO เป็น seed doc ไม่ post GL, กัน draft ค้างซ้ำใน TRCloud.
  //    AP สร้างสำเร็จแล้วสำคัญกว่า — PO ลบไม่ได้ก็ปล่อย (แค่ draft ค้าง ไม่กระทบบัญชี).
  if (opts.poDocId) {
    await post("po/delete.php", { id: opts.poDocId });
  }
  return { ok: true, apDocId, apDocNo };
}

/** อัพเดตใบ AP ที่ส่งเข้า TRCloud แล้ว (ap/update.php) — CEO 2026-07-26 "แก้บิลหลังส่งแล้ว
 *  ให้ไปอัพเดตใบใน TRCloud ด้วย". payload = ชุดเดียวกับ convertExpensePoToAp (create) เป๊ะ
 *  + `id`/`document_number` ของใบเดิม → TRCloud แทนที่เนื้อใบทั้งใบ (full replace).
 *  ⚠️ MUST keep payload in sync กับ convertExpensePoToAp (ถ้าแก้ payload create ต้องแก้ที่นี่ด้วย).
 *  ⚠️ ห้ามเรียกถ้าใบมี PV แล้ว (แก้ยอด AP = journal ของ PV เพี้ยน) — caller เป็นคน guard. */
export async function updateExpenseAp(
  e: PushableExpense,
  apDocId: string,
  apDocNo: string | null,
  opts: { creditForm?: boolean } = {},
): Promise<{ ok: true; apDocId: string; apDocNo: string | null } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  }
  const eff: PushableExpense = {
    ...e,
    trcloudProductCode: resolveEffectiveSku(e),
    categoryAccCode: e.categoryAccCode || GL_FALLBACK,
  };
  if (!eff.branchTrcloudDepartment) {
    return { ok: false, error: "สาขานี้ยังไม่มีรหัสแผนก TRCloud — ตั้งค่าใน Settings → สาขา → TRCloud" };
  }
  const scope: Scope = { orgId: eff.orgId, companyId: eff.companyId };
  const contact = await resolveContactId(scope, {
    vendor: e.vendor, vendorTaxId: e.vendorTaxId, vendorAddress: e.vendorAddress,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };
  const built = await buildLines(scope, eff);
  if (!built.ok) return { ok: false, error: `สินค้า: ${built.error}` };

  const issue = toIsoDate(e.docDate);
  const taxReport = e.docType === "quotation" || !eff.inputVatClaimable ? "0" : "1";
  const autoPv = isAutoPvEnabled();
  const apType = (opts.creditForm || autoPv)
    ? AP_TYPE_CREDIT
    : ((e.paymentStatus ?? "unpaid") === "paid" ? AP_TYPE_CASH : AP_TYPE_CREDIT);
  const apCompanyFormat = autoPv ? AP_COMPANY_FORMAT : "JPS_AP";
  // 🔴 FIX 2026-08-11: sync กับ convertExpensePoToAp — เติม autoPv เข้าเงื่อนไข llSlot (ดู comment ที่นั่น).
  const llSlot = (opts.creditForm || autoPv || (e.paymentStatus ?? "unpaid") !== "paid")
    ? llCSlotForGl(eff.categoryAccCode)
    : null;
  const useLL = !!llSlot;
  const llNet = round2(eff.subtotal - (eff.discount || 0));
  const llVat = round2(eff.vat);
  const llSlots: Json = useLL
    ? {
        [llSlot!]: llNet.toFixed(2),
        ...(llVat > 0
          ? { [eff.inputVatClaimable ? LL_SLOT_VAT_CLAIMABLE : LL_SLOT_VAT_NONCLAIM]: llVat.toFixed(2) }
          : {}),
      }
    : {};
  const payload: Json = {
    id: apDocId, // ← ต่างจาก create: อ้าง id ใบเดิมเพื่อแทนที่ (update)
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: apCompanyFormat,
    document_number: apDocNo ?? "", // คงเลขใบเดิม (ไม่ให้ TRCloud ออกเลขใหม่)
    payment_term: "0",
    reference: e.docCode,
    discount: "0",
    wht: useLL ? "0" : String(round2(e.wht)),
    tax_option: "in",
    tax_report: taxReport,
    type: useLL ? AP_FORMULA_LL : apType,
    approve_status: "",
    department: eff.branchTrcloudDepartment,
    project: eff.branchTrcloudProject ?? "",
    invoice_note: (e.note ? `${e.note} · ` : "") + `LedgerLine · อ้างอิง ${e.docCode} · แก้ไขจากในระบบ`,
    ...llSlots,
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

  const r = await post("ap/update.php", payload);
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  return { ok: true, apDocId, apDocNo };
}

/** อัพเดตใบ PO ที่ยังไม่แปลงเป็น AP (po/update.php) — payload = ชุดเดียวกับ pushExpenseToTrcloud
 *  (create PO) เป๊ะ + id/document_number ใบเดิม. ใช้เมื่อบิลส่ง PO แล้วแต่ยังไม่แปลง AP.
 *  ⚠️ MUST keep payload in sync กับ pushExpenseToTrcloud. */
export async function updateExpensePo(
  e: PushableExpense,
  poDocId: string,
  poDocNo: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  }
  const eff: PushableExpense = {
    ...e,
    trcloudProductCode: resolveEffectiveSku(e),
    categoryAccCode: e.categoryAccCode || GL_FALLBACK,
  };
  if (!eff.branchTrcloudDepartment) {
    return { ok: false, error: "สาขานี้ยังไม่มีรหัสแผนก TRCloud — ตั้งค่าใน Settings → สาขา → TRCloud" };
  }
  const scope: Scope = { orgId: eff.orgId, companyId: eff.companyId };
  const contact = await resolveContactId(scope, {
    vendor: e.vendor, vendorTaxId: e.vendorTaxId, vendorAddress: e.vendorAddress,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า: ${contact.error}` };
  const built = await buildLines(scope, eff);
  if (!built.ok) return { ok: false, error: `สินค้า: ${built.error}` };

  const issue = toIsoDate(e.docDate);
  const payload: Json = {
    id: poDocId, // ← ต่างจาก create: อ้าง id ใบเดิมเพื่อแทนที่
    issue_date: issue,
    delivery_due: issue,
    company_format: "PO",
    type: "po",
    status: "New",
    document_number: poDocNo ?? "",
    payment_term: "0",
    reference: e.docCode,
    discount: "0",
    wht: String(round2(e.wht)),
    tax_option: "in",
    approve_status: "",
    department: eff.branchTrcloudDepartment,
    project: eff.branchTrcloudProject ?? "",
    invoice_note: e.note
      ? `${e.note} · อ้างอิง ${e.docCode} · แก้ไขจากในระบบ`
      : `LedgerLine · อ้างอิง ${e.docCode} · แก้ไขจากในระบบ`,
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
  const r = await post("po/update.php", payload);
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  return { ok: true };
}

/** Delete a pushed doc ("ยกเลิกการส่ง" / test cleanup). Tries PO first (current model),
 *  then falls back to AP so docs pushed before the AP→PO switch can still be cancelled. */
export async function deleteTrcloudAp(docId: string): Promise<{ ok: boolean; error?: string }> {
  if (!trcloudPushConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud" };
  const poR = await post("po/delete.php", { id: docId });
  if (isSuccess(poR.data)) return { ok: true };
  const apR = await post("ap/delete.php", { id: docId });
  if (isSuccess(apR.data)) return { ok: true };
  return { ok: false, error: errMsg(poR) };
}

// ── PV (ใบสำคัญจ่าย) — "จ่ายจริง" หลังสลิปโอนปิดคำขอ ─────────────────────────────
// 1 คำขอโอน (1 การโอนเงิน) = 1 PV อ้างได้หลาย AP (item[]). สูตร PV เลือกตาม "ธนาคารต้นทาง"
// (จากสลิป) → journal: Dr เจ้าหนี้ 2101000 (grand_total=Σ ยอด AP) / Cr หัก ณ ที่จ่าย 2325300 (wht)
// / Cr เงินสด-ธนาคาร (grand_total − wht). WHT ลงที่นี่ (ตอนจ่าย) ไม่ใช่ตอนตั้งหนี้ AP.
//
// ⚠️ ambiguity ที่ยังไม่ครอบ (v1): ธนาคารที่มี >1 บัญชี (SCB บ/ช หลัก vs SCB-4107 · TTB 2 บ/ช)
// map ด้วย "รหัสธนาคาร" → บัญชีหลักของธนาคารนั้นเท่านั้น (สลิปไม่ได้อ่านเลขบัญชีต้นทาง). ตั้ง env
// override รายธนาคารได้ ถ้าต้องเปลี่ยนบัญชีหลัก.
const PV_FORMULA_BY_BANK: Record<string, string> = {
  SCB:   process.env.LEDGER_TRCLOUD_PV_FORMULA_SCB   ?? "SCB[PV]",
  BBL:   process.env.LEDGER_TRCLOUD_PV_FORMULA_BBL   ?? "BBL[PV]",
  KBANK: process.env.LEDGER_TRCLOUD_PV_FORMULA_KBANK ?? "KBANK[PV]",
  TTB:   process.env.LEDGER_TRCLOUD_PV_FORMULA_TTB   ?? "TTB[PV]",
};
// ธนาคารต้นทางอ่านไม่ออก (สลิปไม่มี QR) → ใช้บัญชีหลักของกิจการ (ตั้งได้ทาง env).
const PV_FORMULA_DEFAULT = process.env.LEDGER_TRCLOUD_PV_FORMULA_DEFAULT ?? "SCB[PV]";

/** รหัสธนาคารต้นทาง (จากสลิป · 3 หลัก/ตัวย่อ) → สูตร PV บัญชีเงินสด-ธนาคาร.
 *  matched=false = เดาไม่ได้ → ใช้ default (caller ควร log/เตือนบัญชีให้ตรวจ). */
export function pvFormulaForBank(bankCode: string | null | undefined): {
  formula: string;
  bankAbbr: string | null;
  matched: boolean;
} {
  const ab = toAbbr(bankCode);
  const f = ab ? PV_FORMULA_BY_BANK[ab] : null;
  return { formula: f ?? PV_FORMULA_DEFAULT, bankAbbr: ab, matched: !!f };
}

// AP เราใช้ company_format = "JPS_AP" (เลขเอกสารเต็มคือ "JPS_AP"+running). pv/create item
// ต้องแยก company_format กับ document_number ออกจากกัน (TRCloud นำมาต่อกันเองเป็น doc id).
const PV_AP_FORMAT = "JPS_AP";
function splitApDocNo(apDocNo: string): { company_format: string; document_number: string } {
  const t = (apDocNo || "").trim();
  return t.startsWith(PV_AP_FORMAT)
    ? { company_format: PV_AP_FORMAT, document_number: t.slice(PV_AP_FORMAT.length) }
    : { company_format: PV_AP_FORMAT, document_number: t };
}

export type PvItem = { apDocNo: string; amount: number; detail?: string | null };

/**
 * สร้าง PV (ใบสำคัญจ่าย) ใน TRCloud จ่ายชำระ AP หนึ่งใบขึ้นไป (1 การโอน = 1 PV).
 * - `formula` = สูตร PV บัญชีต้นทาง (เช่น "SCB[PV]") จาก pvFormulaForBank(ธนาคารสลิป)
 * - `whtTotal` = ยอดหัก ณ ที่จ่ายรวม (ลง 2325300 ที่ PV · AP ตั้งหนี้เต็ม gross ไว้แล้ว)
 * - `items[].amount` = ยอดเต็มของ AP (gross · เจ้าหนี้) · Σ = grand_total ของ PV
 * idempotent: pv/search ด้วย reference ก่อน — เจอ = คืนเลย ไม่สร้างซ้ำ.
 */
export async function createPvForRequestAps(input: {
  orgId: string;
  companyId: string;
  reference: string;
  formula: string;
  department: string;
  project?: string | null;
  vendor: { name: string; taxId?: string | null; address?: string | null };
  whtTotal: number;
  issueDate: Date | string;
  note?: string | null;
  items: PvItem[];
}): Promise<{ ok: true; pvDocId: string | null; pvDocNo: string | null } | { ok: false; error: string }> {
  if (!trcloudPushConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า TRCloud (env TRCLOUD_JPS_*)" };
  const items = input.items.filter((it) => it.apDocNo && it.apDocNo.trim());
  if (items.length === 0) return { ok: false, error: "ไม่มีใบ AP ให้จ่าย (PV)" };
  if (!input.department) return { ok: false, error: "ไม่มีรหัสแผนก TRCloud สำหรับ PV" };

  const scope: Scope = { orgId: input.orgId, companyId: input.companyId };

  // vendor → contact_id (คู่ค้าเดียวกับ AP · หาเจอเพราะเพิ่งตั้ง AP)
  const contact = await resolveContactId(scope, {
    vendor: input.vendor.name,
    vendorTaxId: input.vendor.taxId ?? null,
    vendorAddress: input.vendor.address ?? null,
  });
  if (!contact.ok) return { ok: false, error: `คู่ค้า (PV): ${contact.error}` };

  // idempotency — PV อาจมีอยู่แล้ว (retry). reference ผูก 1:1 กับคำขอ.
  {
    const sr = await post("pv/search.php", { keyword: input.reference, limit: "5" });
    const list = asArr(sr.data?.data) ?? asArr(sr.data?.result) ?? asArr(sr.data?.body) ?? [];
    for (const row of list) {
      const o = asObj(row);
      const ref = pick(o, "reference", "ref");
      if (ref && ref.trim() === input.reference.trim()) {
        const pvDocId = pick(o, "payment_id", "id", "document_id");
        const pvDocNo = pick(o, "document_number", "no");
        if (pvDocId || pvDocNo) return { ok: true, pvDocId, pvDocNo };
      }
    }
  }

  const issue = toIsoDate(input.issueDate);
  const payload: Json = {
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: "PV",
    document_number: "",
    reference: input.reference,
    wht: String(round2(input.whtTotal)),
    tax_report: "0",
    type: input.formula, // สูตร PV บัญชีต้นทาง (Dr เจ้าหนี้ / Cr wht / Cr ธนาคาร)
    approve_status: "", // ว่าง = โพสต์ปกติ ไม่ติดรอแก้ไข + ยังลบได้ (เหมือนเอกสารจริงทุกใบ)
    department: input.department,
    project: input.project ?? "",
    invoice_note:
      (input.note ? `${input.note} · ` : "") + `LedgerLine · จ่ายชำระ ${input.reference}`,
    customer: {
      group_code: "S",
      code_number: (contact.ref.codeNumber ?? "").replace(/^\D+/, ""),
      name: input.vendor.name || "ไม่ระบุชื่อผู้ขาย",
      organization: input.vendor.name || "",
      branch: "00000",
      address: input.vendor.address || "-",
      email: "",
      telephone: "",
      tax_id: digitsOnly(input.vendor.taxId),
      contact_type: "normal",
      contact_id: contact.ref.contactId,
      add_contact: "0",
    },
    item: items.map((it) => {
      const s = splitApDocNo(it.apDocNo);
      return {
        company_format: s.company_format,
        document_number: s.document_number,
        doc_type: "AP",
        amount: round2(it.amount).toFixed(2),
        detail: it.detail || `จ่ายชำระ ${it.apDocNo}`,
      };
    }),
  };

  const r = await post("pv/create.php", payload);
  if (!isSuccess(r.data)) return { ok: false, error: errMsg(r) };
  const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
  const pvDocId = pick(inner, "payment_id", "id", "document_id", "doc") ?? pick(r.data, "payment_id", "id");
  const pvDocNo = pick(inner, "document_number", "no") ?? pick(r.data, "document_number", "no");
  if (!pvDocId && !pvDocNo) {
    return { ok: false, error: `TRCloud ไม่คืนเลขเอกสาร PV — จ่ายไม่สำเร็จ (${errMsg(r)})` };
  }
  return { ok: true, pvDocId, pvDocNo };
}
