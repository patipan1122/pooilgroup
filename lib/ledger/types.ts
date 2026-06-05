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
  | "other"; // อื่น ๆ
export type PaymentStatus = "paid" | "unpaid" | "partial";

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
