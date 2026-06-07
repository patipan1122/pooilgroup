// GET /api/ledger/vouchers/[type]?expenseId=<uuid>[&reason=...]
//
// Returns a print-ready Thai accounting DOCUMENT (PV / JV / PCV / ใบแทนใบเสร็จ)
// for one CONFIRMED ledger_expense. The browser turns it into a PDF via its
// "Save as PDF" print path (see lib/ledger/vouchers.ts for why HTML-and-print).
//
// Security (financial document → same bar as the export route):
//   - requireSession  → org scope from the session (never user input)
//   - accountant tier (admin + viewer) — vouchers are an accounting artefact
//   - module entitlement for non-admins
//   - org + company scoping on the expense read (RLS is the backstop)
//
// Substitute-receipt guardrail (ILikeTax / RD rule): an "ใบรับรองแทนใบเสร็จ"
// (type=SUB) may ONLY be issued when the expense has NO real tax invoice (we use
// "has a 13-digit vendor tax id" as the proxy for a proper tax invoice) AND the
// caller supplies a written reason. Otherwise → 400 (use the real receipt).
//
// READ-ONLY: this route never writes to the DB and never recomputes tax —
// amounts come verbatim from the stored, human-confirmed expense.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { getExpense } from "@/lib/ledger/queries";
import { buildVoucher, isVoucherType, VOUCHER_LABEL } from "@/lib/ledger/vouchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ type: string }> },
) {
  // 1) Doc type
  const { type } = await ctx.params;
  if (!isVoucherType(type)) {
    return NextResponse.json({ error: "ประเภทเอกสารไม่ถูกต้อง" }, { status: 400 });
  }

  // 2) Auth — accountant tier (vouchers are an accounting artefact).
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = session.user.role;
  const accountant = isAdminTier(role) || role === "viewer";
  if (!accountant) {
    return NextResponse.json(
      { error: "เฉพาะบัญชี/ผู้ดูแลออกเอกสารได้" },
      { status: 403 },
    );
  }
  if (!isAdminTier(role)) {
    const ok = await userHasModuleAccess(session.user, "ledger");
    if (!ok) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" }, { status: 403 });
  }

  // 3) Inputs
  const { searchParams } = new URL(req.url);
  const expenseId = searchParams.get("expenseId")?.trim() ?? "";
  const companyId = searchParams.get("company")?.trim() ?? "";
  const reason = searchParams.get("reason")?.trim() || null;
  if (!expenseId || !companyId) {
    return NextResponse.json({ error: "ต้องระบุ expenseId และ company" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  // 4) Load the expense (org+company scoped — null if not in tenant).
  const expense = await getExpense({ orgId, companyId, id: expenseId });
  if (!expense) {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
  // A voucher is an OFFICIAL accounting artefact — it may only be issued for a
  // human-CONFIRMED row (or a locked/exported one). This route is the real
  // security boundary (the UI only `disabled`s the button), so mirror that rule
  // here: a draft (machine-ingested, never confirmed) must NOT become a printable
  // PV/JV/PCV/substitute-receipt — that is the NEVER-auto-post class of risk.
  if (expense.status !== "confirmed" && expense.status !== "locked") {
    return NextResponse.json(
      { error: "ออกเอกสารได้เฉพาะรายการที่ยืนยันแล้ว — โปรดยืนยันรายการก่อน" },
      { status: 400 },
    );
  }

  // 5) Header lookups — needed early for SUB guardrails (category name check).
  const [company, category, branch] = await Promise.all([
    prisma.company.findFirst({
      where: { id: companyId, orgId },
      select: { name: true, taxId: true, address: true, phone: true, logoUrl: true },
    }),
    expense.categoryId
      ? prisma.ledgerCategory.findFirst({
          where: { id: expense.categoryId, orgId, companyId },
          select: { name: true },
        })
      : Promise.resolve(null),
    expense.branchId
      ? prisma.branch.findFirst({
          where: { id: expense.branchId, orgId, companyId },
          select: { code: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  // 6) Substitute-receipt guardrails (RD / ILikeTax).
  if (type === "SUB") {
    // P1#22 — Category block: หมวดค่ารับรอง / รถยนต์นั่งส่วนบุคคล ไม่สามารถออก
    //   ใบรับรองแทนใบเสร็จได้ตามกฎสรรพากร (ม.65 ตรี + พรฎ. ฉ.143).
    //   ตรวจ categoryName ที่ resolve จาก DB แล้ว (reuse lookup จากข้อ 5 ข้างบน).
    const resolvedCategoryName = (
      category?.name ?? expense.categoryName ?? ""
    ).toLowerCase();

    const SUB_BLOCKED_KEYWORDS = [
      "ค่ารับรอง",
      "entertainment",
      "รถยนต์นั่งส่วนบุคคล",
      "passenger_car",
      "รถยนต์นั่ง",
    ];
    const isCategoryBlocked = SUB_BLOCKED_KEYWORDS.some((kw) =>
      resolvedCategoryName.includes(kw.toLowerCase()),
    );
    if (isCategoryBlocked) {
      return NextResponse.json(
        { error: "หมวดนี้ไม่สามารถออกใบรับรองแทนใบเสร็จได้ตามกฎหมายสรรพากร" },
        { status: 400 },
      );
    }

    // P1#37 — Real invoice check: ถ้ามีใบกำกับภาษีจริงอยู่แล้ว (vendorTaxId ครบ 13 หลัก
    //   AND docType === 'tax_invoice') → ไม่ต้องออกใบรับรองแทน.
    //   Note: เดิม route นี้บล็อกเมื่อมี vendorTaxId เพียงอย่างเดียว แต่ vendorTaxId อาจ
    //   มาจากใบเสนอราคา/บิล (ยังรอใบกำกับจริง) → เพิ่ม docType guard เพื่อไม่บล็อกเกิน.
    const hasValidTaxId =
      !!expense.vendorTaxId &&
      /^\d{13}$/.test(expense.vendorTaxId.replace(/\D/g, ""));
    const hasRealTaxInvoice =
      hasValidTaxId && expense.docType === "tax_invoice";
    if (hasRealTaxInvoice) {
      return NextResponse.json(
        {
          error:
            "รายจ่ายนี้มีใบกำกับภาษีจริงอยู่แล้ว — ไม่จำเป็นต้องออกใบรับรองแทน",
        },
        { status: 400 },
      );
    }

    if (!reason || reason.length < 3) {
      return NextResponse.json(
        { error: "ใบรับรองแทนใบเสร็จต้องระบุเหตุผล (ตามกฎสรรพากร)" },
        { status: 400 },
      );
    }
  }

  if (!company) {
    return NextResponse.json({ error: "ไม่พบบริษัทใน org นี้" }, { status: 404 });
  }

  const categoryName = category?.name ?? expense.categoryName ?? null;
  const branchLabel = branch ? `${branch.code} · ${branch.name}` : null;

  // 7) Build + return the document (HTML the browser prints to PDF).
  const built = buildVoucher({
    type,
    expense,
    company,
    categoryName,
    branchLabel,
    issuedBy: session.user.name || null,
    substituteReason: reason,
  });

  return new NextResponse(built.html, {
    status: 200,
    headers: {
      "Content-Type": built.contentType,
      // inline → opens in a tab where window.print() fires; the user then saves
      // as PDF. (A filename is still suggested if they choose "save page".)
      "Content-Disposition": `inline; filename="${built.filename}.html"`,
      "Cache-Control": "no-store",
      "X-Voucher-Type": type,
      "X-Voucher-Label": encodeURIComponent(VOUCHER_LABEL[type]),
    },
  });
}
