import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { ShiftClient } from "@/components/playland/shift-client";
import { BackOfficeTabs } from "@/components/playland/back-office-tabs";
import { NavSelect } from "@/components/playland/nav-select";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;

  const isManager = ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"].includes(session.user.role);
  const [openShift, recent] = await Promise.all([
    prisma.playlandShift.findFirst({
      where: { orgId, branchId, status: "OPEN", ...(isManager ? {} : { cashierUserId: session.user.id }) },
      orderBy: { startedAt: "desc" },
    }),
    prisma.playlandShift.findMany({ where: { orgId, branchId }, orderBy: { startedAt: "desc" }, take: 30 }),
  ]);

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1>{openShift ? `กะที่เปิดอยู่ · ${openShift.shiftCode}` : "เปิดกะใหม่"}</h1>
        </div>
        {branches.length > 1 && <NavSelect param="branch" value={branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 170 }} />}
      </header>

      <BackOfficeTabs active="shifts" />

      <div style={{ overflowY: "auto" }}>
        <ShiftClient
          branchId={branchId}
          branchName={branches.find((b) => b.id === branchId)?.name ?? ""}
          openShift={openShift ? {
            id: openShift.id, shiftCode: openShift.shiftCode,
            startedAt: openShift.startedAt.toISOString(),
            openingCashCents: openShift.openingCashCents, totalSalesCents: openShift.totalSalesCents,
          } : null}
          recent={recent.map((r) => ({
            id: r.id, shiftCode: r.shiftCode, cashierUserId: r.cashierUserId, status: r.status,
            startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
            openingCashCents: r.openingCashCents, closingCashCents: r.closingCashCents,
            totalSalesCents: r.totalSalesCents, varianceCents: r.varianceCents, isDayClose: r.isDayClose,
          }))}
        />
      </div>
    </div>
  );
}
