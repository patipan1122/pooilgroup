"use server";

// ClawFleet v2 — review decision mutation for the branch-based redesign.
// The v2 anomaly review modal sends the session CODE (not id) + a decision.
// Maps decision → session status, records reviewer + note.
//
// Gracefully no-ops when the session code isn't a real DB row (e.g. the page is
// still showing mock showcase data before the migration + branch-shape reseed).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import {
  StartBranchSessionSchema,
  SubmitBranchEventSchema,
  CloseBranchSessionSchema,
} from "./types";
import { deriveEvent, validateBranchPhotos, deriveBranchCrossCheck } from "./validation";

type Result = { ok: true } | { ok: false; error: string };
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };

export type V2Decision = "approve" | "recheck" | "escalate";

export async function reviewV2Session(
  sessionCode: string,
  decision: V2Decision,
  note: string,
): Promise<Result> {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { orgId, sessionCode },
    select: { id: true, branchId: true, groupId: true, group: { select: { branchId: true } } },
  });
  // Mock/showcase row (not in DB yet) — report a soft failure; the client keeps
  // its optimistic toast. Real rows proceed to the status update.
  if (!cf) return { ok: false, error: "ยังเป็นข้อมูลตัวอย่าง · ยังไม่บันทึกจริง (รอ migration + seed)" };

  // branch-access guard
  const allowed = await userBranchIds(session);
  const branchId = cf.branchId ?? cf.group?.branchId ?? null;
  if (allowed !== "ALL" && (!branchId || !allowed.includes(branchId))) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  const status =
    decision === "approve" ? "LOCKED" : decision === "recheck" ? "OPEN" : "ANOMALY_REVIEW";
  const reviewNote =
    decision === "escalate" ? `[ESCALATE] ${note}`.trim() : note || null;

  await prisma.cfCollectionSession.update({
    where: { id: cf.id, orgId },
    data: {
      status,
      reviewerId: session.user.id,
      reviewedAt: new Date(),
      reviewNote,
    },
  });

  revalidatePath("/clawfleet/v2/anomalies");
  revalidatePath("/clawfleet/v2/operations");
  revalidatePath("/clawfleet/v2/hub");
  return { ok: true };
}

// =============================================================
// Branch-based collection flow (staff mobile · 5-step design)
// Requires migration 20260528000001 applied (branch_id + prize cols + 5th photo).
// =============================================================

const CASH_PER_PLAY_CENTS = 1000; // ฿10/ครั้ง (flat · design model)

