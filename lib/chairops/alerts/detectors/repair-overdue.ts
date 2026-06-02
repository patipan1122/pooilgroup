// D4 · REPAIR_OVERDUE detector.
//
// SLA matrix:
//   URGENT  → 24 hours
//   NORMAL  → 72 hours
//   LOW     → 168 hours (1 week)
//   default → NORMAL behavior
//
// Skip rules:
//   • Closed (status DONE or CANCELLED) → skip + auto-resolve on transition.
//   • Manual hold flag (notes contains 'hold' / 'พักไว้') → skip.
//   • WAITING_PARTS pauses the SLA clock UNLESS > 14d (then emit with
//     subkind=parts_blocked).
//
// Escalation:
//   WARN  · age > SLA.
//   CRIT  · age > 1.5× SLA.
//   +CEO  · URGENT > 48h.

import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  findOpenAlert,
  isFirstRun,
  PER_DETECTOR_EMIT_CAP,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";

const SLA_HOURS: Record<string, number> = {
  URGENT: 24,
  NORMAL: 72,
  LOW: 168,
};

const PARTS_BLOCKED_DAYS = 14;

function detectHold(notes: string | null | undefined): boolean {
  if (!notes) return false;
  const s = notes.toLowerCase();
  return s.includes("hold") || notes.includes("พักไว้");
}

export async function detectRepairOverdue(orgId?: string): Promise<NewAlert[]> {
  const tickets = await prisma.chairopsDamageTicket.findMany({
    where: {
      status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] },
      closedAt: null,
      ...(orgId ? { orgId } : {}),
    },
    select: {
      id: true,
      orgId: true,
      ticketCode: true,
      branchId: true,
      priority: true,
      status: true,
      openedAt: true,
      assignedToId: true,
      notes: true,
      branch: { select: { name: true } },
      assignedTo: { select: { displayName: true, lineUserId: true } },
    },
  });
  if (tickets.length === 0) return [];

  const out: NewAlert[] = [];
  const now = Date.now();

  // First-run guard.
  const firstRunCache = new Map<string, boolean>();
  async function firstRunFor(thisOrgId: string): Promise<boolean> {
    const cached = firstRunCache.get(thisOrgId);
    if (cached !== undefined) return cached;
    const first = await isFirstRun(thisOrgId, ChairopsAlertKind.REPAIR_OVERDUE);
    firstRunCache.set(thisOrgId, first);
    return first;
  }

  // Aggregate per-org for first-run summary.
  const orgOverdueCount = new Map<string, number>();

  for (const t of tickets) {
    if (out.length >= PER_DETECTOR_EMIT_CAP) break;

    // Hold-flag skip.
    if (detectHold(t.notes)) continue;

    const ageHours = (now - t.openedAt.getTime()) / 3_600_000;
    const slaHours = SLA_HOURS[t.priority] ?? SLA_HOURS.NORMAL;
    const isWaitingParts = t.status === "WAITING_PARTS";

    // WAITING_PARTS pauses SLA — emit only if > 14d.
    if (isWaitingParts && ageHours / 24 < PARTS_BLOCKED_DAYS) continue;
    if (!isWaitingParts && ageHours < slaHours) continue;

    // Idempotency.
    const existing = await findOpenAlert({
      orgId: t.orgId,
      kind: ChairopsAlertKind.REPAIR_OVERDUE,
      branchId: t.branchId,
      entityKey: "ticketId",
      entityValue: t.id,
    });
    if (existing) continue;

    if (await firstRunFor(t.orgId)) {
      orgOverdueCount.set(t.orgId, (orgOverdueCount.get(t.orgId) ?? 0) + 1);
      continue;
    }

    // Level computation.
    let level: typeof ChairopsAlertLevel[keyof typeof ChairopsAlertLevel] = ChairopsAlertLevel.WARN;
    const channels: ("repair" | "ops" | "ceo")[] = ["repair"];
    if (isWaitingParts) {
      level = ChairopsAlertLevel.WARN; // 14d block is bad but not panic — only ops via repair.
    } else if (ageHours > slaHours * 1.5) {
      level = ChairopsAlertLevel.CRITICAL;
      channels.push("ops");
    }
    if (t.priority === "URGENT" && ageHours > 48) {
      level = ChairopsAlertLevel.CRITICAL;
      if (!channels.includes("ceo")) channels.push("ceo");
    }

    const subkind = isWaitingParts ? "parts_blocked" : null;
    const titleSuffix = isWaitingParts
      ? `รออะไหล่นาน ${Math.floor(ageHours / 24)} วัน`
      : `เกิน SLA (${t.priority}/${slaHours}h)`;

    out.push({
      orgId: t.orgId,
      branchId: t.branchId,
      kind: ChairopsAlertKind.REPAIR_OVERDUE,
      level,
      title: `ใบซ่อม ${t.ticketCode} · ${t.branch.name} · ${titleSuffix}`,
      message: t.assignedTo?.displayName
        ? `มอบหมาย: ${t.assignedTo.displayName} · เปิดมา ${Math.floor(ageHours)} ชม.`
        : `ยังไม่มอบหมายช่าง · เปิดมา ${Math.floor(ageHours)} ชม.`,
      contextJson: {
        ticketId: t.id,
        ticketCode: t.ticketCode,
        priority: t.priority,
        ageHours: Math.floor(ageHours),
        slaHours,
        subkind,
        assignedToId: t.assignedToId,
        assignedToLineUserId: t.assignedTo?.lineUserId ?? null,
        linkPath: `/chairops/damage/${t.ticketCode}`,
        source: "ingest-watchdog",
      },
      channels,
    });
  }

  // First-run summary.
  for (const [thisOrgId, count] of orgOverdueCount.entries()) {
    if (count === 0) continue;
    const existing = await findOpenAlert({
      orgId: thisOrgId,
      kind: ChairopsAlertKind.REPAIR_OVERDUE,
      branchId: null,
    });
    if (existing) continue;
    out.push({
      orgId: thisOrgId,
      branchId: null,
      kind: ChairopsAlertKind.REPAIR_OVERDUE,
      level: ChairopsAlertLevel.INFO,
      title: `ใบซ่อมเกิน SLA หลายใบ · ตามแก้ย้อนหลัง`,
      message: `${count} ใบเกิน SLA · กรุณามอบหมายช่างหรือปิดใบที่เสร็จแล้ว`,
      contextJson: {
        historical: true,
        ticketsAffected: count,
        linkPath: "/chairops/damage",
        source: "ingest-watchdog-first-run",
      },
      channels: ["repair"],
    });
  }

  return out;
}
