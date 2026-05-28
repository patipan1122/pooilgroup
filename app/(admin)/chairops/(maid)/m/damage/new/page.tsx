// Maid mobile damage report · /chairops/m/damage/new (CEO mockup "แจ้งซ่อม").
// Replaces the old redirect stub to the desktop form. Loads the maid's branch
// chairs + which chairs already have an open ticket (soft duplicate guard),
// then renders the mobile-first form.
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { ChevronLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import { MaidDamageForm } from "./form";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] as const;

export default async function MaidDamageNewPage() {
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
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนแจ้งซ่อม</p>
        </CardBody>
      </Card>
    );
  }

  const [branch, chairs, openTickets] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true },
    }),
    prisma.chairopsChair.findMany({
      where: { branchId, orgId: session.user.orgId, isActive: true },
      orderBy: { chairCode: "asc" },
      select: { id: true, chairCode: true, isOnline: true },
    }),
    prisma.chairopsDamageTicket.findMany({
      where: {
        branchId,
        orgId: session.user.orgId,
        status: { in: [...OPEN_STATUSES] },
        chairId: { not: null },
      },
      select: { chairId: true },
    }),
  ]);

  const openTicketChairIds = Array.from(
    new Set(openTickets.map((t) => t.chairId).filter((id): id is string => id != null)),
  );

  return (
    <div className="space-y-4">
      <Link
        href="/chairops/m/damage"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับ
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">🔧 แจ้งซ่อมเก้าอี้</h1>
        <p className="text-sm text-zinc-500">สาขา {branch.name}</p>
      </header>

      <MaidDamageForm chairs={chairs} openTicketChairIds={openTicketChairIds} />
    </div>
  );
}
