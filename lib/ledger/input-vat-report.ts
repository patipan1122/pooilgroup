import "server-only";
import { prisma } from "@/lib/prisma";
import { OUR_BUYER } from "@/lib/ledger/group-identity";

// รายงานภาษีซื้อ (Input VAT / ภ.พ.30 · CEO 2026-07-24)
// ดึง "บิลที่มี VAT" ของบริษัท/สาขา/เดือน แล้วบอกว่าแต่ละใบ:
//   - มีใบกำกับภาษีเต็มรูป (ในนามเจพีซิ้งค์) ไหม  → completenessStatus (เขียว/เหลือง/แดง)
//   - ขอคืน VAT ได้ไหม (inputVatClaimable) + เหตุผลถ้าไม่ได้ (inputVatBlockReason)
// ข้อมูลทั้งหมดคิด/เก็บไว้แล้วตอน AI สแกน (gradeCompleteness) — ที่นี่แค่รวบเป็นรายงาน (read-only).

export type InputVatRow = {
  id: string;
  docCode: string;
  docDate: string | null; // YYYY-MM-DD
  vendor: string | null;
  vendorTaxId: string | null;
  vat: number;
  total: number;
  docType: string;
  categoryName: string | null;
  completenessStatus: string; // green_full | yellow_partial | red_invalid | undecided
  inputVatClaimable: boolean | null; // true=ขอคืนได้ · false/null=ยังไม่ได้/ไม่ได้
  inputVatBlockReason: string | null;
  buyerMatchStatus: string; // matched | mismatch | not_found_on_doc | undecided
  trcloudDocNo: string | null;
};

export type InputVatReport = {
  month: string; // YYYY-MM
  buyer: { name: string; taxId: string };
  rows: InputVatRow[];
  totals: {
    count: number;
    totalVat: number;
    claimableVat: number; // VAT ที่ขอคืนได้ (inputVatClaimable=true)
    blockedVat: number; // VAT ที่ขอคืนไม่ได้/ยังไม่ตัดสิน
    claimableCount: number;
    blockedCount: number;
  };
};

function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split("-").map(Number);
  const gte = new Date(Date.UTC(y, m - 1, 1));
  const lt = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return { gte, lt };
}

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export async function getInputVatReport(
  orgId: string,
  companyId: string,
  opts: { branchId?: string | null; month: string },
): Promise<InputVatReport> {
  const { gte, lt } = monthRange(opts.month);
  const rows = await prisma.ledgerExpense.findMany({
    where: {
      orgId,
      companyId,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      status: { not: "void" },
      vat: { gt: 0 }, // เฉพาะบิลที่มีภาษีซื้อ
      docDate: { gte, lt },
    },
    select: {
      id: true,
      docCode: true,
      docDate: true,
      vendor: true,
      vendorTaxId: true,
      vat: true,
      total: true,
      docType: true,
      completenessStatus: true,
      inputVatClaimable: true,
      inputVatBlockReason: true,
      buyerMatchStatus: true,
      trcloudDocNo: true,
      category: { select: { name: true } },
    },
    orderBy: [{ docDate: "asc" }, { docCode: "asc" }],
  });

  const mapped: InputVatRow[] = rows.map((r) => ({
    id: r.id,
    docCode: r.docCode,
    docDate: fmtDate(r.docDate),
    vendor: r.vendor,
    vendorTaxId: r.vendorTaxId,
    vat: Number(r.vat),
    total: Number(r.total),
    docType: r.docType,
    categoryName: r.category?.name ?? null,
    completenessStatus: r.completenessStatus,
    inputVatClaimable: r.inputVatClaimable,
    inputVatBlockReason: r.inputVatBlockReason,
    buyerMatchStatus: r.buyerMatchStatus,
    trcloudDocNo: r.trcloudDocNo,
  }));

  let totalVat = 0;
  let claimableVat = 0;
  let blockedVat = 0;
  let claimableCount = 0;
  let blockedCount = 0;
  for (const r of mapped) {
    totalVat += r.vat;
    if (r.inputVatClaimable === true) {
      claimableVat += r.vat;
      claimableCount += 1;
    } else {
      blockedVat += r.vat;
      blockedCount += 1;
    }
  }

  return {
    month: opts.month,
    buyer: { name: OUR_BUYER.name, taxId: OUR_BUYER.taxId },
    rows: mapped,
    totals: {
      count: mapped.length,
      totalVat: Math.round(totalVat * 100) / 100,
      claimableVat: Math.round(claimableVat * 100) / 100,
      blockedVat: Math.round(blockedVat * 100) / 100,
      claimableCount,
      blockedCount,
    },
  };
}
