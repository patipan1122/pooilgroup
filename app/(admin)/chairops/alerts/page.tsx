// Alerts queue — open + acked alerts · filter by branch / kind / level
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { type Prisma } from "@/lib/generated/prisma/client";
import { ChairopsAlertKind, ChairopsAlertLevel, ChairopsAlertStatus } from "@/lib/generated/prisma/enums";
import { ackAlertAction, resolveAlertAction } from "./actions";

const STATUS_OPTIONS: { value: ChairopsAlertStatus | "ALL_OPEN"; label: string }[] = [
  { value: "ALL_OPEN", label: "เปิด + ACK" },
  { value: ChairopsAlertStatus.OPEN, label: "OPEN" },
  { value: ChairopsAlertStatus.ACK, label: "ACK" },
  { value: ChairopsAlertStatus.RESOLVED, label: "RESOLVED" },
  { value: ChairopsAlertStatus.IGNORED, label: "IGNORED" },
];

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; kind?: string; level?: string; status?: string; acked?: string; resolved?: string; error?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const sp = await searchParams;

  const statusFilter = (sp.status ?? "ALL_OPEN") as ChairopsAlertStatus | "ALL_OPEN";
  const branchFilter = sp.branchId || null;
  const kindFilter = (sp.kind as ChairopsAlertKind | undefined) || null;
  const levelFilter = (sp.level as ChairopsAlertLevel | undefined) || null;

  const whereClause: Prisma.ChairopsAlertWhereInput = {};
  if (statusFilter === "ALL_OPEN") {
    whereClause.status = { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] };
  } else {
    whereClause.status = statusFilter as ChairopsAlertStatus;
  }
  if (branchFilter) whereClause.branchId = branchFilter;
  if (kindFilter) whereClause.kind = kindFilter;
  if (levelFilter) whereClause.level = levelFilter;

  const [alerts, branches, ackers] = await Promise.all([
    prisma.chairopsAlert.findMany({
      where: whereClause,
      orderBy: [{ level: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { branch: { select: { id: true, name: true } } },
    }),
    prisma.chairopsBranch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // pre-fetch acker display names
    prisma.chairopsUser.findMany({ select: { id: true, displayName: true } }),
  ]);
  const ackerMap = new Map(ackers.map((u) => [u.id, u.displayName]));

  const counts = {
    open: alerts.filter((a) => a.status === ChairopsAlertStatus.OPEN).length,
    ack: alerts.filter((a) => a.status === ChairopsAlertStatus.ACK).length,
    critical: alerts.filter((a) => a.level === ChairopsAlertLevel.CRITICAL && (a.status === ChairopsAlertStatus.OPEN || a.status === ChairopsAlertStatus.ACK)).length,
  };

  return (
    <OfficeShell session={session} active="/chairops/alerts">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SHORTAGE · MISSED_COLLECTION · WRITE_OFF_REQUESTED · POS_NOT_INGESTED · CHAIR_OFFLINE · CLEANLINESS_FAIL · REPAIR_OVERDUE
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-md border border-border bg-background px-2 py-1">OPEN: <strong>{counts.open}</strong></span>
          <span className="rounded-md border border-border bg-background px-2 py-1">ACK: <strong>{counts.ack}</strong></span>
          <span className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-danger">
            CRITICAL: <strong>{counts.critical}</strong>
          </span>
        </div>
      </div>

      {/* flash */}
      {sp.error && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm">{sp.error}</div>
      )}
      {(sp.acked || sp.resolved) && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm">
          {sp.resolved ? "resolved เรียบร้อย" : "acked เรียบร้อย"}
        </div>
      )}

      {/* filters */}
      <form action="/chairops/alerts" method="get" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              status: {o.label}
            </option>
          ))}
        </select>
        <select
          name="branchId"
          defaultValue={branchFilter ?? ""}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          name="kind"
          defaultValue={kindFilter ?? ""}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">ทุกประเภท</option>
          {Object.values(ChairopsAlertKind).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          name="level"
          defaultValue={levelFilter ?? ""}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">ทุกระดับ</option>
          {Object.values(ChairopsAlertLevel).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          กรอง
        </Button>
        <Link
          href="/chairops/alerts"
          className="rounded-md border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          ล้าง filter
        </Link>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-2">เวลา</th>
              <th className="px-2 py-2">ระดับ</th>
              <th className="px-2 py-2">ประเภท</th>
              <th className="px-2 py-2">สาขา</th>
              <th className="px-2 py-2">หัวข้อ + รายละเอียด</th>
              <th className="px-2 py-2">สถานะ</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {alerts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  ไม่มี alert ตาม filter นี้ · เงียบสนิท
                </td>
              </tr>
            )}
            {alerts.map((a) => (
              <tr
                key={a.id}
                className={
                  a.level === ChairopsAlertLevel.CRITICAL
                    ? "bg-danger/5 hover:bg-danger/10"
                    : a.level === ChairopsAlertLevel.WARN
                      ? "bg-warning/5 hover:bg-warning/10"
                      : "hover:bg-muted/40"
                }
              >
                <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">
                  <div>{thaiDateTime(a.createdAt)}</div>
                  <div>{thaiRelative(a.createdAt)}</div>
                </td>
                <td className="px-2 py-2">
                  <Badge
                    variant={
                      a.level === ChairopsAlertLevel.CRITICAL
                        ? "danger"
                        : a.level === ChairopsAlertLevel.WARN
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {a.level}
                  </Badge>
                </td>
                <td className="px-2 py-2 font-mono text-xs">{a.kind}</td>
                <td className="px-2 py-2 text-xs">
                  {a.branch ? (
                    <Link href={`/chairops/reconcile/${a.branch.id}`} className="hover:underline">
                      {a.branch.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-2 max-w-[420px]">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.message}</div>
                </td>
                <td className="px-2 py-2">
                  <Badge
                    variant={
                      a.status === ChairopsAlertStatus.OPEN
                        ? "danger"
                        : a.status === ChairopsAlertStatus.ACK
                          ? "warning"
                          : a.status === ChairopsAlertStatus.RESOLVED
                            ? "success"
                            : "secondary"
                    }
                  >
                    {a.status}
                  </Badge>
                  {a.ackedById && a.status !== ChairopsAlertStatus.OPEN && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      โดย {ackerMap.get(a.ackedById) ?? a.ackedById.slice(0, 6)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    {a.status === ChairopsAlertStatus.OPEN && (
                      <form action={ackAlertAction}>
                        <input type="hidden" name="alertId" value={a.id} />
                        <Button type="submit" size="sm" variant="outline" className="w-full">
                          รับทราบ
                        </Button>
                      </form>
                    )}
                    {(a.status === ChairopsAlertStatus.OPEN || a.status === ChairopsAlertStatus.ACK) && (
                      <form action={resolveAlertAction}>
                        <input type="hidden" name="alertId" value={a.id} />
                        <Button type="submit" size="sm" variant="success" className="w-full">
                          ปิด (resolve)
                        </Button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OfficeShell>
  );
}
