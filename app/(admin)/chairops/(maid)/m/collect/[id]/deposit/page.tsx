// Step 2 — maid finished the bank deposit, comes back to attach the slip and
// the actual deposited amount. Shows the counted amount (immutable) + 7-day
// deposit average for sanity check, then renders the client form.
//
// Guards: must be the maid's own row; must not already have a slip; must
// belong to the maid's branch.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, CircleAlert } from "lucide-react";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { canSeeBranch } from "@/lib/chairops/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { thaiDateTime, baht } from "@/lib/chairops/utils/format";
import { DepositForm } from "./form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MaidCollectDepositPage({ params }: Props) {
  const { id } = await params;
  const session = await requireExactRole("MAID");

  const row = await prisma.chairopsCashCollection.findUnique({
    where: { id },
    select: {
      id: true,
      branchId: true,
      maidId: true,
      countedAmount: true,
      depositedAmount: true,
      slipPhotoUrl: true,
      collectedAt: true,
      branch: { select: { name: true } },
    },
  });
  if (!row) notFound();
  if (!canSeeBranch(session.user, row.branchId) || row.maidId !== session.user.id) {
    redirect("/chairops/m?error=forbidden");
  }
  if (row.slipPhotoUrl) {
    // Already deposited — bounce to detail.
    redirect(`/chairops/m/collect/${row.id}`);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const agg = await prisma.chairopsCashCollection.aggregate({
    where: {
      branchId: row.branchId,
      collectedAt: { gte: sevenDaysAgo },
      slipPhotoUrl: { not: null },
    },
    _avg: { depositedAmount: true },
    _count: true,
  });
  const avg7d = agg._count > 0 ? Math.round(agg._avg.depositedAmount ?? 0) : null;

  return (
    <div className="space-y-4">
      <Link
        href={`/chairops/m/collect/${row.id}`}
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับรายการ
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">ฝากเงินเข้าธนาคาร</h1>
        <p className="text-sm text-zinc-500">
          Step 2 จาก 2 · สาขา {row.branch.name}
        </p>
      </header>

      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardBody className="space-y-1 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-emerald-800">
            <CircleAlert className="h-4 w-4" /> ยอดที่นับไว้ก่อนหน้า
          </div>
          <div className="text-2xl font-bold tabular-nums text-emerald-900">
            {baht(row.countedAmount)}
          </div>
          <p className="text-xs text-emerald-700">
            นับเมื่อ {thaiDateTime(row.collectedAt)}
          </p>
        </CardBody>
      </Card>

      <DepositForm
        collectionId={row.id}
        countedAmount={row.countedAmount}
        avg7d={avg7d}
      />
    </div>
  );
}
