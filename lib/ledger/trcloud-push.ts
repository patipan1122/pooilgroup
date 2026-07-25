import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizePurchaseType, type PurchaseType } from "@/lib/ledger/types";

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

function isSuccess(d: Json | null): boolean {
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
// ── บัญชีระบบสำหรับ "การลงบัญชีสำเร็จรูป (manual journal)" — ต้องตรงกับ coa-chart.ts ──
// CEO 2026-07-25: JPS_AP auto-formula เมิน acc_code รายบรรทัด → ตกถังรวม 5919999 · เราจึงส่ง
// journal Dr/Cr เอง (formula:manual) ให้ TRCloud ไม่ต้องคำนวณ. หัก ณ ที่จ่ายลงตอนจ่ายเงิน (PV) ไม่ลงที่ AP.
const ACC_INPUT_VAT = "1432000";           // ภาษีซื้อ (ขอคืนได้)
const ACC_INPUT_VAT_NONCLAIM = "5911100";  // ภาษีซื้อไม่ขอคืน (ลงเป็นค่าใช้จ่าย)
const ACC_PAYABLE = "2101000";             // เจ้าหนี้การค้าในประเทศ
const AP_BOOK_ID = "5";                     // สมุดรายวันซื้อ (purchase/expense journal ของ TRCloud)

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

function toIsoDate(d: Date | string | null): string {
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
    approve_status: "wait",     // ฉบับร่าง; รออนุมัติ/แปลงใน TRCloud
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

// สร้าง "การลงบัญชีสำเร็จรูป (manual journal)" สำหรับใบ AP → ส่งให้ TRCloud ตรง ๆ (formula:manual)
// เพื่อกัน auto-formula ของ JPS_AP ที่เมิน acc_code รายบรรทัด → ลงตกถังรวม 5919999.
//   Dr [ผังบัญชีของหมวด] = ยอดสุทธิ (subtotal − discount)
//   Dr [ภาษีซื้อ 1432000 ขอคืนได้ / 5911100 ขอคืนไม่ได้] = VAT (ถ้ามี)
//   Cr [เจ้าหนี้ 2101000] = ยอดรวม (total)
// หัก ณ ที่จ่าย "ไม่" ลงที่ AP (ลงตอนจ่ายเงิน/PV ตามหลักบัญชีไทย · ตรงกับ 3 บรรทัดที่ TRCloud ใช้).
// คืน null เมื่อไม่มีหมวดจริง / ยอดไม่บาลานซ์ → ปล่อยให้ push ทำงานปกติ (ไม่ยัด journal เสีย).
type GlLine = { acc_code: string; dr: string; cr: string; acc_note: string };
function buildApJournal(e: PushableExpense): GlLine[] | null {
  const acc = e.categoryAccCode;
  if (!acc || acc === GL_FALLBACK) return null; // ไม่มีหมวดจริง — guard ที่อื่นบล็อกส่งอยู่แล้ว
  const net = round2(e.subtotal - (e.discount || 0));
  const vat = round2(e.vat);
  const total = round2(e.total);
  if (net <= 0 || total <= 0) return null;
  const lines: GlLine[] = [
    { acc_code: acc, dr: net.toFixed(2), cr: "0.00", acc_note: (e.categoryName || "ค่าใช้จ่าย").slice(0, 120) },
  ];
  if (vat > 0) {
    lines.push({
      acc_code: e.inputVatClaimable ? ACC_INPUT_VAT : ACC_INPUT_VAT_NONCLAIM,
      dr: vat.toFixed(2),
      cr: "0.00",
      acc_note: e.inputVatClaimable ? "ภาษีซื้อ" : "ภาษีซื้อ (ขอคืนไม่ได้)",
    });
  }
  lines.push({ acc_code: ACC_PAYABLE, dr: "0.00", cr: total.toFixed(2), acc_note: "เจ้าหนี้การค้า" });
  // บาลานซ์: ΣDr = ΣCr (net + vat = total). คลาดเกิน 0.02 = ไม่ยัด (กัน journal เพี้ยน)
  if (Math.abs(round2(net + (vat > 0 ? vat : 0)) - total) > 0.02) return null;
  return lines;
}

export async function convertExpensePoToAp(
  e: PushableExpense,
  opts: { poDocId?: string | null; slipUrl?: string | null } = {},
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
  const apType = (e.paymentStatus ?? "unpaid") === "paid" ? AP_TYPE_CASH : AP_TYPE_CREDIT;
  const slipNote = opts.slipUrl ? ` · สลิปโอน: ${opts.slipUrl}` : "";
  // การลงบัญชีสำเร็จรูป — ส่งเอง (formula:manual) กัน TRCloud auto ตก 5919999. null = ไม่พร้อม → auto ตามเดิม.
  const apJournal = buildApJournal(eff);
  const payload: Json = {
    issue_date: issue,
    due_date: issue,
    tax_date: issue,
    company_format: "JPS_AP",
    document_number: "",
    payment_term: "0",
    reference: e.docCode,
    discount: "0",
    wht: String(round2(e.wht)),
    tax_option: "in",           // ราคา VAT-inclusive (ค่าใช้จ่ายเก็บยอดรวม VAT)
    tax_report: taxReport,
    type: apType,               // Cash[AP] จ่ายแล้ว / Credit[AP] ค้างจ่าย (Cr เจ้าหนี้)
    approve_status: "wait",     // ร่าง — บัญชี approve ก่อน post
    department: eff.branchTrcloudDepartment,
    project: eff.branchTrcloudProject ?? "",
    invoice_note: (e.note ? `${e.note} · ` : "") + `LedgerLine · อ้างอิง ${e.docCode}${slipNote}`,
    ...(opts.slipUrl ? { url: opts.slipUrl } : {}), // แนบลิงก์สลิปโอน (ถ้า TRCloud รับ)
    // ส่งการลงบัญชีสำเร็จรูป (Dr/Cr) เอง → TRCloud ไม่ auto → เลิกตก 5919999 (CEO 2026-07-25)
    ...(apJournal ? { formula: "manual", book_id: AP_BOOK_ID, gl_entry: apJournal } : {}),
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
