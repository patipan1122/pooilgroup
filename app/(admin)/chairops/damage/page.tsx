// ของเสีย — unified page · CEO 2026-06-29 merged "จัดการตู้เสีย" in here as a tab
//   [ ตู้ต้องเช็ก ]  (auto-detected suspect-broken payment devices, redesigned)
//   [ ใบแจ้งซ่อม ]   (the existing damage-ticket list + filters)
// Default tab = suspects for office+ (the active concern); technicians only see
// their assigned tickets.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { ChairopsTicketStatus, ChairopsAlertKind } from "@/lib/generated/prisma/enums";
import { getSuspectsWithChecks } from "@/lib/chairops/alerts/_chair-check";
import { SuspectsView } from "./_suspects-view";
import { recheckSuspects } from "./check-actions";
import { RecheckButton } from "./_recheck-button";

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

const OPEN_TICKET_STATUSES: ChairopsTicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

type Search = {
  tab?: string;
  // tickets-tab filters
  branch?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  from?: string;
  to?: string;
  // suspects-tab filters
  sstream?: string;
  sstatus?: string;
  // set by recheckSuspects() redirect → shows "✅ เช็คแล้ว" confirmation
  checked?: string;
};

export default async function DamageListPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireAuth();
  // MAID can only access /damage/new — redirect away from admin list
  if (session.user.role === "MAID") redirect("/chairops/damage/new");
  const sp = await searchParams;
  const orgId = session.user.orgId;
  const isTechnician = session.user.role === "TECHNICIAN";
  const canSeeSuspects = !isTechnician;
  const tab = !canSeeSuspects || sp.tab === "tickets" ? "tickets" : "suspects";

  // Suspects (office+ only) — needed for the tab count + the suspects view.
  const suspects = canSeeSuspects ? await getSuspectsWithChecks(orgId) : [];

  // How many branches the live detector SKIPPED because their POS isn't
  // ingested (W-042 · _stream-activity.ts:124). Without this, "0 ตู้ต้องเช็ก"
  // reads as "✅ ทุกช่องปกติ" even when N branches were never actually checked —
  // exactly the CEO's "เหมือนใช้ไม่ได้" confusion (Pinpoint 2026-08-02). We
  // surface it so the empty state is honest and points at the real blocker.
  let posBlockedBranches = 0;
  if (canSeeSuspects && tab === "suspects") {
    const blocked = await prisma.chairopsAlert.findMany({
      where: {
        orgId,
        kind: ChairopsAlertKind.POS_NOT_INGESTED,
        status: { in: ["OPEN", "ACK"] },
      },
      select: { branchId: true },
    });
    posBlockedBranches = new Set(
      blocked.map((b) => b.branchId).filter((id): id is string => !!id),
    ).size;
  }

  // Open-ticket count for the tab label (cheap COUNT, always).
  const ticketScope: Prisma.ChairopsDamageTicketWhereInput = { orgId };
  if (isTechnician) ticketScope.assignedToId = session.user.id;
  const openTicketCount = await prisma.chairopsDamageTicket.count({
    where: { ...ticketScope, status: { in: OPEN_TICKET_STATUSES } },
  });

  // Tickets-tab data — only fetched when that tab is active.
  let tickets: Array<
    Prisma.ChairopsDamageTicketGetPayload<{
      include: {
        branch: { select: { name: true; slug: true } };
        chair: { select: { chairCode: true } };
        reportedBy: { select: { displayName: true } };
        assignedTo: { select: { displayName: true } };
      };
    }>
  > = [];
  let branches: { id: string; name: string }[] = [];
  let technicians: { id: string; displayName: string }[] = [];

  if (tab === "tickets") {
    const w: Prisma.ChairopsDamageTicketWhereInput = { orgId };
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
    [tickets, branches, technicians] = await Promise.all([
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
            // orgId-scoped — ChairOps has no RLS, so this filter is the tenant
            // boundary (the dropdown must not list other orgs' branches).
            where: { orgId, isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
      isTechnician
        ? Promise.resolve([])
        : prisma.chairopsUser.findMany({
            where: { orgId, role: "TECHNICIAN", isActive: true },
            select: { id: true, displayName: true },
            orderBy: { displayName: "asc" },
          }),
    ]);
  }

  const tabLink = (key: "suspects" | "tickets", label: string, count: number) => (
    <Link
      href={key === "suspects" ? "/chairops/damage?tab=suspects" : "/chairops/damage?tab=tickets"}
      className={
        "rounded-md px-3 py-1.5 text-sm font-medium " +
        (tab === key
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-background hover:bg-muted")
      }
    >
      {label} ({count})
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ของเสีย</h1>
          <p className="text-sm text-muted-foreground">
            {tab === "suspects"
              ? `ตู้ที่ช่องรับเงิน (เหรียญ/แบงค์/โอน) เงียบหลายวันทั้งที่เครื่องยังทำงาน · ณ ${thaiDateTime(new Date())}`
              : isTechnician
                ? "ตั๋วที่มอบหมายให้คุณ"
                : `ใบแจ้งซ่อม · ${tickets.length} รายการ`}
          </p>
        </div>
        {tab === "suspects" && (
          <div className="flex items-center gap-2">
            {sp.checked && (
              <span className="text-xs font-medium text-emerald-600">
                ✅ เช็คแล้ว · {thaiDateTime(new Date())}
              </span>
            )}
            <form action={recheckSuspects}>
              <RecheckButton />
            </form>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {canSeeSuspects && tabLink("suspects", "ตู้ต้องเช็ก", suspects.length)}
        {tabLink("tickets", "ใบแจ้งซ่อม", openTicketCount)}
      </div>

      {tab === "suspects" ? (
        <SuspectsView
          data={suspects}
          streamFilter={sp.sstream ?? ""}
          statusFilter={sp.sstatus ?? ""}
          posBlockedBranches={posBlockedBranches}
        />
      ) : (
        <>
          {!isTechnician && (
            <Card>
              <CardBody className="p-4">
                <form className="flex flex-wrap items-end gap-3 text-sm" method="GET">
                  <input type="hidden" name="tab" value="tickets" />
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
                    href="/chairops/damage?tab=tickets"
                    className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
                  >
                    ล้างฟิลเตอร์
                  </Link>
                </form>
              </CardBody>
            </Card>
          )}

          <Card>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground [&>th]:bg-muted">
                    <th className="px-3 py-2 font-medium">รหัส</th>
                    <th className="px-3 py-2 font-medium">รูป</th>
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
                      <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                        ไม่มีตั๋วที่ตรงเงื่อนไข
                      </td>
                    </tr>
                  ) : (
                    tickets.map((t) => (
                      <tr key={t.id} className="border-t border-border hover:bg-muted/50">
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
                        <td className="px-3 py-2">
                          {/* CEO Pinpoint 2026-08-02 · "ใบแจ้งซ่อมอยากให้มีรูป" —
                              photos were stored (photoUrls) + shown on the detail
                              page but never in this list. Thumbnail links to detail. */}
                          {t.photoUrls.length > 0 ? (
                            <Link
                              href={`/chairops/damage/${t.ticketCode}`}
                              className="relative inline-block"
                              title={`${t.photoUrls.length} รูป`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={t.photoUrls[0]}
                                alt="รูปแจ้งซ่อม"
                                loading="lazy"
                                className="h-10 w-10 rounded object-cover border border-border"
                              />
                              {t.photoUrls.length > 1 && (
                                <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground">
                                  +{t.photoUrls.length - 1}
                                </span>
                              )}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{t.branch.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{t.chair?.chairCode ?? "—"}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{t.category}</div>
                          <div className="line-clamp-1 text-xs text-muted-foreground">
                            {t.description}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          {t.assignedTo?.displayName ?? (
                            <span className="text-muted-foreground">ยังไม่ระบุ</span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-muted-foreground"
                          title={thaiDateTime(t.openedAt)}
                        >
                          {thaiRelative(t.openedAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
