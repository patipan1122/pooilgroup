// Office "เก็บเงินแทนแม่บ้าน" — CEO 2026-05-30 spec: office/CEO sometimes
// needs to do a maid's cash-collect run themselves. Picking a SPECIFIC maid
// (the "เล่นเป็น" button on /chairops/users) is one path; this page is the
// faster one — pick a BRANCH directly and the system finds the active maid
// for that branch + impersonates them in one step.
//
// Layout: card grid of every active branch. Each card shows the assigned
// maid (or a warning if there isn't one yet) and a single "เก็บเงินสาขานี้"
// button that posts to /api/admin/users/<authUserId>/impersonate then sends
// the office user straight to /chairops/m.
//
// Auth: requireRole(ADMIN) from chairops session — same gate as
// /chairops/users. The impersonate API itself re-checks Pool admin tier.

import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import {
  MasterDetailShell,
  ChairopsKpiTile,
} from "@/components/chairops/_kit";
import { Card, CardBody } from "@/components/ui/card";
import { Building2, AlertTriangle } from "lucide-react";
import { PlayAsMaidButton } from "../users/play-as-maid-button";

export const dynamic = "force-dynamic";

export default async function BranchCollectPage() {
  await requireRole("ADMIN");

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

  // Pull every active MAID + their primaryBranchId so we can match maid-to-
  // branch in O(n). Branches with no maid get a warning card.
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
    // First maid wins (1-maid-per-branch is the design per memory
    // [[chairops-maid-one-per-branch-collect-only]]); skip extras silently.
    if (!maidByBranch.has(m.primaryBranchId)) {
      maidByBranch.set(m.primaryBranchId, {
        id: m.id,
        displayName: m.displayName,
        authUserId: m.authUserId,
      });
    }
  }

  const branchesWithMaid = branches.filter((b) => maidByBranch.has(b.id));
  const branchesWithoutMaid = branches.length - branchesWithMaid.length;

  return (
    <div className="chairops-scope">
      <MasterDetailShell sidebar={null} noMeta>
        <header className="mb-5">
          <p className="text-xs font-semibold text-zinc-500">
            ออฟฟิศ · เก็บเงินแทน
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">
            เก็บเงินสาขาไหน
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            เลือกสาขาที่จะเก็บเงินแทนแม่บ้าน · ระบบจะเข้าใช้งานในมุมมองแม่บ้านของสาขานั้น
            · ทุก action จะถูกบันทึก audit log
          </p>
        </header>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ChairopsKpiTile
            label="สาขาทั้งหมด"
            value={String(branches.length)}
            tone="neutral"
            icon={<Building2 className="size-4" aria-hidden />}
          />
          <ChairopsKpiTile
            label="พร้อมเข้าใช้งาน"
            value={String(branchesWithMaid.length)}
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
            const ready = !!maid?.authUserId;
            return (
              <li key={b.id}>
                <Card
                  className={
                    ready
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
                      </div>
                    </div>
                    {ready ? (
                      <>
                        <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs">
                          <div className="text-zinc-500">แม่บ้านประจำ</div>
                          <div className="font-medium text-zinc-800">
                            {maid?.displayName}
                          </div>
                        </div>
                        <PlayAsMaidButton
                          authUserId={maid!.authUserId!}
                          maidDisplayName={`สาขา ${b.name}`}
                        />
                      </>
                    ) : (
                      <div className="rounded-md border border-amber-200 bg-white p-2 text-xs text-amber-700">
                        {maid
                          ? "แม่บ้านยังไม่ได้ผูก auth (ติดต่อ admin)"
                          : "ยังไม่มีแม่บ้านประจำสาขา"}
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
