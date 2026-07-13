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
import { zUUID } from "@/lib/zod-helpers";
import { userBranchIds, assertCfAdmin, isCfAdmin, isCfBranchManager, cfHasAdminPower } from "./role-guard";
import { getClawfleetPolicy } from "./policy";
import {
  StartBranchSessionSchema,
  SubmitBranchEventSchema,
  SubmitRefillOnlySchema,
  CloseBranchSessionSchema,
  StartGroupSessionSchema,
  SubmitExchangerEventSchema,
  CloseGroupSessionSchema,
  DEFAULTS,
  ANOMALY_FLAGS,
  FLAG_SEVERITY,
  type AnomalyFlag,
} from "./types";
import { deriveEvent, deriveBranchCrossCheck } from "./validation";
import { computeCfDrift } from "./drift";
import { getBranchMainWarehouseId } from "./stock-queries";

type Result = { ok: true } | { ok: false; error: string };
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };
// N5 soft-gate: server คำนวณ SHORT แล้วยังไม่มีเหตุผล → คืน needsReason (ไม่ใช่ error แข็ง)
// ให้จอมือถือเด้ง dropdown เหตุผล แล้วส่งซ้ำพร้อม shortReason.
type SubmitBranchEventResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string; needsReason?: boolean };

// R4 sentinel — โยนจากใน $transaction เมื่อเติมเกินสต๊อกคลังสาขา · catch แปลงเป็น
// error ข้อความชัด (แยกจาก DB error ทั่วไป) แล้ว rollback ทั้งก้อน (ไม่ตัดสต๊อกครึ่ง ๆ).
class CfOverIssueError extends Error {}

// รูปที่แนบทีหลัง — รับ url จริง (http) เท่านั้น · ค่าว่าง = ไม่ส่ง (ข้าม)
const zAttachUrl = z.union([z.string().url(), z.literal("")]);

// ── "รูปยังไม่ครบ" (photos incomplete) — derived · ไม่มี schema flag ──────────
// นับ "รูปหลักฐานที่คาดว่าต้องมี" ที่ยัง null สำหรับ event (photosPurgedAt ต้อง null ก่อนเรียก).
// รูปเงินสด (photoCashUrl) = optional ไม่นับ (CEO 2026-07-11 "เงินสดไม่ต้องถ่าย").
//  - COLLECTION: มิเตอร์เหรียญ + มิเตอร์ตุ๊กตา + สต็อกก่อนเติม + สต็อกหลังเติม (4 ช่อง)
//  - INITIAL/baseline: 4 รูปมิเตอร์กายภาพ + รูปตู้ (ไม่นับ photoStockUrl — baseline ไม่มีช่องถ่ายรูปสต็อก)
// ⚠️ ต้องตรงกับ HistoryPanel (page.tsx) + office chip (collections-client) เป๊ะ (ใช้ label/คอลัมน์ชุดเดียวกัน).
function deriveEventPhotoCompleteness(
  eventType: string,
  cols: Record<string, string | null>,
): { missingCount: number; expectedCount: number } {
  const expectedCols =
    eventType === "INITIAL"
      ? [
          "photoMoneyMeterTopUrl",
          "photoMoneyMeterBottomUrl",
          "photoDollMeterTopUrl",
          "photoDollMeterBottomUrl",
          "photoMachineUrl",
        ]
      : ["photoMeterAfterUrl", "photoPrizeMeterUrl", "photoStockUrl", "photoMeterBeforeUrl"];
  let missingCount = 0;
  for (const c of expectedCols) if (cols[c] == null) missingCount++;
  return { missingCount, expectedCount: expectedCols.length };
}

// ── นโยบาย "มิเตอร์ต้องตรง" (meterMatch · Wave 4b) ─────────────────────────
// เมื่อเจ้าของเปิดสวิตช์ meterMatch (policy.meterMatch) → รอบที่ปิดแล้วมีธง "เกี่ยวกับมิเตอร์"
// (มิเตอร์ไม่ต่อเนื่อง/ถอยหลัง · มิเตอร์ไม่ขยับแต่มีเงิน · ตุ๊กตาออกแต่เหรียญไม่ขยับ ·
//  เหรียญขยับแต่ตุ๊กตาไม่ออก · เหรียญตู้แลก vs ตู้คีบไม่ตรง) → บังคับ status = ANOMALY_REVIEW.
// ⚠️ ADDITIVE ONLY — ถ้า ON ทำได้แค่ "escalate ให้คนตรวจ" (เข้มขึ้น) · ห้ามปลด/ผ่อนการตรวจใด ๆ
//    (ไม่มี case ที่ ON แล้ว status กลับจาก ANOMALY_REVIEW → CLOSED). ไม่ hard-block submit —
//    รอบยังปิดได้ แค่ต้องผ่านการตรวจก่อน LOCK. OFF = พฤติกรรมเดิมทุกประการ.
// เก็บเป็น Set<string> — รับทั้ง AnomalyFlag (typed) และ string[] จากคอลัมน์ anomalyFlags ใน DB
// (ตอน read-back หลัง trigger) โดยไม่ต้อง cast กลบชนิด · ค่าที่ไม่ใช่ธงมิเตอร์ = has()→false ปลอดภัย.
const METER_ANOMALY_FLAGS: ReadonlySet<string> = new Set<string>([
  ANOMALY_FLAGS.C1_CONTINUITY_BREAK, // มิเตอร์ไม่ต่อจากรอบก่อน
  ANOMALY_FLAGS.C2_METER_REGRESS, // มิเตอร์ถอยหลัง
  ANOMALY_FLAGS.M5_METER_NO_MOVE_BUT_CASH, // มิเตอร์ไม่ขยับแต่มีเงิน
  ANOMALY_FLAGS.P4_DOLL_NO_COIN, // ตุ๊กตาออกแต่เหรียญไม่ขยับ
  ANOMALY_FLAGS.P5_COIN_NO_DOLL, // เหรียญขยับ ตุ๊กตาไม่ออก
  ANOMALY_FLAGS.COIN_GROUP_MISMATCH, // เหรียญตู้แลก vs ตู้คีบ ไม่ตรง
]);

/**
 * เมื่อ meterMatch เปิด + รอบมีธงเกี่ยวกับมิเตอร์ → ยกระดับ status เป็น ANOMALY_REVIEW.
 * คืน status เดิมทุกกรณีอื่น (ปิด policy · ไม่มีธงมิเตอร์ · เป็น ANOMALY_REVIEW อยู่แล้ว).
 */
