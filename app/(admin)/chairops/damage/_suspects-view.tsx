// CEO 2026-06-29 · "ตู้ต้องเช็ก" tab — redesigned for scan-ability:
//   • summary bar (how many chairs, how many branches, split by device)
//   • filter by device + triage status (native GET form, no JS)
//   • cards GROUPED BY BRANCH (worst branch first) so "ตู้ไหน สาขาไหน" is obvious
//   • each card → drill into /chairops/damage/check/[chairCode]
// Colours lean blue/green/orange (least-yellow) per CEO taste.
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDate } from "@/lib/chairops/utils/format";
import { STREAM_META, type StreamKey } from "@/lib/chairops/alerts/_stream-activity";
import {
  CHECK_STATUS_LABEL,
  CHECK_STATUS_TONE,
  type SuspectWithCheck,
} from "@/lib/chairops/alerts/_chair-check";
import { ChairopsChairCheckStatus } from "@/lib/generated/prisma/enums";
import { setChairSuspectThreshold } from "./check-actions";

function sevTone(days: number): "danger" | "orange" | "neutral" {
  if (days >= 7) return "danger";
  if (days >= 3) return "orange";
  return "neutral";
}

export function SuspectsView({
  data,
  streamFilter,
  statusFilter,
}: {
  data: SuspectWithCheck[];
  streamFilter: string;
  statusFilter: string;
}) {
  // summary from the FULL list (stable overview)
  const branchCount = new Set(data.map((s) => s.branchId)).size;
  const perStream: Record<StreamKey, number> = {
    coin: data.filter((s) => s.stream === "coin").length,
    cash: data.filter((s) => s.stream === "cash").length,
    transfer: data.filter((s) => s.stream === "transfer").length,
  };

  // apply filters for what's shown
  const shown = data.filter(
    (s) =>
      (!streamFilter || s.stream === streamFilter) &&
      (!statusFilter || s.status === statusFilter),
  );

  // group shown suspects by branch, worst branch (max daysZero) first
  const groups = new Map<string, { branchName: string; items: SuspectWithCheck[] }>();
  for (const s of shown) {
    const g = groups.get(s.branchId);
    if (g) g.items.push(s);
    else groups.set(s.branchId, { branchName: s.branchName, items: [s] });
  }
  const orderedGroups = Array.from(groups.values())
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => b.daysZero - a.daysZero),
      worst: Math.max(...g.items.map((i) => i.daysZero)),
    }))
    .sort((a, b) => b.worst - a.worst);

  return (
    <div className="space-y-4">
      {/* summary bar */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-red-600">{data.length}</span>
            <span className="text-muted-foreground">ตู้ต้องเช็ก · {branchCount} สาขา</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["coin", "cash", "transfer"] as StreamKey[]).map((k) => (
              <span
                key={k}
                className={
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium " +
                  STREAM_META[k].chipClass
                }
              >
                {STREAM_META[k].icon} {STREAM_META[k].short} {perStream[k]}
              </span>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* filter row */}
      <form method="GET" className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value="suspects" />
        <div>
          <label className="block text-xs font-medium text-muted-foreground">อุปกรณ์</label>
          <select
            name="sstream"
            defaultValue={streamFilter}
            className="h-9 rounded-md border border-border bg-background px-2"
          >
            <option value="">ทุกช่อง</option>
            <option value="coin">🪙 เหรียญ</option>
            <option value="cash">💵 แบงค์</option>
            <option value="transfer">📲 โอน</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">สถานะ</label>
          <select
            name="sstatus"
            defaultValue={statusFilter}
            className="h-9 rounded-md border border-border bg-background px-2"
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(CHECK_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          กรอง
        </button>
        {(streamFilter || statusFilter) && (
          <Link
            href="/chairops/damage?tab=suspects"
            className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
          >
            ล้าง
          </Link>
        )}
      </form>

      {shown.length === 0 ? (
        <Card>
          <CardBody className="p-10 text-center text-muted-foreground">
            {data.length === 0
              ? "✅ ไม่มีตู้ที่น่าจะเสียตอนนี้ · ทุกช่องรับเงินยังมีเงินเข้าปกติ"
              : "ไม่มีตู้ที่ตรงตัวกรอง"}
          </CardBody>
        </Card>
      ) : (
        orderedGroups.map((g) => (
          <section key={g.branchName} className="space-y-2">
            <div className="flex items-center gap-2 px-0.5">
              <h2 className="text-sm font-semibold">{g.branchName}</h2>
              <Badge tone={sevTone(g.worst)}>{g.items.length} ตู้</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((s) => {
                const meta = STREAM_META[s.stream];
                const isClosed =
                  s.status === ChairopsChairCheckStatus.RESOLVED ||
                  s.status === ChairopsChairCheckStatus.FALSE_ALARM;
                return (
                  <Card key={s.streamKey} className={isClosed ? "opacity-70" : undefined}>
                    <CardBody className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/chairops/damage/check/${encodeURIComponent(s.chairCode)}?stream=${s.stream}`}
                            className="font-mono text-sm font-semibold text-primary hover:underline"
                          >
                            {s.chairCode}
                          </Link>
                          <div className="mt-1">
                            <span
                              className={
                                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium " +
                                meta.chipClass
                              }
                            >
                              {meta.icon} {meta.label}
                            </span>
                          </div>
                        </div>
                        <Badge tone={sevTone(s.daysZero)}>เงียบ {s.daysZero} วัน</Badge>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        {s.lastActiveAt
                          ? `เงินเข้าล่าสุด ${thaiDate(s.lastActiveAt)}`
                          : "ไม่พบเงินเข้าในช่วงที่ดู"}{" "}
                        · ช่องอื่นยังมีเงิน (เครื่องไม่ตาย)
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge tone={CHECK_STATUS_TONE[s.status]}>
                          {CHECK_STATUS_LABEL[s.status]}
                        </Badge>
                        {s.lastActionByName && (
                          <span className="truncate text-xs text-muted-foreground">
                            โดย {s.lastActionByName}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <Link
                          href={`/chairops/damage/check/${encodeURIComponent(s.chairCode)}?stream=${s.stream}`}
                          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          ดูรายละเอียด →
                        </Link>
                        {s.openTicketCode ? (
                          <Link
                            href={`/chairops/damage/${s.openTicketCode}`}
                            className="inline-flex h-8 items-center rounded-md border border-emerald-400 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                          >
                            มีใบแจ้งซ่อมแล้ว →
                          </Link>
                        ) : (
                          <Link
                            href={`/chairops/damage/new?chairId=${s.chairId}&chairCode=${encodeURIComponent(s.chairCode)}`}
                            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                          >
                            เปิดใบแจ้งซ่อม
                          </Link>
                        )}
                      </div>

                      <form
                        action={setChairSuspectThreshold}
                        className="flex items-center gap-1 border-t border-border pt-2"
                      >
                        <input type="hidden" name="chairId" value={s.chairId} />
                        <input type="hidden" name="chairCode" value={s.chairCode} />
                        <span className="text-xs text-muted-foreground">เตือนเมื่อเงียบ</span>
                        <input
                          type="number"
                          name="days"
                          min={1}
                          max={60}
                          defaultValue={s.threshold}
                          aria-label="จำนวนวันก่อนเตือน"
                          className="h-7 w-12 rounded-md border border-border bg-background px-1 text-center text-xs"
                        />
                        <span className="text-xs text-muted-foreground">วัน</span>
                        <button
                          type="submit"
                          className="h-7 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        >
                          บันทึก
                        </button>
                      </form>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
