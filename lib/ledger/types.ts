// LedgerLine — shared types for the ledger (บัญชี/ใบเสร็จ) module.
//
// These are the *client-safe* shapes: Prisma Decimal columns are projected to
// plain `number` before they cross the server→client boundary (Decimal objects
// don't serialize through RSC). Queries do the conversion (see queries.ts).

export type ExpenseStatus = "draft" | "confirmed" | "locked" | "void";
export type ExpenseSource = "line" | "web" | "email";

export type ExpenseDocType =
  | "tax_invoice" // ใบกำกับภาษี
  | "receipt" // ใบเสร็จรับเงิน
  | "cash_bill" // บิลเงินสด
  | "delivery_note" // ใบส่งของ
  | "quotation" // ใบเสนอราคา — นับเป็นค่าใช้จ่ายจริง (D1) · ขอคืน VAT ไม่ได้จนใบกำกับจริงมา supersede
  | "other"; // อื่น ๆ
export type PaymentStatus = "paid" | "unpaid" | "partial";

// — Input-VAT claimability (ภาษีซื้อ) — enums kept as TS unions; the DB columns are
//   plain text (module convention). The buyer match is decided on the 13-digit tax id
//   EXACTLY (never the name / OCR confidence). See lib/ledger/recheck.ts.
export type BuyerMatchStatus =
  | "matched" // เลขภาษีบนใบ === ผู้ซื้อ (เจพีซิ้งค์)
  | "mismatch" // คนละเลข (บริษัทเครืออื่น / นอกเครือ / ผิด 1 หลัก)
  | "not_found_on_doc" // ไม่เจอเลข 13 หลักบนใบ
  | "undecided"; // ยังไม่ตรวจ

export type CompletenessStatus =
  | "green_full" // เต็มรูป + ผู้ซื้อตรง + VAT แยก → ขอคืนได้
  | "yellow_partial" // ใบย่อ ม.86/6 / ขาด element รอง → ขอใบใหม่
  | "red_invalid" // ขาดของบังคับ / ผู้ซื้อผิด → ขอคืนไม่ได้
  | "undecided"; // ยังไม่ตรวจ

export type InputVatBlockReason =
  | "abbreviated_86_6" // ใบกำกับอย่างย่อ ม.86/6
  | "buyer_mismatch" // ผู้ซื้อ = นอกเครือ / ผิด 1 หลัก
  | "wrong_entity" // ผู้ซื้อ = บริษัทอื่นในเครือ
  | "incomplete_invoice" // ขาดองค์ประกอบ ม.86/4 (เลขผู้ขาย / บรรทัด VAT / ฯลฯ)
  | "entertainment" // ค่ารับรอง (v2)
  | "passenger_car" // รถยนต์นั่ง ≤10 ที่นั่ง (v2)
  | "other";

/** One line item read off a receipt. */
export interface ExpenseItem {
  id?: string;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
  vatRate?: number | null;
}

/** A PO / supporting-evidence file attached to an expense (Bainy section 4). */
export interface ExpenseAttachment {
  url: string;
  kind: "po" | "evidence";
  name?: string;
}

/** A single expense row, serialized for the UI. */
export interface Expense {
  id: string;
  orgId: string;
  companyId: string;
  branchId: string | null;
  docCode: string;
  status: ExpenseStatus;
  source: ExpenseSource;
  vendor: string | null;
  vendorTaxId: string | null;
  docDate: string | null; // ISO date (YYYY-MM-DD)
  subtotal: number;
  vat: number;
  wht: number;
  total: number;
  categoryId: string | null;
  categoryName?: string | null;
  paymentMethod: string | null;
  // — Bainy-parity fields —
  docType: ExpenseDocType;
  vendorDocNumber: string | null;
  vendorAddress: string | null;
  vendorBranchCode: string | null;
  discount: number;
  paymentStatus: PaymentStatus;
  claimantName: string | null;
  bankDetail: string | null;
  isRecurring: boolean;
  attachments: ExpenseAttachment[];
  driveWebUrl?: string | null;
  originalUrl: string | null;
  thumbUrl: string | null;
  sha256: string | null;
  ocrModel: string | null;
  ocrConfidence: FieldConfidence | null;
  slipRef: string | null;
  needsReview: boolean;
  note: string | null;
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  exportBatchId: string | null;
  // — TRCloud API push status (null = ยังไม่ส่ง · set = ส่งแล้ว) —
  trcloudDocId: string | null;
  trcloudDocNo: string | null;
  trcloudPushedAt: string | null;
  trcloudError: string | null;
  // — Input-VAT claimability (ภาษีซื้อ) — สถานะสี + ผลตรวจผู้ซื้อ + ใบทดแทน —
  buyerTaxIdSnapshot: string | null;
  buyerNameSnapshot: string | null;
  buyerTaxIdOnDoc: string | null;
  buyerMatchStatus: BuyerMatchStatus;
  completenessStatus: CompletenessStatus;
  completenessMissing: string[] | null;
  completenessCheckedAt: string | null;
  inputVatClaimable: boolean | null;
  inputVatBlockReason: InputVatBlockReason | null;
  replacementOfId: string | null;
  replacedById: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
  overrideReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: ExpenseItem[];
}

/**
 * Per-field OCR confidence (0..1). Keys mirror the receipt fields the AI reads.
 * Anything missing is treated as low confidence by the UI.
 */
export interface FieldConfidence {
  vendor?: number;
  vendor_tax_id?: number;
  doc_date?: number;
  subtotal?: number;
  vat?: number;
  total?: number;
  payment_method?: number;
  category?: number;
  [field: string]: number | undefined;
}

/**
 * Raw structured result returned by ai-parse.parseReceipt() — the AI's reading
 * of a receipt image BEFORE it becomes a draft expense. Amounts are numbers or
 * null (AI must return null, never guess — see ai-parse prompt).
 */
export interface ParsedReceipt {
  vendor: string | null;
  docType?: ExpenseDocType | null; // ประเภทเอกสาร (AI-classified from the header)
  vendorTaxId: string | null;
  buyerTaxIdOnDoc: string | null; // เลขภาษีผู้ซื้อที่ AI อ่านได้บนใบ (13 หลัก หรือ null — ห้ามเดา)
  vendorDocNumber?: string | null; // เลขที่เอกสารของผู้ขาย (invoice no.)
  vendorAddress?: string | null; // ที่อยู่ผู้ขาย
  docDate: string | null; // YYYY-MM-DD
  subtotal: number | null;
  discount?: number | null; // ส่วนลดระดับเอกสาร (ลดฐานภาษี)
  vat: number | null;
  wht: number | null;
  total: number | null;
  paymentMethod: string | null;
  suggestedCategory: string | null;
  items: ExpenseItem[];
  confidence: FieldConfidence;
  ocrModel: string;
  raw: string;
}

/** Result of recheck() math/format validators. */
export interface RecheckResult {
  ok: boolean;
  warnings: string[];
}