function escalateForMeterMatch(
  meterMatchOn: boolean,
  status: "CLOSED" | "ANOMALY_REVIEW",
  flags: readonly string[],
): "CLOSED" | "ANOMALY_REVIEW" {
  if (!meterMatchOn || status === "ANOMALY_REVIEW") return status;
  return flags.some((f) => METER_ANOMALY_FLAGS.has(f)) ? "ANOMALY_REVIEW" : status;
}

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
      status: true,
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

  // A1 (audit 2026-07-01 · CEO เคาะ "แอดมิน+ผจก.อนุมัติ"): ตรวจ/อนุมัติ/ปิดล็อกรอบผิดปกติ
  // = ผู้จัดการสาขา + แอดมิน เท่านั้น (กันพนักงานเก็บเงิน/viewer อนุมัติกันเองปิดคดีโกง).
  // เดิมเช็คแค่ requireSession + สิทธิ์สาขา → staff ในสาขาเดียวกันกด approve ได้.
  if (!isCfAdmin(session.user.role) && !isCfBranchManager(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่ตรวจ/อนุมัติรอบได้" };
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

  // R4 (ultrareview 2026-07-01 · idempotency): อนุมัติ/ตรวจได้เฉพาะรอบที่ปิดแล้วรอตรวจ
  // (CLOSED/ANOMALY_REVIEW) เท่านั้น. เดิม update where:{id} เฉย ๆ → กด 2 ครั้ง หรือรอบที่
  // ถูก LOCKED/OPEN ไปแล้วยังโดนเขียนทับสถานะได้ (เปิด LOCKED กลับมา OPEN = แก้ตัวเลขได้อีก).
  if (cf.status !== "CLOSED" && cf.status !== "ANOMALY_REVIEW") {
    return { ok: false, error: "รอบนี้ถูกตรวจไปแล้ว หรือสถานะไม่ถูกต้อง" };
  }

  try {
    // R7 (audit): บันทึกใครตรวจ/ตัดสินใจอะไร ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ
    await prisma.$transaction(async (tx) => {
      const upd = await tx.cfCollectionSession.updateMany({
        // guard สถานะซ้ำใน where ด้วย → ถ้ามีอีก request ชิงตัดหน้า count=0
        where: { id: cf.id, orgId, status: { in: ["CLOSED", "ANOMALY_REVIEW"] } },
        data: {
          status,
          reviewerId: session.user.id,
          reviewedAt: new Date(),
          reviewNote,
        },
      });
      if (upd.count === 0) {
        throw new Error("รอบนี้ถูกตรวจไปแล้ว หรือสถานะไม่ถูกต้อง");
      }
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: `CF_REVIEW_${decision.toUpperCase()}`,
          resourceType: "CF_SESSION",
          resourceId: cf.id,
          diff: {
            old: { status: cf.status },
            new: { status, reviewNote },
          },
        },
      });
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message || "ตรวจรอบไม่สำเร็จ" };
  }

  revalidatePath("/clawfleet/os/collections");
  revalidatePath("/clawfleet/os/dashboard");
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
    revalidatePath("/clawfleet/os/collections");
    revalidatePath("/clawfleet/os/dashboard");
    return { ok: true, data: { id: s.id, code: s.sessionCode } };
  } catch (e) {
    // G1 (audit 2026-07-01): unique index cf_sessions_one_open_per_branch ชน (2 คนเปิดรอบสาขา
    // เดียวกันพร้อมกัน) → P2002 = มีรอบเปิดอยู่แล้ว · ดึงมา resume แทน error (กัน 2 OPEN/สาขา)
    if ((e as { code?: string }).code === "P2002") {
      const ex = await prisma.cfCollectionSession.findFirst({
        where: { orgId, branchId, status: "OPEN" },
        select: { id: true, sessionCode: true },
      });
      if (ex) return { ok: true, data: { id: ex.id, code: ex.sessionCode } };
    }
    return { ok: false, error: `เปิดรอบไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/** กรอกข้อมูล 1 ตู้คีบในรอบสาขา (5 รูป · มิเตอร์ก่อนดึงจากระบบ) */
export async function submitBranchEvent(input: unknown): Promise<SubmitBranchEventResult> {
  const parsed = SubmitBranchEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  // เติมตุ๊กตา "หลาย SKU" — ยอดเติมรวม = ผลบวกทุกไลน์ (ใช้ในกระทบยอด + เก็บ event.refillQty เดียว
  // → คณิตศาสตร์ "ตุ๊กตาหาย" เดิมไม่พัง). ไม่ส่ง refillLines (จอเก่า/เติม SKU เดียว) → fallback เดิม.
  const refillLines: { productId: string; qty: number; warehouseId?: string }[] =
    data.refillLines && data.refillLines.length > 0
      ? data.refillLines
      : data.refillProductId && data.refillQty > 0
        ? [{ productId: data.refillProductId, qty: data.refillQty, warehouseId: data.warehouseId }]
        : [];
  const effectiveRefillQty =
    refillLines.length > 0 ? refillLines.reduce((s, l) => s + l.qty, 0) : data.refillQty;

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

  // รูป = ตัวเลือกทั้งหมด (CEO 2026-07-11 "เงินสดไม่ต้องถ่ายรูป"). เดิม A5 บังคับรูปเงินสดเมื่อ
  // policy.photoRequired เปิด → ทำให้ "กดส่งไม่ผ่าน" ทั้งที่จอบอกว่ารูปไม่บังคับ (client/server ไม่ตรง)
  // แล้ว error จริงถูกกลบเป็น "เช็คสัญญาณเน็ต" → เอาด่านบังคับรูปเงินสดออก ไม่บล็อกการส่งอีก.

  // P1 (audit 2026-07-08): server-side baseline guard. กฏ "ต้องตั้ง baseline ก่อนเก็บเงิน"
  // เดิมบังคับเฉพาะฝั่งจอ (staff-app route ตู้ AWAITING_SETUP ไปฟอร์ม baseline) — action นี้
  // เป็น raw POST ยิงตรงได้ → ตู้ที่ไม่เคยตั้ง baseline เก็บเงินแบบ round-1 (verdict ถูกกด) ตลอดชีพ
  // → SHORT/OVER ไม่เด้ง เงินหายเงียบ. รอบ baseline จัดการโดย submitFirstBaseline เท่านั้น (คนล็อก);
  // action นี้รับเฉพาะรอบ 2+ (ตู้ที่ล็อกแล้ว). staff-app route ตู้ที่ยังไม่ล็อกไป BaselineForm อยู่แล้ว → สอดคล้อง.
  if (!machine.isFirstBaselineLocked) {
    return { ok: false, error: "ตู้นี้ยังไม่ได้ตั้งค่าครั้งแรก · ต้องทำ baseline ก่อนเก็บเงิน" };
  }

  const cashPerCoin = machine.loadouts[0]
    ? machine.loadouts[0].pricePerPlayCoins * 1000
    : CASH_PER_PLAY_CENTS;

  // A2/A3 (audit 2026-07-01): ใช้สต๊อกตุ๊กตา "ก่อน" จากค่าจริงในระบบ (machine.lastDollStock ที่
  // trigger cf_update_machine_mirror เขียนไว้ = stock_after ของรอบก่อน) เป็น baseline ของ
  // การกระทบยอด — ไม่เชื่อ data.stockBefore จาก client (ปลอมได้ → ปั่น "ตุ๊กตาหาย=0" ผ่านได้).
  // ผลพลอยได้: ปิดช่อง cross-round (ตุ๊กตาหายระหว่างรอบตอนตู้ว่าง) เพราะ baseline = ยอดจริงรอบก่อน.
  // ชิ้น 3 (CEO 2026-07-13) · กระทบยอดต้องรู้การเติม/เอาออกตุ๊กตา "ระหว่างรอบ" (quick actions
  // refillDollsToMachine / returnDollsToStock ที่พนักงานทำตอนไม่มีเวลาทำรอบเต็ม). movement เหล่านี้
  // ไม่อัปเดต lastDollStock (trigger ยิงเฉพาะ collection event) → baseline เดิมจะพลาดของที่เติม/เอาออก
  // ระหว่างทาง → "ตุ๊กตาที่ลูกค้าคีบได้" เพี้ยน. ดึงมาบวกเข้า baseline (server-side · ไม่เชื่อ client):
  //   in-machine delta ต่อ movement = −qty (LOAD qty ลบ → +ในตู้ · return ADJUST qty บวก → −ในตู้)
  //   นับเฉพาะ occurredAt > lastEventAt (หลังรอบก่อน) + refTable ∈ quick actions (ไม่ใช่ cf_collection_events)
  //   → นับครั้งเดียว (รอบถัดไปเริ่มนับจาก event รอบนี้เป็นต้นไป · ledger เก่าไม่ถูกนับซ้ำ).
  let stockBaseline = machine.lastDollStock;
  if (machine.lastEventAt) {
    const interimAgg = await prisma.cfStockMovement.aggregate({
      where: {
        orgId,
        machineId: machine.id,
        occurredAt: { gt: machine.lastEventAt },
        // ทุก action ที่เติมตุ๊กตาเข้าตู้ "นอกรอบเก็บเงิน" (money-review 2026-07-13):
        //   cf_refill_dolls (เติมอย่างเดียว) · cf_return_dolls (เอาออก/เปลี่ยน) ·
        //   cf_setup_product (ผจก.เพิ่มสินค้า/ยอดตุ๊กตาในตู้ที่ล็อกแล้วระหว่างรอบ — LOAD machineId=ตู้)
        // ไม่รวม cf_collection_events (การเติมของรอบนี้ นับผ่าน effectiveRefillQty แล้ว).
        refTable: { in: ["cf_refill_dolls", "cf_return_dolls", "cf_setup_product"] },
      },
      _sum: { qty: true },
    });
    stockBaseline += -(interimAgg._sum.qty ?? 0); // +เติมระหว่างทาง −เอาออกระหว่างทาง
  }

  // A1 baseline (30-day median revenue for this machine)
  const medianRow = await prisma.$queryRaw<{ median: number | null }[]>`
    SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cash_counted_cents))::int as median
    FROM cf_collection_events
    WHERE machine_id = ${machine.id}::uuid
      AND event_type = 'COLLECTION'
      AND collected_at > NOW() - INTERVAL '30 days'`;
  const medianRevenueCents = medianRow[0]?.median ?? null;

  // FOUNDATION (blueprint §2): drift ผ่าน computeCfDrift ตัวเดียว (wrap deriveEvent · math เดิม).
  // round-1 (ตู้ยังไม่ล็อก baseline) → verdict = null (revenue ยังนับ · short/over ถูกกด).
  const isBaselineRound = !machine.isFirstBaselineLocked;
  const derived = computeCfDrift({
    kind: "CLAW",
    coinMeterBefore: machine.lastCoinMeter, // KEEP mirror (ไม่ใช่ odometer ดิบ)
    coinMeterAfter: data.coinMeterAfter,
    cashCountedCents: data.cashCountedCents,
    dollMeterBefore: machine.lastDollMeter,
    dollMeterAfter: data.dollMeterAfter,
    stockBefore: stockBaseline, // A2/A3: ค่าจริงในระบบ ไม่ใช่ data.stockBefore จาก client
    stockAfter: data.stockAfter,
    refillQty: effectiveRefillQty, // ยอดเติมรวมทุก SKU
    cashPerCoinCents: cashPerCoin,
    medianRevenueCents,
    isBaselineRound,
  });
  // blockReason = data-integrity (C2/M5/P4) → บล็อกแม้ round-1 (ตัวเลขอ่านผิด)
  if (derived.blockReason) return { ok: false, error: derived.blockReason };

  // N5 (blueprint §2 N5): server เป็นคนตัดสิน SHORT/OVER (ไม่เชื่อ client).
  // verdict=SHORT + ยังไม่ให้เหตุผล → soft gate: คืน needsReason ให้จอเด้ง dropdown.
  // verdict=OVER → รับได้ + บันทึก override marker (ธง M4/M6 มีอยู่แล้ว · เติม note).
  // round-1 (verdict=null) → ไม่มี gate.
  const shortReason = data.shortReason?.trim() || null;
  const eventFlags: string[] = [...derived.flags];
  let eventNotes = data.notes ?? null;
  if (derived.verdict === "SHORT" && !shortReason) {
    return { ok: false, error: "เงินขาด · เลือกเหตุผลก่อนบันทึก", needsReason: true };
  }
  if (derived.verdict === "OVER") {
    // override marker — เงินเกินผ่านได้เงียบ ๆ แต่บันทึกไว้ว่ารับทั้งที่เกิน
    const overNote = "[OVERRIDE] เงินเกิน · รับโดยไม่บล็อก";
    eventNotes = eventNotes ? `${eventNotes}\n${overNote}` : overNote;
  }

  const dup = await prisma.cfCollectionEvent.findFirst({
    where: { sessionId: data.sessionId, machineId: data.machineId, eventType: "COLLECTION" },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "ตู้นี้กรอกในรอบนี้ไปแล้ว" };

  // E3 (bigfeature · warehouse) — คลังหลักของสาขา (id · null ถ้ายังไม่ตั้ง → แถว movement เก่านับเป็น
  //   main ผ่าน NULL). อ่านครั้งเดียว ใช้เป็น default ห้องที่หักเมื่อไลน์ไม่ระบุ warehouseId.
  const branchMainId =
    refillLines.length > 0 ? await getBranchMainWarehouseId(orgId, machine.branchId) : null;

  try {
    const ev = await prisma.$transaction(async (tx) => {
      // P0-2b · per-MACHINE lock (additive safety · ไม่แตะ money math ด้านล่างเลย) — serialize
      //   COLLECTION กับ REFILL_ONLY บนตู้เดียวกัน กันสองรอบชนมิลลิวินาที (mirror trigger match 0 แถว).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cf_machine:" + machine.id}))`;
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
          stockBefore: stockBaseline, // A2/A3: server-truth baseline (see above)
          stockAfter: data.stockAfter,
          refillQty: effectiveRefillQty, // ยอดเติมรวมทุก SKU
          // ⚠️ COLUMN→CONTENT MAPPING (column names DON'T match content — no migration to rename).
          // The 5 captured photos are packed into 5 existing columns. When you READ these back,
          // map column → REAL meaning using this table (do NOT trust the column name):
          //   photoMeterAfterUrl   = รูปมิเตอร์เหรียญ (coin meter)   ← data.photoCoinMeterUrl
          //   photoPrizeMeterUrl   = รูปมิเตอร์ตุ๊กตา (prize meter)  ← data.photoPrizeMeterUrl  (name OK)
          //   photoStockUrl        = รูปตุ๊กตาก่อนเติม (stock before) ← data.photoStockBeforeUrl
          //   photoMeterBeforeUrl  = รูปตุ๊กตาหลังเติม (stock after)  ← data.photoStockAfterUrl  (reused slot!)
          //   photoCashUrl         = รูปเงินสด (cash)                ← data.photoCashUrl         (name OK)
          // Read side today only COUNTS non-null photos (queries.ts eventToMachine) — never labels by
          // column name — so this is currently cosmetic. Keep labels in sync with the table above if a
          // per-photo gallery is ever added.
          photoMeterAfterUrl: data.photoCoinMeterUrl,
          photoPrizeMeterUrl: data.photoPrizeMeterUrl,
          photoStockUrl: data.photoStockBeforeUrl,
          photoMeterBeforeUrl: data.photoStockAfterUrl,
          photoCashUrl: data.photoCashUrl,
          anomalyFlags: eventFlags,
          shortReason, // N5: เหตุผลเงินขาด (null เมื่อ OK/OVER/round-1)
          notes: eventNotes,
        },
        select: { id: true },
      });
      // เติมทีละ SKU (แต่ละไลน์ = 1 แถว LOAD_TO_MACHINE · หักคลังห้องที่เลือก · atomic ใน tx เดียว).
      // guard/lock ต่อไลน์เหมือนเดิม — 2 SKU ในไลน์เดียวกันหักคนละล็อก ไม่ชนกัน.
      for (const line of refillLines) {
        // ห้องที่หยิบ: ระบุมา = ห้องนั้น · ไม่ระบุ = คลังหลัก (null = aggregate ยอดทุกห้อง = เดิม)
        const chosenWh = line.warehouseId ?? branchMainId;
        const whFilter: Record<string, unknown> =
          chosenWh == null
            ? {}
            : branchMainId && chosenWh === branchMainId
              ? { OR: [{ warehouseId: chosenWh }, { warehouseId: null }] }
              : { warehouseId: chosenWh };
        // 🔒 advisory-lock ต่อ (branch,ห้อง,สินค้า) — serialize การเติมพร้อมกัน กันอ่านยอดก้อนเดียวแล้วตัดเกิน
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machine.branchId} || ':' || ${chosenWh ?? "MAIN"}), hashtext(${line.productId}))`;
        // R4 over-issue guard — เติมได้ไม่เกิน "ของบนชั้นจริง" (NET) ของสินค้านั้นในห้องที่เลือก.
        // NET = Σ ทุกแถวของสินค้าในห้อง (รับเข้า − โหลดเข้าตู้ − เบิก + คืน) — ไม่ filter machineId.
        // (เดิม machineId:null = GROSS รับเข้ารวม ไม่หักตุ๊กตาที่โหลดเข้าตู้ไปแล้ว → เติมเกินของบนชั้นได้
        //  → net ติดลบ. machine rows แนบ warehouseId ห้องที่โหลด → scope ตาม whFilter ถูกต้องต่อห้อง.)
        const onHandAgg = await tx.cfStockMovement.aggregate({
          where: { orgId, branchId: machine.branchId, productId: line.productId, ...whFilter },
          _sum: { qty: true },
        });
        const shelfOnHand = onHandAgg._sum.qty ?? 0;
        if (line.qty > shelfOnHand) {
          const roomSuffix = line.warehouseId ? " ในคลังที่เลือก" : "";
          throw new CfOverIssueError(
            `ตุ๊กตาบนชั้นไม่พอ${roomSuffix} · บนชั้นมี ${shelfOnHand} ตัว · เติม ${line.qty} ตัวไม่ได้`,
          );
        }
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: machine.branchId,
            type: "LOAD_TO_MACHINE",
            productId: line.productId,
            machineId: machine.id,
            warehouseId: chosenWh, // attribute การตัดให้ห้องที่หยิบ (null = คลังหลัก)
            qty: -line.qty,
            refTable: "cf_collection_events",
            refId: created.id,
            occurredAt: new Date(),
            createdById: session.user.id,
            reason: "เติมตุ๊กตาเข้าตู้",
          },
        });
      }
      // loadout (ราคา/ครั้ง + สินค้าตัวแทนของตู้):
      //   เติม SKU เดียว + ต่างจากของเดิม → ปิดเก่า/เปิดใหม่ (พฤติกรรมเดิม · ราคาคงตามแถวเดิม).
      //   เติมหลาย SKU → แตะเฉพาะถ้าตู้ยังไม่มี loadout เลย (สร้างให้ SKU ที่เติมเยอะสุด · default 1 เหรียญ)
      //   — ไม่ churn ราคาเมื่อมี loadout อยู่แล้ว (หลาย SKU ในตู้ track ผ่าน stock ledger ไม่ใช่ loadout).
      if (refillLines.length > 0) {
        const currentLoadout = machine.loadouts[0] ?? null;
        const now = new Date();
        if (refillLines.length === 1) {
          const only = refillLines[0];
          if (!currentLoadout || currentLoadout.productId !== only.productId) {
            if (currentLoadout) {
              await tx.cfMachineLoadout.update({ where: { id: currentLoadout.id }, data: { effectiveTo: now } });
            }
            await tx.cfMachineLoadout.create({
              data: {
                orgId,
                machineId: machine.id,
                productId: only.productId,
                pricePerPlayCoins: currentLoadout?.pricePerPlayCoins ?? 1,
                effectiveFrom: now,
                setById: session.user.id,
                notes: "ตั้งจากการเติมตุ๊กตา (refill)",
              },
            });
          }
        } else if (!currentLoadout) {
          const primary = [...refillLines].sort((a, b) => b.qty - a.qty)[0];
          await tx.cfMachineLoadout.create({
            data: {
              orgId,
              machineId: machine.id,
              productId: primary.productId,
              pricePerPlayCoins: 1,
              effectiveFrom: now,
              setById: session.user.id,
              notes: "ตั้งจากการเติมตุ๊กตาหลาย SKU (refill)",
            },
          });
        }
      }
      return created;
    });
    revalidatePath("/clawfleet/os/collections");
    return { ok: true, data: { id: ev.id } };
  } catch (e) {
    // R4 over-issue → ข้อความชัด (สต๊อกสาขาไม่พอ) · transaction rollback แล้ว = ไม่มีของตัด
    if (e instanceof CfOverIssueError) {
      return { ok: false, error: e.message };
    }
    // B1 (audit 2026-07-01): unique index กันกรอกตู้ซ้ำในรอบ (กด 2 ครั้ง/retry ชน) →
    // P2002 = DB บังคับ atomic แทน read-then-write (กันนับเงิน+ตัดสต๊อก 2 เท่า)
    if ((e as { code?: string }).code === "P2002") {
      return { ok: false, error: "ตู้นี้กรอกในรอบนี้ไปแล้ว" };
    }
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// =============================================================
// REFILL_ONLY — "เปลี่ยนตุ๊กตาโดยไม่เก็บเงิน" (Option C-mirror · CEO 2026-07-13)
// พนักงานสลับตุ๊กตา: เอาของเก่า N ตัวออกคืนคลัง + เติมของใหม่ M ตัวจากคลัง — ไม่เก็บเงิน · ไม่อ่านมิเตอร์.
//
// MONEY MODEL (LOCKED): baseline การกระทบยอดคือ machine.lastDollStock (mirror ที่ trigger เขียน).
//   stockAfter (→ กลายเป็น mirror ใหม่) = machine.lastDollStock − N + M  (mirror-based · ไม่ใช่ค่านับ stockBefore)
//   → mirror ขยับเฉพาะ "ส่วนที่สลับตั้งใจ" (−N+M) เท่านั้น · การคีบก่อนสลับไม่ถูกดูดกลืน
//     → ยังถูกจับที่รอบ COLLECTION ถัดไป (dispensed = lastDollStock + refill − stockAfter คงเดิม) → ไม่ต้องอ่านมิเตอร์.
//   FREEZE 2 มิเตอร์: coinBefore=coinAfter=lastCoinMeter · dollBefore=dollAfter=lastDollMeter
//     (trigger copy coin_meter_after/doll_meter_after ดิบเข้า mirror → ถ้าไม่ freeze = รีเซ็ตมิเตอร์ → รายได้/ขโมยปลอมรอบหน้า).
//   ไม่มี drift/verdict/SHORT-gate (ไม่มีเงิน · มิเตอร์ไม่ขยับ). guard = stockAfter≥0 · NET over-issue ต่อไลน์เติม · ในตู้≥N ต่อการคืน.
export async function submitRefillOnly(
  input: unknown,
): Promise<ResultOf<{ id: string; stockAfter: number }>> {
  const parsed = SubmitRefillOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const N = data.dollsReturnedToStock;
  const refillLines = data.refillLines ?? [];
  const refillTotal = refillLines.reduce((s, l) => s + l.qty, 0);

  // ไม่มีอะไรให้ทำ (ไม่คืน + ไม่เติม) → reject (กันสร้าง event เปล่าที่ไม่ขยับ mirror)
  if (N === 0 && refillLines.length === 0) {
    return { ok: false, error: "ต้องมีการคืนหรือเติมตุ๊กตาอย่างน้อย 1 อย่าง" };
  }
  // คืน N>0 ต้องระบุว่าคืนสินค้าตัวไหน
  if (N > 0 && !data.returnProductId) {
    return { ok: false, error: "เลือกตุ๊กตาที่จะเอาออก (คืนเข้าคลัง)" };
  }

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
  // baseline ต้องล็อกก่อน (เหมือน submitBranchEvent) — mirror ต้องมี baseline ก่อนถึงจะขยับได้ถูก
  if (!machine.isFirstBaselineLocked) {
    return { ok: false, error: "ตู้นี้ยังไม่ได้ตั้งค่าครั้งแรก · ต้องทำ baseline ก่อน" };
  }

  // Idempotency (pre-tx fast path) — ถ้ากดซ้ำ (clientKey เดิม) เจอ movement เดิม → คืน event เดิม (no-op).
  // ผูก clientKey กับ movement (refTable 'cf_refill_only' · refId=clientKey · documentId=event.id).
  // P2-2: คืน event ที่ผูกกับ clientKey นี้เป๊ะ (ผ่าน documentId) ไม่ใช่ REFILL_ONLY ล่าสุดของตู้ (อาจเป็น clientKey อื่น).
  const existing = await prisma.cfStockMovement.findFirst({
    where: { orgId, branchId: machine.branchId, refTable: "cf_refill_only", refId: data.clientKey },
    select: { documentId: true },
  });
  if (existing?.documentId) {
    const ev = await prisma.cfCollectionEvent.findFirst({
      where: { orgId, machineId: machine.id, id: existing.documentId },
      select: { id: true, stockAfter: true },
    });
    if (ev) return { ok: true, data: { id: ev.id, stockAfter: ev.stockAfter ?? 0 } };
  }

  // stockAfter (→ mirror ใหม่) = mirror − N + M · guard ≥ 0 (กัน mirror ติดลบ)
  const stockAfter = machine.lastDollStock - N + refillTotal;
  if (stockAfter < 0) {
    return {
      ok: false,
      error: `คืน ${N} ตัวมากกว่าจำนวนในระบบ (${machine.lastDollStock}) · ยอดหลังสลับติดลบ`,
    };
  }

  // P0-2: mirror trigger เขียนเฉพาะเมื่อ NEW.collected_at > last_event_at (strict) — ถ้า REFILL_ONLY
  //   ชนมิลลิวินาทีเดียวกับ event ล่าสุด (COLLECTION/REFILL_ONLY อื่น) trigger match 0 แถว → mirror ไม่ขยับ
  //   ทั้งที่ stock movement ลงแล้ว → รอบ COLLECTION ถัดไป dispensed เพี้ยน (−N+M). บังคับ collectedAt
  //   ให้ "ชนะ" event ล่าสุดของตู้อย่างน้อย 1ms เสมอ (คู่กับ per-machine lock ด้านล่างที่ serialize รอบ).
  const collectedAt = new Date(
    Math.max(Date.now(), (machine.lastEventAt ? machine.lastEventAt.getTime() : 0) + 1),
  );

  // คลังหลักของสาขา — default ห้องที่หักเมื่อไลน์เติมไม่ระบุ warehouseId (เหมือน submitBranchEvent)
  const branchMainId =
    refillLines.length > 0 ? await getBranchMainWarehouseId(orgId, machine.branchId) : null;

  try {
    const ev = await prisma.$transaction(async (tx) => {
      // ── P0-1a · LOCK FIRST (ก่อน dup-check) — advisory lock ต่อ clientKey ──
      //   ทำ dup-check ก่อน lock (แบบเดิม) = 2 request clientKey เดียวกัน ผ่าน check ทั้งคู่ → หักคลัง 2 เท่า.
      //   ล็อกก่อนตรวจ (mirror pattern จาก returnDollsToStock stock-actions.ts:1609) → request ที่ 2 รอ
      //   จน request แรก commit → เห็นแถว dup → replay no-op. (partial unique index เป็น backstop ระดับ DB.)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cf_refill_only:" + data.clientKey}))`;
      // ── P0-2b · per-MACHINE lock — serialize REFILL_ONLY กับ COLLECTION บนตู้เดียวกัน ──
      //   กัน REFILL_ONLY กับ COLLECTION (หรือ REFILL_ONLY 2 อัน) แทรกกันจนชนมิลลิวินาที (คู่กับ collectedAt bump).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cf_machine:" + machine.id}))`;

      // ── กันกดซ้ำใน tx (หลัง lock) — idempotency guard ชั้นสอง (pre-tx อาจแข่งกัน) ──
      // P2-2: ตัว anchor movement ของคำสั่งนี้เก็บ event.id ไว้ที่ documentId (ผูก clientKey→event ตรงตัว)
      //   → replay คืน event ของ clientKey นี้เป๊ะ (ไม่ใช่ REFILL_ONLY ล่าสุด createdAt desc ที่อาจเป็น clientKey อื่น).
      const dupInTx = await tx.cfStockMovement.findFirst({
        where: { orgId, branchId: machine.branchId, refTable: "cf_refill_only", refId: data.clientKey },
        select: { documentId: true },
      });
      if (dupInTx) {
        const prev = dupInTx.documentId
          ? await tx.cfCollectionEvent.findFirst({
              where: { orgId, machineId: machine.id, id: dupInTx.documentId },
              select: { id: true, stockAfter: true },
            })
          : null;
        // คืน event เดิม — สร้าง sentinel เพื่อ short-circuit นอก tx
        return { __idempotent: true, id: prev?.id ?? "", stockAfter: prev?.stockAfter ?? stockAfter } as const;
      }

      // 1) สร้าง REFILL_ONLY event — FREEZE 2 มิเตอร์ (before==after==mirror ปัจจุบัน)
      //    stockAfter = mirror − N + M (mirror-based · ไม่ใช่ค่านับ) → trigger เขียนเข้า mirror ใหม่.
      //    stockBefore = ค่านับจริง (AUDIT only) · cashCountedCents=0 · sessionId=null (ไม่อยู่ในรอบ).
      const created = await tx.cfCollectionEvent.create({
        data: {
          orgId,
          sessionId: null,
          machineId: machine.id,
          eventType: "REFILL_ONLY",
          collectedAt, // P0-2: strictly beats machine.lastEventAt so the mirror trigger always fires
          collectedById: session.user.id,
          // FREEZE — trigger copy coin_meter_after/doll_meter_after ดิบเข้า mirror → ต้อง = ค่าปัจจุบันเป๊ะ
          coinMeterBefore: machine.lastCoinMeter,
          coinMeterAfter: machine.lastCoinMeter,
          cashCountedCents: 0, // ไม่เก็บเงิน
          dollMeterBefore: machine.lastDollMeter,
          dollMeterAfter: machine.lastDollMeter,
          stockBefore: data.stockBefore, // AUDIT only — ไม่ใช้คำนวณ mirror
          stockAfter, // → mirror ใหม่ (mirror − N + M)
          refillQty: refillTotal, // M
          dollsReturnedToStock: N, // N (audit)
          // รูป (2 ช่อง) — reuse slot เดิม (photoStockUrl = ก่อน · photoMeterBeforeUrl = หลัง · ตรงกับ COLLECTION)
          photoStockUrl: data.photoStockBeforeUrl || null,
          photoMeterBeforeUrl: data.photoStockAfterUrl || null,
          anomalyFlags: [],
          notes: data.notes ?? null,
        },
        select: { id: true },
      });

      // 2) เติม M — หัก 1 แถว LOAD_TO_MACHINE ต่อไลน์ (reuse block เดียวกับ submitBranchEvent ~441-483)
      //    advisory-lock ต่อ (branch,ห้อง,สินค้า) · NET over-issue guard · qty:-line.qty · refId=event.id
      for (const line of refillLines) {
        const chosenWh = line.warehouseId ?? branchMainId;
        const whFilter: Record<string, unknown> =
          chosenWh == null
            ? {}
            : branchMainId && chosenWh === branchMainId
              ? { OR: [{ warehouseId: chosenWh }, { warehouseId: null }] }
              : { warehouseId: chosenWh };
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machine.branchId} || ':' || ${chosenWh ?? "MAIN"}), hashtext(${line.productId}))`;
        const onHandAgg = await tx.cfStockMovement.aggregate({
          where: { orgId, branchId: machine.branchId, productId: line.productId, ...whFilter },
          _sum: { qty: true },
        });
        const shelfOnHand = onHandAgg._sum.qty ?? 0;
        if (line.qty > shelfOnHand) {
          const roomSuffix = line.warehouseId ? " ในคลังที่เลือก" : "";
          throw new CfOverIssueError(
            `ตุ๊กตาบนชั้นไม่พอ${roomSuffix} · บนชั้นมี ${shelfOnHand} ตัว · เติม ${line.qty} ตัวไม่ได้`,
          );
        }
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: machine.branchId,
            type: "LOAD_TO_MACHINE",
            productId: line.productId,
            machineId: machine.id,
            warehouseId: chosenWh,
            qty: -line.qty,
            refTable: "cf_collection_events",
            refId: created.id,
            occurredAt: new Date(),
            createdById: session.user.id,
            reason: "เติมตุ๊กตาเข้าตู้ (เปลี่ยนตุ๊กตา)",
          },
        });
      }

      // 3) คืน N — 1 แถว ADJUST qty:+N (ผกผัน refill · "ในตู้" ↓) + in-machine guard.
      //    (inline logic จาก returnDollsToStock ~1607-1658 · refId=clientKey · lock ต่อ (branch,product).)
      if (N > 0 && data.returnProductId) {
        const returnPid = data.returnProductId;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machine.branchId}), hashtext(${returnPid}))`;
        const product = await tx.cfProduct.findFirst({
          where: { id: returnPid, orgId },
          select: { id: true, unitCostCents: true },
        });
        if (!product) throw new CfOverIssueError("ไม่พบสินค้าที่จะคืน");
        // "ในตู้" ของสินค้านี้ = |Σ qty ที่ machineId=ตู้นี้ + productId นี้| (รวมแถวเติมที่เพิ่งเขียนใน tx นี้)
        const inMachineAgg = await tx.cfStockMovement.aggregate({
          where: { orgId, branchId: machine.branchId, machineId: machine.id, productId: returnPid },
          _sum: { qty: true },
        });
        const inMachine = Math.abs(inMachineAgg._sum.qty ?? 0);
        if (N > inMachine) {
          throw new CfOverIssueError(`ในตู้มีของนี้ ${inMachine} ตัว · เอาออก ${N} ตัวไม่ได้`);
        }
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: machine.branchId,
            type: "ADJUST",
            productId: returnPid,
            machineId: machine.id,
            qty: N, // + → ลด |Σ machineId=ตู้| → "ในตู้" ลด (ผกผัน refill · คลัง gross ไม่แตะ)
            unitCostCents: product.unitCostCents,
            refTable: "cf_refill_only",
            refId: data.clientKey, // idempotency anchor (pre-tx/in-tx dup check ใช้แถวนี้)
            documentId: created.id, // P2-2: ผูก clientKey → event นี้ (replay คืน event ที่ถูกต้อง)
            occurredAt: new Date(),
            createdById: session.user.id,
            reason: "คืนตุ๊กตาจากตู้เข้าคลัง (เปลี่ยนตุ๊กตา)",
          },
        });
      } else {
        // ไม่มีการคืน (N=0 · เติมอย่างเดียว) → ยังต้องผูก clientKey กับ event นี้ให้ idempotency ทำงาน.
        // เขียน movement marker qty:0 บนสินค้าที่เติมเยอะสุด (ไม่กระทบยอดสต๊อก · เป็นแค่ anchor).
        const anchorPid = [...refillLines].sort((a, b) => b.qty - a.qty)[0]?.productId;
        if (anchorPid) {
          await tx.cfStockMovement.create({
            data: {
              orgId,
              branchId: machine.branchId,
              type: "ADJUST",
              productId: anchorPid,
              machineId: machine.id,
              qty: 0, // marker เท่านั้น — ไม่กระทบยอด (idempotency anchor สำหรับ N=0)
              refTable: "cf_refill_only",
              refId: data.clientKey,
              documentId: created.id, // P2-2: ผูก clientKey → event นี้ (replay คืน event ที่ถูกต้อง)
              occurredAt: new Date(),
              createdById: session.user.id,
              reason: "เปลี่ยนตุ๊กตา (เติมอย่างเดียว · idempotency marker)",
            },
          });
        }
      }

      // 4) เปิด loadout row ให้ SKU ใหม่ที่ยังไม่มี (สินค้านี้เป็นของในตู้ · pattern จาก refillDollsToMachine)
      for (const line of refillLines) {
        const existingLoadout = await tx.cfMachineLoadout.findFirst({
          where: { orgId, machineId: machine.id, productId: line.productId, effectiveTo: null },
          select: { id: true },
        });
        if (!existingLoadout) {
          await tx.cfMachineLoadout.create({
            data: {
              orgId,
              machineId: machine.id,
              productId: line.productId,
              pricePerPlayCoins: machine.loadouts[0]?.pricePerPlayCoins ?? 1,
              effectiveFrom: new Date(),
              effectiveTo: null,
              setById: session.user.id,
              notes: "ตั้งจากการเปลี่ยนตุ๊กตา (refill-only)",
            },
          });
        }
      }

      return { __idempotent: false, id: created.id, stockAfter } as const;
    });

    revalidatePath("/clawfleet/os/app");
    revalidatePath("/clawfleet/os/collections");
    return { ok: true, data: { id: ev.id, stockAfter: ev.stockAfter } };
  } catch (e) {
    // over-issue / in-machine guard → ข้อความชัด (rollback แล้ว = ไม่มีของตัดครึ่ง)
    if (e instanceof CfOverIssueError) {
      return { ok: false, error: e.message };
    }
    // กันกดซ้ำชนกันจริง (unique/แข่ง) → รายงานเป็นซ้ำ (event ถูกสร้างโดย request แรกแล้ว)
    if ((e as { code?: string }).code === "P2002") {
      return { ok: false, error: "รายการนี้ถูกบันทึกไปแล้ว (กดซ้ำ)" };
    }
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${(e as Error).message}` };
  }
}

// ตั้ง/แก้ "ชื่อเล่น" ตู้ (CEO 2026-07-11): พนักงานส่วนใหญ่ดูตู้เองแล้วรู้ → ให้ตั้งชื่อที่จำง่ายได้เอง.
// ไม่ยุ่งรหัสตู้ (code) เดิม (code = แค่ป้ายชื่อ · ตู้สแกนด้วย qrToken). ว่าง = ล้างชื่อเล่น.
const RenameMachineNicknameSchema = z.object({
  machineId: zUUID(),
  nickname: z.string().max(60),
});
export async function renameMachineNickname(input: unknown): Promise<Result> {
  const parsed = RenameMachineNicknameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { machineId, nickname } = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId, isActive: true },
    select: { id: true, branchId: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้" };
  // สิทธิ์ = สมาชิกสาขานี้ (พนักงานเก็บเงินสาขาเดียวกับตู้) หรือแอดมิน (ALL)
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(machine.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์แก้ตู้สาขานี้" };
  }
  const clean = nickname.trim();
  await prisma.cfMachine.update({
    where: { id: machine.id },
    data: { nickname: clean.length > 0 ? clean : null },
  });
  revalidatePath("/clawfleet/os/app");
  revalidatePath("/clawfleet/os/manage");
  return { ok: true };
}

// ── แนบรูปเพิ่มทีหลัง (attach later) — พนักงานถ่ายรูปหลักฐานไม่ทันตอนเก็บ (รีบ/สัญญาณตก)
//    → กลับมาแนบเพิ่มจากหน้าประวัติได้ (item 5). รูปเป็น "หลักฐานเสริม" · ไม่แตะเงิน/มิเตอร์/กระทบยอด.
//
// คอลัมน์รูปของ event เก็บหลักฐานตามความหมายจริง (ดู submitBranchEvent write-side):
//   photoMeterAfterUrl = มิเตอร์เหรียญ · photoPrizeMeterUrl = มิเตอร์ตุ๊กตา
//   photoStockUrl = สต็อกก่อนเติม · photoMeterBeforeUrl = สต็อกหลังเติม (reused slot) · photoCashUrl = เงินสด
//   (baseline/INITIAL ใช้ photoMoney*/photoDoll*/photoMachine เพิ่ม — รับได้เผื่อแนบรูปรอบตั้งต้น)
// รูปเงินสด (photoCashUrl) = optional · ไม่นับใน "ครบ/ไม่ครบ" (CEO 2026-07-11).
const AttachEventPhotosSchema = z.object({
  eventId: zUUID(),
  photos: z
    .object({
      photoMeterAfterUrl: zAttachUrl.optional(),
      photoPrizeMeterUrl: zAttachUrl.optional(),
      photoStockUrl: zAttachUrl.optional(),
      photoMeterBeforeUrl: zAttachUrl.optional(),
      photoCashUrl: zAttachUrl.optional(),
      photoMoneyMeterTopUrl: zAttachUrl.optional(),
      photoMoneyMeterBottomUrl: zAttachUrl.optional(),
      photoDollMeterTopUrl: zAttachUrl.optional(),
      photoDollMeterBottomUrl: zAttachUrl.optional(),
      photoMachineUrl: zAttachUrl.optional(),
    })
    .strict(),
});

/**
 * แนบรูปหลักฐานเพิ่มให้ event ที่เก็บไปแล้ว (item 5) — idempotent · money-safe (แตะเฉพาะคอลัมน์รูป).
 *  - สิทธิ์: สมาชิกสาขาของตู้ (เหมือน submitBranchEvent) หรือแอดมิน
 *  - เขียนเฉพาะคอลัมน์ที่ "ยังว่าง (null)" — ไม่ทับรูปเดิม (กันเขียนทับหลักฐานที่ถ่ายไว้แล้ว)
 *  - purge แล้ว (photosPurgedAt != null) → no-op (รูปถูกลบตามนโยบายเก็บ · แนบเพิ่มไม่ได้)
 *  - คืน completeness (missing/total) เพื่อจอเคลียร์ป้าย "รูปยังไม่ครบ" ได้ทันที
 */
export async function attachEventPhotos(
  input: unknown,
): Promise<ResultOf<{ photosMissing: boolean; missingCount: number }>> {
  const parsed = AttachEventPhotosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { eventId, photos } = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  // resolve event → machine → branch (org-scoped)
  const ev = await prisma.cfCollectionEvent.findFirst({
    where: { id: eventId, orgId },
    select: {
      id: true,
      eventType: true,
      photosPurgedAt: true,
      machine: { select: { branchId: true } },
      photoMeterAfterUrl: true,
      photoPrizeMeterUrl: true,
      photoStockUrl: true,
      photoMeterBeforeUrl: true,
      photoCashUrl: true,
      photoMoneyMeterTopUrl: true,
      photoMoneyMeterBottomUrl: true,
      photoDollMeterTopUrl: true,
      photoDollMeterBottomUrl: true,
      photoMachineUrl: true,
    },
  });
  if (!ev) return { ok: false, error: "ไม่พบรายการเก็บเงินนี้" };

  // branch-access guard (เหมือน submitBranchEvent / renameMachineNickname)
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(ev.machine.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  // รูปถูกลบตามนโยบายเก็บแล้ว → แนบเพิ่มไม่มีความหมาย (no-op · ไม่ error เพื่อ idempotent)
  if (ev.photosPurgedAt) {
    return { ok: false, error: "รูปของรายการนี้ถูกลบตามนโยบายเก็บแล้ว · แนบเพิ่มไม่ได้" };
  }

  // เขียนเฉพาะคอลัมน์ที่ "ยังว่าง" + ผู้ใช้ส่ง url ใหม่มา (ไม่ทับรูปเดิม · idempotent)
  const data: Record<string, string> = {};
  for (const [col, url] of Object.entries(photos)) {
    if (!url) continue; // ไม่ส่ง / ส่งค่าว่าง → ข้าม
    const current = (ev as Record<string, unknown>)[col];
    if (current == null) data[col] = url; // ยังว่างเท่านั้น → เติม
  }
  if (Object.keys(data).length > 0) {
    await prisma.cfCollectionEvent.update({ where: { id: ev.id }, data });
  }

  // completeness หลังอัปเดต — นับ "รูปหลักฐานที่คาดว่าต้องมี" ตามชนิด event (ไม่นับเงินสด).
  // สร้าง record คอลัมน์รูปล้วน ๆ (ค่าเดิม + ที่เพิ่งเติม) — เลี่ยง cast ทั้ง ev (มี Date/relation ปน)
  const mergedCols: Record<string, string | null> = {
    photoMeterAfterUrl: ev.photoMeterAfterUrl,
    photoPrizeMeterUrl: ev.photoPrizeMeterUrl,
    photoStockUrl: ev.photoStockUrl,
    photoMeterBeforeUrl: ev.photoMeterBeforeUrl,
    photoMoneyMeterTopUrl: ev.photoMoneyMeterTopUrl,
    photoMoneyMeterBottomUrl: ev.photoMoneyMeterBottomUrl,
    photoDollMeterTopUrl: ev.photoDollMeterTopUrl,
    photoDollMeterBottomUrl: ev.photoDollMeterBottomUrl,
    photoMachineUrl: ev.photoMachineUrl,
    ...data,
  };
  const { missingCount } = deriveEventPhotoCompleteness(ev.eventType, mergedCols);

  revalidatePath("/clawfleet/os/collections");
  revalidatePath("/clawfleet/os/app");
  return { ok: true, data: { photosMissing: missingCount > 0, missingCount } };
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
      isBaseline: true,
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

  // ราคา/ครั้งจริงต่อตู้ (ตาม loadout ปัจจุบัน) — ตอนกรอกต่อตู้ใช้ราคาจริงอยู่แล้ว
  // (pricePerPlayCoins×1000) ตอนปิดรอบต้องใช้ราคาเดียวกัน ไม่งั้น cross-check คิด
  // ทุกตู้ที่ ฿10 → ตู้ราคาอื่นจะติด flag เงินขาด/เกินทั้งที่เงินถูก. ตู้ที่ไม่มี
  // loadout → fallback flat (เหมือน submit).
  const cashMachines = await prisma.cfMachine.findMany({
    where: { orgId, branchId: cf.branchId, kind: "CLAW" },
    select: {
      id: true,
      loadouts: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: "desc" }, select: { pricePerPlayCoins: true } },
    },
  });
  const priceByMachine = new Map<string, number>();
  for (const m of cashMachines) {
    priceByMachine.set(m.id, m.loadouts[0] ? m.loadouts[0].pricePerPlayCoins * 1000 : CASH_PER_PLAY_CENTS);
  }

  const ccRaw = deriveBranchCrossCheck(
    cf.events.map((e) => ({
      coinMeterBefore: e.coinMeterBefore,
      coinMeterAfter: e.coinMeterAfter,
      cashCountedCents: e.cashCountedCents,
      dollMeterBefore: e.dollMeterBefore ?? 0,
      dollMeterAfter: e.dollMeterAfter ?? 0,
      stockBefore: e.stockBefore ?? 0,
      stockAfter: e.stockAfter ?? 0,
      refillQty: e.refillQty ?? 0,
      cashPerCoinCents: priceByMachine.get(e.machineId) ?? CASH_PER_PLAY_CENTS,
    })),
  );

  // FOUNDATION round-1 (blueprint §2 · CEO R1): รอบ baseline → revenue ยังนับ (expected/actual
  // ยังบันทึกตามเดิม) แต่ "verdict" เงินขาด/เกิน (M2/M3/M4/M6) ถูกกด — ไม่มีรอบก่อนให้เทียบ.
  // ธง data-integrity/ตุ๊กตา (C2/P*/…) ยังคงอยู่. wrap ไม่ fork: กรองธงเงินออกจากผล deriveBranchCrossCheck
  // แล้วคำนวณ status ใหม่จากธงที่เหลือ.
  const cc = cf.isBaseline
    ? (() => {
        const MONEY_VERDICT_FLAGS: ReadonlySet<string> = new Set<string>([
          ANOMALY_FLAGS.M2_CASH_SHORT_MINOR,
          ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR,
          ANOMALY_FLAGS.M4_CASH_OVER,
          ANOMALY_FLAGS.M6_CASH_OVER_MAJOR,
        ]);
        const keptFlags = ccRaw.flags.filter((f) => !MONEY_VERDICT_FLAGS.has(f));
        return {
          ...ccRaw,
          flags: keptFlags,
          status: keptFlags.length > 0 ? ("ANOMALY_REVIEW" as const) : ("CLOSED" as const),
        };
      })()
    : ccRaw;

  // นโยบาย meterMatch (Wave 4b): เปิด → ถ้ารอบมีธงเกี่ยวกับมิเตอร์ บังคับเข้า ANOMALY_REVIEW
  // (additive · escalate เท่านั้น · ไม่ปลดการตรวจ). ปิด → status = cc.status เดิม.
  const policy = await getClawfleetPolicy();
  const finalStatus = escalateForMeterMatch(policy.meterMatch, cc.status, cc.flags);

  try {
    await prisma.cfCollectionSession.update({
      where: { id: data.sessionId, status: "OPEN" },
      data: {
        status: finalStatus,
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
    revalidatePath("/clawfleet/os/collections");
    revalidatePath("/clawfleet/os/dashboard");
    return { ok: true, data: { status: finalStatus, flags: cc.flags } };
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
    revalidatePath("/clawfleet/os/collections");
    revalidatePath("/clawfleet/os/dashboard");
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
        // ⚠️ COLUMN→CONTENT MAPPING (EXCHANGER · names don't match — see CLAW write site above):
        //   photoMeterAfterUrl  = รูปมิเตอร์เหรียญ (coin meter) ← data.photoCoinMeterUrl
        //   photoCashUrl        = รูปเงินสด (cash)              ← data.photoCashUrl       (name OK)
        //   photoMeterBeforeUrl = รูปถาดเหรียญ (token tray)     ← data.photoTokenTrayUrl  (reused slot!)
        photoMeterAfterUrl: data.photoCoinMeterUrl,
        photoCashUrl: data.photoCashUrl,
        photoMeterBeforeUrl: data.photoTokenTrayUrl,
        notes: data.notes,
      },
      select: { id: true },
    });
    revalidatePath("/clawfleet/os/collections");
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
          promoCoinsDispensed: true,
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

  // ราคา/ครั้งจริงต่อตู้ สำหรับกลุ่มเงินสด (cash group) — เหมือนปิดรอบสาขา ต้องใช้
  // ราคาจริงตาม loadout ไม่ใช่ flat ฿10 ไม่งั้นตู้ราคาอื่นติด flag เงินผิด. token group
  // ใช้ 0 (เงินอยู่ที่ตู้แลก · claw ไม่มีเงิน) จึงข้ามการ lookup.
  const priceByMachine = new Map<string, number>();
  if (!isTokenGroup) {
    const cashMachines = await prisma.cfMachine.findMany({
      where: { orgId, groupId: cf.groupId, kind: "CLAW" },
      select: {
        id: true,
        loadouts: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: "desc" }, select: { pricePerPlayCoins: true } },
      },
    });
    for (const m of cashMachines) {
      priceByMachine.set(m.id, m.loadouts[0] ? m.loadouts[0].pricePerPlayCoins * 1000 : CASH_PER_PLAY_CENTS);
    }
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
      cashPerCoinCents: isTokenGroup ? 0 : (priceByMachine.get(e.machineId) ?? CASH_PER_PLAY_CENTS),
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

  // ultrareview 2026-07-01 (finding #3): ตู้แลก token ต้อง reconcile เงินสดจริง ไม่ใช่ปล่อยผ่าน.
  // เดิม expectedCashCents ของ token group = 0 เสมอ (claws ไม่มีเงิน) → เงินตู้แลก (actual)
  // เทียบกับ 0 → variance บวกเสมอ ไม่มีวันจับ "เก็บเงินตู้แลกขาด".
  // เงินที่ตู้แลก "ควร" ได้ = token ที่ขายเป็นเงิน × ราคา/token
  //   token ขายเป็นเงิน = (มิเตอร์ token ขึ้น − token แจกจาก promo)
  //   ราคา/token (cents) = 100 / baseCoinPerBaht  (baseCoinPerBaht = จำนวน token ต่อ ฿1)
  let expectedCashCentsFinal = cc.expectedCashCents;
  let cashVarianceBpsFinal = cc.cashVarianceBps;
  if (isTokenGroup && cf.group?.exchangerId) {
    const exId = cf.group.exchangerId;
    const loadout = await prisma.cfExchangerLoadout.findFirst({
      where: { orgId, machineId: exId, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
      select: { baseCoinPerBaht: true },
    });
    const coinPerBaht = loadout ? Number(loadout.baseCoinPerBaht) : 1;
    let exchangerExpectedCents = 0;
    if (coinPerBaht > 0) {
      for (const e of cf.events) {
        if (e.machineId !== exId) continue;
        const tokensOut = Math.max(0, e.coinMeterAfter - e.coinMeterBefore);
        const tokensSold = Math.max(0, tokensOut - (e.promoCoinsDispensed ?? 0));
        // ราคา/token = ฿(1/coinPerBaht) = (100/coinPerBaht) cents · ปัดเป็นจำนวนเต็ม cents
        exchangerExpectedCents += Math.round((tokensSold * 100) / coinPerBaht);
      }
    }
    expectedCashCentsFinal = cc.expectedCashCents + exchangerExpectedCents;
    cashVarianceBpsFinal =
      expectedCashCentsFinal > 0
        ? Math.round(((recordedCashCents - expectedCashCentsFinal) / expectedCashCentsFinal) * 10000)
        : 0;
  }

  // ultrareview 2026-07-01 (finding #5): ตู้แลก (token group) คำนวณเงินขาด/เกินแล้ว
  // (expectedCashCentsFinal / cashVarianceBpsFinal) แต่ deriveBranchCrossCheck คิดจาก
  // cash=0 → cc.flags ไม่มีธงเงินตู้แลกเลย → รอบเงินตู้แลกขาด/เกินปิดเป็น CLOSED เงียบ
  // ไม่เข้า ANOMALY_REVIEW. ที่นี่จึง derive ธงเงินของตู้แลกเองจาก variance จริง
  // (ใช้เพดาน cents เดียวกับ deriveBranchCrossCheck) แล้ว merge เข้ากับ cc.flags.
  const mergedFlags: AnomalyFlag[] = [...cc.flags];
  if (isTokenGroup) {
    const exchangerVarianceCents = recordedCashCents - expectedCashCentsFinal;
    if (exchangerVarianceCents < 0) {
      // เงินตู้แลกขาด — |ขาด| เกินเพดานเตือน (฿100) → ยกธง
      const shortCents = Math.abs(exchangerVarianceCents);
      if (shortCents > DEFAULTS.CASH_VARIANCE_WARN_CENTS) {
        // เกินเพดานเตือน = ขาดเยอะ (M3 · P1 บังคับตรวจ)
        if (!mergedFlags.includes(ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR)) {
          mergedFlags.push(ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR);
        }
      } else if (shortCents > 0) {
        // ขาดเล็กน้อย (M2 · P2 เตือน)
        if (
          !mergedFlags.includes(ANOMALY_FLAGS.M2_CASH_SHORT_MINOR) &&
          !mergedFlags.includes(ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR)
        ) {
          mergedFlags.push(ANOMALY_FLAGS.M2_CASH_SHORT_MINOR);
        }
      }
    } else if (exchangerVarianceCents > DEFAULTS.CASH_VARIANCE_WARN_CENTS) {
      // เงินตู้แลกเกินก้อนใหญ่ (> ฿300) → M6 (P1) · เกินเพดานเตือน → M4 (P2)
      if (exchangerVarianceCents > DEFAULTS.CASH_OVER_MAJOR_CENTS) {
        if (!mergedFlags.includes(ANOMALY_FLAGS.M6_CASH_OVER_MAJOR)) {
          mergedFlags.push(ANOMALY_FLAGS.M6_CASH_OVER_MAJOR);
        }
      } else if (!mergedFlags.includes(ANOMALY_FLAGS.M4_CASH_OVER)) {
        mergedFlags.push(ANOMALY_FLAGS.M4_CASH_OVER);
      }
    }
  }

  // ถ้ามีธง P0/P1 ใด ๆ → ต้องเข้า ANOMALY_REVIEW (mirror ตรรกะปิดรอบสาขา · P2 = เตือนเฉย ๆ
  // ไม่ดันเข้า review). เดิม cc.status คิดจาก cc.flags เท่านั้น → ธงเงินตู้แลกที่เพิ่งเพิ่มถูกเมิน.
  const hasEscalatingFlag = mergedFlags.some((f) => FLAG_SEVERITY[f] !== "P2");
  const baseStatus: "CLOSED" | "ANOMALY_REVIEW" =
    cc.status === "ANOMALY_REVIEW" || hasEscalatingFlag ? "ANOMALY_REVIEW" : "CLOSED";

  // นโยบาย meterMatch (Wave 4b): เปิด → ถ้ารอบมีธงเกี่ยวกับมิเตอร์ (รวม COIN_GROUP_MISMATCH
  // ที่ trigger จะ append) บังคับเข้า ANOMALY_REVIEW. app-layer escalate ล่วงหน้าจาก mergedFlags
  // ที่คำนวณได้ (additive · escalate เท่านั้น) · trigger ยังทำ token cross-check ของมันตามปกติ.
  const policy = await getClawfleetPolicy();
  const mergedStatus = escalateForMeterMatch(policy.meterMatch, baseStatus, mergedFlags);

  try {
    await prisma.cfCollectionSession.update({
      where: { id: data.sessionId, status: "OPEN" },
      data: {
        // trigger may override to ANOMALY_REVIEW if token mismatch;
        // mergedStatus already escalates on token-exchanger cash short/over flags
        //   + meterMatch policy (if on) on any meter-related flag
        status: mergedStatus,
        closedById: session.user.id,
        expectedCashCents: expectedCashCentsFinal,
        actualCashCents: recordedCashCents,
        totalCashCents: recordedCashCents,
        cashVarianceBps: cashVarianceBpsFinal,
        prizeMeterOut: cc.prizeMeterOut,
        prizeCountedOut: cc.prizeCountedOut,
        prizeVariance: cc.prizeVariance,
        anomalyFlags: mergedFlags,
        reviewNote: data.reviewNote,
      },
      select: { id: true },
    });
    // read back what the trigger decided (token cross-check + final status)
    const after = await prisma.cfCollectionSession.findFirst({
      where: { id: data.sessionId, orgId },
      select: { status: true, anomalyFlags: true },
    });
    // meterMatch guard บนผลหลัง trigger — ถ้า trigger append ธงมิเตอร์ (เช่น COIN_GROUP_MISMATCH)
    // แล้วสถานะยังเป็น CLOSED → escalate ให้ผลลัพธ์ที่คืน (defensive · trigger ปกติ escalate เอง).
    // สถานะอื่น (OPEN/LOCKED/ANOMALY_REVIEW) คืนตามที่ trigger เขียนจริง ไม่แตะ.
    const afterFlags = after?.anomalyFlags ?? mergedFlags;
    const returnedStatus: string =
      after?.status === "CLOSED"
        ? escalateForMeterMatch(policy.meterMatch, "CLOSED", afterFlags)
        : (after?.status ?? mergedStatus);
    revalidatePath("/clawfleet/os/collections");
    revalidatePath("/clawfleet/os/dashboard");
    return {
      ok: true,
      data: { status: returnedStatus, flags: afterFlags },
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

  // R5 (ultrareview 2026-07-01): สั่งของเข้าสาขา = การจัดการสต๊อก → เฉพาะผู้จัดการสาขา
  // + แอดมินเท่านั้น (เดิมไม่มี role guard → พนักงานเก็บเงิน/viewer สั่งของได้).
  if (!isCfAdmin(session.user.role) && !isCfBranchManager(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่สั่งของได้" };
  }

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
    revalidatePath("/clawfleet/os/stock");
    revalidatePath("/clawfleet/os/dashboard");
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

const MANAGE_PATHS = ["/clawfleet/os/branches", "/clawfleet/os/manage"] as const;
/** refresh both admin surfaces that share these CRUD actions (branches page + manage hub) */
function revalidateManage() {
  for (const p of MANAGE_PATHS) revalidatePath(p);
}

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
    // E1 (bigfeature · warehouse) — สร้างสาขา + คลังหลักในธุรกรรมเดียว (atomic)
    // → ห้ามมีสาขาที่ไม่มีคลังหลัก. partial-unique cf_warehouses_one_main_per_branch
    //   การันตี main เดียวต่อสาขา (idempotent-safe: main ตัวที่ 2 จะถูก reject).
    const b = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
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
      await tx.cfWarehouse.create({
        data: {
          orgId,
          branchId: branch.id,
          name: "คลังหลัก",
          isMain: true,
          sortOrder: 0,
          createdById: session.user.id,
        },
      });
      return branch;
    });
    revalidateManage();
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
    revalidateManage();
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
      revalidateManage();
      return { ok: true, data: { mode: "soft" } };
    }
    await prisma.branch.delete({ where: { id: branchId } });
    revalidateManage();
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
        // bigfeature (N1): ตู้ใหม่ = AWAITING_SETUP ⚪ (isFirstBaselineLocked=false, ค่า default).
        // ไม่เขียน INITIAL event ที่นี่ (baseline form เป็นคนเขียน INITIAL รอบแรกแล้ว lock ตู้)
        // → partial-unique index cf_events_one_baseline_per_machine ยังว่าง ไม่มีอะไร pre-consume.
        isFirstBaselineLocked: false,
      },
      select: { id: true },
    });
    revalidateManage();
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
    revalidateManage();
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
    revalidateManage();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ปลดระวางตู้ไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/**
 * ย้ายตู้ไปสาขาอื่น (forward-only) — เฉพาะแอดมิน (assertCfAdmin).
 * ⚠️ movements/events เก่ายังผูก branchId เดิม (ประวัติไม่ย้ายตาม) → เป็นการย้าย
 * "ไปข้างหน้า" เท่านั้น: รอบเก็บ/สต๊อกใหม่หลังย้ายจะอยู่สาขาใหม่ · ของเก่าคงบริบทเดิม.
 * กันย้ายเข้าสาขาที่ไม่ใช่ตู้คีบ/ไม่ใช่ org เดียวกัน.
 */
export async function reassignCfMachineBranch(
  machineId: string,
  newBranchId: string,
): Promise<Result> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  if (!machineId || !newBranchId) return { ok: false, error: "ไม่ระบุตู้หรือสาขาปลายทาง" };

  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId },
    select: { id: true, branchId: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้" };
  if (machine.branchId === newBranchId) return { ok: false, error: "ตู้อยู่ในสาขานี้อยู่แล้ว" };

  const branch = await prisma.branch.findFirst({
    where: { id: newBranchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบปลายทาง หรือไม่อยู่ในองค์กรนี้" };

  try {
    await prisma.cfMachine.update({
      where: { id: machineId },
      // ย้ายเฉพาะ branchId · เคลียร์ groupId (กลุ่มผูกกับสาขาเดิม · ย้ายข้ามสาขา = หลุดกลุ่ม)
      data: { branchId: newBranchId, groupId: null },
    });
    revalidateManage();
    revalidatePath("/clawfleet/os/stock");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ย้ายสาขาตู้ไม่สำเร็จ: ${(e as Error).message}` };
  }
}

