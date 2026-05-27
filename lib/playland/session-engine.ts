// Playland · Session lifecycle state machine
//
// State transitions:
//   (none) ── check-in event ──► ACTIVE
//   ACTIVE ── check-out event ──► PAUSED (set reentry deadline = now+15min)
//   PAUSED ── check-in event (within 15min) ──► ACTIVE (accumulate paused secs)
//   PAUSED ── 15min elapsed ──► FORFEITED (cron job)
//   ACTIVE ── time elapsed ──► EXPIRED (cron job · pre-warning alert at -10min)
//   ACTIVE/PAUSED ── cashier manual checkout ──► COMPLETED
//
// Per [[playland-workshop-decisions]]: exit MUST go through cashier confirm
// (Plan C). So webhook from device on direction="out" only PAUSES the session
// (sets reentry deadline). The cashier then either confirms permanent exit
// (COMPLETED) or the customer re-enters within 15min.

import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { ACSEvent } from "./acs/types";

const REENTRY_GRACE_MINUTES = 15;
const WARN_BEFORE_EXPIRE_MINUTES = 10;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface HandleFaceEventInput {
  orgId: string;
  branchId: string;
  deviceId: string;
  event: ACSEvent;
}

export interface HandleFaceEventResult {
  eventId: string;
  sessionId: string | null;
  outcome:
    | "logged_only"
    | "session_created"
    | "session_paused"
    | "session_resumed"
    | "session_already_paused"
    | "stranger_alert"
    | "tailgate_alert"
    | "unrecognized"
    | "duplicate"
    | "error";
  message: string;
}

