// CEO 2026-06-29 · per-chair drill-down for "ตู้เสีย".
//   • 30-day history of all 3 payment devices (see exactly when one went silent)
//   • per suspect device: triage status workflow (ตรวจ→นัดแม่บ้าน→แจ้งซ่อม→…)
//   • append-only log timeline (who did what, when)
// Office/Manager+ only. Lives under /damage so it inherits the AdminShell layout.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { baht, thaiDate, thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import {
  computeChairStreamDetail,
  STREAM_META,
  type StreamKey,
} from "@/lib/chairops/alerts/_stream-activity";
import {
  getChecksForChair,
  CHECK_STATUS_LABEL,
  CHECK_STATUS_TONE,
  CHECK_STATUS_FLOW,
} from "@/lib/chairops/alerts/_chair-check";
import { ChairopsChairCheckStatus, ChairopsTicketStatus } from "@/lib/generated/prisma/enums";
import { setCheckStatus, addCheckNote, setChairSuspectThreshold } from "../../check-actions";

const STREAMS: StreamKey[] = ["coin", "cash", "transfer"];
const OPEN_TICKET_STATUSES: ChairopsTicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

export default async function ChairCheckDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ chairCode: string }>;
  searchParams: Promise<{ stream?: string }>;
}) {
  const session = await requireAuth();
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  const orgId = session.user.orgId;
  const { chairCode: rawCode } = await params;
  const chairCode = decodeURIComponent(rawCode);
  const sp = await searchParams;
  const focusStream = sp.stream;

  const detail = await computeChairStreamDetail(orgId, chairCode);
  if (!detail) notFound();

  const [checks, openTicket] = await Promise.all([
    getChecksForChair(orgId, chairCode),
    prisma.chairopsDamageTicket.findFirst({
      where: { orgId, chairId: detail.chair.id, status: { in: OPEN_TICKET_STATUSES } },
      select: { ticketCode: true },
    }),
  ]);

  // history table — newest first, cap to 30 rows with data
  const rows = [...detail.days].reverse().slice(0, 30);

  function valueCell(val: number, stream: StreamKey, suspect: boolean) {
    const display = stream === "coin" ? `${val}` : baht(val);
    if (val <= 0) {
      return (
        <span className={suspect ? "font-semibold text-red-600" : "text-muted-foreground"}>
          0{suspect ? " ✕" : ""}
        </span>
      );
    }
    return <span>{display}</span>;
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/chairops/damage?tab=suspects" className="text-sm text-primary hover:underline">
          ← กลับไปตู้ต้องเช็ก
        </Link>
      </div>

      {/* header */}
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <div className="font-mono text-xl font-bold">{detail.chair.chairCode}</div>
            <div className="text-sm text-muted-foreground">{detail.chair.branchName}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {detail.chairAlive ? (
                <Badge tone="success">เครื่องทำงานปกติ (มีเงินเข้าช่องใดช่องหนึ่ง)</Badge>
              ) : (
                <Badge tone="danger">ทั้งเครื่องเงียบ — ดูที่แจ้งเตือนเครื่องออฟไลน์</Badge>
              )}
              {openTicket && (
                <Link href={`/chairops/damage/${openTicket.ticketCode}`}>
                  <Badge tone="brand">มีใบแจ้งซ่อม {openTicket.ticketCode} →</Badge>
                </Link>
              )}
            </div>
          </div>
          <form
            action={setChairSuspectThreshold}
            className="flex items-center gap-1 rounded-md border border-border p-2"
          >
            <input type="hidden" name="chairId" value={detail.chair.id} />
            <input type="hidden" name="chairCode" value={detail.chair.chairCode} />
            <span className="text-xs text-muted-foreground">เตือนเมื่อเงียบ</span>
            <input
              type="number"
              name="days"
              min={1}
              max={60}
              defaultValue={detail.threshold}
              aria-label="จำนวนวันก่อนเตือน"
              className="h-8 w-14 rounded-md border border-border bg-background px-2 text-center text-sm"
            />
            <span className="text-xs text-muted-foreground">วัน</span>
            <button type="submit" className="h-8 rounded-md border border-border px-2 text-xs hover:bg-muted">
              บันทึก
            </button>
          </form>
        </CardBody>
      </Card>

      {/* per-device triage */}
      <div className="grid gap-3 lg:grid-cols-3">
        {STREAMS.map((stream) => {
          const st = detail.streams[stream];
          const meta = STREAM_META[stream];
          const streamKey = `${detail.chair.chairCode}::${stream}`;
          const check = checks.get(streamKey);
          const status = check?.status ?? ChairopsChairCheckStatus.PENDING;
          const showTriage = st.isSuspect || !!check;
          const focused = focusStream === stream;

          return (
            <Card
              key={stream}
              className={focused ? "ring-2 ring-primary" : undefined}
            >
              <CardBody className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-medium " +
                      meta.chipClass
                    }
                  >
                    {meta.icon} {meta.label}
                  </span>
                  {st.isSuspect ? (
                    <Badge tone="danger">เงียบ {st.daysZero} วัน</Badge>
                  ) : st.hasBaseline ? (
                    <Badge tone="success">ปกติ</Badge>
                  ) : (
                    <Badge tone="neutral">ไม่เฝ้า</Badge>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  {st.lastActiveAt
                    ? `เงินเข้าล่าสุด ${thaiDate(st.lastActiveAt)}`
                    : "ไม่พบเงินเข้าในช่วง 30 วัน"}
                  {!st.hasBaseline && !st.lastActiveAt && " · ช่องนี้อาจไม่ได้ใช้งาน"}
                </div>

                {showTriage ? (
                  <>
                    <div className="flex items-center gap-2 border-t border-border pt-2">
                      <span className="text-xs text-muted-foreground">สถานะ:</span>
                      <Badge tone={CHECK_STATUS_TONE[status]}>{CHECK_STATUS_LABEL[status]}</Badge>
                    </div>

                    {/* quick status buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      {CHECK_STATUS_FLOW.map((next) => (
                        <form action={setCheckStatus} key={next}>
                          <input type="hidden" name="streamKey" value={streamKey} />
                          <input type="hidden" name="chairId" value={detail.chair.id} />
                          <input type="hidden" name="branchId" value={detail.chair.branchId} />
                          <input type="hidden" name="chairCode" value={detail.chair.chairCode} />
                          <input type="hidden" name="stream" value={stream} />
                          <input type="hidden" name="toStatus" value={next} />
                          <button
                            type="submit"
                            disabled={status === next}
                            className={
                              "h-7 rounded-md border px-2 text-xs " +
                              (status === next
                                ? "cursor-default border-primary bg-primary/10 font-medium text-primary"
                                : "border-border hover:bg-muted")
                            }
                          >
                            {CHECK_STATUS_LABEL[next]}
                          </button>
                        </form>
                      ))}
                    </div>

                    {/* add note */}
                    <form action={addCheckNote} className="flex items-center gap-1.5">
                      <input type="hidden" name="streamKey" value={streamKey} />
                      <input type="hidden" name="chairId" value={detail.chair.id} />
                      <input type="hidden" name="branchId" value={detail.chair.branchId} />
                      <input type="hidden" name="chairCode" value={detail.chair.chairCode} />
                      <input type="hidden" name="stream" value={stream} />
                      <input
                        name="note"
                        placeholder="บันทึกการตรวจ เช่น โทรนัดช่างแล้ว"
                        className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="h-8 rounded-md border border-border px-2 text-xs hover:bg-muted"
                      >
                        เพิ่มบันทึก
                      </button>
                    </form>

                    {/* log timeline */}
                    {check && check.logs.length > 0 && (
                      <ol className="space-y-1.5 border-t border-border pt-2 text-xs">
                        {check.logs.map((l) => (
                          <li key={l.id} className="flex gap-2">
                            <span className="shrink-0 text-muted-foreground" title={thaiDateTime(l.createdAt)}>
                              {thaiRelative(l.createdAt)}
                            </span>
                            <span>
                              {l.action === "STATUS" && l.toStatus ? (
                                <span className="font-medium">
                                  → {CHECK_STATUS_LABEL[l.toStatus as ChairopsChairCheckStatus]}
                                </span>
                              ) : (
                                "บันทึก"
                              )}
                              {l.note && <span className="text-muted-foreground"> · {l.note}</span>}
                              {l.byName && <span className="text-muted-foreground"> · {l.byName}</span>}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                ) : (
                  <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                    ช่องนี้ปกติ · ยังไม่ต้องตรวจ
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* 30-day history */}
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium">ประวัติเงินเข้า 30 วัน (แยก 3 ช่อง · ใหม่สุดก่อน)</span>
          <span className="text-xs text-muted-foreground">
            เหรียญ = จำนวนครั้ง · แบงค์/โอน = บาท
          </span>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground [&>th]:bg-muted">
                <th className="px-3 py-2 font-medium">วันที่</th>
                {STREAMS.map((s) => (
                  <th
                    key={s}
                    className={
                      "px-3 py-2 text-right font-medium " +
                      (detail.streams[s].isSuspect ? "text-red-600" : "")
                    }
                  >
                    {STREAM_META[s].icon} {STREAM_META[s].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-12 text-center text-muted-foreground">
                    ไม่มีข้อมูล POS ในช่วง 30 วัน
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.bizDate.toISOString()} className="border-t border-border">
                    <td className="px-3 py-1.5 text-xs">{thaiDate(d.bizDate)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {valueCell(d.coin, "coin", detail.streams.coin.isSuspect)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {valueCell(d.cash, "cash", detail.streams.cash.isSuspect)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {valueCell(d.transfer, "transfer", detail.streams.transfer.isSuspect)}
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
