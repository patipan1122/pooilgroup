// GET /api/chairops/maids/[userId]/contract/pdf — office/admin real downloadable
// PDF of any maid's contract (draft or signed), mirroring the self-service
// /api/chairops/contract/pdf route but ADMIN-gated and looked up by userId
// instead of the caller's own session (CEO 2026-09-23: the office contract
// view's "พิมพ์ / บันทึก PDF" still used window.print(), which stamps the
// browser's own URL/timestamp header into the output — looked unprofessional
// next to the real paper template. Same server-side-generation reasoning as
// the maid-facing route: avoids that, and the CSP connect-src block on R2's
// *.r2.dev image domain that a client-side render would hit).

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { ContractPdfDocument } from "@/app/(admin)/chairops/(maid)/m/contract/contract-pdf-document";
import type { ContractDocData, ContractSignature } from "@/app/(admin)/chairops/(maid)/m/contract/types";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  const { userId } = await params;
  const orgId = session.user.orgId;

  const maid = await prisma.chairopsUser.findFirst({
    where: { id: userId, orgId, role: ChairopsUserRole.MAID },
    select: { displayName: true, selfieImageUrl: true },
  });
  if (!maid) {
    return NextResponse.json({ error: "ไม่พบแม่บ้านคนนี้" }, { status: 404 });
  }

  const contract = await prisma.chairopsMaidContract.findFirst({
    where: { orgId, maidId: userId, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
  });
  if (!contract) {
    return NextResponse.json({ error: "ยังไม่มีสัญญาสำหรับแม่บ้านคนนี้" }, { status: 404 });
  }

  const data: ContractDocData = {
    maidName: contract.maidName,
    idCardNumber: contract.idCardNumber,
    address: contract.address,
    phone: contract.phone,
    monthlyWage: contract.monthlyWage,
    payDayOfMonth: contract.payDayOfMonth,
    salaryBankName: contract.salaryBankName,
    salaryAccountNo: contract.salaryAccountNo,
    salaryAccountName: contract.salaryAccountName,
    companyBankName: contract.companyBankName,
    companyAccountNo: contract.companyAccountNo,
    companyAccountName: contract.companyAccountName,
    companyAccountType: contract.companyAccountType,
    startDate: ymd(contract.startDate),
    endDate: ymd(contract.endDate),
    idCardImageUrl: contract.idCardImageUrl,
    // Contracts signed before the selfie-snapshot column existed (2026-09-23)
    // have no photo on the row at all — fall back to the live profile photo
    // rather than showing a blank box for every pre-existing signed contract.
    selfieImageUrl: contract.selfieImageUrl ?? maid.selfieImageUrl,
  };

  const signed =
    contract.status === "SIGNED" && !!contract.signatureImageUrl && !!contract.signedAt;
  const signature: ContractSignature | null = signed
    ? {
        signatureImageUrl: contract.signatureImageUrl!,
        signedName: contract.signedName ?? contract.maidName,
        signedAt: contract.signedAt!.toISOString(),
        signedIp: contract.signedIp,
        contentHash: contract.contentHash,
      }
    : null;

  const buffer = await renderToBuffer(ContractPdfDocument({ data, signature }));

  const fileName = `สัญญาจ้าง-${maid.displayName || "แม่บ้าน"}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
