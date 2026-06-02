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