const SetMachinePhotoSchema = z.object({
  machineId: zUUID(),
  photoUrl: z.string().url(), // absolute R2 url
});

/**
 * ตั้ง/เปลี่ยนรูปตู้ (N4) — พนักงานในสาขาก็ทำได้ (branch-access · ไม่ต้องเป็นแอดมิน).
 * เขียนทับรูปเดิม (เก็บล่าสุด · ไม่มีประวัติ). guard สิทธิ์เข้าถึงสาขาของตู้.
 */
export async function setMachinePhoto(input: unknown): Promise<Result> {
  const parsed = SetMachinePhotoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { machineId, photoUrl } = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId },
    select: { id: true, branchId: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้" };

  // branch-access guard — NEVER gate write on userBranchIds()==='ALL' (viewer ก็ได้ ALL).
  // ใช้ cfHasAdminPower หรือ membership สาขาจริง (userBranch) เท่านั้น.
  if (!(await cfHasAdminPower(session))) {
    const ub = await prisma.userBranch.findFirst({
      where: { userId: session.user.id, branchId: machine.branchId },
      select: { id: true },
    });
    if (!ub) return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  try {
    await prisma.cfMachine.update({
      where: { id: machineId },
      data: { photoUrl },
    });
    revalidateManage();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `บันทึกรูปตู้ไม่สำเร็จ: ${(e as Error).message}` };
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

    revalidateManage();
    revalidatePath("/clawfleet/os/dashboard");
    revalidatePath("/clawfleet/os/stock");
    revalidatePath("/clawfleet/os/collections");
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

    revalidateManage();
    revalidatePath("/clawfleet/os/dashboard");
    return { ok: true, data: { deleted: true } };
  } catch (e) {
    return { ok: false, error: `ลบข้อมูลตัวอย่างไม่สำเร็จ: ${(e as Error).message}` };
  }
}
