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

// ---------------------------------------------------------------------------
// Gate whitelist sync — closes the "face stays a standing key forever" gap.
//
// The ACS-F606 device opens its own relay locally the instant it matches a
// registered face, with NO real-time check against our backend (see
// acs-auto-adapter.ts header + docs/acs/README.md). So the only lever we
// have is WHICH faces are on each device's local whitelist right now:
//   ACTIVE (currently inside)   → NOT on the entrance device, IS on the exit device
//   PAUSED (stepped out, grace) → back on the entrance device, OFF the exit device (one exit per round)
//   FORFEITED / COMPLETED       → off BOTH entrance and exit whitelists
// Real devices are behind shop-LAN NAT (Vercel can't reach them directly),
// so both add/remove go through the existing async PlaylandFaceSync queue —
// same mechanism `syncMemberFaceToDevices` (actions.ts) already uses.
// ---------------------------------------------------------------------------

async function directionalDeviceIds(tx: Tx, branchId: string): Promise<{ entrance: string[]; exit: string[] }> {
  const devices = await tx.playlandDevice.findMany({
    where: { branchId, status: { not: "DISABLED" }, vendor: { not: "mock" } },
    select: { id: true, direction: true },
  });
  return {
    entrance: devices.filter((d) => d.direction === "IN").map((d) => d.id),
    exit: devices.filter((d) => d.direction === "OUT").map((d) => d.id),
  };
}

async function queueFaceJobs(tx: Tx, orgId: string, deviceIds: string[], memberId: string, mode: "ADD" | "REMOVE") {
  for (const deviceId of deviceIds) {
    await tx.playlandFaceSync.upsert({
      where: { deviceId_memberId: { deviceId, memberId } },
      create: { orgId, deviceId, memberId, status: mode === "ADD" ? "PENDING" : "DELETE_PENDING" },
      update: { status: mode === "ADD" ? "PENDING" : "DELETE_PENDING", attempts: 0, lastAttemptAt: null, errorMessage: null },
    });
  }
}

/** Just walked in — take them off the entrance whitelist so re-scanning the same face doesn't keep opening the gate. */
async function revokeEntranceAccess(tx: Tx, orgId: string, branchId: string, memberId: string) {
  const { entrance } = await directionalDeviceIds(tx, branchId);
  if (entrance.length > 0) await queueFaceJobs(tx, orgId, entrance, memberId, "REMOVE");
}

/** Just stepped out mid-visit — put them back on the entrance whitelist so they can scan back in within the grace window. */
async function restoreEntranceAccess(tx: Tx, orgId: string, branchId: string, memberId: string) {
  const { entrance } = await directionalDeviceIds(tx, branchId);
  if (entrance.length > 0) await queueFaceJobs(tx, orgId, entrance, memberId, "ADD");
}

/** Just stepped out — take them off the EXIT whitelist so the same face can't open the exit gate a second time this round (CEO 2026-10-01). */
async function revokeExitAccess(tx: Tx, orgId: string, branchId: string, memberId: string) {
  const { exit } = await directionalDeviceIds(tx, branchId);
  if (exit.length > 0) await queueFaceJobs(tx, orgId, exit, memberId, "REMOVE");
}

/** Walked back in within grace — give the exit back so they can leave again (once). */
async function restoreExitAccess(tx: Tx, orgId: string, branchId: string, memberId: string) {
  const { exit } = await directionalDeviceIds(tx, branchId);
  if (exit.length > 0) await queueFaceJobs(tx, orgId, exit, memberId, "ADD");
}

