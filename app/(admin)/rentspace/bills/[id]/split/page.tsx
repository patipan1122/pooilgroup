// RentSpace — "แตกบิล" (พิมพ์ใบวางบิลแยก). Read-only: บิลหลักในระบบไม่ถูกแตะ.
// โหลดบิลเดียวกับหน้ารายละเอียด แล้วส่งให้ client แบ่งรายการ + พิมพ์ 2 ใบ.
import "@/components/rentspace/tokens.css";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { getBill } from "@/lib/rentspace/data";
import { loadBillMeterReadings, projectBankInfo } from "@/lib/rentspace/bill-extras";
import { toNum } from "@/lib/rentspace/format";
import SplitBillClient from "../_components/split-bill-client";

export const dynamic = "force-dynamic";

export default async function SplitBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const bill = await getBill(session.user.org_id, id);
  if (!bill) notFound();
  // บิลที่ยกเลิกแล้วไม่มีอะไรให้แตก → กลับหน้ารายละเอียด
  if (bill.status === "void") redirect(`/rentspace/bills/${id}`);

  const meterReadings = await loadBillMeterReadings(prisma, bill.unitId, bill.period);
  const bank = projectBankInfo(bill.project);

  return (
    <div className="min-h-screen px-4 py-5 max-w-2xl mx-auto" style={{ background: "var(--rs-bg-2)" }}>
      <SplitBillClient
        billId={bill.id}
        billNo={bill.billNo}
        period={bill.period}
        status={bill.status}
        issueDate={bill.issueDate ? bill.issueDate.toISOString() : null}
        dueDate={bill.dueDate ? bill.dueDate.toISOString() : null}
        vatPercent={toNum(bill.contract?.vatPercent)}
        master={{
          subtotal: toNum(bill.subtotal),
          discountAmount: toNum(bill.discountAmount),
          vatAmount: toNum(bill.vatAmount),
          totalAmount: toNum(bill.totalAmount),
        }}
        project={{
          name: bill.project.name,
          address: bill.project.address,
          billCompanyName: bill.project.billCompanyName,
          billAddress: bill.project.billAddress,
          billTaxId: bill.project.billTaxId,
          billBranch: bill.project.billBranch,
        }}
        unit={{ code: bill.unit.code, name: bill.unit.name }}
        tenant={{
          bizName: bill.tenant.bizName,
          prefix: bill.tenant.prefix,
          firstName: bill.tenant.firstName,
          lastName: bill.tenant.lastName,
          nickname: bill.tenant.nickname,
          taxId: bill.tenant.taxId,
          address: bill.tenant.address,
        }}
        items={bill.items.map((it) => ({
          id: it.id,
          kind: it.kind,
          label: it.label,
          qty: toNum(it.qty),
          unitPrice: toNum(it.unitPrice),
          amount: toNum(it.amount),
          vatable: it.vatable,
        }))}
        meterReadings={meterReadings}
        bank={bank}
      />
    </div>
  );
}
