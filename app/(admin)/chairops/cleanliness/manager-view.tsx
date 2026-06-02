// Cleanliness MANAGER+ list view · Server Component.
// CEO 2026-06-02 approved: managers see recent cleanliness reports across all
// branches in their org (or filter by ?branch=<slug>). Smallest viable list:
// branch · maid · time · grade · photo-count · note preview.
//
// Why no shell-nav: this route is reached from /chairops/dashboard top-nav, so
// users already have global navigation. Keep this view focused on the data.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateTime } from "@/lib/chairops/utils/format";

const GRADE_MAP = {
  PASS: { tone: "success" as const, label: "ผ่าน" },
  WARN: { tone: "warning" as const, label: "เฝ้าดู" },
  FAIL: { tone: "danger" as const, label: "ไม่ผ่าน" },
};

export async function CleanlinessManagerView({
  orgId,
  branchSlug,
}: {
  orgId: string;
  branchSlug?: string;
}) {
  // Branch dropdown source — every branch in the org (multi-tenant safe).
  const branches = await prisma.chairopsBranch.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });

  const selectedBranch = branchSlug
    ? branches.find((b) => b.slug === branchSlug)
    : null;

  const reports = await prisma.chairopsCleanlinessReport.findMany({
    where: {
      orgId,
      ...(selectedBranch ? { branchId: selectedBranch.id } : {}),
    },
    orderBy: { reportedAt: "desc" },
    take: 100,
    select: {
      id: true,
      reportedAt: true,
      grade: true,
      notes: true,
      photoUrls: true,
      branchId: true,
      byMaidId: true,
    },
  });

  // Resolve maid names + branch labels in 2 batched queries (no N+1).
  const maidIds = Array.from(new Set(reports.map((r) => r.byMaidId)));
  const branchIds = Array.from(new Set(reports.map((r) => r.branchId)));
  const [maids, branchRows] = await Promise.all([
    prisma.chairopsUser.findMany({
      where: { id: { in: maidIds }, orgId },
      select: { id: true, displayName: true },
    }),
    prisma.chairopsBranch.findMany({
      where: { id: { in: branchIds }, orgId },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  const maidById = new Map(maids.map((m) => [m.id, m.displayName]));
  const branchById = new Map(branchRows.map((b) => [b.id, b]));

  const failCount = reports.filter((r) => r.grade === "FAIL").length;
  const warnCount = reports.filter((r) => r.grade === "WARN").length;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">ความสะอาด</h1>
        <p className="text-sm text-muted-foreground">
          รายงานล่าสุด {reports.length} รายการ
          {failCount > 0 && (
            <span className="ml-2 text-danger">· ไม่ผ่าน {failCount}</span>
          )}
          {warnCount > 0 && (
            <span className="ml-2 text-warning">· เฝ้าดู {warnCount}</span>
          )}
        </p>
      </header>

      <form method="GET" className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="branch">
          สาขา
        </label>
        <select
          id="branch"
          name="branch"
          defaultValue={branchSlug ?? ""}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.slug}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          กรอง
        </button>
        {branchSlug && (
          <Link
            href="/chairops/cleanliness"
            className="h-9 inline-flex items-center px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            ล้างตัวกรอง
          </Link>
        )}
      </form>

      {reports.length === 0 ? (
        <Card>
          <CardBody className="p-8 text-center text-sm text-muted-foreground">
            ยังไม่มีรายงานความสะอาด
            {selectedBranch ? ` สำหรับสาขา ${selectedBranch.name}` : ""}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">เมื่อ</th>
                    <th className="px-3 py-2 font-medium">สาขา</th>
                    <th className="px-3 py-2 font-medium">แม่บ้าน</th>
                    <th className="px-3 py-2 font-medium">เกรด</th>
                    <th className="px-3 py-2 font-medium">รูป</th>
                    <th className="px-3 py-2 font-medium">โน้ต</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const g = GRADE_MAP[r.grade];
                    const branch = branchById.get(r.branchId);
                    return (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {thaiDateTime(r.reportedAt)}
                        </td>
                        <td className="px-3 py-2">{branch?.name ?? "—"}</td>
                        <td className="px-3 py-2">
                          {maidById.get(r.byMaidId) ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={g.tone}>{g.label}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {r.photoUrls.length} รูป
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[24rem]">
                          <span className="line-clamp-1">{r.notes ?? "—"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
