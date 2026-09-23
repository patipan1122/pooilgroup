// GET /api/chairops/contract/pdf — real downloadable PDF of the maid's SIGNED
// employment contract (CEO 2026-09-23: window.print() doesn't work inside the
// LINE in-app browser many maids/brokers open this link from — no print
// pipeline available — so this renders a real PDF file server-side instead).
//
// A plain <a href="/api/chairops/contract/pdf" download> on the frontend
// triggers this — no client-side fetch/JS involved, so it works even in
// restrictive in-app webviews and isn't subject to the page's CSP connect-src
// (which doesn't allowlist R2's public *.r2.dev domain — see
// contract-pdf-document.tsx's header comment for why generation happens here,
// server-side, and not in the browser).

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ContractPdfDocument } from "@/app/(admin)/chairops/(maid)/m/contract/contract-pdf-document";
import type { ContractDocData } from "@/app/(admin)/chairops/(maid)/m/contract/types";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export async function GET() {
  const session = await requireExactRole("MAID");
  const { orgId, id: maidId } = session.user;

  const contract = await prisma.chairopsMaidContract.findFirst({
    where: { orgId, maidId, status: "SIGNED" },
    orderBy: { createdAt: "desc" },
  });

  if (!contract || !contract.signatureImageUrl || !contract.signedAt) {
    return NextResponse.json({ error: "ยังไม่มีสัญญาที่เซ็นแล้ว" }, { status: 404 });
  }

  // Contracts signed before the selfie-snapshot column existed (2026-09-23)
  // have no photo on the row at all — fall back to the live profile photo
  // rather than showing a blank box for every pre-existing signed contract.
  const user = await prisma.chairopsUser.findUnique({
    where: { id: maidId },
    select: { selfieImageUrl: true },
  });

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
    selfieImageUrl: contract.selfieImageUrl ?? user?.selfieImageUrl ?? null,
  };

  const buffer = await renderToBuffer(
    ContractPdfDocument({
      data,
      signature: {
        signatureImageUrl: contract.signatureImageUrl,
        signedName: contract.signedName ?? contract.maidName,
        signedAt: contract.signedAt.toISOString(),
        signedIp: contract.signedIp,
        contentHash: contract.contentHash,
      },
    }),
  );

  const fileName = `สัญญาจ้าง-${contract.maidName || "แม่บ้าน"}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
