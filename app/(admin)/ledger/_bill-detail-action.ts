"use server";

// LedgerLine — read-only "ดูบิลก่อนแมช/ก่อนโอน" fetch.
//
// หน้า /ledger/to-pay และ /ledger/reconcile เดิมโชว์แค่ "เลข EXP + ยอด" ต่อบิล →
// CEO ดูแล้วไม่รู้ว่าคือบิลอะไร จะแมช/จะโอนถูกไหม. Action นี้ดึง "ไส้ในบิลจริง"
// (รูปใบเสร็จ + รายการสินค้า + เลขที่เอกสาร + ยอด/VAT/หัก ณ ที่จ่าย) มาโชว์ตอนกด
// เท่านั้น — ไม่ preload ทั้งลิสต์ (คุม payload) และ READ-ONLY ล้วน (ไม่มี write).
//
// Security bar (mirror exportReconcileCsv / requireLedgerAccess):
//   • session + module entitlement (non-admin ต้องถือ ledger grant)
//   • company ต้องอยู่ใน org ของผู้เรียก (กันข้ามบริษัท/ข้าม org)
//   • getExpense ผูก where { orgId, companyId, id } → คืน null ถ้าไม่อยู่ใน tenant
// ไม่ต้อง gate expense.export/confirm — แค่ "ดู" บิลที่ผู้ใช้เห็นในลิสต์อยู่แล้ว.

import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { listCompanies } from "@/lib/ledger/queries";
import { getExpense } from "@/lib/ledger/queries";
import type {
  ExpenseDocType,
  ExpenseStatus,
  PaymentStatus,
} from "@/lib/ledger/types";

export type BillDetailImage = {
  url: string;
  kind: "receipt" | "po" | "evidence" | "page";
};

export type BillDetailItem = {
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
  vatRate: number | null;
};

export type BillDetail = {
  id: string;
  docCode: string;
  title: string | null;
  vendor: string | null;
  vendorDocNumber: string | null;
  vendorTaxId: string | null;
  docDate: string | null;
  docType: ExpenseDocType;
  categoryName: string | null;
  subtotal: number;
  discount: number;
  vat: number;
  wht: number;
  total: number;
  status: ExpenseStatus;
  paymentStatus: PaymentStatus;
  items: BillDetailItem[];
  images: BillDetailImage[];
  thumbUrl: string | null;
};

export type BillDetailResult =
  | { ok: true; bill: BillDetail }
  | { ok: false; error: string };

export async function getBillDetailAction(input: {
  expenseId: string;
  companyId: string;
}): Promise<BillDetailResult> {
  if (!input.expenseId || !input.companyId) {
    return { ok: false, error: "ข้อมูลไม่ครบ" };
  }

  // ---- gate ----
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!isAdminTier(session.user.role)) {
    const has = await userHasModuleAccess(session.user, "ledger");
    if (!has) return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }
  const orgId = session.user.org_id;

  // company ต้องอยู่ใน org ของผู้เรียก
  const companies = await listCompanies(orgId);
  if (!companies.some((c) => c.id === input.companyId)) {
    return { ok: false, error: "ไม่พบบริษัท" };
  }

  const exp = await getExpense({
    orgId,
    companyId: input.companyId,
    id: input.expenseId,
  });
  if (!exp) return { ok: false, error: "ไม่พบบิล" };

  // รูปทั้งหมด: รูปใบเสร็จหลัก (originalUrl) ก่อน แล้วตามด้วยไฟล์แนบ (PO/หลักฐาน/หน้าเพิ่ม)
  // dedup by url เผื่อ originalUrl ซ้ำกับ attachment.
  const images: BillDetailImage[] = [];
  const seen = new Set<string>();
  if (exp.originalUrl) {
    images.push({ url: exp.originalUrl, kind: "receipt" });
    seen.add(exp.originalUrl);
  }
  for (const a of exp.attachments ?? []) {
    if (!a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    images.push({ url: a.url, kind: a.kind });
  }

  const bill: BillDetail = {
    id: exp.id,
    docCode: exp.docCode,
    title: exp.title ?? null,
    vendor: exp.vendor,
    vendorDocNumber: exp.vendorDocNumber,
    vendorTaxId: exp.vendorTaxId,
    docDate: exp.docDate,
    docType: exp.docType,
    categoryName: exp.categoryName ?? null,
    subtotal: exp.subtotal,
    discount: exp.discount,
    vat: exp.vat,
    wht: exp.wht,
    total: exp.total,
    status: exp.status,
    paymentStatus: exp.paymentStatus,
    items: (exp.items ?? []).map((it) => ({
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
      vatRate: it.vatRate ?? null,
    })),
    images,
    thumbUrl: exp.thumbUrl,
  };

  return { ok: true, bill };
}
