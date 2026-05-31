// Per-chair revenue + move history report.
// CEO 2026-05-31 spec: chair code can appear multiple rows in a report,
// one per branch it earned revenue at. This page shows the chair's full
// history — move log on the left, revenue grouped by (branch) on the right.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ArrowRight, History, Building2 } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { baht, thaiDate } from "@/lib/chairops/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ chairCode: string }>;
}

export default async function ChairRevenuePage({ params }: Props) {
  const session = await requireRole("OFFICE");
  const { chairCode: codeRaw } = await params;
  const chairCode = decodeURIComponent(codeRaw).toUpperCase();

  const chair = await prisma.chairopsChair.findFirst({
    where: { orgId: session.user.orgId, chairCode },
    include: { branch: { select: { id: true, name: true } } },
  });

  // Per-branch revenue rollup from PosDaily. group by branchId so chair
  // shows ONE row per branch it ever earned at — exactly what CEO described.
  // posDaily contains the file-snapshot branchId regardless of moves.
  type Group = {
    branchId: string;
    _sum: { cashTotal: unknown; onlineTotal: unknown; grossTotal: unknown };
    _count: { _all: number };
  };
  const grouped = (await prisma.chairopsPosDaily.groupBy({
    by: ["branchId"],
    where: { orgId: session.user.orgId, chairCode },
    _sum: { cashTotal: true, onlineTotal: true, grossTotal: true },
    _count: { _all: true },
  })) as unknown as Group[];

  // Fetch branch names for the groups.
  const branchIds = grouped.map((g) => g.branchId);
  const branches = await prisma.chairopsBranch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
  });
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  // Move history.
  const moves = chair
    ? await prisma.chairopsChairMove.findMany({
        where: { orgId: session.user.orgId, chairId: chair.id },
        orderBy: { movedAt: "desc" },
        include: {
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
          movedBy: { select: { displayName: true } },
        },
        take: 50,
      })
    : [];

  const total = grouped.reduce(
    (sum, g) => sum + Number(g._sum.grossTotal ?? 0),
    0,
  );

  if (!chair && grouped.length === 0) notFound();

  return (
    <div className="chairops-scope max-w-3xl space-y-4 p-4">
      <Link
        href="/chairops/branches"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับสาขา
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          เก้าอี้ · รายงานยอด & ประวัติย้าย
        </p>
        <h1 className="font-mono text-2xl font-bold tracking-tight text-zinc-900">
          {chairCode}
        </h1>
        <p className="text-sm text-zinc-500">
          {chair ? (
            <>
              ปัจจุบันอยู่ที่{" "}
              <span className="font-medium text-zinc-800">{chair.branch.name}</span>
              {!chair.isActive && (
                <Badge tone="neutral" className="ml-2 text-[10px]">
                  ปิดใช้งาน
                </Badge>
              )}
            </>
          ) : (
            <span className="text-amber-700">เก้าอี้นี้ไม่อยู่ในระบบแล้ว · ข้อมูลยอด POS ยังอยู่</span>
          )}
        </p>
      </header>

      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardBody className="space-y-1 p-4">
          <div className="text-xs text-emerald-700">ยอดรวม (ทุกสาขา · ทุกวัน)</div>
          <div className="text-3xl font-bold tabular-nums text-emerald-900">
            {baht(total)}
          </div>
          <div className="text-xs text-emerald-700">
            จาก {grouped.length} สาขา ·{" "}
            {grouped.reduce((s, g) => s + g._count._all, 0)} วัน
          </div>
        </CardBody>
      </Card>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <Building2 className="size-4" aria-hidden />
          ยอดต่อสาขา ({grouped.length})
        </h2>
        {grouped.length === 0 ? (
          <Card>
            <CardBody className="p-4 text-sm text-zinc-500">
              ยังไม่มียอด POS สำหรับเก้าอี้นี้
            </CardBody>
          </Card>
        ) : (
          <ul className="space-y-2">
            {grouped
              .sort(
                (a, b) =>
                  Number(b._sum.grossTotal ?? 0) - Number(a._sum.grossTotal ?? 0),
              )
              .map((g) => {
                const cash = Number(g._sum.cashTotal ?? 0);
                const online = Number(g._sum.onlineTotal ?? 0);
                const gross = Number(g._sum.grossTotal ?? 0);
                const isCurrent = chair?.branchId === g.branchId;
                return (
                  <li key={g.branchId}>
                    <Card
                      className={
                        isCurrent
                          ? "border-emerald-300 bg-emerald-50/30"
                          : "border-zinc-200"
                      }
                    >
                      <CardBody className="space-y-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-zinc-900">
                            {branchNameById.get(g.branchId) ?? "—"}
                            {isCurrent && (
                              <span className="ml-2 text-xs font-normal text-emerald-700">
                                ปัจจุบัน
                              </span>
                            )}
                          </div>
                          <div className="text-lg font-bold tabular-nums text-zinc-900">
                            {baht(gross)}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded bg-zinc-100 p-2">
                            <div className="text-zinc-500">เงินสด</div>
                            <div className="font-medium tabular-nums text-zinc-800">
                              {baht(cash)}
                            </div>
                          </div>
                          <div className="rounded bg-zinc-100 p-2">
                            <div className="text-zinc-500">ออนไลน์</div>
                            <div className="font-medium tabular-nums text-zinc-800">
                              {baht(online)}
                            </div>
                          </div>
                          <div className="rounded bg-zinc-100 p-2">
                            <div className="text-zinc-500">จำนวนวัน</div>
                            <div className="font-medium tabular-nums text-zinc-800">
                              {g._count._all}
                            </div>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <History className="size-4" aria-hidden />
          ประวัติย้ายสาขา ({moves.length})
        </h2>
        {moves.length === 0 ? (
          <Card>
            <CardBody className="p-4 text-sm text-zinc-500">
              ยังไม่มีบันทึกการย้าย (เก้าอี้ยังอยู่ที่สาขาเดิมตั้งแต่ลงทะเบียน)
            </CardBody>
          </Card>
        ) : (
          <ul className="space-y-2">
            {moves.map((m) => (
              <li key={m.id}>
                <Card>
                  <CardBody className="space-y-1 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-500">
                        {thaiDate(m.movedAt)}
                      </span>
                      <Badge
                        tone={m.source === "pos_ingest" ? "neutral" : "success"}
                        className="text-[10px]"
                      >
                        {m.source}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-zinc-700">
                        {m.fromBranch?.name ?? <em className="text-zinc-400">เริ่มต้น</em>}
                      </span>
                      <ArrowRight className="size-3.5 text-zinc-400" aria-hidden />
                      <span className="font-medium text-zinc-900">
                        {m.toBranch.name}
                      </span>
                    </div>
                    {m.movedBy && (
                      <div className="text-xs text-zinc-500">
                        โดย {m.movedBy.displayName}
                      </div>
                    )}
                    {m.notes && (
                      <div className="text-xs italic text-zinc-500">{m.notes}</div>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
