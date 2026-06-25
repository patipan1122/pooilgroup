"use server";

// ClawFleet v2 — review decision mutation for the branch-based redesign.
// The v2 anomaly review modal sends the session CODE (not id) + a decision.
// Maps decision → session status, records reviewer + note.
//
// Gracefully no-ops when the session code isn't a real DB row (e.g. the page is
// still showing mock showcase data before the migration + branch-shape reseed).

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds, assertCfAdmin } from "./role-guard";
import {
  StartBranchSessionSchema,
  SubmitBranchEventSchema,
  CloseBranchSessionSchema,
  StartGroupSessionSchema,
  SubmitExchangerEventSchema,
  CloseGroupSessionSchema,
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
    select: {
      id: true,
      branchId: true,
      groupId: true,
      group: { select: { branchId: true } },
      closedById: true,
    },
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

  // F2 (segregation of duties · CEO 2026-06-02): ห้ามอนุมัติรอบที่ตัวเองเป็นคนปิด/เก็บ
  // (ยัง "ตรวจซ้ำ/ส่งต่อ" ได้ — แค่ห้าม approve เอง)
  if (decision === "approve" && cf.closedById && cf.closedById === session.user.id) {
    return {
      ok: false,
      error: "อนุมัติรอบที่ตัวเองเก็บ/ปิดไม่ได้ · ให้คนอื่นตรวจ (กดตรวจซ้ำหรือส่งต่อได้)",
    };
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
    select: { id: true, branchId: true, groupId: true },
  });
  if (!cf) return { ok: false, error: "รอบนี้ไม่อยู่ในสถานะเปิด" };
  if (cf.branchId !== machine.branchId) return { ok: false, error: "ตู้ไม่อยู่ในสาขาของรอบนี้" };
  // Anti-fraud (audit P1): for a GROUP-scoped round, the claw must belong to THAT
  // group — else a claw from group B submitted into group A's round would corrupt
  // the 3-way cross-check denominator (trigger sums claws of A+B vs A's exchanger).
  if (cf.groupId && cf.groupId !== machine.groupId) {
    return { ok: false, error: "ตู้ไม่อยู่ในกลุ่มของรอบนี้" };
  }

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

// =============================================================
// Group-scoped collect flow (Type B = TOKEN exchanger + claws · Type A = CASH)
// Opening a session with group_id set re-enables the Postgres trigger
// cf_session_close_crosscheck (3-way token check). Grafted from antifraud branch.
// =============================================================

