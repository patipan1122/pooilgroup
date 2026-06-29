// CEO 2026-06-29 · "จัดการตู้เสีย" — one place to (a) see chairs whose payment
// device is suspect-broken (auto-detected LIVE), and (b) the existing repair
// tickets. The suspects tab recomputes on every load (= the "เช็คตู้เสียด่วน"
// live summary, read-only — never writes an alert; the daily cron owns alert
// creation + LINE notify). Reuses the existing damage-ticket flow for repairs.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiRelative, thaiDateTime } from "@/lib/chairops/utils/format";
import { ChairopsTicketStatus } from "@/lib/generated/prisma/enums";
import {
  computeStreamSuspects,
  STREAM_LABEL,
} from "@/lib/chairops/alerts/_stream-activity";
import { setChairSuspectThreshold } from "./actions";

const OPEN_TICKET_STATUSES: ChairopsTicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

const STATUS_LABEL: Record<ChairopsTicketStatus, string> = {
  OPEN: "ใหม่",
  ASSIGNED: "มอบหมายแล้ว",
  IN_PROGRESS: "กำลังซ่อม",
  WAITING_PARTS: "รออะไหล่",
  DONE: "เสร็จ",
  CANCELLED: "ยกเลิก",
};
const STATUS_TONE: Record<ChairopsTicketStatus, "neutral" | "success" | "warning" | "danger"> = {
  OPEN: "danger",
  ASSIGNED: "warning",
  IN_PROGRESS: "warning",
  WAITING_PARTS: "neutral",
  DONE: "success",
  CANCELLED: "neutral",
};

export default async function BrokenChairsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireAuth();
  // Office/Manager+ page — maids report in the field, technicians use /damage.
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  const sp = await searchParams;
  const tab = sp.tab === "tickets" ? "tickets" : "suspects";
  const orgId = session.user.orgId;
  const nowLabel = thaiDateTime(new Date());

  // Always compute suspects (cheap) so the header counts are live on both tabs.
  const suspects = await computeStreamSuspects(orgId);
  suspects.sort((a, b) => b.daysZero - a.daysZero);
  const chairIds = Array.from(new Set(suspects.map((s) => s.chairId)));

  const [openTickets, ticketsForSuspects] = await Promise.all([
    prisma.chairopsDamageTicket.findMany({
      where: { orgId, status: { in: OPEN_TICKET_STATUSES } },
      include: {
        branch: { select: { name: true } },
        chair: { select: { chairCode: true } },
        assignedTo: { select: { displayName: true } },
      },
      orderBy: [{ priority: "desc" }, { openedAt: "desc" }],
      take: 200,
    }),
    chairIds.length
      ? prisma.chairopsDamageTicket.findMany({
          where: { orgId, chairId: { in: chairIds }, status: { in: OPEN_TICKET_STATUSES } },
          select: { chairId: true, ticketCode: true },
        })
      : Promise.resolve([]),
  ]);
  const openTicketByChair = new Map<string, string>();
  for (const t of ticketsForSuspects) {
    if (t.chairId && !openTicketByChair.has(t.chairId)) {
      openTicketByChair.set(t.chairId, t.ticketCode);
    }
  }

  const tabLink = (key: "suspects" | "tickets", label: string, count: number) => (
    <Link
      href={key === "suspects" ? "/chairops/broken-chairs" : "/chairops/broken-chairs?tab=tickets"}
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
          <h1 className="text-2xl font-bold tracking-tight">จัดการตู้เสีย</h1>
          <p className="text-sm text-muted-foreground">
            ตู้ที่ช่องรับเงิน (เหรียญ/แบงค์/โอน) ไม่มีเงินเข้าหลายวันทั้งที่เครื่องยังทำงาน · ข้อมูล ณ {nowLabel}
          </p>
        </div>
        <Link
          href="/chairops/broken-chairs"
          className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium leading-9 hover:bg-muted"
        >
          🔄 เช็คตู้เสียด่วน
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabLink("suspects", "ตู้ต้องเช็ก", suspects.length)}
        {tabLink("tickets", "ใบแจ้งซ่อม", openTickets.length)}
      </div>

      {tab === "suspects" ? (
        suspects.length === 0 ? (
          <Card>
            <CardBody className="p-10 text-center text-muted-foreground">
              ✅ ไม่มีตู้ที่น่าจะเสียตอนนี้ · ทุกช่องรับเงินยังมีเงินเข้าปกติ
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suspects.map((s) => {
              const openTicket = openTicketByChair.get(s.chairId);
              return (
                <Card key={s.streamKey}>
                  <CardBody className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-sm font-semibold">{s.chairCode}</div>
                        <div className="text-xs text-muted-foreground">{s.branchName}</div>
                      </div>
                      <Badge tone={s.daysZero >= 3 ? "danger" : "warning"}>
                        {s.daysZero} วัน
                      </Badge>
                    </div>

                    <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <strong>{STREAM_LABEL[s.stream]}</strong> ไม่มีเงินเข้า{" "}
                      <strong>{s.daysZero} วันติด</strong>
                      <div className="mt-0.5 text-xs text-amber-800">
                        {s.lastActiveAt
                          ? `มีเงินล่าสุด ${s.lastActiveAt.toISOString().slice(0, 10)}`
                          : "ไม่พบเงินเข้าในช่วงที่ดู"}{" "}
                        · เครื่องยังทำงาน (ช่องอื่นมีเงิน)
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {openTicket ? (
                        <Link
                          href={`/chairops/damage/${openTicket}`}
                          className="inline-flex h-9 items-center rounded-md border border-emerald-400 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          มีใบแจ้งซ่อมแล้ว →
                        </Link>
                      ) : (
                        <Link
                          href={`/chairops/damage/new?chairId=${s.chairId}&chairCode=${encodeURIComponent(
                            s.chairCode,
                          )}`}
                          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          เปิดใบแจ้งซ่อม
                        </Link>
                      )}

                      <form action={setChairSuspectThreshold} className="flex items-center gap-1">
                        <input type="hidden" name="chairId" value={s.chairId} />
                        <span className="text-xs text-muted-foreground">เตือนเมื่อเงียบ</span>
                        <input
                          type="number"
                          name="days"
                          min={1}
                          max={60}
                          defaultValue={s.threshold}
                          aria-label="จำนวนวันก่อนเตือน"
                          className="h-8 w-14 rounded-md border border-border bg-background px-2 text-center text-sm"
                        />
                        <span className="text-xs text-muted-foreground">วัน</span>
                        <button
                          type="submit"
                          className="h-8 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        >
                          บันทึก
                        </button>
                      </form>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm text-muted-foreground">ใบแจ้งซ่อมที่ยังเปิดอยู่</span>
            <Link href="/chairops/damage" className="text-sm text-primary hover:underline">
              ดูทั้งหมด / ประวัติ →
            </Link>
          </div>
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground [&>th]:bg-muted">
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
                {openTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                      ไม่มีใบแจ้งซ่อมที่เปิดอยู่
                    </td>
                  </tr>
                ) : (
                  openTickets.map((t) => (
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
      )}
    </div>
  );
}
