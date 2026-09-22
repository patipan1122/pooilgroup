// /chairops/m/contract — maid employment contract (CEO 2026-07-12).
// If a SIGNED contract exists → show the read-only signed copy + print.
// Otherwise → the fill → preview → sign flow (prefilled from the profile).
//
// CEO 2026-09-22: styled with RentSpace's letterhead treatment (gradient header
// + rs-card), importing .rs-scope directly rather than copying its hex values —
// the CEO asked for this page to look like the lease-contract signing page.
// `?from=onboarding` means the maid just finished onboarding and was forwarded
// straight here, so the back-link and copy change accordingly.

import "@/components/rentspace/tokens.css";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";

import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ContractFlow, type ContractPrefill } from "./contract-flow";
import { SignedContractView } from "./signed-contract-view";
import type { ContractDocData } from "./types";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function MaidContractPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await requireExactRole("MAID");
  const { orgId, id: maidId } = session.user;
  const fromOnboarding = (await searchParams).from === "onboarding";

  const [user, contract, company] = await Promise.all([
    prisma.chairopsUser.findUniqueOrThrow({
      where: { id: maidId },
      select: {
        displayName: true,
        phone: true,
        mobilePhone: true,
        idCardNumber: true,
        homeAddress: true,
        idCardImageUrl: true,
        idCardFileName: true,
        bankName: true,
        bankAccountNo: true,
        bankAccountName: true,
      },
    }),
    prisma.chairopsMaidContract.findFirst({
      where: { orgId, maidId, status: { not: "VOID" } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.chairopsBankAccount.findFirst({
      where: { orgId, isActive: true, branchId: null },
      orderBy: { createdAt: "desc" },
      select: { bankName: true, accountNo: true, accountName: true },
    }),
  ]);

  // หัวกระดาษแบบเดียวกับหน้าเซ็นสัญญาเช่า RentSpace — ชื่อบริษัทเป็นตัวอักษร
  // ในแถบไล่สี (ไม่มีไฟล์โลโก้ · RentSpace เองก็ทำแบบนี้)
  const header = (
    <div
      className="px-5 py-5 text-white"
      style={{ background: "linear-gradient(135deg, var(--rs-brand), var(--rs-navy))" }}
    >
      <div className="mx-auto max-w-2xl">
        {!fromOnboarding && (
          <Link
            href="/chairops/m/profile"
            className="inline-flex items-center gap-1 text-[13px] opacity-90 hover:opacity-100"
          >
            <ArrowLeft className="h-4 w-4" /> บัญชีของฉัน
          </Link>
        )}
        <div className="mt-1 flex items-center gap-2 text-[13px] opacity-90">
          <FileText className="h-4 w-4" /> บริษัท เจพีซิงค์กรุ๊ป จำกัด
        </div>
        <h1 className="mt-1 text-xl font-bold">สัญญาจ้างเหมาทำความสะอาดและเก็บเงินนำส่งธนาคาร</h1>
        <p className="mt-1 text-[12.5px] opacity-90">
          {fromOnboarding
            ? "เหลืออีกขั้นเดียว — อ่านสัญญาให้ครบแล้วเซ็นชื่อได้เลย"
            : "กรุณาอ่านสัญญาให้ครบถ้วนก่อนลงลายมือชื่อ"}
        </p>
      </div>
    </div>
  );

  if (contract && contract.status === "SIGNED" && contract.signatureImageUrl && contract.signedAt) {
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
    };
    return (
      <div className="rs-scope min-h-screen pb-10" style={{ background: "var(--rs-bg-2)" }}>
        {header}
        <div className="mx-auto max-w-2xl px-4 py-5">
          <SignedContractView
            data={data}
            signature={{
              signatureImageUrl: contract.signatureImageUrl,
              signedName: contract.signedName ?? contract.maidName,
              signedAt: contract.signedAt.toISOString(),
              signedIp: contract.signedIp,
              contentHash: contract.contentHash,
            }}
          />
        </div>
      </div>
    );
  }

  const prefill: ContractPrefill = {
    maidName: contract?.maidName ?? user.displayName,
    idCardNumber: contract?.idCardNumber ?? user.idCardNumber ?? "",
    address: contract?.address ?? user.homeAddress ?? "",
    phone: contract?.phone ?? user.mobilePhone ?? user.phone ?? "",
    monthlyWage: contract?.monthlyWage?.toString() ?? "",
    payDayOfMonth: contract?.payDayOfMonth?.toString() ?? "",
    salaryBankName: contract?.salaryBankName ?? user.bankName ?? "",
    salaryAccountNo: contract?.salaryAccountNo ?? user.bankAccountNo ?? "",
    salaryAccountName: contract?.salaryAccountName ?? user.bankAccountName ?? user.displayName,
    startDate: ymd(contract?.startDate ?? null),
    endDate: ymd(contract?.endDate ?? null),
    idCardImageUrl: contract?.idCardImageUrl ?? user.idCardImageUrl ?? "",
    idCardFileName: user.idCardFileName ?? "",
    companyBankName: contract?.companyBankName ?? company?.bankName ?? "",
    companyAccountNo: contract?.companyAccountNo ?? company?.accountNo ?? "",
    companyAccountName:
      contract?.companyAccountName ?? company?.accountName ?? "บริษัท เจพีซิงค์กรุ๊ป จำกัด",
  };

  return (
    <div className="rs-scope min-h-screen pb-10" style={{ background: "var(--rs-bg-2)" }}>
      {header}
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <p className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
          กรอกข้อมูลให้ครบ → ดูตัวอย่างสัญญา → เซ็นชื่อออนไลน์ได้เลย
        </p>
        <ContractFlow prefill={prefill} />
      </div>
    </div>
  );
}
