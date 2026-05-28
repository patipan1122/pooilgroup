// Damage tickets — admin list view
// TECHNICIAN sees only their assigned + open · MANAGER+ sees all
// Filters: branch · status · priority · assignee · date range
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { ChairopsTicketStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABEL: Record<ChairopsTicketStatus, string> = {
  OPEN: "ใหม่",
  ASSIGNED: "มอบหมายแล้ว",
  IN_PROGRESS: "กำลังซ่อม",
  WAITING_PARTS: "รออะไหล่",
  DONE: "เสร็จ",
  CANCELLED: "ยกเลิก",
};

const STATUS_TONE: Record<ChairopsTicketStatus, "brand" | "neutral" | "success" | "warning" | "danger"> = {
  OPEN: "danger",
  ASSIGNED: "warning",
  IN_PROGRESS: "warning",
  WAITING_PARTS: "neutral",
  DONE: "success",
  CANCELLED: "neutral",
};

type Search = {
  branch?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  from?: string;
  to?: string;
};

export default async function DamageListPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireAuth();
  // MAID can only access /damage/new (other agent's scope) — redirect away from admin list
  if (session.user.role === "MAID") redirect("/chairops/damage/new");
  const sp = await searchParams;

  // technician = scope to their own assignments unless explicit "all"
  const isTechnician = session.user.role === "TECHNICIAN";

  const w: Prisma.ChairopsDamageTicketWhereInput = {};
  if (isTechnician) {
    w.assignedToId = session.user.id;
  } else {
    if (sp.assignee) w.assignedToId = sp.assignee;
    if (sp.branch) w.branchId = sp.branch;
  }
  if (sp.status) w.status = sp.status as ChairopsTicketStatus;
  if (sp.priority) w.priority = sp.priority;
  if (sp.from || sp.to) {
    const range: Prisma.DateTimeFilter = {};
    if (sp.from) range.gte = new Date(sp.from);
    if (sp.to) range.lte = new Date(sp.to);
    w.openedAt = range;
  }

  const [tickets, branches, technicians] = await Promise.all([
    prisma.chairopsDamageTicket.findMany({
      where: w,
      include: {
        branch: { select: { name: true, slug: true } },
        chair: { select: { chairCode: true } },
        reportedBy: { select: { displayName: true } },
        assignedTo: { select: { displayName: true } },
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { openedAt: "desc" }],
      take: 200,
    }),
    isTechnician
      ? Promise.resolve([])
      : prisma.chairopsBranch.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
    isTechnician
      ? Promise.resolve([])
      : prisma.chairopsUser.findMany({
          where: { role: "TECHNICIAN", isActive: true },
          select: { id: true, displayName: true },
          orderBy: { displayName: "asc" },
        }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ของเสีย / ตั๋วซ่อม</h1>
          <p className="text-sm text-muted-foreground">
            {isTechnician
              ? "ตั๋วที่มอบหมายให้คุณ"
              : `รายการทั้งหมด · ${tickets.length} รายการ`}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/chairops/damage?status=OPEN"
            className="rounded-md border border-border bg-background px-3 py-1.5 hover:bg-muted"
          >
            เฉพาะใหม่
          </Link>
          <Link
            href="/chairops/damage"
            className="rounded-md border border-border bg-background px-3 py-1.5 hover:bg-muted"
          >
            ทั้งหมด
          </Link>
        </div>
      </div>

      {!isTechnician && (
        <Card>
          <CardBody className="p-4">
            <form className="flex flex-wrap items-end gap-3 text-sm" method="GET">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">สาขา</label>
                <select
                  name="branch"
                  defaultValue={sp.branch ?? ""}
                  className="h-9 rounded-md border border-border bg-background px-2"
                >
                  <option value="">ทั้งหมด</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">สถานะ</label>
                <select
                  name="status"
                  defaultValue={sp.status ?? ""}
                  className="h-9 rounded-md border border-border bg-background px-2"
                >
                  <option value="">ทั้งหมด</option>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">ความเร่งด่วน</label>
                <select
                  name="priority"
                  defaultValue={sp.priority ?? ""}
                  className="h-9 rounded-md border border-border bg-background px-2"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="URGENT">ด่วน</option>
                  <option value="NORMAL">ปกติ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">ผู้รับผิดชอบ</label>
                <select
                  name="assignee"
                  defaultValue={sp.assignee ?? ""}
                  className="h-9 rounded-md border border-border bg-background px-2"
                >
                  <option value="">ทั้งหมด</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
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
                href="/chairops/damage"
                className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
              >
                ล้างฟิลเตอร์
              </Link>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-14 z-10 bg-muted/50 sm:top-16">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">รหัส</th>
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 font-medium">เครื่อง</th>
                <th className="px-3 py-2 font-medium">อาการ</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2 font-medium">ผู้รับผิดชอบ</th>
                <th className="px-3 py-2 font-medium">แจ้งเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-12 text-center text-muted-foreground"
                  >
                    ไม่มีตั๋วที่ตรงเงื่อนไข
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-border hover:bg-muted/50"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/chairops/damage/${t.ticketCode}`}
                        className="text-primary hover:underline"
                      >
                        {t.ticketCode}
                      </Link>
                      {t.priority === "URGENT" && (
                        <Badge tone="danger" className="ml-2">
                          ด่วน
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{t.branch.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.chair?.chairCode ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{t.category}</div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {t.description}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[t.status]}>
                        {STATUS_LABEL[t.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {t.assignedTo?.displayName ?? (
                        <span className="text-muted-foreground">ยังไม่ระบุ</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground" title={thaiDateTime(t.openedAt)}>
                      {thaiRelative(t.openedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
