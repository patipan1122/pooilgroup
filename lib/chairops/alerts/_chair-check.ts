// CEO 2026-06-29 · triage status + history helpers for the "ตู้เสีย" feature.
// A ChairopsChairCheck row is the current triage state of one (chair, device);
// it's created lazily the first time office acts. The append-only log records
// who-did-what-when. This module is the read side; writes live in the route's
// check-actions.ts ("use server").

import { prisma } from "@/lib/prisma";
import { ChairopsChairCheckStatus, ChairopsTicketStatus } from "@/lib/generated/prisma/enums";
import { computeStreamSuspects, type StreamSuspect } from "./_stream-activity";

type Tone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "orange"
  | "purple";

export const CHECK_STATUS_LABEL: Record<ChairopsChairCheckStatus, string> = {
  PENDING: "ยังไม่ตรวจ",
  CHECKING: "กำลังตรวจสอบ",
  MAID_SCHEDULED: "นัดแม่บ้านแล้ว",
  REPAIR_REPORTED: "แจ้งซ่อมแล้ว",
  PARTS_SENT: "ส่งอะไหล่แล้ว",
  RESOLVED: "แก้แล้ว / ปิด",
  FALSE_ALARM: "ไม่เสีย (ปิด)",
};

export const CHECK_STATUS_TONE: Record<ChairopsChairCheckStatus, Tone> = {
  PENDING: "neutral",
  CHECKING: "info",
  MAID_SCHEDULED: "purple",
  REPAIR_REPORTED: "brand",
  PARTS_SENT: "orange",
  RESOLVED: "success",
  FALSE_ALARM: "neutral",
};

// Action buttons offered on the detail page, in workflow order. Triage is
// non-linear (office may skip straight to ปิด), so any transition is allowed.
export const CHECK_STATUS_FLOW: ChairopsChairCheckStatus[] = [
  "CHECKING",
  "MAID_SCHEDULED",
  "REPAIR_REPORTED",
  "PARTS_SENT",
  "RESOLVED",
  "FALSE_ALARM",
];

// Closed states = no longer needs attention.
export const CHECK_CLOSED_STATUSES: ChairopsChairCheckStatus[] = ["RESOLVED", "FALSE_ALARM"];

const OPEN_TICKET_STATUSES: ChairopsTicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

// Only swallow "relation/column does not exist" (migration not applied yet) so
// ของเสีย keeps working during the deploy→migration gap. Any OTHER DB error is
// re-thrown — never silently masked once the table exists.
function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface SuspectWithCheck extends StreamSuspect {
  status: ChairopsChairCheckStatus; // PENDING when no triage row exists yet
  checkNote: string | null;
  lastActionAt: Date | null;
  lastActionByName: string | null;
  openTicketCode: string | null;
}

/** Live suspects (sorted worst-first) joined with their triage status + any open ticket. */
export async function getSuspectsWithChecks(orgId: string): Promise<SuspectWithCheck[]> {
  const suspects = await computeStreamSuspects(orgId);
  suspects.sort((a, b) => b.daysZero - a.daysZero);
  if (suspects.length === 0) return [];

  const streamKeys = suspects.map((s) => s.streamKey);
  const chairIds = Array.from(new Set(suspects.map((s) => s.chairId)));

  const [checks, openTickets] = await Promise.all([
    // Defensive: if the migration hasn't landed yet, the table won't exist —
    // degrade to "no triage rows" (all PENDING) instead of breaking ของเสีย.
    prisma.chairopsChairCheck
      .findMany({
        where: { orgId, streamKey: { in: streamKeys } },
        select: {
          streamKey: true,
          status: true,
          note: true,
          lastActionAt: true,
          lastActionByName: true,
        },
      })
      .catch((e) => {
        if (isMissingRelation(e)) {
          return [] as Array<{
            streamKey: string;
            status: ChairopsChairCheckStatus;
            note: string | null;
            lastActionAt: Date | null;
            lastActionByName: string | null;
          }>;
        }
        throw e;
      }),
    prisma.chairopsDamageTicket.findMany({
      where: { orgId, chairId: { in: chairIds }, status: { in: OPEN_TICKET_STATUSES } },
      select: { chairId: true, ticketCode: true },
    }),
  ]);

  const checkByKey = new Map(checks.map((c) => [c.streamKey, c]));
  const ticketByChair = new Map<string, string>();
  for (const t of openTickets) {
    if (t.chairId && !ticketByChair.has(t.chairId)) ticketByChair.set(t.chairId, t.ticketCode);
  }

  return suspects.map((s) => {
    const c = checkByKey.get(s.streamKey);
    return {
      ...s,
      status: c?.status ?? ChairopsChairCheckStatus.PENDING,
      checkNote: c?.note ?? null,
      lastActionAt: c?.lastActionAt ?? null,
      lastActionByName: c?.lastActionByName ?? null,
      openTicketCode: ticketByChair.get(s.chairId) ?? null,
    };
  });
}

/** Detail page — checks (with recent log entries) for one chair, keyed by streamKey.
 *  Degrades to an empty map if the table isn't there yet (migration not applied). */
export async function getChecksForChair(orgId: string, chairCode: string) {
  const checks = await prisma.chairopsChairCheck
    .findMany({
      where: { orgId, chairCode },
      include: { logs: { orderBy: { createdAt: "desc" }, take: 50 } },
    })
    .catch((e) => {
      if (isMissingRelation(e)) return [];
      throw e;
    });
  return new Map(checks.map((c) => [c.streamKey, c]));
}
