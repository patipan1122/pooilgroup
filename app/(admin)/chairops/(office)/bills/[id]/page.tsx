// Bill detail / edit page · /chairops/bills/[id]
// CEO + ADMIN: full form, mark-paid, delete. MANAGER + OFFICE: read-only view.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
import {
  getCategoryList,
  getAnomaly,
  deriveStatus,
  bangkokDateOfToday,
} from "@/lib/chairops/queries/vendor-bills";
import { baht, thaiDate } from "@/lib/chairops/utils/format";

import { BillEditForm } from "./_components/bill-edit-form";
import { MarkPaidForm } from "./_components/mark-paid-form";
import { DeleteBillForm } from "./_components/delete-bill-form";
import { UnmarkPaidForm } from "./_components/unmark-paid-form";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OFFICE");
  const { id } = await params;
  const orgId = session.user.orgId;

  const bill = await prisma.chairopsVendorBill.findFirst({
    where: { id, orgId },
    include: {
      branch: { select: { id: true, name: true, slug: true } },
      category: { select: { id: true, code: true, label: true } },
    },
  });
  if (!bill) notFound();

  // CEO+ADMIN edit · MANAGER+OFFICE view-only (per locked decision).
  const canEdit = rankOf(session.user.role) >= rankOf(ChairopsUserRole.CEO);

  const [branches, categories, anomaly] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getCategoryList({ orgId }),
    getAnomaly({
      orgId,
      branchId: bill.branchId,
      categoryId: bill.categoryId,
      billPeriod: bill.billPeriod,
      amount: Number(bill.amount),
    }),
  ]);

  const billPeriodStr = bill.billPeriod.toISOString().slice(0, 7);
  const dueDateStr = bill.dueDate.toISOString().slice(0, 10);
  const paidAtStr = bill.paidAt ? bill.paidAt.toISOString().slice(0, 10) : "";
  // BA-05 (2026-06-03) · share `deriveStatus` + `bangkokDateOfToday` with the
  // matrix so the same bill never shows two different statuses (the inline
  // ternary used wall-clock UTC; the matrix uses BKK calendar midnight — a
  // 7-hour daily window of disagreement). Anchor to BKK day to match maid/
  // branch operations cadence.
  const status = deriveStatus(bill.paidAt, bill.dueDate, bangkokDateOfToday());

  const STATUS_LABEL = {
    PAID: { txt: "จ่ายแล้ว", chip: "bg-emerald-100 text-emerald-700" },
    PENDING: { txt: "รอจ่าย", chip: "bg-amber-100 text-amber-800" },
    OVERDUE: { txt: "เกินกำหนด", chip: "bg-rose-100 text-rose-700" },
  } as const;

  return (
    <div className="space-y-5">
      <Link
        href="/chairops/bills"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        กลับตาราง
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            บิล · {bill.branch.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            {bill.category.label} ·{" "}
            <span className="tabular-nums">
              {thaiDate(bill.billPeriod, "LLLL yyyy")}
            </span>
          </h1>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_LABEL[status].chip}`}
        >
          {STATUS_LABEL[status].txt}
        </span>
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          {canEdit ? (
            <BillEditForm
              billId={bill.id}
              defaults={{
                branchId: bill.branchId,
                billPeriod: billPeriodStr,
                categoryId: bill.categoryId,
                amount: Number(bill.amount),
                dueDate: dueDateStr,
                paidAt: paidAtStr,
                paidAmount: bill.paidAmount ? Number(bill.paidAmount) : null,
                slipPhotoUrl: bill.slipPhotoUrl,
                bankAccountTo: bill.bankAccountTo,
                paymentTerms: bill.paymentTerms,
                notes: bill.notes,
              }}
              branches={branches}
              categories={categories}
              branchSlug={bill.branch.slug}
              initialAnomaly={{
                prev: anomaly.prev,
                deltaPct: anomaly.deltaPct,
                isAnomalous: anomaly.isAnomalous,
              }}
            />
          ) : (
            <ReadOnlyView
              billPeriodStr={billPeriodStr}
              dueDateStr={dueDateStr}
              paidAtStr={paidAtStr}
              amount={Number(bill.amount)}
              paidAmount={bill.paidAmount ? Number(bill.paidAmount) : null}
              slipPhotoUrl={bill.slipPhotoUrl}
              bankAccountTo={bill.bankAccountTo}
              paymentTerms={bill.paymentTerms}
              notes={bill.notes}
            />
          )}
        </div>

        <aside className="space-y-3">
          {canEdit && status !== "PAID" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
              <h2 className="text-sm font-semibold text-emerald-900">
                ทำเครื่องหมายว่าจ่ายแล้ว
              </h2>
              <p className="mt-1 text-xs text-emerald-800/80">
                กรอกวันที่จ่าย + ยอด (เลือกแนบสลิป)
              </p>
              <MarkPaidForm
                billId={bill.id}
                defaultPaidAt={new Date().toISOString().slice(0, 10)}
                defaultPaidAmount={Number(bill.amount)}
                branchSlug={bill.branch.slug}
              />
            </div>
          ) : null}

          {/* OWN-BILLS-03 (2026-06-03) · explicit revert-paid surface, replaces
              the old silent-clear behaviour where blanking paidAt in the edit
              form un-marked the bill. */}
          {canEdit && status === "PAID" ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <h2 className="text-sm font-semibold text-amber-900">
                ยกเลิกการจ่าย
              </h2>
              <p className="mt-1 text-xs text-amber-800/80">
                ใช้เมื่อบันทึกจ่ายผิด · จะกลับเป็น &quot;รอจ่าย&quot;
              </p>
              <UnmarkPaidForm billId={bill.id} />
            </div>
          ) : null}

          {canEdit ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50/30 p-4">
              <h2 className="text-sm font-semibold text-rose-900">
                ลบบิลนี้
              </h2>
              <p className="mt-1 text-xs text-rose-800/80">
                ใช้เมื่อบันทึกผิด · ลบแล้วกู้คืนไม่ได้
              </p>
              <DeleteBillForm billId={bill.id} />
            </div>
          ) : null}

          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-xs text-zinc-600">
            <p>
              <span className="font-medium text-zinc-800">หมวด:</span>{" "}
              {bill.category.label}
            </p>
            <p>
              <span className="font-medium text-zinc-800">รหัส:</span>{" "}
              {bill.category.code}
            </p>
            <p>
              <span className="font-medium text-zinc-800">ยอด:</span>{" "}
              {baht(Number(bill.amount))}
            </p>
            {anomaly.isAnomalous &&
            anomaly.prev != null &&
            anomaly.deltaPct != null ? (
              <p className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-amber-900">
                ⚠️ ต่างจากเดือนก่อน {(anomaly.deltaPct * 100).toFixed(0)}% (เดือนก่อน{" "}
                {baht(anomaly.prev)})
              </p>
            ) : null}
          </div>
        </aside>
      </section>
    </div>
  );
}

function ReadOnlyView({
  billPeriodStr,
  dueDateStr,
  paidAtStr,
  amount,
  paidAmount,
  slipPhotoUrl,
  bankAccountTo,
  paymentTerms,
  notes,
}: {
  billPeriodStr: string;
  dueDateStr: string;
  paidAtStr: string;
  amount: number;
  paidAmount: number | null;
  slipPhotoUrl: string | null;
  bankAccountTo: string | null;
  paymentTerms: string | null;
  notes: string | null;
}) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <Row label="เดือนบิล" value={billPeriodStr} />
      <Row label="กำหนดชำระ" value={dueDateStr} />
      <Row label="ยอดบิล" value={baht(amount)} />
      <Row label="วันที่จ่าย" value={paidAtStr || "—"} />
      <Row label="ยอดที่จ่าย" value={paidAmount ? baht(paidAmount) : "—"} />
      <Row label="ธนาคารผู้รับ" value={bankAccountTo || "—"} />
      <Row label="เงื่อนไขการชำระ" value={paymentTerms || "—"} />
      <Row label="หมายเหตุ" value={notes || "—"} />
      {/* SEC-01 (2026-06-03) · render slip link only when URL passes the
          canonical R2 allowlist guard — defense-in-depth against historical
          rows that pre-date the zod validation tightening. */}
      {slipPhotoUrl && isAllowedPhotoUrl(slipPhotoUrl) ? (
        <div className="col-span-full">
          <dt className="text-xs font-medium text-zinc-700">สลิป</dt>
          <dd className="mt-1">
            <a
              href={slipPhotoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-700 underline"
            >
              ดูรูปสลิป
            </a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-600">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900">{value}</dd>
    </div>
  );
}
