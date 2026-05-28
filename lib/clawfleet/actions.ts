"use server";
// ClawFleet — Server Actions (all mutations)
// Pattern follows Pool repair module. Branch-scoping via role-guard.ts.
// Spec: docs/CLAWFLEET_PLAN.md

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import {
  CreateMachineSchema,
  CreateProductSchema,
  CreateGroupSchema,
  SetMachineLoadoutSchema,
  SetExchangerLoadoutSchema,
  StartSessionSchema,
  SubmitEventSchema,
  CloseSessionSchema,
  ReviewSessionSchema,
  StockReceiveSchema,
  StockCountBatchSchema,
} from "./types";
import {
  assertCanAccessBranch,
  assertCanAccessMachine,
  assertCanManageMachine,
  assertCfAdmin,
  assertCanReviewSession,
  isCfAdmin,
} from "./role-guard";
import { deriveEvent, validatePhotos } from "./validation";
import { randomBytes } from "crypto";

type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string };

const ok = <T>(data?: T): Result<T> => ({ ok: true, data });
function fail<T = void>(error: string, code?: string): Result<T> {
  return { ok: false, error, code };
}

// =============================================================
// MACHINES
// =============================================================

export async function createMachine(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateMachineSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanAccessBranch(data.branchId);
  if (!isCfAdmin(session.user.role) && session.user.role !== "branch_manager") {
    return fail("ไม่มีสิทธิ์สร้างตู้");
  }
  try {
    const m = await prisma.cfMachine.create({
      data: {
        orgId: session.user.org_id,
        branchId: data.branchId,
        groupId: data.groupId,
        code: data.code,
        nickname: data.nickname,
        kind: data.kind,
        serial: data.serial,
        qrToken: randomBytes(16).toString("hex"),
        initialCoinMeter: data.initialCoinMeter,
        initialDollMeter: data.kind === "CLAW" ? data.initialDollMeter : 0,
        lastCoinMeter: data.initialCoinMeter,
        lastDollMeter: data.kind === "CLAW" ? data.initialDollMeter : 0,
        installedAt: data.installedAt ? new Date(data.installedAt) : null,
        notes: data.notes,
      },
    });

    // create INITIAL event so continuity works
    await prisma.cfCollectionEvent.create({
      data: {
        orgId: session.user.org_id,
        sessionId: null,
        machineId: m.id,
        eventType: "INITIAL",
        collectedAt: new Date(),
        collectedById: session.user.id,
        coinMeterBefore: data.initialCoinMeter,
        coinMeterAfter: data.initialCoinMeter,
        cashCountedCents: 0,
        dollMeterBefore: data.kind === "CLAW" ? data.initialDollMeter : null,
        dollMeterAfter: data.kind === "CLAW" ? data.initialDollMeter : null,
        stockBefore: data.kind === "CLAW" ? 0 : null,
        stockAfter: data.kind === "CLAW" ? 0 : null,
        refillQty: data.kind === "CLAW" ? 0 : null,
        notes: "เริ่มต้นตู้",
      },
    });
    revalidatePath("/clawfleet/machines");
    return ok({ id: m.id });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return fail("รหัสตู้ซ้ำ", "DUPLICATE");
    return fail(`สร้างตู้ไม่สำเร็จ: ${(e as Error).message}`);
  }
}

export async function updateMachineActive(
  machineId: string,
  isActive: boolean,
): Promise<Result> {
  const session = await assertCanManageMachine(machineId);
  await prisma.cfMachine.update({
    where: { id: machineId, orgId: session.user.org_id },
    data: { isActive, retiredAt: isActive ? null : new Date() },
  });
  revalidatePath("/clawfleet/machines");
  return ok();
}

// =============================================================
// PRODUCTS
// =============================================================

export async function createProduct(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateProductSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const session = await assertCfAdmin();
  try {
    const p = await prisma.cfProduct.create({
      data: { orgId: session.user.org_id, ...parsed.data },
    });
    revalidatePath("/clawfleet/products");
    return ok({ id: p.id });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return fail("SKU ซ้ำ", "DUPLICATE");
    return fail(`สร้างสินค้าไม่สำเร็จ: ${(e as Error).message}`);
  }
}

// =============================================================
// GROUPS
// =============================================================