/** เปิดรอบเก็บระดับสาขา · resume ถ้ามีรอบ OPEN อยู่แล้ว */
export async function startBranchSession(input: unknown): Promise<ResultOf<{ id: string; code: string }>> {
  const parsed = StartBranchSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  const orgId = session.user.org_id;
  const { branchId } = parsed.data;

  // branch-access guard
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine", isActive: true },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ หรือสาขาปิดใช้งาน" };

  // resume an already-open round (1 OPEN session/branch)
  const open = await prisma.cfCollectionSession.findFirst({
    where: { orgId, branchId, status: "OPEN" },
    select: { id: true, sessionCode: true },
  });
  if (open) return { ok: true, data: { id: open.id, code: open.sessionCode } };

  const admin = adminClient();
  const { data: codeData, error: codeErr } = await admin.rpc("cf_next_session_code", {
    p_org_id: orgId,
  });
  if (codeErr) return { ok: false, error: `รหัสรอบ: ${codeErr.message}` };

  try {
    const s = await prisma.cfCollectionSession.create({
      data: {
        orgId,
        branchId,
        sessionCode: codeData as string,
        openedById: session.user.id,
        status: "OPEN",
      },
      select: { id: true, sessionCode: true },
    });
    revalidatePath("/clawfleet/v2/operations");
    revalidatePath("/clawfleet/v2/hub");
    return { ok: true, data: { id: s.id, code: s.sessionCode } };
  } catch (e) {
    return { ok: false, error: `เปิดรอบไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/** กรอกข้อมูล 1 ตู้คีบในรอบสาขา (5 รูป · มิเตอร์ก่อนดึงจากระบบ) */
export async function submitBranchEvent(input: unknown): Promise<ResultOf<{ id: string }>> {
  const parsed = SubmitBranchEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId, isActive: true, kind: "CLAW" },
    include: { loadouts: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: "desc" } } },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้คีบ" };

  // branch-access guard
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(machine.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  if (data.qrToken && machine.qrToken !== data.qrToken) {
    return { ok: false, error: "QR ไม่ตรงกับตู้นี้ · สแกนใหม่" };
  }

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { id: data.sessionId, orgId, status: "OPEN" },
    select: { id: true, branchId: true },
  });
  if (!cf) return { ok: false, error: "รอบนี้ไม่อยู่ในสถานะเปิด" };
  if (cf.branchId !== machine.branchId) return { ok: false, error: "ตู้ไม่อยู่ในสาขาของรอบนี้" };

  const photoCheck = validateBranchPhotos(data);
  if (!photoCheck.ok) return { ok: false, error: photoCheck.reason };

  const cashPerCoin = machine.loadouts[0]
    ? machine.loadouts[0].pricePerPlayCoins * 1000
    : CASH_PER_PLAY_CENTS;

  // A1 baseline (30-day median revenue for this machine)
  const medianRow = await prisma.$queryRaw<{ median: number | null }[]>`
    SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cash_counted_cents))::int as median
    FROM cf_collection_events
    WHERE machine_id = ${machine.id}::uuid
      AND event_type = 'COLLECTION'
      AND collected_at > NOW() - INTERVAL '30 days'`;
  const medianRevenueCents = medianRow[0]?.median ?? null;

  const derived = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: machine.lastCoinMeter,
    coinMeterAfter: data.coinMeterAfter,
    cashCountedCents: data.cashCountedCents,
    dollMeterBefore: machine.lastDollMeter,
    dollMeterAfter: data.dollMeterAfter,
    stockBefore: data.stockBefore,
    stockAfter: data.stockAfter,
    refillQty: data.refillQty,
    cashPerCoinCents: cashPerCoin,
    medianRevenueCents,
  });
  if (derived.blockReason) return { ok: false, error: derived.blockReason };

  const dup = await prisma.cfCollectionEvent.findFirst({
    where: { sessionId: data.sessionId, machineId: data.machineId, eventType: "COLLECTION" },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "ตู้นี้กรอกในรอบนี้ไปแล้ว" };

  const refillProductId = data.refillProductId ?? machine.loadouts[0]?.productId ?? null;

  try {
    const ev = await prisma.$transaction(async (tx) => {
      const created = await tx.cfCollectionEvent.create({
        data: {
          orgId,
          sessionId: data.sessionId,
          machineId: data.machineId,
          eventType: "COLLECTION",
          collectedAt: new Date(),
          collectedById: session.user.id,
          coinMeterBefore: machine.lastCoinMeter,
          coinMeterAfter: data.coinMeterAfter,
          cashCountedCents: data.cashCountedCents,
          dollMeterBefore: machine.lastDollMeter,
          dollMeterAfter: data.dollMeterAfter,
          stockBefore: data.stockBefore,
          stockAfter: data.stockAfter,
          refillQty: data.refillQty,
          // 5 photos → schema columns
          photoMeterAfterUrl: data.photoCoinMeterUrl,
          photoPrizeMeterUrl: data.photoPrizeMeterUrl,
          photoStockUrl: data.photoStockBeforeUrl,
          photoMeterBeforeUrl: data.photoStockAfterUrl,
          photoCashUrl: data.photoCashUrl,
          anomalyFlags: derived.flags,
          notes: data.notes,
        },
        select: { id: true },
      });
      if (data.refillQty > 0 && refillProductId) {
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: machine.branchId,
            type: "LOAD_TO_MACHINE",
            productId: refillProductId,
            machineId: machine.id,
            qty: -data.refillQty,
            refTable: "cf_collection_events",
            refId: created.id,
            occurredAt: new Date(),
            createdById: session.user.id,
            reason: "เติมตุ๊กตาเข้าตู้",
          },
        });
      }
      return created;
    });
    revalidatePath("/clawfleet/v2/operations");
    return { ok: true, data: { id: ev.id } };
  } catch (e) {
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/** ปิดรอบสาขา · 2-way cross-check (เงิน + ตุ๊กตา) */
export async function closeBranchSession(input: unknown): Promise<ResultOf<{ status: string; flags: string[] }>> {
  const parsed = CloseBranchSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { id: data.sessionId, orgId, status: "OPEN" },
    select: {
      id: true,
      branchId: true,
      events: {
        where: { eventType: "COLLECTION" },
        select: {
          coinMeterBefore: true, coinMeterAfter: true, cashCountedCents: true,
          dollMeterBefore: true, dollMeterAfter: true,
          stockBefore: true, stockAfter: true, refillQty: true,
        },
      },
    },
  });
  if (!cf) return { ok: false, error: "รอบนี้ไม่อยู่ในสถานะเปิด" };
  if (!cf.branchId) return { ok: false, error: "รอบนี้ไม่ใช่ระดับสาขา · ปิดผ่านระบบกลุ่ม" };

  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(cf.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  const machineCount = await prisma.cfMachine.count({
    where: { orgId, branchId: cf.branchId, kind: "CLAW", isActive: true },
  });
  if (cf.events.length === 0) return { ok: false, error: "ยังไม่มีตู้ที่กรอก · กรอกอย่างน้อย 1 ตู้" };
  if (cf.events.length < machineCount) {
    return { ok: false, error: `เก็บไม่ครบ · กรอก ${cf.events.length}/${machineCount} ตู้` };
  }

  const cc = deriveBranchCrossCheck(
    cf.events.map((e) => ({
      coinMeterBefore: e.coinMeterBefore,
      coinMeterAfter: e.coinMeterAfter,
      cashCountedCents: e.cashCountedCents,
      dollMeterBefore: e.dollMeterBefore ?? 0,
      dollMeterAfter: e.dollMeterAfter ?? 0,
      stockBefore: e.stockBefore ?? 0,
      stockAfter: e.stockAfter ?? 0,
      refillQty: e.refillQty ?? 0,
      cashPerCoinCents: CASH_PER_PLAY_CENTS,
    })),
  );

  try {
    await prisma.cfCollectionSession.update({
      where: { id: data.sessionId, status: "OPEN" },
      data: {
        status: cc.status,
        closedById: session.user.id,
        expectedCashCents: cc.expectedCashCents,
        actualCashCents: cc.actualCashCents,
        cashVarianceBps: cc.cashVarianceBps,
        prizeMeterOut: cc.prizeMeterOut,
        prizeCountedOut: cc.prizeCountedOut,
        prizeVariance: cc.prizeVariance,
        totalCashCents: cc.actualCashCents,
        anomalyFlags: cc.flags,
        reviewNote: data.reviewNote,
      },
      select: { id: true },
    });
    revalidatePath("/clawfleet/v2/operations");
    revalidatePath("/clawfleet/v2/anomalies");
    revalidatePath("/clawfleet/v2/hub");
    return { ok: true, data: { status: cc.status, flags: cc.flags } };
  } catch (e) {
    return { ok: false, error: `ปิดรอบไม่สำเร็จ: ${(e as Error).message}` };
  }
}
