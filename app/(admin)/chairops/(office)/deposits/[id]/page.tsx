// /chairops/deposits/[id] — deposit drill-down: which collection rounds
// are inside this deposit, the slip photo, and cumulative vs POS diff.
// Sprint-2 UAT finding: office staff couldn't trace "ฝาก 9,970 ฿ ครอบคลุมรอบไหนบ้าง".

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DepositDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;

  const deposit = await prisma.chairopsCashDeposit.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      depositedAt: true,
      depositedAmount: true,
      bankFee: true,
      notes: true,
      slipPhotoUrl: true,
      requiresReview: true,
      branch: { select: { id: true, name: true } },
      maid: { select: { displayName: true } },
      collections: {
        select: {
          id: true,
          countedAmount: true,
          collectedAt: true,
          notes: true,
          source: true,
        },
        orderBy: { collectedAt: "asc" },
      },
    },
  });

  if (!deposit) notFound();

  const totalCollected = deposit.collections.reduce(
    (s, c) => s + c.countedAmount,
    0,
  );
  const diff = deposit.depositedAmount - totalCollected;
  const bkk = (d: Date) => {
    const local = new Date(d.getTime() + 7 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  };

  return (
    <div className="chairops-scope mx-auto max-w-3xl space-y-6 px-4 py-6">
      <Link
        href={`/chairops/reconcile/${deposit.branch.id}`}
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
        กลับ · {deposit.branch.name}
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          {deposit.branch.name} · {deposit.maid.displayName}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          รายละเอียดการฝาก
        </h1>
        <p className="text-sm text-zinc-500">{bkk(deposit.depositedAt)}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Slip photo */}
        {deposit.slipPhotoUrl && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500">สลิปฝากเงิน</p>
            <a
              href={deposit.slipPhotoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={deposit.slipPhotoUrl}
                alt="สลิปฝากเงิน"
                className="w-full rounded-xl border border-zinc-200 object-cover"
                style={{ maxHeight: 300 }}
              />
            </a>
          </div>
        )}

        {/* Summary */}
        <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <p className="text-xs font-semibold text-zinc-500">สรุป</p>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="py-0.5 text-zinc-500">ยอดฝากจริง</td>
                <td className="py-0.5 text-right font-mono font-semibold text-zinc-900">
                  {deposit.depositedAmount.toLocaleString()} ฿
                </td>
              </tr>
              {deposit.bankFee > 0 && (
                <tr>
                  <td className="py-0.5 text-zinc-500">ค่าธรรมเนียมธนาคาร</td>
                  <td className="py-0.5 text-right font-mono text-zinc-600">
                    +{deposit.bankFee.toLocaleString()} ฿
                  </td>
                </tr>
              )}
              <tr>
                <td className="py-0.5 text-zinc-500">
                  POS รวม ({deposit.collections.length} รอบ)
                </td>
                <td className="py-0.5 text-right font-mono text-zinc-900">
                  {totalCollected.toLocaleString()} ฿
                </td>
              </tr>
              <tr className="border-t border-zinc-100">
                <td className="pt-2 font-semibold text-zinc-700">ส่วนต่าง</td>
                <td
                  className={`pt-2 text-right font-mono font-bold ${diff < -100 ? "text-red-600" : diff > 100 ? "text-emerald-600" : "text-zinc-600"}`}
                >
                  {diff > 0 ? "+" : ""}
                  {diff.toLocaleString()} ฿
                </td>
              </tr>
            </tbody>
          </table>
          {deposit.requiresReview && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              ⚠ รายการนี้รอตรวจสอบ ·{" "}
              <Link href="/chairops/review-queue" className="underline">
                ไปหน้าตรวจสอบ
              </Link>
            </div>
          )}
          {deposit.notes && (
            <p className="text-xs text-zinc-500">หมายเหตุ: {deposit.notes}</p>
          )}
        </div>
      </div>

      {/* Collection rounds table */}
      <section>
        <p className="mb-2 text-xs font-semibold text-zinc-500">
          รอบเก็บเงินในการฝากนี้
        </p>
        {deposit.collections.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">
            ไม่มีรอบเก็บเงินที่ผูกไว้กับการฝากนี้
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500">
                  <th className="pb-2 pr-4">วัน-เวลา</th>
                  <th className="pb-2 pr-4">ยอดนับ</th>
                  <th className="pb-2 pr-4">แหล่งที่มา</th>
                  <th className="pb-2">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {deposit.collections.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-4 tabular-nums text-zinc-600">
                      {bkk(c.collectedAt)}
                    </td>
                    <td className="py-2 pr-4 font-mono font-semibold text-zinc-900">
                      {c.countedAmount.toLocaleString()} ฿
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                          c.source === "CSV_IMPORT"
                            ? "bg-blue-50 text-blue-700"
                            : c.source === "OFFICE_PROXY"
                              ? "bg-purple-50 text-purple-700"
                              : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {c.source === "CSV_IMPORT"
                          ? "CSV"
                          : c.source === "OFFICE_PROXY"
                            ? "ออฟฟิศ"
                            : "แม่บ้าน"}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-zinc-500">
                      {c.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200 font-semibold">
                  <td className="pt-2 text-zinc-700">รวม</td>
                  <td className="pt-2 font-mono text-zinc-900">
                    {totalCollected.toLocaleString()} ฿
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