export async function createGroup(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateGroupSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanAccessBranch(data.branchId);
  if (!isCfAdmin(session.user.role) && session.user.role !== "branch_manager") {
    return fail("ไม่มีสิทธิ์สร้างกลุ่ม");
  }
  try {
    const g = await prisma.cfMachineGroup.create({
      data: {
        orgId: session.user.org_id,
        branchId: data.branchId,
        name: data.name,
        exchangerId: data.exchangerId,
        toleranceBps: data.toleranceBps,
      },
    });
    // attach exchanger to group
    if (data.exchangerId) {
      await prisma.cfMachine.update({
        where: { id: data.exchangerId, orgId: session.user.org_id },
        data: { groupId: g.id },
      });
    }
    revalidatePath("/clawfleet/groups");
    return ok({ id: g.id });
  } catch (e) {
    return fail(`สร้างกลุ่มไม่สำเร็จ: ${(e as Error).message}`);
  }
}

export async function addMachineToGroup(machineId: string, groupId: string): Promise<Result> {
  const session = await assertCanManageMachine(machineId);
  // verify group same branch
  const group = await prisma.cfMachineGroup.findFirst({
    where: { id: groupId, orgId: session.user.org_id },
    select: { branchId: true },
  });
  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId: session.user.org_id },
    select: { branchId: true },
  });
  if (!group || !machine) return fail("ไม่พบข้อมูล");
  if (group.branchId !== machine.branchId) return fail("ตู้ต้องอยู่สาขาเดียวกับกลุ่ม");
  await prisma.cfMachine.update({
    where: { id: machineId },
    data: { groupId },
  });
  revalidatePath("/clawfleet/groups");
  return ok();
}

// =============================================================
// LOADOUTS
// =============================================================

export async function setMachineLoadout(input: unknown): Promise<Result> {
  const parsed = SetMachineLoadoutSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanManageMachine(data.machineId);
  // verify machine is CLAW
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId: session.user.org_id },
    select: { kind: true },
  });
  if (!machine || machine.kind !== "CLAW") return fail("ตั้ง loadout ได้เฉพาะตู้คีบ");
  await prisma.$transaction([
    prisma.cfMachineLoadout.updateMany({
      where: { machineId: data.machineId, effectiveTo: null },
      data: { effectiveTo: new Date() },
    }),
    prisma.cfMachineLoadout.create({
      data: {
        orgId: session.user.org_id,
        machineId: data.machineId,
        productId: data.productId,
        pricePerPlayCoins: data.pricePerPlayCoins,
        setById: session.user.id,
        notes: data.notes,
      },
    }),
  ]);
  revalidatePath(`/clawfleet/machines`);
  return ok();
}

export async function setExchangerLoadout(input: unknown): Promise<Result> {
  const parsed = SetExchangerLoadoutSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanManageMachine(data.machineId);
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId: session.user.org_id },
    select: { kind: true },
  });
  if (!machine || machine.kind !== "EXCHANGER") return fail("ตั้งได้เฉพาะตู้แลก");
  await prisma.$transaction([
    prisma.cfExchangerLoadout.updateMany({
      where: { machineId: data.machineId, effectiveTo: null },
      data: { effectiveTo: new Date() },
    }),
    prisma.cfExchangerLoadout.create({
      data: {
        orgId: session.user.org_id,
        machineId: data.machineId,
        baseCoinPerBaht: data.baseCoinPerBaht,
        promoTiers: data.promoTiers,
        setById: session.user.id,
        notes: data.notes,
      },
    }),
  ]);
  revalidatePath(`/clawfleet/machines`);
  return ok();
}

// =============================================================
// SESSIONS
// =============================================================

