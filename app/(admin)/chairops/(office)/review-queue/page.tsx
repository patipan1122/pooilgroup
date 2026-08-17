// /chairops/review-queue — deposits auto-flagged for office review
// (requiresReview=true when |diff| ≥ 500฿ per BF1 MAID-04 anti-fraud rule).
// Office staff verify the slip photo against the expected POS amount, then
// click "ตรวจแล้ว" to clear the flag. Sprint-2 UAT finding.

import Link from "next/link";
import { AlertTriangle, CheckCircle, ChevronLeft, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { clearDepositReview } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;

  const flagged = await prisma.chairopsCashDeposit.findMany({
    where: { orgId, requiresReview: true },
    orderBy: { depositedAt: "asc" },
    take: 100,
    select: {
      id: true,
      branchId: true,
      depositedAmount: true,
      bankFee: true,
      depositedAt: true,
      notes: true,
      ocrFlagReason: true,
      slipPhotoUrl: true,
      branch: { select: { name: true } },
      maid: { select: { displayName: true } },
      collections: {
        select: { countedAmount: true },
      },
    },
  });

  return (
    <div className="chairops-scope mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Link
        href="/chairops"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับหน้าหลัก
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">ออฟฟิศ · ตรวจสอบ</p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          รายการรอตรวจสอบ
        </h1>
        <p className="text-sm text-zinc-600">
          ฝากเงินที่ยอดต่างกับ POS ≥ 500 ฿ หรือ AI อ่านสลิปแล้วสงสัยว่าซ้ำ/บัญชีผิด — ตรวจสลิปแล้วกด &quot;ตรวจแล้ว&quot;
        </p>
      </header>

      {flagged.length === 0 ? (
        <div
          className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5"
        >
          <CheckCircle className="h-8 w-8 shrink-0 text-emerald-500" aria-hidden />
          <div>
            <p className="font-semibold text-emerald-800">ไม่มีรายการรอตรวจ</p>
            <p className="text-sm text-emerald-700">ยอดทุกรอบสอดคล้องกับ POS ✓</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {flagged.length} รายการรอตรวจสอบ
          </div>

          {flagged.map((d) => {
            const expected = d.collections.reduce(
              (s, c) => s + c.countedAmount,
              0,
            );
            const diff = d.depositedAmount - expected;
            const bkk = new Date(d.depositedAt.getTime() + 7 * 3_600_000);
            const dateLabel = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}-${String(bkk.getUTCDate()).padStart(2, "0")} ${String(bkk.getUTCHours()).padStart(2, "0")}:${String(bkk.getUTCMinutes()).padStart(2, "0")}`;

            return (
              <div
                key={d.id}
                className="rounded-xl border border-amber-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-5">
                  {/* Slip thumbnail */}
                  {d.slipPhotoUrl && (
                    <a
                      href={d.slipPhotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={d.slipPhotoUrl}
                        alt="สลิปฝากเงิน"
                        className="h-24 w-24 rounded-lg border border-zinc-200 object-cover"
                      />
                    </a>
                  )}

                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-zinc-900">{d.branch.name}</span>
                      <span className="text-xs text-zinc-500">·</span>
                      <span className="text-sm text-zinc-600">{d.maid.displayName}</span>
                      <span className="text-xs text-zinc-400">{dateLabel}</span>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500">ฝากจริง </span>
                        <span className="font-mono font-semibold text-zinc-900">
                          {d.depositedAmount.toLocaleString()} ฿
                        </span>
                        {d.bankFee > 0 && (
                          <span className="ml-1 text-xs text-zinc-400">
                            (+{d.bankFee} ค่าธรรมเนียม)
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-zinc-500">POS รวม </span>
                        <span className="font-mono font-semibold text-zinc-900">
                          {expected.toLocaleString()} ฿
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">ต่าง </span>
                        <span
                          className={`font-mono font-bold ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-600" : "text-zinc-600"}`}
                        >
                          {diff > 0 ? "+" : ""}
                          {diff.toLocaleString()} ฿
                        </span>
                      </div>
                    </div>

                    {d.ocrFlagReason && (
                      <p className="flex items-start gap-1 text-xs font-medium text-red-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        AI ตรวจพบ: {d.ocrFlagReason}
                      </p>
                    )}
                    {d.notes && (
                      <p className="text-xs text-zinc-500">หมายเหตุ: {d.notes}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    <form action={clearDepositReview}>
                      <input type="hidden" name="depositId" value={d.id} />
                      <button
                        type="submit"
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 active:scale-95"
                      >
                        <CheckCircle className="h-4 w-4" aria-hidden />
                        ตรวจแล้ว
                      </button>
                    </form>
                    <Link
                      href={`/chairops/deposits/${d.id}`}
                      className="inline-flex min-h-[36px] items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      ดูรายละเอียด
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