/** Process an ACS event end-to-end inside a transaction. Idempotent via webhookId UNIQUE. */
export async function handleFaceEvent(input: HandleFaceEventInput): Promise<HandleFaceEventResult> {
  const { orgId, branchId, deviceId, event } = input;

  return prisma.$transaction(async (tx) => {
    // ---- 1. Idempotency check (webhookId UNIQUE prevents double-process) ----
    const existing = await tx.playlandFaceEvent.findUnique({ where: { webhookId: event.webhookId } });
    if (existing) {
      return {
        eventId: existing.id,
        sessionId: existing.sessionId,
        outcome: "duplicate" as const,
        message: "already processed",
      };
    }

    // ---- 2. Look up member by faceId (Version C: device sends faceId we registered) ----
    let memberId: string | null = null;
    if (event.faceId) {
      const m = await tx.playlandMember.findFirst({
        where: { orgId, branchId, faceId: event.faceId, deletedAt: null },
        select: { id: true },
      });
      memberId = m?.id ?? null;
    }

    // ---- 3. Branch by event type ----
    if (event.type === "heartbeat") {
      // Just update device last seen
      await tx.playlandDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
      const ev = await insertEvent(tx, input, null, null);
      return { eventId: ev.id, sessionId: null, outcome: "logged_only", message: "heartbeat ack" };
    }

    if (event.type === "stranger" || (event.type === "unrecognized" && !memberId)) {
      const ev = await insertEvent(tx, input, null, null);
      await tx.playlandAlert.create({
        data: {
          orgId,
          branchId,
          type: "STRANGER",
          severity: "DANGER",
          title: "หน้าไม่ผ่านการระบบ",
          message: `Device ${input.deviceId} จับหน้าที่ไม่ได้ลงทะเบียน · เวลา ${event.eventAt.toISOString()}`,
          metadata: { eventId: ev.id, confidence: event.confidence },
        },
      });
      return { eventId: ev.id, sessionId: null, outcome: "stranger_alert", message: "stranger detected" };
    }

    if (event.type === "tailgate") {
      const ev = await insertEvent(tx, input, memberId, null);
      await tx.playlandAlert.create({
        data: {
          orgId,
          branchId,
          type: "TAILGATE",
          severity: "WARNING",
          title: "ตรวจพบการแอบเข้าตาม",
          message: "Device รายงาน tailgate · กรุณาตรวจสอบ CCTV",
          metadata: { eventId: ev.id },
        },
      });
      return { eventId: ev.id, sessionId: null, outcome: "tailgate_alert", message: "tailgate detected" };
    }

    if (event.type === "door_open") {
      // Manual override · logged only
      const ev = await insertEvent(tx, input, memberId, null);
      return { eventId: ev.id, sessionId: null, outcome: "logged_only", message: "manual door open" };
    }

    // ---- 4. Recognized events (in/out) ----
    if (!memberId) {
      const ev = await insertEvent(tx, input, null, null);
      return { eventId: ev.id, sessionId: null, outcome: "unrecognized", message: "no member match for faceId" };
    }

    // Find any ACTIVE or PAUSED session for this member
    const session = await tx.playlandSession.findFirst({
      where: { orgId, branchId, memberId, status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { checkInAt: "desc" },
    });

    // ---- 5a. Direction IN ----
    if (event.direction === "in") {
      if (!session) {
        // No open session · this is unexpected (member should have a session before entering)
        // Log as ALERT — cashier must register/check-in first
        const ev = await insertEvent(tx, input, memberId, null);
        await tx.playlandAlert.create({
          data: {
            orgId,
            branchId,
            type: "MISMATCH",
            severity: "WARNING",
            title: "สมาชิกสแกนเข้าโดยไม่มี session",
            message: `Member ${memberId} ไม่มี active session · cashier ต้องสร้าง session ก่อน`,
            metadata: { eventId: ev.id, memberId },
          },
        });
        return { eventId: ev.id, sessionId: null, outcome: "logged_only", message: "no active session for member" };
      }

      if (session.status === "PAUSED") {
        // Re-entry within grace period?
        const now = event.eventAt;
        if (session.reentryDeadlineAt && session.reentryDeadlineAt < now) {
          // Too late · forfeited
          await tx.playlandSession.update({
            where: { id: session.id },
            data: { status: "FORFEITED", checkOutAt: now },
          });
          const ev = await insertEvent(tx, input, memberId, session.id);
          await tx.playlandAlert.create({
            data: {
              orgId,
              branchId,
              sessionId: session.id,
              type: "REENTRY_EXPIRED",
              severity: "DANGER",
              title: "ขาดสิทธิ์ — กลับมาเกิน 15 นาที",
              message: "ผู้ใช้กลับมาหลัง grace period · session forfeited",
              metadata: { eventId: ev.id },
            },
          });
          return { eventId: ev.id, sessionId: session.id, outcome: "session_already_paused", message: "forfeited (re-entry too late)" };
        }
        // Accumulate paused seconds + resume
        const pausedSecs = session.pausedAt ? Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000) : 0;
        await tx.playlandSession.update({
          where: { id: session.id },
          data: {
            status: "ACTIVE",
            resumedAt: now,
            totalPausedSeconds: session.totalPausedSeconds + pausedSecs,
            reentryDeadlineAt: null,
          },
        });
        const ev = await insertEvent(tx, input, memberId, session.id);
        return { eventId: ev.id, sessionId: session.id, outcome: "session_resumed", message: `resumed (+${pausedSecs}s paused)` };
      }

      // session.status === "ACTIVE" · just log (duplicate in-scan)
      const ev = await insertEvent(tx, input, memberId, session.id);
      return { eventId: ev.id, sessionId: session.id, outcome: "logged_only", message: "already active" };
    }

    // ---- 5b. Direction OUT ----
    if (event.direction === "out") {
      if (!session) {
        // No session to pause · just log
        const ev = await insertEvent(tx, input, memberId, null);
        return { eventId: ev.id, sessionId: null, outcome: "logged_only", message: "exit with no active session" };
      }
      if (session.status === "ACTIVE") {
        const deadline = new Date(event.eventAt.getTime() + REENTRY_GRACE_MINUTES * 60_000);
        await tx.playlandSession.update({
          where: { id: session.id },
          data: { status: "PAUSED", pausedAt: event.eventAt, reentryDeadlineAt: deadline },
        });
        const ev = await insertEvent(tx, input, memberId, session.id);
        return { eventId: ev.id, sessionId: session.id, outcome: "session_paused", message: `paused · re-entry by ${deadline.toISOString()}` };
      }
      // Already PAUSED · log only
      const ev = await insertEvent(tx, input, memberId, session.id);
      return { eventId: ev.id, sessionId: session.id, outcome: "session_already_paused", message: "already paused" };
    }

    // Unknown direction · just log
    const ev = await insertEvent(tx, input, memberId, session?.id ?? null);
    return { eventId: ev.id, sessionId: session?.id ?? null, outcome: "logged_only", message: "unknown direction" };
  });
}