export async function startSession(input: unknown): Promise<Result<{ id: string; code: string }>> {
  const parsed = StartSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const session = await requireSession();
  // verify group accessible
  const group = await prisma.cfMachineGroup.findFirst({
    where: { id: parsed.data.groupId, orgId: session.user.org_id },
    select: { branchId: true, isActive: true },
  });
  if (!group) return fail("ไม่พบกลุ่ม");
  await assertCanAccessBranch(group.branchId);
  if (!group.isActive) return fail("กลุ่มถูกปิดใช้งาน");

  // gen code via RPC
  const admin = adminClient();
  const { data: codeData, error: codeErr } = await admin.rpc("cf_next_session_code", {
    p_org_id: session.user.org_id,
  });
  if (codeErr) return fail(`รหัสรอบ: ${codeErr.message}`);
  const sessionCode = codeData as string;

  try {
    const s = await prisma.cfCollectionSession.create({
      data: {
        orgId: session.user.org_id,
        groupId: parsed.data.groupId,
        sessionCode,
        openedById: session.user.id,
        status: "OPEN",
      },
    });
    revalidatePath("/clawfleet/sessions");
    return ok({ id: s.id, code: s.sessionCode });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return fail("มี session ที่เปิดอยู่แล้วในกลุ่มนี้", "DUPLICATE_OPEN");
    }
    return fail(`เปิด session ไม่สำเร็จ: ${(e as Error).message}`);
  }
}

export async function submitEvent(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = SubmitEventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanAccessMachine(data.machineId);

  // verify machine + session + QR token
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId: session.user.org_id, isActive: true },
    include: {
      loadouts: {
        where: { effectiveTo: null },
        take: 1,
        orderBy: { effectiveFrom: "desc" },
      },
    },
  });
  if (!machine) return fail("ไม่พบตู้");
  if (machine.qrToken !== data.qrToken) return fail("QR ไม่ตรงกับตู้นี้ · กรุณาสแกนตู้ใหม่", "QR_MISMATCH");

  // verify session OPEN
  const cfSession = await prisma.cfCollectionSession.findFirst({
    where: { id: data.sessionId, orgId: session.user.org_id, status: "OPEN" },
    include: { group: { select: { id: true, branchId: true } } },
  });
  if (!cfSession) return fail("Session ไม่อยู่ใน OPEN");
  if (machine.groupId && machine.groupId !== cfSession.groupId)
    return fail("ตู้ไม่อยู่ในกลุ่มของ session นี้");

  // photo F1 check (ตู้คีบ 4 ใบ · ตู้แลก 3 ใบ)
  const photoCheck = validatePhotos(machine.kind, {
    photoMeterBeforeUrl: data.photoMeterBeforeUrl,
    photoCashUrl: data.photoCashUrl,
    photoMeterAfterUrl: data.photoMeterAfterUrl,
    photoStockUrl: data.photoStockUrl,
  });
  if (!photoCheck.ok) return fail(photoCheck.reason, "PHOTO_MISSING");

  // derive validation
  const cashPerCoin = machine.kind === "CLAW" && machine.loadouts[0]
    ? machine.loadouts[0].pricePerPlayCoins * 1000
    : 1000; // default 1 coin = ฿10

  // A1 baseline — 30-day median revenue for this machine
  // (QA Phase 2 follow-up: wire previously-dead anomaly rule)
  const medianRow = await prisma.$queryRaw<{ median: number | null }[]>`
    SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cash_counted_cents))::int as median
    FROM cf_collection_events
    WHERE machine_id = ${machine.id}::uuid
      AND event_type = 'COLLECTION'
      AND collected_at > NOW() - INTERVAL '30 days'
  `;
  const medianRevenueCents = medianRow[0]?.median ?? null;

  const derived = deriveEvent({
    kind: machine.kind,
    coinMeterBefore: machine.lastCoinMeter,
    coinMeterAfter: data.coinMeterAfter,
    cashCountedCents: data.cashCountedCents,
    dollMeterBefore: machine.lastDollMeter,
    dollMeterAfter: data.dollMeterAfter ?? null,
    stockBefore: data.stockBefore ?? null,
    stockAfter: data.stockAfter ?? null,
    refillQty: data.refillQty ?? null,
    promoCoinsDispensed: data.promoCoinsDispensed ?? null,
    cashPerCoinCents: cashPerCoin,
    medianRevenueCents,
  });

  if (derived.blockReason) return fail(derived.blockReason, "VALIDATION_BLOCK");

  // duplicate guard — same machine + session
  const dup = await prisma.cfCollectionEvent.findFirst({
    where: { sessionId: data.sessionId, machineId: data.machineId, eventType: "COLLECTION" },
    select: { id: true },
  });
  if (dup) return fail("ตู้นี้กรอกใน session นี้ไปแล้ว", "DUPLICATE_EVENT");

  // INSERT event + auto stock movement (LOAD_TO_MACHINE) if refill
  try {
    const result = await prisma.$transaction(async (tx) => {
      const ev = await tx.cfCollectionEvent.create({
        data: {
          orgId: session.user.org_id,
          sessionId: data.sessionId,
          machineId: data.machineId,
          eventType: "COLLECTION",
          collectedAt: new Date(),
          collectedById: session.user.id,
          coinMeterBefore: machine.lastCoinMeter,
          coinMeterAfter: data.coinMeterAfter,
          cashCountedCents: data.cashCountedCents,
          dollMeterBefore: machine.kind === "CLAW" ? machine.lastDollMeter : null,
          dollMeterAfter: data.dollMeterAfter ?? null,
          stockBefore: data.stockBefore ?? null,
          stockAfter: data.stockAfter ?? null,
          refillQty: data.refillQty ?? null,
          promoCoinsDispensed: data.promoCoinsDispensed ?? null,
          photoMeterBeforeUrl: data.photoMeterBeforeUrl,
          photoCashUrl: data.photoCashUrl,
          photoMeterAfterUrl: data.photoMeterAfterUrl,
          photoStockUrl: data.photoStockUrl,
          anomalyFlags: derived.flags,
          notes: data.notes,
        },
      });

      // LOAD_TO_MACHINE if CLAW + refill > 0
      if (
        machine.kind === "CLAW" &&
        data.refillQty &&
        data.refillQty > 0 &&
        machine.loadouts[0]
      ) {
        await tx.cfStockMovement.create({
          data: {
            orgId: session.user.org_id,
            branchId: machine.branchId,
            type: "LOAD_TO_MACHINE",
            productId: machine.loadouts[0].productId,
            machineId: machine.id,
            qty: -data.refillQty,
            refTable: "cf_collection_events",
            refId: ev.id,
            occurredAt: new Date(),
            createdById: session.user.id,
            reason: "เติมตุ๊กตาเข้าตู้",
          },
        });
      }
      return ev;
    });
    revalidatePath(`/clawfleet/sessions/${data.sessionId}`);
    return ok({ id: result.id });
  } catch (e) {
    return fail(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
  }
}

