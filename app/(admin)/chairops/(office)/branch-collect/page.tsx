// Office "เก็บเงินแทนแม่บ้าน" — pick one OR multiple branches. CEO 2026-05-30:
// office/admin can be at HQ counting cash several maids brought back, so the
// picker now supports multi-select. Each selected branch gets its own
// "เก็บสาขานี้" link that opens the chair-checklist for that branch directly
// (no impersonation cookie — the office user submits as themselves via the
// createCashCollection branchOverride field).
//
// Layout (server-rendered):
//   3 KPI tiles (total / ready / missing-maid)
//   card grid · each card =
//      branch name + city + chair count
//      maid badge (optional)
//      [เก็บสาขานี้] link → /chairops/collect/<branchId>/new

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import {
  MasterDetailShell,
  ChairopsKpiTile,
} from "@/components/chairops/_kit";
import { Card, CardBody } from "@/components/ui/card";
import { Building2, AlertTriangle, Banknote, ChevronRight } from "lucide-react";
import { SyncChairsFromPosButton } from "./sync-button";

export const dynamic = "force-dynamic";

export default async function BranchCollectPage() {
  await requireRole("OFFICE");

  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      city: true,
      _count: { select: { chairs: { where: { isActive: true } } } },
    },
  });

  const maids = await prisma.chairopsUser.findMany({
    where: { role: "MAID", isActive: true },
    select: {
      id: true,
      displayName: true,
      authUserId: true,
      primaryBranchId: true,
    },
  });
  const maidByBranch = new Map<
    string,
    { id: string; displayName: string; authUserId: string | null }
  >();
  for (const m of maids) {
    if (!m.primaryBranchId) continue;
    if (!maidByBranch.has(m.primaryBranchId)) {
      maidByBranch.set(m.primaryBranchId, {
        id: m.id,
        displayName: m.displayName,
        authUserId: m.authUserId,
      });
    }
  }

  const branchesWithChair = branches.filter((b) => b._count.chairs > 0);
  const branchesWithoutMaid = branches.filter((b) => !maidByBranch.has(b.id))
    .length;

  return (
    <div className="chairops-scope">
      <MasterDetailShell sidebar={null} noMeta>
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500">
              ออฟฟิศ · เก็บเงินแทน
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">
              เก็บเงินสาขาไหน
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              เลือกสาขาที่จะเก็บเงิน · กดสาขาไหนก็เปิด chair-checklist
              ของสาขานั้น · ระบบบันทึกในนามคุณ (audit-tracked) · เก็บได้หลายสาขา
              ในรอบเดียว
            </p>
          </div>
          <SyncChairsFromPosButton />
        </header>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ChairopsKpiTile
            label="สาขาทั้งหมด"
            value={String(branches.length)}
            tone="neutral"
            icon={<Building2 className="size-4" aria-hidden />}
          />
          <ChairopsKpiTile
            label="พร้อมเก็บ (มีเก้าอี้)"
            value={String(branchesWithChair.length)}
            tone="success"
          />
          {branchesWithoutMaid > 0 && (
            <ChairopsKpiTile
              label="ยังไม่มีแม่บ้าน"
              value={String(branchesWithoutMaid)}
              tone="warning"
              icon={<AlertTriangle className="size-4" aria-hidden />}
            />
          )}
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => {
            const maid = maidByBranch.get(b.id);
            const hasChairs = b._count.chairs > 0;
            return (
              <li key={b.id}>
                <Card
                  className={
                    hasChairs
                      ? "border-zinc-200"
                      : "border-amber-200 bg-amber-50/50"
                  }
                >
                  <CardBody className="space-y-3 p-4">
                    <div className="space-y-1">
                      <div className="font-semibold text-zinc-900">
                        {b.name}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {b.city ?? "—"} · {b._count.chairs} เก้าอี้
                        {maid ? ` · แม่บ้าน ${maid.displayName}` : ""}
                      </div>
                    </div>
                    {hasChairs ? (
                      <Link
                        href={`/chairops/collect/${b.id}/new`}
                        className="inline-flex w-full items-center justify-between gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white active:bg-emerald-700"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Banknote className="size-4" aria-hidden />
                          เก็บเงินสาขานี้
                        </span>
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    ) : (
                      <div className="space-y-2">
                        <div className="rounded-md border border-amber-200 bg-white p-2 text-xs text-amber-700">
                          ยังไม่มีเก้าอี้ในสาขา
                        </div>
                        <Link
                          href={`/chairops/branches/${b.id}/chairs/add`}
                          className="inline-flex w-full items-center justify-between gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 active:bg-amber-50"
                        >
                          + เพิ่มเก้าอี้สาขานี้
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </div>
                    )}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>

        {branches.length === 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardBody className="p-4 text-sm text-amber-800">
              ยังไม่มีสาขา · เพิ่มสาขาก่อนที่ /chairops/branches
            </CardBody>
          </Card>
        )}
      </MasterDetailShell>
    </div>
  );
}
