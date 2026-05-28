// Cash-collection form shell · Server Component for /chairops/m/collect/new.
// Loads:
//   - branch name
//   - 7-day deposit avg (anti-stupid deviation guard in client form)
//   - active chair codes for the maid's branch (optional typeahead)
// Then renders <CollectNewForm/> (client).

import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CollectNewForm } from "./form";

export const dynamic = "force-dynamic";

export default async function MaidCollectNewPage() {
  const session = await requireExactRole("MAID");
  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardBody className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <CircleAlert className="h-5 w-5" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนเริ่มบันทึก</p>
        </CardBody>
      </Card>
    );
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [branch, agg, chairs] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true },
    }),
    prisma.chairopsCashCollection.aggregate({
      where: { branchId, collectedAt: { gte: sevenDaysAgo } },
      _avg: { depositedAmount: true },
      _count: true,
    }),
    prisma.chairopsChair.findMany({
      where: { branchId, isActive: true },
      orderBy: { chairCode: "asc" },
      select: { chairCode: true },
      take: 200,
    }),
  ]);

  const avg7d = agg._count > 0 ? Math.round(agg._avg.depositedAmount ?? 0) : null;
  const chairCodes = chairs.map((c) => c.chairCode);

  return (
    <div className="space-y-4">
      <Link
        href="/chairops/m"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับหน้าหลัก
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">บันทึกการเก็บเงิน</h1>
        <p className="text-sm text-zinc-500">สาขา {branch.name}</p>
      </header>

      <CollectNewForm avg7d={avg7d} chairCodes={chairCodes} />
    </div>
  );
}