/** Visit is fully over (forfeited grace / checked out) — off every gate device until their next paid visit re-registers them. */
export async function revokeAllGateAccess(tx: Tx, orgId: string, branchId: string, memberId: string) {
  const { entrance, exit } = await directionalDeviceIds(tx, branchId);
  const all = [...entrance, ...exit];
  if (all.length > 0) await queueFaceJobs(tx, orgId, all, memberId, "REMOVE");
}

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
        // Wave 2 (D-A2 · 2026-09-30): customer paid at the counter and chose
        // "สแกนหน้า" instead of a wristband → session sits PENDING_ENTRY until
        // this exact gate scan starts the clock. Mirrors activatePendingSession
        // (wristband.ts) — the wristband-gate equivalent of this same rule.
        const pending = await tx.playlandSession.findFirst({
          where: { orgId, branchId, memberId, status: "PENDING_ENTRY" },
          orderBy: { createdAt: "desc" },
        });
        if (pending) {
          const expiresAt = pending.packageMinutes > 0 ? new Date(event.eventAt.getTime() + pending.packageMinutes * 60_000) : null;
          // Race-safe: succeeds only if still PENDING_ENTRY · guards against a
          // duplicate scan resetting the clock a second time.
          const activated = await tx.playlandSession.updateMany({
            where: { id: pending.id, status: "PENDING_ENTRY" },
            data: { status: "ACTIVE", checkInAt: event.eventAt, expiresAt },
          });
          if (activated.count === 1) {
            await revokeEntranceAccess(tx, orgId, branchId, memberId);
            const ev = await insertEvent(tx, input, memberId, pending.id);
            return { eventId: ev.id, sessionId: pending.id, outcome: "session_created", message: "activated pending session via face scan" };
          }
          // Lost the race (already activated a moment earlier) — fall through to the normal alert below.
        }
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
          await revokeAllGateAccess(tx, orgId, branchId, memberId);
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
        await revokeEntranceAccess(tx, orgId, branchId, memberId);
        await restoreExitAccess(tx, orgId, branchId, memberId);
        const ev = await insertEvent(tx, input, memberId, session.id);
        return { eventId: ev.id, sessionId: session.id, outcome: "session_resumed", message: `resumed (+${pausedSecs}s paused)` };
      }

      // session.status === "ACTIVE" · just log (duplicate in-scan) — also re-assert
      // the entrance-whitelist removal in case the earlier DELETE job hasn't landed
      // on the device yet (agent poll lag), so a repeat scan can't reopen the gate.
      await revokeEntranceAccess(tx, orgId, branchId, memberId);
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
        await restoreEntranceAccess(tx, orgId, branchId, memberId);
        await revokeExitAccess(tx, orgId, branchId, memberId);
        const ev = await insertEvent(tx, input, memberId, session.id);
        return { eventId: ev.id, sessionId: session.id, outcome: "session_paused", message: `paused · re-entry by ${deadline.toISOString()}` };
      }
      // Already PAUSED · log only — also re-assert the exit-whitelist removal in case the earlier
      // DELETE job hasn't landed on the device yet (agent poll lag), so a repeat scan can't reopen the exit.
      await revokeExitAccess(tx, orgId, branchId, memberId);
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
  // เกินเวลา: CEO 2026-06-24 — "เวลาไม่หยุด ไม่ตัด/ไม่ริบอัตโนมัติ"
  //   เลยเวลาแล้ว → ปล่อยเวลาเดินต่อเป็น "เกินเวลา" (status คง ACTIVE → ยังอยู่บนกระดาน)
  //   จนแคชเชียร์เช็คเอาท์ → ตอนนั้นค่อยคิด "ค่าปรับเกินเวลา" เก็บเงิน (checkOutSession)
  //   cron แค่แจ้งเตือนครั้งเดียวว่าเลยเวลาแล้ว · ไม่แตะ status · ไม่แตะเงิน
  const dueActive = await prisma.playlandSession.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lte: now },
      packageMinutes: { gt: 0 },
      NOT: { alerts: { some: { type: "TIME_EXPIRED" } } }, // เตือนครั้งเดียวพอ
    },
    select: { id: true, orgId: true, branchId: true },
  });
  for (const s of dueActive) {
    await prisma.playlandAlert.create({
      data: {
        orgId: s.orgId,
        branchId: s.branchId,
        sessionId: s.id,
        type: "TIME_EXPIRED",
        severity: "WARNING",
        title: "เกินเวลาเล่น",
        message: "เลยเวลาแล้ว · เวลาเดินต่อ → เก็บค่าปรับเกินเวลาตอนเช็คเอาท์",
      },
    });
  }
  // PAUSED sessions past grace
  const dueForfeit = await prisma.playlandSession.findMany({
    where: { status: "PAUSED", reentryDeadlineAt: { lte: now } },
    select: { id: true, orgId: true, branchId: true, memberId: true },
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
    // Visit is over — off every gate device (matches the immediate too-late-reentry path above)
    await revokeAllGateAccess(prisma, s.orgId, s.branchId, s.memberId);
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
