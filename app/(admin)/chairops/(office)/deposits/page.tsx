// /chairops/deposits — OFFICE pending-deposit list.
//
// When office collects "เก็บเงินแทน" the round is recorded under the office
// user (createCashCollection sets maidId = office user.id via branchOverride).
// The maid deposit flow is requireExactRole("MAID") + filters maidId=self +
// primaryBranchId, so office-collected cash had NO deposit path (CEO hit this
// live 2026-06-03 → "เก็บแล้วหารายการฝากไม่เจอ"). This page lists the office
// user's own pending rounds grouped by branch and lets them batch-deposit per
// branch via the shared BatchDepositForm (passing branchOverride).
import Link from "next/link";
import { ChevronLeft, Banknote } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { BatchDepositForm } from "@/app/(admin)/chairops/(maid)/m/deposit/form";

export const dynamic = "force-dynamic";

export default async function OfficeDepositsPage() {
  const session = await requireRole("OFFICE");

  const pending = await prisma.chairopsCashCollection.findMany({
    where: {
      orgId: session.user.orgId,
      maidId: session.user.id, // office's own on-behalf rounds (not real maids')
      depositId: null,
    },
    orderBy: { collectedAt: "asc" },
    take: 200,
    select: {
      id: true,
      countedAmount: true,
      collectedAt: true,
      notes: true,
      branchId: true,
      branch: { select: { name: true } },
    },
  });

  const byBranch = new Map<string, { name: string; rows: typeof pending }>();
  for (const c of pending) {
    const existing = byBranch.get(c.branchId);
    if (existing) {
      existing.rows.push(c);
    } else {
      byBranch.set(c.branchId, { name: c.branch?.name ?? "—", rows: [c] });
    }
  }

  return (
    <div className="chairops-scope mx-auto max-w-3xl space-y-5 px-4 py-6">
      <Link
        href="/chairops/branch-collect"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับไปเก็บเงิน
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          ออฟฟิศ · ฝากเงินที่เก็บแทน
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          รายการรอฝาก
        </h1>
        <p className="text-sm text-zinc-600">
          รายการที่คุณเก็บแทนแล้วยังไม่ฝาก · แยกตามสาขา · เลือกรอบแล้วกดฝากก้อนได้เลย
        </p>
      </header>

      {byBranch.size === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardBody className="flex flex-col items-center gap-3 p-6 text-center">
            {/* น้องแมวน้ำพักผ่อน — สถานะว่าง (ฝากครบแล้ว) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/mascot/banner/seal-onsen.jpg"
              alt=""
              aria-hidden
              className="h-40 w-auto rounded-xl"
            />
            <p className="text-sm font-semibold text-emerald-800">
              ไม่มีรายการค้างฝาก · เก็บครบฝากครบแล้ว 🎉
            </p>
          </CardBody>
        </Card>
      ) : (
        Array.from(byBranch.entries()).map(([branchId, g]) => {
          const sum = g.rows.reduce((s, r) => s + r.countedAmount, 0);
          return (
            <Card key={branchId} className="border-zinc-200">
              <CardBody className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-zinc-900">
                    <Banknote
                      className="h-5 w-5 shrink-0 text-emerald-600"
                      aria-hidden
                    />
                    {g.name}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {g.rows.length} รอบ · {sum.toLocaleString()} ฿
                  </div>
                </div>
                <BatchDepositForm
                  pendingCollections={g.rows.map((r) => ({
                    id: r.id,
                    countedAmount: r.countedAmount,
                    collectedAt: r.collectedAt.toISOString(),
                    notes: r.notes,
                  }))}
                  branchOverride={branchId}
                  redirectTo="/chairops/deposits"
                />
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