async function insertEvent(
  tx: Tx,
  input: HandleFaceEventInput,
  memberId: string | null,
  sessionId: string | null,
) {
  const { orgId, branchId, deviceId, event } = input;
  return tx.playlandFaceEvent.create({
    data: {
      orgId,
      branchId,
      deviceId,
      sessionId: sessionId ?? undefined,
      memberId: memberId ?? undefined,
      faceId: event.faceId,
      type: mapEventType(event.type),
      direction: mapDirection(event.direction),
      confidence: event.confidence ?? undefined,
      snapshotR2Path: undefined,
      rawPayload: event.raw as object,
      webhookId: event.webhookId,
      eventAt: event.eventAt,
    },
  });
}

function mapEventType(t: ACSEvent["type"]) {
  return ({
    recognized: "RECOGNIZED",
    unrecognized: "UNRECOGNIZED",
    tailgate: "TAILGATE",
    stranger: "STRANGER",
    door_open: "DOOR_OPEN",
    heartbeat: "DEVICE_HEARTBEAT",
    qr_scan: "RECOGNIZED",   // unused: webhook router branches qr_scan to handleQRScan
    error: "ERROR",
  } as const)[t];
}

function mapDirection(d: ACSEvent["direction"]) {
  return ({ in: "IN", out: "OUT", unknown: "UNKNOWN" } as const)[d];
}

/** Cron-callable: expire active sessions whose time is up + handle paused-too-long */
export async function expireDueSessions() {
  const now = new Date();
  // ACTIVE sessions where expiresAt has passed
  const dueActive = await prisma.playlandSession.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now }, packageMinutes: { gt: 0 } },
    select: { id: true, orgId: true, branchId: true },
  });
  for (const s of dueActive) {
    await prisma.$transaction([
      prisma.playlandSession.update({ where: { id: s.id }, data: { status: "EXPIRED" } }),
      prisma.playlandAlert.create({
        data: {
          orgId: s.orgId,
          branchId: s.branchId,
          sessionId: s.id,
          type: "TIME_EXPIRED",
          severity: "WARNING",
          title: "หมดเวลาเล่น",
          message: "session expired · cashier ต้อง check-out หรือต่อเวลา",
        },
      }),
    ]);
  }
  // PAUSED sessions past grace
  const dueForfeit = await prisma.playlandSession.findMany({
    where: { status: "PAUSED", reentryDeadlineAt: { lte: now } },
    select: { id: true, orgId: true, branchId: true },
  });
  for (const s of dueForfeit) {
    await prisma.$transaction([
      prisma.playlandSession.update({ where: { id: s.id }, data: { status: "FORFEITED", checkOutAt: now } }),
      prisma.playlandAlert.create({
        data: {
          orgId: s.orgId,
          branchId: s.branchId,
          sessionId: s.id,
          type: "REENTRY_EXPIRED",
          severity: "DANGER",
          title: "ขาดสิทธิ์ — กลับมาเกิน 15 นาที",
          message: "session forfeited via cron",
        },
      }),
    ]);
  }
  // ACTIVE sessions about to expire (warning at -10min)
  const warnDeadline = new Date(now.getTime() + WARN_BEFORE_EXPIRE_MINUTES * 60_000);
  const warnDue = await prisma.playlandSession.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { gt: now, lte: warnDeadline },
      packageMinutes: { gt: 0 },
      // Don't double-warn — skip if there's already a TIME_WARNING alert for this session
      NOT: { alerts: { some: { type: "TIME_WARNING" } } },
    },
    select: { id: true, orgId: true, branchId: true },
  });
  for (const s of warnDue) {
    await prisma.playlandAlert.create({
      data: {
        orgId: s.orgId,
        branchId: s.branchId,
        sessionId: s.id,
        type: "TIME_WARNING",
        severity: "WARNING",
        title: "ใกล้หมดเวลาเล่น",
        message: "เหลือ ≤ 10 นาที · พิจารณาแจ้งผู้ปกครองหรือต่อเวลา",
      },
    });
  }
  return { expiredCount: dueActive.length, forfeitedCount: dueForfeit.length, warnedCount: warnDue.length };
}
