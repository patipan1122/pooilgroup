// Per-branch deep view · header + KPI cards + 30-day timeline + sub-tabs
// Server Component · all reads server-side
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { baht, thaiDate, thaiDateTime, thaiRelative, ageHours } from "@/lib/chairops/utils/format";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/chairops/ui/card";
import { Badge } from "@/components/chairops/ui/badge";
import {
  StatusBadge,
  deriveStatus,
  formatAgeThai,
} from "../_components/status-badge";

export const dynamic = "force-dynamic";

const TICKET_STATUS_VARIANT = {
  OPEN: "danger" as const,
  ASSIGNED: "warning" as const,
  IN_PROGRESS: "warning" as const,
  WAITING_PARTS: "warning" as const,
  DONE: "success" as const,
  CANCELLED: "secondary" as const,
};

const CLEANLINESS_VARIANT = {
  PASS: "success" as const,
  WARN: "warning" as const,
  FAIL: "danger" as const,
};

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ branchSlug: string }>;
}) {
  const { branchSlug } = await params;

  const branch = await prisma.chairopsBranch.findUnique({
    where: { slug: branchSlug },
    include: { drifts: true },
  });
  if (!branch) notFound();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [collections, posDaily, cleanlinessReports, openTickets] = await Promise.all([
    prisma.chairopsCashCollection.findMany({
      where: { branchId: branch.id, collectedAt: { gte: thirtyDaysAgo } },
      orderBy: { collectedAt: "desc" },
      include: { maid: { select: { displayName: true } } },
      take: 100,
    }),
    prisma.chairopsPosDaily.findMany({
      where: { branchId: branch.id, bizDate: { gte: thirtyDaysAgo } },
      orderBy: { bizDate: "desc" },
      take: 100,
    }),
    prisma.chairopsCleanlinessReport.findMany({
      where: { branchId: branch.id },
      orderBy: { reportedAt: "desc" },
      take: 10,
      include: { maid: { select: { displayName: true } } },
    }),
    prisma.chairopsDamageTicket.findMany({
      where: {
        branchId: branch.id,
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] },
      },
      orderBy: { openedAt: "asc" },
      include: { assignedTo: { select: { displayName: true } } },
    }),
  ]);

  const drift = branch.drifts[0];
  const posTotal = drift?.posTotal ?? 0;
  const depositTotal = drift?.depositTotal ?? 0;
  const driftAmount = drift?.driftAmount ?? 0;
  const driftHours = drift?.driftSince ? ageHours(drift.driftSince) : 0;
  const daysSince = drift?.daysSinceLastCollection ?? 999;
  const status = deriveStatus({
    isActive: branch.isActive,
    driftAmount,
    driftHours,
    daysSinceLastCollection: daysSince,
  });

  // Mixed chronological timeline (last 30 days)
  type TimelineItem =
    | {
        kind: "collection";
        at: Date;
        deposit: number;
        counted: number;
        by: string;
        notes: string | null;
      }
    | {
        kind: "pos";
        at: Date;
        bizDate: Date;
        revenue: number;
        online: number;
        cash: number;
        chairCode: string | null;
      };

  const timeline: TimelineItem[] = [
    ...collections.map<TimelineItem>((c) => ({
      kind: "collection",
      at: c.collectedAt,
      deposit: c.depositedAmount,
      counted: c.countedAmount,
      by: c.maid?.displayName ?? "—",
      notes: c.notes,
    })),
    ...posDaily.map<TimelineItem>((p) => ({
      kind: "pos",
      at: p.enteredAt,
      bizDate: p.bizDate,
      revenue: p.totalRevenue,
      online: p.online,
      cash: p.totalCash,
      chairCode: p.chairCode,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Breadcrumb + header */}
      <div className="flex flex-col gap-2">
        <Link
          href="/chairops/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← กลับสรุปภาพรวม
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{branch.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[branch.region, branch.mallGroup, branch.floor].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
      </div>

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              POS รวม
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-2xl font-bold tabular-nums sm:p-5 sm:pt-0">
            {baht(posTotal)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              ฝากรวม
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-2xl font-bold tabular-nums sm:p-5 sm:pt-0">
            {baht(depositTotal)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              DRIFT
            </div>
          </CardHeader>
          <CardContent
            className={
              "p-4 pt-0 text-2xl font-bold tabular-nums sm:p-5 sm:pt-0 " +
              (driftAmount > 0
                ? "text-[hsl(0,84%,40%)]"
                : driftAmount < -100
                ? "text-[hsl(38,92%,32%)]"
                : "")
            }
          >
            {baht(driftAmount, true)}
            {driftAmount > 0 ? (
              <div className="mt-1 text-xs font-normal text-muted-foreground">
                ค้าง {formatAgeThai(driftHours)}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              เก็บล่าสุด
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-base font-semibold sm:p-5 sm:pt-0">
            {drift?.lastCollectionAt ? (
              <>
                <div>{thaiRelative(drift.lastCollectionAt)}</div>
                <div className="mt-1 text-xs font-normal text-muted-foreground">
                  {thaiDateTime(drift.lastCollectionAt)}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">ไม่เคยเก็บ</span>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Timeline */}
      <section className="rounded-xl border border-border bg-background shadow-sm">
        <div className="border-b border-border p-4 sm:p-5">
          <h2 className="text-base font-semibold sm:text-lg">เคลื่อนไหวล่าสุด (30 วัน)</h2>
          <p className="text-xs text-muted-foreground">
            รวม POS รายวัน + การเก็บเงินแม่บ้าน เรียงล่าสุดก่อน
          </p>
        </div>
        {timeline.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            ไม่มีข้อมูล 30 วันล่าสุด
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {timeline.map((t, i) => (
              <li key={`${t.kind}-${i}`} className="flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
                <div className="mt-1 shrink-0">
                  {t.kind === "collection" ? (
                    <Badge variant="success">เก็บเงิน</Badge>
                  ) : (
                    <Badge variant="secondary">POS</Badge>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {t.kind === "collection" ? (
                    <>
                      <p className="text-sm font-medium">
                        ฝาก {baht(t.deposit)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          (นับได้ {baht(t.counted)})
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        โดย {t.by} · {thaiDateTime(t.at)}
                      </p>
                      {t.notes ? (
                        <p className="mt-1 text-xs italic text-muted-foreground">{t.notes}</p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        ยอด {baht(t.revenue)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          (online {baht(t.online)} · เงินสด {baht(t.cash)})
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        วันทำการ {thaiDate(t.bizDate)}
                        {t.chairCode ? ` · เก้าอี้ ${t.chairCode}` : ""}
                      </p>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Sub-tabs: cleanliness + damage (rendered as two stacked panels, mobile-friendly) */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Cleanliness */}
        <div className="rounded-xl border border-border bg-background shadow-sm">
          <div className="border-b border-border p-4 sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">ความสะอาด (10 ครั้งล่าสุด)</h2>
          </div>
          {cleanlinessReports.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีรายงาน</div>
          ) : (
            <ul className="divide-y divide-border">
              {cleanlinessReports.map((c) => (
                <li key={c.id} className="flex items-center gap-3 p-3 sm:p-4">
                  <Badge variant={CLEANLINESS_VARIANT[c.grade]}>{c.grade}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      โดย {c.maid?.displayName ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {thaiRelative(c.reportedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Damage tickets */}
        <div className="rounded-xl border border-border bg-background shadow-sm">
          <div className="border-b border-border p-4 sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">
              ของเสียที่เปิดอยู่ ({openTickets.length})
            </h2>
          </div>
          {openTickets.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              ไม่มีของเสียค้าง · เยี่ยม!
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {openTickets.map((t) => (
                <li key={t.id} className="flex items-start gap-3 p-3 sm:p-4">
                  <Badge variant={TICKET_STATUS_VARIANT[t.status]} className="shrink-0">
                    {t.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t.ticketCode} · {t.category}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      เปิด {thaiRelative(t.openedAt)} · มอบให้{" "}
                      {t.assignedTo?.displayName ?? "ยังไม่มอบ"}
                      {t.priority === "URGENT" ? (
                        <span className="ml-1 font-semibold text-[hsl(0,84%,40%)]">· ด่วน</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
