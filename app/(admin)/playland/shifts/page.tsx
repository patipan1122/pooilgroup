import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { ShiftClient } from "@/components/playland/shift-client";

export const dynamic = "force-dynamic";

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;

  // Cashier sees own open shift · Manager sees any open shift at branch
  const isManager = ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"].includes(session.user.role);
  const [openShift, recent] = await Promise.all([
    prisma.playlandShift.findFirst({
      where: { orgId, branchId, status: "OPEN", ...(isManager ? {} : { cashierUserId: session.user.id }) },
      orderBy: { startedAt: "desc" },
    }),
    prisma.playlandShift.findMany({ where: { orgId, branchId }, orderBy: { startedAt: "desc" }, take: 30 }),
  ]);

  return (
    <ShiftClient
      branchId={branchId}
      branchName={branches.find((b) => b.id === branchId)?.name ?? ""}
      openShift={openShift ? {
        id: openShift.id,
        shiftCode: openShift.shiftCode,
        startedAt: openShift.startedAt.toISOString(),
        openingCashCents: openShift.openingCashCents,
        totalSalesCents: openShift.totalSalesCents,
      } : null}
      recent={recent.map((r) => ({
        id: r.id,
        shiftCode: r.shiftCode,
        cashierUserId: r.cashierUserId,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        openingCashCents: r.openingCashCents,
        closingCashCents: r.closingCashCents,
        totalSalesCents: r.totalSalesCents,
        varianceCents: r.varianceCents,
        isDayClose: r.isDayClose,
      }))}
    />
  );
}
