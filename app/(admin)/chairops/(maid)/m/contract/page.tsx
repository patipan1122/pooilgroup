// /chairops/m/contract — maid employment contract (CEO 2026-07-12).
// If a SIGNED contract exists → show the read-only signed copy + print.
// Otherwise → the fill → preview → sign flow (prefilled from the profile).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ContractFlow, type ContractPrefill } from "./contract-flow";
import { SignedContractView } from "./signed-contract-view";
import type { ContractDocData } from "./types";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function MaidContractPage() {
  const session = await requireExactRole("MAID");
  const { orgId, id: maidId } = session.user;

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

  const header = (
    <header className="space-y-1">
      <Link
        href="/chairops/m/profile"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
      >
        <ArrowLeft className="size-4" /> บัญชีของฉัน
      </Link>
      <h1 className="text-xl font-bold text-zinc-900">สัญญาจ้าง</h1>
    </header>
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
      <div className="space-y-4">
        {header}
        <SignedContractView
          data={data}
          signature={{
            signatureImageUrl: contract.signatureImageUrl,
            signedName: contract.signedName ?? contract.maidName,
            signedAt: contract.signedAt.toISOString(),
          }}
        />
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
    <div className="space-y-4">
      {header}
      <p className="text-sm text-zinc-500">
        กรอกข้อมูลให้ครบ → ดูตัวอย่างสัญญา → เซ็นชื่อออนไลน์ได้เลย
      </p>
      <ContractFlow prefill={prefill} />
    </div>
  );
}