export async function closeSession(input: unknown): Promise<Result<{ status: string; flags: string[] }>> {
  const parsed = CloseSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await requireSession();

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { id: data.sessionId, orgId: session.user.org_id },
    include: {
      group: {
        select: {
          branchId: true,
          machines: { where: { isActive: true }, select: { id: true, kind: true } },
        },
      },
      events: { select: { id: true, machineId: true, eventType: true } },
    },
  });
  if (!cf) return fail("ไม่พบ session");
  if (cf.status !== "OPEN") return fail("Session ไม่อยู่ใน OPEN");
  // Legacy close flow is group-scoped (branch-level v2 sessions close elsewhere).
  if (!cf.group) return fail("Session นี้ไม่มีกลุ่ม · ปิดผ่านระบบ v2");
  await assertCanAccessBranch(cf.group.branchId);

  // G7 check: must have all active machines collected
  const machineCount = cf.group.machines.length;
  const collectedCount = cf.events.filter((e) => e.eventType === "COLLECTION").length;
  if (collectedCount < machineCount) {
    return fail(
      `เก็บไม่ครบ · กรอก ${collectedCount}/${machineCount} ตู้`,
      "G7_INCOMPLETE",
    );
  }

  try {
    // P1-4 fix: trigger may rewrite status=ANOMALY_REVIEW · Prisma return shows the value Prisma sent
    // not what trigger landed. Refetch after update.
    await prisma.cfCollectionSession.update({
      where: { id: data.sessionId, status: "OPEN" }, // P0-5 fix: atomic guard prevents double-close
      data: {
        status: "CLOSED",
        closedById: session.user.id,
        reviewNote: data.reviewNote,
      },
    });
    const refetched = await prisma.cfCollectionSession.findUniqueOrThrow({
      where: { id: data.sessionId },
      select: { status: true, anomalyFlags: true },
    });
    revalidatePath(`/clawfleet/sessions/${data.sessionId}`);
    revalidatePath("/clawfleet/dashboard");
    return ok({ status: refetched.status, flags: refetched.anomalyFlags });
  } catch (e) {
    // Trigger may raise G2/G7
    return fail(`ปิด session ไม่สำเร็จ: ${(e as Error).message}`, "TRIGGER_BLOCK");
  }
}

