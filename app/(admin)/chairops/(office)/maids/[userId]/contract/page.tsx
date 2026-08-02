// /chairops/maids/[userId]/contract — office view / print of a maid's contract
// (F4b · CEO 2026-08-02). ADMIN-only (PDPA: full ID number + address + signature).

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import type {
  ContractDocData,
  ContractSignature,
} from "@/app/(admin)/chairops/(maid)/m/contract/types";
import { OfficeContractView } from "../_components/office-contract-view";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function OfficeMaidContractPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  const { userId } = await params;
  const orgId = session.user.orgId;

  const maid = await prisma.chairopsUser.findFirst({
    where: { id: userId, orgId, role: ChairopsUserRole.MAID },
    select: { displayName: true },
  });
  if (!maid) notFound();

  const contract = await prisma.chairopsMaidContract.findFirst({
    where: { orgId, maidId: userId, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
  });

  const header = (
    <div className="text-xs text-zinc-500">
      <Link href={`/chairops/maids/${userId}`} className="inline-flex items-center gap-1 hover:text-emerald-700">
        <ArrowLeft className="size-3.5" /> {maid.displayName}
      </Link>{" "}
      / สัญญาจ้าง
    </div>
  );

  if (!contract) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
          ยังไม่มีสัญญาสำหรับแม่บ้านคนนี้ — สร้างร่างได้ที่หน้ารายละเอียดแม่บ้าน
        </div>
      </div>
    );
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

  return (
    <div className="space-y-4">
      {header}
      <OfficeContractView data={data} signature={signature} signed={signed} />
    </div>
  );
}