/** เปิดรอบเก็บระดับกลุ่ม · resume ถ้ามีรอบ OPEN อยู่แล้ว */
export async function startGroupSession(
  input: unknown,
): Promise<ResultOf<{ id: string; code: string; groupType: "TOKEN" | "CASH" }>> {
  const parsed = StartGroupSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  const orgId = session.user.org_id;
  const { groupId } = parsed.data;

  const group = await prisma.cfMachineGroup.findFirst({
    where: { id: groupId, orgId, isActive: true },
    select: { id: true, branchId: true, exchangerId: true },
  });
  if (!group) return { ok: false, error: "ไม่พบกลุ่มตู้ หรือกลุ่มปิดใช้งาน" };

  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(group.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  const groupType: "TOKEN" | "CASH" = group.exchangerId ? "TOKEN" : "CASH";

  // Anti-wedge (audit P0): a group with 0 active CLAW machines can OPEN but never
  // CLOSE (closeGroupSession needs ≥1 claw event) — and the open session then blocks
  // any retry. Refuse to open an empty group up front.
  const clawCount = await prisma.cfMachine.count({
    where: { orgId, groupId, kind: "CLAW", isActive: true },
  });
  if (clawCount === 0) {
    return { ok: false, error: "กลุ่มนี้ยังไม่มีตู้คีบ · เพิ่มตู้เข้ากลุ่มก่อนเปิดรอบ" };
  }

  const open = await prisma.cfCollectionSession.findFirst({
    where: { orgId, groupId, status: "OPEN" },
    select: { id: true, sessionCode: true },
  });
  if (open) return { ok: true, data: { id: open.id, code: open.sessionCode, groupType } };

  const admin = adminClient();
  const { data: codeData, error: codeErr } = await admin.rpc("cf_next_session_code", { p_org_id: orgId });
  if (codeErr) return { ok: false, error: `รหัสรอบ: ${codeErr.message}` };

  try {
    const s = await prisma.cfCollectionSession.create({
      data: {
        orgId,
        groupId,
        branchId: group.branchId, // keep branch for access guards + branch reporting
        sessionCode: codeData as string,
        openedById: session.user.id,
        status: "OPEN",
      },
      select: { id: true, sessionCode: true },
    });
    revalidatePath("/clawfleet/v2/operations");
    revalidatePath("/clawfleet/v2/hub");
    return { ok: true, data: { id: s.id, code: s.sessionCode, groupType } };
  } catch (e) {
    return { ok: false, error: `เปิดรอบไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/** กรอกตู้แลก (EXCHANGER) ในรอบกลุ่ม — token meter + เงินที่เก็บได้ + 3 รูป */
export async function submitExchangerEvent(input: unknown): Promise<ResultOf<{ id: string }>> {
  const parsed = SubmitExchangerEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId, isActive: true, kind: "EXCHANGER" },
    select: { id: true, branchId: true, groupId: true, qrToken: true, lastCoinMeter: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้แลก" };

  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(machine.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  if (data.qrToken && machine.qrToken !== data.qrToken) {
    return { ok: false, error: "QR ไม่ตรงกับตู้แลกนี้ · สแกนใหม่" };
  }

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { id: data.sessionId, orgId, status: "OPEN" },
    select: { id: true, groupId: true },
  });
  if (!cf) return { ok: false, error: "รอบนี้ไม่อยู่ในสถานะเปิด" };
  if (!cf.groupId || cf.groupId !== machine.groupId) {
    return { ok: false, error: "ตู้แลกไม่อยู่ในกลุ่มของรอบนี้" };
  }
  // C2: token meter must not regress
  if (data.coinMeterAfter < machine.lastCoinMeter) {
    return { ok: false, error: "มิเตอร์ token ถอยหลัง · ตรวจตัวเลข" };
  }

  const dup = await prisma.cfCollectionEvent.findFirst({
    where: { sessionId: data.sessionId, machineId: data.machineId, eventType: "COLLECTION" },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "ตู้แลกนี้กรอกในรอบนี้ไปแล้ว" };

  try {
    const ev = await prisma.cfCollectionEvent.create({
      data: {
        orgId,
        sessionId: data.sessionId,
        machineId: data.machineId,
        eventType: "COLLECTION",
        collectedAt: new Date(),
        collectedById: session.user.id,
        coinMeterBefore: machine.lastCoinMeter,
        coinMeterAfter: data.coinMeterAfter, // token dispensed = delta
        cashCountedCents: data.cashCountedCents, // money collected at exchanger
        promoCoinsDispensed: data.promoCoinsDispensed ?? null,
        photoMeterAfterUrl: data.photoCoinMeterUrl,
        photoCashUrl: data.photoCashUrl,
        photoMeterBeforeUrl: data.photoTokenTrayUrl, // reuse slot for token-tray photo
        notes: data.notes,
      },
      select: { id: true },
    });
    revalidatePath("/clawfleet/v2/operations");
    return { ok: true, data: { id: ev.id } };
  } catch (e) {
    return { ok: false, error: `บันทึกตู้แลกไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/**
 * ปิดรอบกลุ่ม. App-layer คำนวณ doll (+ cash สำหรับกลุ่มเงินสด) เป็น snapshot/preview
 * แล้ว set status. Postgres trigger cf_session_close_crosscheck จะทำ TOKEN cross-check
 * (exchanger coins-out == Σ claw coins-in) เองตอน UPDATE → append COIN_GROUP_MISMATCH
 * + บังคับ ANOMALY_REVIEW ถ้าไม่ตรง. ตู้แลกถูก guard ด้วย exchanger_id IS NOT NULL.
 */
export async function closeGroupSession(
  input: unknown,
): Promise<ResultOf<{ status: string; flags: string[] }>> {
  const parsed = CloseGroupSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { id: data.sessionId, orgId, status: "OPEN" },
    select: {
      id: true,
      branchId: true,
      groupId: true,
      group: { select: { exchangerId: true } },
      events: {
        where: { eventType: "COLLECTION" },
        select: {
          machineId: true,
          coinMeterBefore: true, coinMeterAfter: true, cashCountedCents: true,
          dollMeterBefore: true, dollMeterAfter: true,
          stockBefore: true, stockAfter: true, refillQty: true,
        },
      },
    },
  });
  if (!cf) return { ok: false, error: "รอบนี้ไม่อยู่ในสถานะเปิด" };
  if (!cf.groupId) return { ok: false, error: "รอบนี้ไม่ใช่ระดับกลุ่ม" };

  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && (!cf.branchId || !allowed.includes(cf.branchId))) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  const isTokenGroup = !!cf.group?.exchangerId;

  // completeness: ทุกตู้คีบในกลุ่ม + ตู้แลก (ถ้าเป็น token group) ต้องเก็บครบ
  const clawCount = await prisma.cfMachine.count({
    where: { orgId, groupId: cf.groupId, kind: "CLAW", isActive: true },
  });
  const exchangerCollected = isTokenGroup
    ? cf.events.some((e) => e.machineId === cf.group!.exchangerId)
    : true;
  const clawEvents = cf.events.filter((e) => e.machineId !== cf.group?.exchangerId);

  if (clawEvents.length === 0) return { ok: false, error: "ยังไม่มีตู้คีบที่กรอก" };
  if (clawEvents.length < clawCount) {
    return { ok: false, error: `เก็บไม่ครบ · ตู้คีบ ${clawEvents.length}/${clawCount} ตู้` };
  }
  if (!exchangerCollected) {
    return { ok: false, error: "ยังไม่ได้เก็บตู้แลก (EXCHANGER) ของกลุ่มนี้" };
  }

  // App-layer cash+doll preview (token = trigger). For token groups the claws carry
  // no cash, so skip the per-claw cash check; doll always applies.
  const cc = deriveBranchCrossCheck(
    clawEvents.map((e) => ({
      coinMeterBefore: e.coinMeterBefore,
      coinMeterAfter: e.coinMeterAfter,
      cashCountedCents: isTokenGroup ? 0 : e.cashCountedCents,
      dollMeterBefore: e.dollMeterBefore ?? 0,
      dollMeterAfter: e.dollMeterAfter ?? 0,
      stockBefore: e.stockBefore ?? 0,
      stockAfter: e.stockAfter ?? 0,
      refillQty: e.refillQty ?? 0,
      // token group: claws have no cash → expected 0 so cash check is a no-op
      cashPerCoinCents: isTokenGroup ? 0 : CASH_PER_PLAY_CENTS,
    })),
  );

  // P0: for a TOKEN group the REAL money lives in the EXCHANGER, not the claws.
  // The recorded cash the office reconciles against the bank slip = exchanger cash
  // (+ any claw cash, 0 for token groups). Without this, settlement would reconcile
  // a deposit slip against ฿0 and never catch a short deposit.
  const exchangerCashCents = isTokenGroup
    ? cf.events
        .filter((e) => e.machineId === cf.group?.exchangerId)
        .reduce((sum, e) => sum + (e.cashCountedCents ?? 0), 0)
    : 0;
  const recordedCashCents = cc.actualCashCents + exchangerCashCents;

  try {
    await prisma.cfCollectionSession.update({
      where: { id: data.sessionId, status: "OPEN" },
      data: {
        // trigger may override to ANOMALY_REVIEW if token mismatch
        status: cc.status,
        closedById: session.user.id,
        expectedCashCents: cc.expectedCashCents,
        actualCashCents: recordedCashCents,
        totalCashCents: recordedCashCents,
        cashVarianceBps: cc.cashVarianceBps,
        prizeMeterOut: cc.prizeMeterOut,
        prizeCountedOut: cc.prizeCountedOut,
        prizeVariance: cc.prizeVariance,
        anomalyFlags: cc.flags,
        reviewNote: data.reviewNote,
      },
      select: { id: true },
    });
    // read back what the trigger decided (token cross-check + final status)
    const after = await prisma.cfCollectionSession.findFirst({
      where: { id: data.sessionId, orgId },
      select: { status: true, anomalyFlags: true },
    });
    revalidatePath("/clawfleet/v2/operations");
    revalidatePath("/clawfleet/v2/anomalies");
    revalidatePath("/clawfleet/v2/hub");
    return {
      ok: true,
      data: { status: after?.status ?? cc.status, flags: after?.anomalyFlags ?? cc.flags },
    };
  } catch (e) {
    return { ok: false, error: `ปิดรอบไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// Stock — request a shipment from central warehouse (cf_deliveries)
// =============================================================
export async function createDelivery(input: {
  branchId: string;
  itemsCount: number;
  unitsCount: number;
  note?: string;
}): Promise<ResultOf<{ id: string }>> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branchId = String(input?.branchId ?? "");
  const itemsCount = Math.max(0, Math.floor(Number(input?.itemsCount) || 0));
  const unitsCount = Math.max(1, Math.floor(Number(input?.unitsCount) || 0));
  if (!branchId) return { ok: false, error: "ไม่ระบุสาขา" };

  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ" };

  try {
    const d = await prisma.cfDelivery.create({
      data: {
        orgId,
        branchId,
        status: "SCHEDULED",
        itemsCount,
        unitsCount,
        note: input?.note ? String(input.note).slice(0, 500) : null,
        createdById: session.user.id,
      },
      select: { id: true },
    });
    revalidatePath("/clawfleet/v2/stock");
    revalidatePath("/clawfleet/v2/hub");
    return { ok: true, data: { id: d.id } };
  } catch (e) {
    return { ok: false, error: `สั่งของไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// จัดการ (Manage) — full CRUD สำหรับ สาขา (Branch) + ตู้ (CfMachine)
// Admin power = org admin-tier OR program_admin ที่ได้ grant clawfleet
// (assertCfAdmin redirects ถ้าไม่มีสิทธิ์). ทุก action: Zod + try/catch + revalidate.
// =============================================================

const MANAGE_PATH = "/clawfleet/v2/manage";

/** unique-violation จาก Prisma (รหัสซ้ำ) */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * หา companyId สำหรับสาขาตู้คีบใหม่ — สืบจากสาขาตู้คีบที่มีอยู่แล้ว (ให้ company
 * เดียวกับของเดิม) → ถ้าไม่มี ใช้ company แรกของ org. Branch.companyId เป็น required
 * ไม่มี default จึงต้อง resolve ก่อน create.
 */
async function resolveCfCompanyId(orgId: string): Promise<string | null> {
  const sibling = await prisma.branch.findFirst({
    where: { orgId, businessType: "claw_machine" },
    select: { companyId: true },
    orderBy: { createdAt: "asc" },
  });
  if (sibling?.companyId) return sibling.companyId;
  const company = await prisma.company.findFirst({
    where: { orgId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return company?.id ?? null;
}

const CreateBranchSchema = z.object({
  name: z.string().trim().min(1, "กรอกชื่อสาขา").max(120),
  code: z.string().trim().min(1, "กรอกรหัสสาขา").max(40),
  province: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
});

/** สร้างสาขาตู้คีบใหม่ */
export async function createBranch(input: unknown): Promise<ResultOf<{ id: string }>> {
  const parsed = CreateBranchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  const { name, code, province, region } = parsed.data;

  const companyId = await resolveCfCompanyId(orgId);
  if (!companyId) {
    return { ok: false, error: "ไม่พบบริษัทในองค์กรนี้ · ตั้งค่าบริษัทก่อนเพิ่มสาขา" };
  }

  try {
    const b = await prisma.branch.create({
      data: {
        orgId,
        companyId,
        code,
        name,
        businessType: "claw_machine",
        province: province || null,
        region: region || null,
      },
      select: { id: true },
    });
    revalidatePath(MANAGE_PATH);
    return { ok: true, data: { id: b.id } };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "รหัสสาขาซ้ำ · ใช้รหัสอื่น" };
    return { ok: false, error: `เพิ่มสาขาไม่สำเร็จ: ${(e as Error).message}` };
  }
}

const RenameBranchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(40).optional(),
});

/** เปลี่ยนชื่อ/รหัสสาขา */
export async function renameBranch(branchId: string, input: unknown): Promise<Result> {
  const parsed = RenameBranchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  if (parsed.data.name === undefined && parsed.data.code === undefined) {
    return { ok: false, error: "ไม่มีข้อมูลที่จะแก้ไข" };
  }
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ" };

  try {
    await prisma.branch.update({
      where: { id: branchId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
      },
    });
    revalidatePath(MANAGE_PATH);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "รหัสสาขาซ้ำ · ใช้รหัสอื่น" };
    return { ok: false, error: `แก้ไขสาขาไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/**
 * ลบสาขา — SOFT delete (isActive=false) ถ้ามีตู้หรือรอบเก็บอยู่แล้ว
 * (กันข้อมูลประวัติพัง) · ลบจริงเฉพาะสาขาที่ว่างเปล่า.
 */
export async function deleteBranch(branchId: string): Promise<ResultOf<{ mode: "soft" | "hard" }>> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: {
      id: true,
      _count: { select: { cfMachines: true, cfSessions: true } },
    },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ" };

  const hasDependents = branch._count.cfMachines > 0 || branch._count.cfSessions > 0;

  try {
    if (hasDependents) {
      await prisma.branch.update({ where: { id: branchId }, data: { isActive: false } });
      revalidatePath(MANAGE_PATH);
      return { ok: true, data: { mode: "soft" } };
    }
    await prisma.branch.delete({ where: { id: branchId } });
    revalidatePath(MANAGE_PATH);
    return { ok: true, data: { mode: "hard" } };
  } catch (e) {
    return { ok: false, error: `ลบสาขาไม่สำเร็จ: ${(e as Error).message}` };
  }
}

const CreateMachineSchema = z.object({
  branchId: z.string().min(1, "ไม่ระบุสาขา"),
  code: z.string().trim().min(1, "กรอกรหัสตู้").max(40),
  nickname: z.string().trim().max(120).optional(),
  kind: z.enum(["CLAW", "EXCHANGER"]),
});

/** เพิ่มตู้ใหม่ในสาขา · generate qrToken เอง */
export async function createCfMachine(input: unknown): Promise<ResultOf<{ id: string }>> {
  const parsed = CreateMachineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  const { branchId, code, nickname, kind } = parsed.data;

  // ตู้ต้องอยู่ในสาขาตู้คีบของ org นี้เท่านั้น
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ หรือสาขาไม่อยู่ในองค์กรนี้" };

  try {
    const m = await prisma.cfMachine.create({
      data: {
        orgId,
        branchId,
        code,
        nickname: nickname || null,
        kind,
        qrToken: randomUUID(),
      },
      select: { id: true },
    });
    revalidatePath(MANAGE_PATH);
    return { ok: true, data: { id: m.id } };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "รหัสตู้ซ้ำ · ใช้รหัสอื่น" };
    return { ok: false, error: `เพิ่มตู้ไม่สำเร็จ: ${(e as Error).message}` };
  }
}

const RenameMachineSchema = z.object({
  nickname: z.string().trim().max(120).optional(),
  code: z.string().trim().min(1).max(40).optional(),
  kind: z.enum(["CLAW", "EXCHANGER"]).optional(),
});

/** เปลี่ยนชื่อ/รหัส/ประเภทตู้ */
export async function renameCfMachine(machineId: string, input: unknown): Promise<Result> {
  const parsed = RenameMachineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  if (
    parsed.data.nickname === undefined &&
    parsed.data.code === undefined &&
    parsed.data.kind === undefined
  ) {
    return { ok: false, error: "ไม่มีข้อมูลที่จะแก้ไข" };
  }
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId },
    select: { id: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้" };

  try {
    await prisma.cfMachine.update({
      where: { id: machineId },
      data: {
        ...(parsed.data.nickname !== undefined ? { nickname: parsed.data.nickname || null } : {}),
        ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      },
    });
    revalidatePath(MANAGE_PATH);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "รหัสตู้ซ้ำ · ใช้รหัสอื่น" };
    return { ok: false, error: `แก้ไขตู้ไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/** ปลดระวางตู้ (soft · isActive=false + retiredAt) */
export async function retireCfMachine(machineId: string): Promise<Result> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId },
    select: { id: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้" };

  try {
    await prisma.cfMachine.update({
      where: { id: machineId },
      data: { isActive: false, retiredAt: new Date() },
    });
    revalidatePath(MANAGE_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ปลดระวางตู้ไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// DEMO DATA — ใส่/ลบ ข้อมูลตัวอย่าง (super_admin only · idempotent)
// ทุกอย่าง mark "[DEMO]" + code prefix "DEMO-" เพื่อให้ลบกลับได้สะอาด.
// สร้างครบทั้ง spectrum ค่าเฉลี่ยบาท/ตัว: ดี(~200)/ต่ำ(~140)/ขาดทุน(~90)/ตึง(~420).
// =============================================================

const DEMO_MARK = "[DEMO]";
const DEMO_PREFIX = "DEMO-";

/** วันที่ย้อนหลัง n วัน (เที่ยงวัน) */
function daysBack(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}
/** เวลาวันนี้ (ใช้ปิดรอบ ให้เข้าช่วง "วันนี้" ของ P&L) */
function todayAt(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** หา/สร้าง company สำหรับ demo (org อาจว่างเปล่า) */
async function ensureDemoCompany(orgId: string): Promise<string> {
  const existing = await resolveCfCompanyId(orgId);
  if (existing) return existing;
  const c = await prisma.company.create({
    data: { orgId, code: `${DEMO_PREFIX}CO`, name: `${DEMO_MARK} บริษัทตัวอย่าง` },
    select: { id: true },
  });
  return c.id;
}

/** หา/สร้าง user สำหรับเป็นคนเก็บ/ปิดรอบ demo */
async function ensureDemoUser(orgId: string): Promise<string> {
  const existing = await prisma.user.findFirst({
    where: { orgId, name: { startsWith: DEMO_MARK } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const u = await prisma.user.create({
    data: { orgId, name: `${DEMO_MARK} พนักงานตัวอย่าง`, role: "staff", isActive: true },
    select: { id: true },
  });
  return u.id;
}

/** หา/สร้าง product ตาม sku (idempotent) */
async function ensureDemoProduct(
  orgId: string, sku: string, name: string, unitCostCents: number,
): Promise<string> {
  const existing = await prisma.cfProduct.findFirst({
    where: { orgId, sku },
    select: { id: true },
  });
  if (existing) return existing.id;
  const p = await prisma.cfProduct.create({
    data: { orgId, sku, name, unitCostCents, isActive: true },
    select: { id: true },
  });
  return p.id;
}

/**
 * spec ของตู้ demo: ค่าเฉลี่ยบาท/ตัว ที่อยากให้ออก → คำนวณ cash/dolls.
 * cashCents = avg * dolls * 100.
 */
type DemoMachineSpec = {
  code: string; nickname: string; dolls: number; avg: number;
  configDaysAgo: number; // ตั้งค่าตู้ล่าสุดกี่วันก่อน
};

/**
 * ใส่ข้อมูลตัวอย่าง — สร้าง products + 3 สาขา + ตู้ + loadout + รอบเก็บ
 * (CLOSED หลายรอบ ครบ spectrum + 1-2 OPEN กำลังเก็บ).
 */
export async function seedClawFleetDemo(): Promise<ResultOf<{ branches: number; machines: number; sessions: number }>> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  try {
    const companyId = await ensureDemoCompany(orgId);
    const userId = await ensureDemoUser(orgId);

    // 1) products (ต้นทุนตุ๊กตา)
    const bearId = await ensureDemoProduct(orgId, `${DEMO_PREFIX}BEAR`, `${DEMO_MARK} หมีบราวน์`, 11000); // ฿110
    const catId = await ensureDemoProduct(orgId, `${DEMO_PREFIX}CAT`, `${DEMO_MARK} ตุ๊กตาแมว`, 12000); // ฿120

    // 2) สาขา demo + spec ตู้ในแต่ละสาขา (ครบ spectrum)
    const branchSpecs: { code: string; name: string; province: string; machines: DemoMachineSpec[] }[] = [
      {
        code: `${DEMO_PREFIX}A`, name: `${DEMO_MARK} สาขาเซ็นทรัล (ตัวอย่าง)`, province: "กรุงเทพฯ",
        machines: [
          { code: `${DEMO_PREFIX}A-01`, nickname: "ตู้ 01 · ทางเข้า", dolls: 20, avg: 210, configDaysAgo: 3 },  // GOOD
          { code: `${DEMO_PREFIX}A-02`, nickname: "ตู้ 02 · ข้างกาแฟ", dolls: 18, avg: 195, configDaysAgo: 5 }, // GOOD
          { code: `${DEMO_PREFIX}A-03`, nickname: "ตู้ 03 · มุมเด็ก", dolls: 22, avg: 140, configDaysAgo: 40 }, // LOW + stale
        ],
      },
      {
        code: `${DEMO_PREFIX}B`, name: `${DEMO_MARK} สาขาตลาดบางใหญ่ (ตัวอย่าง)`, province: "นนทบุรี",
        machines: [
          { code: `${DEMO_PREFIX}B-01`, nickname: "ตู้ 01 · ใกล้ ATM", dolls: 20, avg: 90, configDaysAgo: 60 },  // LOSS + stale
          { code: `${DEMO_PREFIX}B-02`, nickname: "ตู้ 02 · ทางออก", dolls: 16, avg: 240, configDaysAgo: 8 },   // GOOD
        ],
      },
      {
        code: `${DEMO_PREFIX}C`, name: `${DEMO_MARK} สาขาปั๊ม ปตท. (ตัวอย่าง)`, province: "นครราชสีมา",
        machines: [
          { code: `${DEMO_PREFIX}C-01`, nickname: "ตู้ 01 · ร้านสะดวกซื้อ", dolls: 10, avg: 420, configDaysAgo: 12 }, // HIGH
          { code: `${DEMO_PREFIX}C-02`, nickname: "ตู้ 02 · หน้าร้าน", dolls: 15, avg: 300, configDaysAgo: 6 },     // AMBER
        ],
      },
    ];

    let branchCount = 0, machineCount = 0, sessionCount = 0;
    let firstBranchId = "";
    // เก็บ ref สาขา/ตู้แรกไว้ใช้สร้างรอบ "รอตรวจ (ANOMALY_REVIEW)" ตัวอย่าง
    let anomalyBranchId = "";
    let anomalyMachineId = "";

    for (const bs of branchSpecs) {
      // สาขา (idempotent by code)
      let branch = await prisma.branch.findFirst({
        where: { orgId, code: bs.code },
        select: { id: true },
      });
      if (!branch) {
        branch = await prisma.branch.create({
          data: {
            orgId, companyId, code: bs.code, name: bs.name,
            businessType: "claw_machine", province: bs.province, isActive: true,
          },
          select: { id: true },
        });
      }
      branchCount += 1;
      if (!firstBranchId) firstBranchId = branch.id;

      // กลุ่ม event สำหรับ "วันนี้" — รวมเป็น 1 รอบ CLOSED ต่อสาขา
      const sessionCode = `${DEMO_PREFIX}S-${bs.code}-CLOSED`;
      // กันสร้างซ้ำ: ลบรอบ demo เดิมของสาขานี้ก่อน (events cascade ผ่าน SetNull → ลบ events เอง)
      const existingSess = await prisma.cfCollectionSession.findMany({
        where: { orgId, sessionCode: { startsWith: `${DEMO_PREFIX}S-${bs.code}` } },
        select: { id: true },
      });
      if (existingSess.length > 0) {
        const ids = existingSess.map((s) => s.id);
        await prisma.cfCollectionEvent.deleteMany({ where: { sessionId: { in: ids } } });
        await prisma.cfCollectionSession.deleteMany({ where: { id: { in: ids } } });
      }

      const closedSession = await prisma.cfCollectionSession.create({
        data: {
          orgId, branchId: branch.id, sessionCode,
          openedAt: todayAt(9), openedById: userId,
          closedAt: todayAt(11), closedById: userId,
          status: "CLOSED",
        },
        select: { id: true },
      });
      sessionCount += 1;

      let branchCashCents = 0;

      for (let i = 0; i < bs.machines.length; i++) {
        const ms = bs.machines[i]!;
        const productId = i % 2 === 0 ? bearId : catId;

        // ตู้ (idempotent by code)
        let machine = await prisma.cfMachine.findFirst({
          where: { orgId, code: ms.code },
          select: { id: true },
        });
        if (!machine) {
          machine = await prisma.cfMachine.create({
            data: {
              orgId, branchId: branch.id, code: ms.code, nickname: ms.nickname,
              kind: "CLAW", qrToken: randomUUID(), isActive: true,
            },
            select: { id: true },
          });
        }
        machineCount += 1;
        // ตู้แรกของสาขาแรก → ใช้เป็น ref ของรอบ anomaly ตัวอย่าง
        if (!anomalyMachineId) {
          anomalyBranchId = branch.id;
          anomalyMachineId = machine.id;
        }

        // loadout active (effectiveTo null) — ตั้งต้นทุน + วันตั้งค่าล่าสุด
        // ปิด loadout เดิมก่อน (กันมีหลาย active)
        await prisma.cfMachineLoadout.updateMany({
          where: { orgId, machineId: machine.id, effectiveTo: null },
          data: { effectiveTo: daysBack(ms.configDaysAgo + 1) },
        });
        await prisma.cfMachineLoadout.create({
          data: {
            orgId, machineId: machine.id, productId,
            pricePerPlayCoins: 1, effectiveFrom: daysBack(ms.configDaysAgo),
          },
        });

        // event เก็บเงิน — cash จาก avg*dolls
        const cashCents = Math.round(ms.avg * ms.dolls * 100);
        branchCashCents += cashCents;
        const meterBefore = 1000 + i * 100;
        await prisma.cfCollectionEvent.create({
          data: {
            orgId, sessionId: closedSession.id, machineId: machine.id,
            eventType: "COLLECTION", collectedAt: todayAt(10), collectedById: userId,
            coinMeterBefore: 0, coinMeterAfter: ms.dolls * 25,
            cashCountedCents: cashCents,
            dollMeterBefore: meterBefore, dollMeterAfter: meterBefore + ms.dolls,
            stockBefore: 30, stockAfter: 30 - ms.dolls,
          },
        });
      }

      // อัปยอดรวมของรอบ
      await prisma.cfCollectionSession.update({
        where: { id: closedSession.id },
        data: { totalCashCents: branchCashCents },
      });

      // 1 รอบ OPEN (กำลังเก็บ) ในสาขาแรกสองสาขา เพื่อโชว์ "รอบกำลังเก็บ"
      if (branchCount <= 2) {
        await prisma.cfCollectionSession.create({
          data: {
            orgId, branchId: branch.id,
            sessionCode: `${DEMO_PREFIX}S-${bs.code}-OPEN`,
            openedAt: todayAt(20), openedById: userId, status: "OPEN",
          },
        });
        sessionCount += 1;
      }
    }

    // 2b) รอบ "รอตรวจ (ANOMALY_REVIEW)" ตัวอย่าง 1 รอบ — เงินขาดจริง (cash < ที่ควรได้)
    //     เพื่อให้หน้า Anomaly ไม่ว่างใน demo. มี shortfall ทั้งเงินและตุ๊กตา:
    //       มิเตอร์เหรียญออก 800 ครั้ง → ควรได้ ฿8,000 (800 × ฿10) แต่เก็บได้ ฿6,400
    //       → ขาด ฿1,600 (~20% · เด้ง ANOMALY_REVIEW). ตุ๊กตาออกตามมิเตอร์ 30 ตัว
    //       แต่นับจริงหาย → variance -3.
    //     code ขึ้นต้น DEMO- จึงถูก clearClawFleetDemo() ลบอัตโนมัติ (scope startsWith DEMO_PREFIX).
    if (anomalyBranchId && anomalyMachineId) {
      const anomCode = `${DEMO_PREFIX}S-A-ANOMALY`;
      // กันสร้างซ้ำ
      const existingAnom = await prisma.cfCollectionSession.findMany({
        where: { orgId, sessionCode: anomCode },
        select: { id: true },
      });
      if (existingAnom.length > 0) {
        const ids = existingAnom.map((s) => s.id);
        await prisma.cfCollectionEvent.deleteMany({ where: { sessionId: { in: ids } } });
        await prisma.cfCollectionSession.deleteMany({ where: { id: { in: ids } } });
      }
      const expectedCashCents = 800 * CASH_PER_PLAY_CENTS; // ฿8,000
      const actualCashCents = 640000; // ฿6,400 → ขาด ฿1,600 (~20%)
      const anomSession = await prisma.cfCollectionSession.create({
        data: {
          orgId, branchId: anomalyBranchId, sessionCode: anomCode,
          openedAt: todayAt(13), openedById: userId,
          closedAt: todayAt(14), closedById: userId,
          status: "ANOMALY_REVIEW",
          expectedCashCents, actualCashCents, totalCashCents: actualCashCents,
          cashVarianceBps: Math.round(((actualCashCents - expectedCashCents) / expectedCashCents) * 10000),
          prizeMeterOut: 30, prizeCountedOut: 27, prizeVariance: -3,
          anomalyFlags: ["CASH_SHORT", "PRIZE_SHORT"],
          reviewNote: `${DEMO_MARK} เงินที่เก็บได้น้อยกว่าที่มิเตอร์ควรได้ ฿1,600`,
        },
        select: { id: true },
      });
      await prisma.cfCollectionEvent.create({
        data: {
          orgId, sessionId: anomSession.id, machineId: anomalyMachineId,
          eventType: "COLLECTION", collectedAt: todayAt(13), collectedById: userId,
          coinMeterBefore: 0, coinMeterAfter: 800,
          cashCountedCents: actualCashCents,
          dollMeterBefore: 1000, dollMeterAfter: 1030, // มิเตอร์บอกตุ๊กตาออก 30
          stockBefore: 30, stockAfter: 3, // 30 - 27 (นับจริงออก 27 → หาย 3)
          anomalyFlags: ["CASH_SHORT"],
          notes: `${DEMO_MARK} ตัวอย่างเงินขาด`,
        },
      });
      sessionCount += 1;
    }

    // 3) ข้อมูลคลังสินค้า (WMS) ตัวอย่าง — ใบรับ + นับสต๊อก(มีต่าง) + ของหาย + movements
    if (firstBranchId) {
      await seedCfStockDemo(orgId, userId, firstBranchId, [bearId, catId]);
    }

    revalidatePath(MANAGE_PATH);
    revalidatePath("/clawfleet/v2/hub");
    revalidatePath("/clawfleet/v2/stock");
    revalidatePath("/clawfleet/v2/anomalies");
    revalidatePath("/clawfleet/v2/operations");
    return { ok: true, data: { branches: branchCount, machines: machineCount, sessions: sessionCount } };
  } catch (e) {
    return { ok: false, error: `ใส่ข้อมูลตัวอย่างไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/**
 * ใส่ข้อมูลคลังสินค้า (WMS) ตัวอย่างให้สาขาแรก — idempotent (กันสร้างซ้ำด้วย code prefix).
 * สร้าง: รับเข้า 2 ใบ (RECEIPT_IN) + นับสต๊อก 1 ใบ (มีต่าง · COUNT_ADJUST) + ของหาย 1 ใบ (LOSS_ADJUST).
 */
async function seedCfStockDemo(
  orgId: string, userId: string, branchId: string, productIds: string[],
): Promise<void> {
  // กันซ้ำ: ถ้ามีใบรับ demo ของสาขานี้แล้ว ข้าม
  const existing = await prisma.cfGoodsReceipt.findFirst({
    where: { orgId, branchId, receiptCode: { startsWith: `${DEMO_PREFIX}GR-` } },
    select: { id: true },
  });
  if (existing) return;

  const names = await prisma.cfProduct.findMany({
    where: { id: { in: productIds } }, select: { id: true, name: true, unitCostCents: true },
  });
  const nmap = new Map(names.map((n) => [n.id, n]));
  const [p1, p2] = productIds;
  const n1 = nmap.get(p1!); const n2 = nmap.get(p2!);
  if (!n1 || !n2) return;

  await prisma.$transaction(async (tx) => {
    // ── ใบรับ #1 (รับหมีบราวน์ 40 + แมว 30) ──
    const r1 = await tx.cfGoodsReceipt.create({
      data: {
        orgId, branchId, receiptCode: `${DEMO_PREFIX}GR-001`,
        supplierName: `${DEMO_MARK} คลังกลางบางนา`, note: "รับล็อตประจำสัปดาห์",
        totalCostCents: 40 * n1.unitCostCents + 30 * n2.unitCostCents, status: "RECEIVED",
        createdById: userId, createdAt: daysBack(7),
        lines: { create: [
          { orgId, productId: p1!, productName: n1.name, quantity: 40, unitCostCents: n1.unitCostCents },
          { orgId, productId: p2!, productName: n2.name, quantity: 30, unitCostCents: n2.unitCostCents },
        ] },
      },
      select: { id: true },
    });
    await tx.cfStockMovement.createMany({ data: [
      { orgId, branchId, type: "RECEIPT_IN", productId: p1!, qty: 40, unitCostCents: n1.unitCostCents, occurredAt: daysBack(7), createdById: userId, documentType: "goods_receipt", documentId: r1.id, refTable: "cf_goods_receipts", refId: r1.id, reason: "รับเข้า · คงเหลือ 40" },
      { orgId, branchId, type: "RECEIPT_IN", productId: p2!, qty: 30, unitCostCents: n2.unitCostCents, occurredAt: daysBack(7), createdById: userId, documentType: "goods_receipt", documentId: r1.id, refTable: "cf_goods_receipts", refId: r1.id, reason: "รับเข้า · คงเหลือ 30" },
    ] });

    // ── ใบรับ #2 (รับเพิ่มหมี 20) ──
    const r2 = await tx.cfGoodsReceipt.create({
      data: {
        orgId, branchId, receiptCode: `${DEMO_PREFIX}GR-002`,
        supplierName: `${DEMO_MARK} คลังกลางบางนา`, totalCostCents: 20 * n1.unitCostCents, status: "RECEIVED",
        createdById: userId, createdAt: daysBack(3),
        lines: { create: [{ orgId, productId: p1!, productName: n1.name, quantity: 20, unitCostCents: n1.unitCostCents }] },
      },
      select: { id: true },
    });
    await tx.cfStockMovement.create({ data: { orgId, branchId, type: "RECEIPT_IN", productId: p1!, qty: 20, unitCostCents: n1.unitCostCents, occurredAt: daysBack(3), createdById: userId, documentType: "goods_receipt", documentId: r2.id, refTable: "cf_goods_receipts", refId: r2.id, reason: "รับเข้า · คงเหลือ 60" } });

    // ── นับสต๊อก 1 ใบ (พบหมีหาย 3 · แมวเกิน 1) ──
    const c1 = await tx.cfStockCount.create({
      data: {
        orgId, branchId, countCode: `${DEMO_PREFIX}SC-001`, note: "นับประจำเดือน",
        itemsCounted: 2, totalDiff: -2, countedById: userId, countedByName: `${DEMO_MARK} พนักงานตัวอย่าง`,
        countedAt: daysBack(1),
        lines: { create: [
          { orgId, productId: p1!, productName: n1.name, systemQty: 60, countedQty: 57, diff: -3, reason: "หายจากชั้น" },
          { orgId, productId: p2!, productName: n2.name, systemQty: 30, countedQty: 31, diff: 1, reason: "นับเกินเดิม" },
        ] },
      },
      select: { id: true },
    });
    await tx.cfStockMovement.createMany({ data: [
      { orgId, branchId, type: "COUNT_ADJUST", productId: p1!, qty: -3, expectedQty: 60, varianceQty: -3, occurredAt: daysBack(1), createdById: userId, documentType: "stock_count", documentId: c1.id, refTable: "cf_stock_counts", refId: c1.id, reason: "นับต่าง · 60→57" },
      { orgId, branchId, type: "COUNT_ADJUST", productId: p2!, qty: 1, expectedQty: 30, varianceQty: 1, occurredAt: daysBack(1), createdById: userId, documentType: "stock_count", documentId: c1.id, refTable: "cf_stock_counts", refId: c1.id, reason: "นับต่าง · 30→31" },
    ] });

    // ── ของหาย 1 ใบ (แมวเสียหาย 2) ──
    const l1 = await tx.cfLossDoc.create({
      data: {
        orgId, branchId, lossCode: `${DEMO_PREFIX}LS-001`, reason: "DAMAGE",
        note: "ตุ๊กตาเปื้อน/ขาด", totalCostCents: 2 * n2.unitCostCents, reportedById: userId, reportedAt: daysBack(0),
        lines: { create: [{ orgId, productId: p2!, productName: n2.name, qty: 2, unitCostCents: n2.unitCostCents, note: "เปื้อนน้ำ" }] },
      },
      select: { id: true },
    });
    await tx.cfStockMovement.create({ data: { orgId, branchId, type: "LOSS_ADJUST", productId: p2!, qty: -2, unitCostCents: n2.unitCostCents, occurredAt: daysBack(0), createdById: userId, documentType: "loss_doc", documentId: l1.id, refTable: "cf_loss_docs", refId: l1.id, reason: "ของหาย/เสียหาย (DAMAGE)" } });
  });
}

/** ลบข้อมูลตัวอย่างทั้งหมด (super_admin only) — match "[DEMO]"/"DEMO-" */
export async function clearClawFleetDemo(): Promise<ResultOf<{ deleted: boolean }>> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  try {
    // ทั้งหมดอยู่ใน 1 transaction → all-or-nothing (ถ้า step กลางพัง = rollback ไม่ลบครึ่งทาง)
    // ลำดับลบจากลูก→แม่ (FK Restrict) · scope [DEMO]/orgId เหมือนเดิม (ไม่แตะข้อมูลจริง)
    await prisma.$transaction(async (tx) => {
      const sessions = await tx.cfCollectionSession.findMany({
        where: { orgId, sessionCode: { startsWith: DEMO_PREFIX } },
        select: { id: true },
      });
      const sessIds = sessions.map((s) => s.id);
      if (sessIds.length > 0) {
        await tx.cfCollectionEvent.deleteMany({ where: { sessionId: { in: sessIds } } });
      }
      // events ที่ไม่ผูก session (เผื่อ) ของตู้ demo
      const demoMachines = await tx.cfMachine.findMany({
        where: { orgId, code: { startsWith: DEMO_PREFIX } },
        select: { id: true },
      });
      const machIds = demoMachines.map((m) => m.id);
      if (machIds.length > 0) {
        await tx.cfCollectionEvent.deleteMany({ where: { machineId: { in: machIds } } });
      }
      if (sessIds.length > 0) {
        await tx.cfCollectionSession.deleteMany({ where: { id: { in: sessIds } } });
      }
      if (machIds.length > 0) {
        await tx.cfMachineLoadout.deleteMany({ where: { orgId, machineId: { in: machIds } } });
        await tx.cfMachine.deleteMany({ where: { id: { in: machIds } } });
      }
      // WMS demo docs (movements ผูก documentId → ลบ movements ของใบ demo ก่อน · lines cascade ผ่าน FK)
      const demoReceipts = await tx.cfGoodsReceipt.findMany({ where: { orgId, receiptCode: { startsWith: `${DEMO_PREFIX}GR-` } }, select: { id: true } });
      const demoCounts = await tx.cfStockCount.findMany({ where: { orgId, countCode: { startsWith: `${DEMO_PREFIX}SC-` } }, select: { id: true } });
      const demoLosses = await tx.cfLossDoc.findMany({ where: { orgId, lossCode: { startsWith: `${DEMO_PREFIX}LS-` } }, select: { id: true } });
      const docIds = [...demoReceipts, ...demoCounts, ...demoLosses].map((d) => d.id);
      if (docIds.length > 0) {
        await tx.cfStockMovement.deleteMany({ where: { orgId, documentId: { in: docIds } } });
      }
      if (demoReceipts.length) await tx.cfGoodsReceipt.deleteMany({ where: { id: { in: demoReceipts.map((d) => d.id) } } });
      if (demoCounts.length) await tx.cfStockCount.deleteMany({ where: { id: { in: demoCounts.map((d) => d.id) } } });
      if (demoLosses.length) await tx.cfLossDoc.deleteMany({ where: { id: { in: demoLosses.map((d) => d.id) } } });
      // movements ของ product demo ที่ไม่ผูก doc (เผื่อ)
      const demoProducts = await tx.cfProduct.findMany({ where: { orgId, sku: { startsWith: DEMO_PREFIX } }, select: { id: true } });
      const demoProductIds = demoProducts.map((p) => p.id);
      if (demoProductIds.length > 0) {
        await tx.cfStockMovement.deleteMany({ where: { orgId, productId: { in: demoProductIds } } });
      }
      await tx.cfProduct.deleteMany({ where: { orgId, sku: { startsWith: DEMO_PREFIX } } });
      await tx.branch.deleteMany({ where: { orgId, code: { startsWith: DEMO_PREFIX } } });
    });

    // เก็บ company/user demo ไว้ (อาจถูกอ้างที่อื่น · soft footprint) — ลบเฉพาะ orphan ปลอดภัย
    // อยู่ "นอก" transaction โดยตั้งใจ: best-effort · ถ้า company ถูกอ้างที่อื่น (FK กันลบ)
    // ก็ปล่อยผ่าน ไม่ rollback การลบ demo ที่สำเร็จไปแล้ว (semantics เดิม .catch no-op)
    await prisma.company.deleteMany({ where: { orgId, code: `${DEMO_PREFIX}CO` } }).catch(() => {});

    revalidatePath(MANAGE_PATH);
    revalidatePath("/clawfleet/v2/hub");
    return { ok: true, data: { deleted: true } };
  } catch (e) {
    return { ok: false, error: `ลบข้อมูลตัวอย่างไม่สำเร็จ: ${(e as Error).message}` };
  }
}