export async function reviewSession(input: unknown): Promise<Result> {
  const parsed = ReviewSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanReviewSession(data.sessionId);

  await prisma.cfCollectionSession.update({
    where: { id: data.sessionId, orgId: session.user.org_id },
    data: {
      status: data.decision === "APPROVE" ? "LOCKED" : "OPEN",
      reviewerId: session.user.id,
      reviewedAt: new Date(),
      reviewNote: data.reviewNote,
    },
  });
  revalidatePath(`/clawfleet/sessions/${data.sessionId}`);
  revalidatePath("/clawfleet/anomalies");
  return ok();
}

// =============================================================
// STOCK
// =============================================================

export async function stockReceive(input: unknown): Promise<Result> {
  const parsed = StockReceiveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanAccessBranch(data.branchId);

  await prisma.cfStockMovement.create({
    data: {
      orgId: session.user.org_id,
      branchId: data.branchId,
      type: "RECEIVE",
      productId: data.productId,
      qty: data.qty,
      unitCostCents: data.unitCostCents,
      receiptR2Key: data.receiptR2Key,
      reason: data.notes,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
      createdById: session.user.id,
    },
  });
  revalidatePath(`/clawfleet/stock`);
  return ok();
}

export async function stockCountBatch(input: unknown): Promise<Result<{ counted: number; flagged: number }>> {
  const parsed = StockCountBatchSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;
  const session = await assertCanAccessBranch(data.branchId);

  let flagged = 0;
  const productIds = data.counts.map((c) => c.productId);
  // sum existing balance per product
  const balances = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: {
      orgId: session.user.org_id,
      branchId: data.branchId,
      productId: { in: productIds },
    },
    _sum: { qty: true },
  });
  const expectedBy = new Map(balances.map((b) => [b.productId, b._sum.qty ?? 0]));

  for (const c of data.counts) {
    const expected = expectedBy.get(c.productId) ?? 0;
    const variance = expected - c.actualQty;
    const absV = Math.abs(variance);
    const pctV = expected > 0 ? absV / expected : 0;
    const isFlagged = absV > 10 || pctV > 0.05;
    if (isFlagged) flagged += 1;
    // COUNT_SNAPSHOT is a marker (qty=0) — doesn't change balance
    // ADJUST does the actual delta so balance sum stays correct
    // P0 fix (P2-21): previously COUNT_SNAPSHOT.qty=actual + ADJUST.qty=(actual-expected) double-counted
    await prisma.cfStockMovement.create({
      data: {
        orgId: session.user.org_id,
        branchId: data.branchId,
        type: "COUNT_SNAPSHOT",
        productId: c.productId,
        qty: 0, // marker only
        expectedQty: expected,
        varianceQty: variance,
        reason: c.reason ?? `นับได้ ${c.actualQty} · คาด ${expected}`,
        occurredAt: new Date(),
        createdById: session.user.id,
      },
    });
    // ADJUST closes the gap: -variance means actual now == expected + (-variance) = actual
    if (variance !== 0) {
      await prisma.cfStockMovement.create({
        data: {
          orgId: session.user.org_id,
          branchId: data.branchId,
          type: "ADJUST",
          productId: c.productId,
          qty: -variance,
          reason: c.reason ?? "ปรับให้ตรงนับจริง",
          occurredAt: new Date(),
          createdById: session.user.id,
        },
      });
    }
  }
  revalidatePath(`/clawfleet/stock`);
  return ok({ counted: data.counts.length, flagged });
}

// =============================================================
// Generic helpers — small zod parser for action wrappers
// =============================================================
export async function actionFromFormData<T>(
  schema: z.ZodType<T>,
  fd: FormData,
): Promise<T | null> {
  const obj: Record<string, FormDataEntryValue | string> = {};
  for (const [k, v] of fd.entries()) {
    obj[k] = typeof v === "string" ? v : v.name;
  }
  const res = schema.safeParse(obj);
  return res.success ? res.data : null;
}
