// Cash-collection form shell · Server Component
// Loads the 7-day avg deposit so the client form can warn on big deviations.
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { CollectNewForm } from "./form";
import { Card, CardContent } from "@/components/chairops/ui/card";
import { CircleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CollectNewPage() {
  const session = await requireExactRole("MAID");
  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <CircleAlert className="h-5 w-5 text-warning" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-muted-foreground">ติดต่อออฟฟิศก่อนเริ่มบันทึก</p>
        </CardContent>
      </Card>
    );
  }

  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: branchId },
    select: { name: true },
  });

  // 7-day moving average of deposited amount (for anti-stupid deviation guard)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const agg = await prisma.chairopsCashCollection.aggregate({
    where: { branchId, collectedAt: { gte: sevenDaysAgo } },
    _avg: { depositedAmount: true },
    _count: true,
  });
  const avg7d = agg._count > 0 ? Math.round(agg._avg.depositedAmount ?? 0) : null;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">บันทึกการเก็บเงิน</h1>
        <p className="text-sm text-muted-foreground">สาขา {branch.name}</p>
      </header>

      <CollectNewForm avg7d={avg7d} />
    </div>
  );
}
