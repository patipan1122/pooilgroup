// Audit log viewer · CEO / ADMIN only
// Filterable: entity · entityId · user · date range · paginated
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/chairops/ui/card";
import { thaiDateTime } from "@/lib/chairops/utils/format";
import { Prisma } from "@/lib/generated/prisma/client";

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    entityId?: string;
    userId?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireRole("CEO");
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const w: Prisma.ChairopsAuditLogWhereInput = {};
  if (sp.entity) w.entity = sp.entity;
  if (sp.entityId) w.entityId = sp.entityId;
  if (sp.userId) w.userId = sp.userId;
  if (sp.action) w.action = { contains: sp.action, mode: "insensitive" };
  if (sp.from || sp.to) {
    const range: Prisma.DateTimeFilter = {};
    if (sp.from) range.gte = new Date(sp.from);
    if (sp.to) range.lte = new Date(sp.to + "T23:59:59");
    w.createdAt = range;
  }

  const [logs, total, entities, users] = await Promise.all([
    prisma.chairopsAuditLog.findMany({
      where: w,
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.chairopsAuditLog.count({ where: w }),
    // Distinct entity names for filter dropdown
    prisma.chairopsAuditLog.findMany({
      select: { entity: true },
      distinct: ["entity"],
      orderBy: { entity: "asc" },
    }),
    prisma.chairopsUser.findMany({
      where: { isActive: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 200,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = new URLSearchParams(
    Object.entries({ ...sp, page: undefined }).filter(([, v]) => v) as [string, string][]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          ทั้งหมด {total.toLocaleString("en-US")} รายการ · หน้า {page}/{pageCount}
        </p>
      </div>

      <Card>
        <div className="p-4">
          <form className="flex flex-wrap items-end gap-3 text-sm" method="GET">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Entity</label>
              <select
                name="entity"
                defaultValue={sp.entity ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                <option value="">ทั้งหมด</option>
                {entities.map((e) => (
                  <option key={e.entity} value={e.entity}>
                    {e.entity}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Entity ID</label>
              <input
                type="text"
                name="entityId"
                defaultValue={sp.entityId ?? ""}
                placeholder="UUID"
                className="h-9 rounded-md border border-border bg-background px-2 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">ผู้ใช้</label>
              <select
                name="userId"
                defaultValue={sp.userId ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                <option value="">ทั้งหมด</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Action</label>
              <input
                type="text"
                name="action"
                defaultValue={sp.action ?? ""}
                placeholder="เช่น damage_ticket"
                className="h-9 rounded-md border border-border bg-background px-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">ตั้งแต่</label>
              <input
                type="date"
                name="from"
                defaultValue={sp.from ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">ถึง</label>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              ค้นหา
            </button>
            <Link
              href="/chairops/audit"
              className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
            >
              ล้าง
            </Link>
          </form>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-14 z-10 bg-muted/50 sm:top-16">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">เมื่อ</th>
                <th className="px-3 py-2 font-medium">ผู้ใช้</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Entity ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-12 text-center text-muted-foreground">
                    ไม่มีข้อมูล
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="border-t border-border hover:bg-muted/50">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {thaiDateTime(l.createdAt)}
                    </td>
                    <td className="px-3 py-2">{l.user?.displayName ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/chairops/audit/${l.entity}/${l.entityId}`}
                        className="text-primary hover:underline"
                      >
                        {l.entity}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{l.entityId}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link
              href={`/chairops/audit?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page - 1) })}`}
              className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
            >
              ← ก่อนหน้า
            </Link>
          )}
          <span className="text-muted-foreground">
            หน้า {page} / {pageCount}
          </span>
          {page < pageCount && (
            <Link
              href={`/chairops/audit?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page + 1) })}`}
              className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
            >
              ถัดไป →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
