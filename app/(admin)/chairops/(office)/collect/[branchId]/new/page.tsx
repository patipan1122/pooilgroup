// Office direct-collect for a SPECIFIC branch (no impersonation needed).
// Office/admin reaches this page from /chairops/branch-collect (multi-select
// picker). The action runs as the office user themselves (their chairopsUser
// id ends up in maidId for audit) but the row's branchId is the URL param.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, CircleAlert } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { CollectNewForm } from "@/app/(admin)/chairops/(maid)/m/collect/new/form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ branchId: string }>;
}

export default async function OfficeCollectForBranchPage({ params }: Props) {
  const session = await requireRole("OFFICE");
  const { branchId } = await params;

  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: session.user.orgId, isActive: true },
    select: { id: true, name: true, city: true },
  });
  if (!branch) {
    notFound();
  }

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60_000);
  const [chairs, recentMoves] = await Promise.all([
    prisma.chairopsChair.findMany({
      where: { branchId: branch.id, isActive: true },
      orderBy: { chairCode: "asc" },
      select: { chairCode: true },
      take: 200,
    }),
    prisma.chairopsChairMove.findMany({
      where: { toBranchId: branch.id, movedAt: { gte: fourteenDaysAgo } },
      orderBy: { movedAt: "desc" },
      include: {
        chair: { select: { chairCode: true } },
        fromBranch: { select: { name: true } },
      },
      take: 50,
    }),
  ]);
  const movedInByCode = new Map<
    string,
    { fromName: string | null; movedAt: string }
  >();
  for (const m of recentMoves) {
    if (!m.chair) continue;
    if (!movedInByCode.has(m.chair.chairCode)) {
      movedInByCode.set(m.chair.chairCode, {
        fromName: m.fromBranch?.name ?? null,
        movedAt: m.movedAt.toISOString(),
      });
    }
  }
  const recentlyMovedIn = Array.from(movedInByCode.entries()).map(
    ([chairCode, info]) => ({ chairCode, ...info }),
  );

  if (chairs.length === 0) {
    return (
      <div className="space-y-4">
        <Link
          href="/chairops/branch-collect"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden /> เลือกสาขาใหม่
        </Link>
        <Card className="border-amber-200 bg-amber-50">
          <CardBody className="space-y-2 p-5 text-sm">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <CircleAlert className="h-5 w-5" />
              สาขา {branch.name} ยังไม่มีเก้าอี้ในระบบ
            </div>
            <p className="text-amber-700">
              เพิ่มเก้าอี้ก่อนที่ /chairops/branches/{branch.id}/chairs
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Catch the office user accidentally landing here without a chairops row
  // (created at first chairops login; rare but possible during migration).
  if (!session.user.id) {
    redirect("/chairops/dashboard?error=no_chairops_user");
  }

  return (
    <div className="space-y-4 p-4">
      <Link
        href="/chairops/branch-collect"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> เลือกสาขาใหม่
      </Link>
      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          เก็บเงินแทน · ออฟฟิศ
        </p>
        <h1 className="text-xl font-bold text-zinc-900">
          สาขา {branch.name}
        </h1>
        <p className="text-sm text-zinc-500">
          {branch.city ?? "—"} · {chairs.length} เก้าอี้ ·{" "}
          บันทึกในนามคุณ ({session.user.displayName})
        </p>
      </header>
      <CollectNewForm
        chairCodes={chairs.map((c) => c.chairCode)}
        branchOverride={branch.id}
        recentlyMovedIn={recentlyMovedIn}
      />
    </div>
  );
}
