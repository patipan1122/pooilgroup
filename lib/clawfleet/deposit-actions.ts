"use server";

// ClawFleet · ตู้คีบ OS — Wave 4a · ฝากเงินเข้าธนาคาร (custody→deposit)
// -----------------------------------------------------------------------------
// ทำไมมี: เดิมพิสูจน์ได้แค่ "เก็บเงินจากตู้เท่าไหร่" แต่จุดบอดคือ "เงินในมือพนักงาน
//   ถูกฝากเข้าธนาคารครบไหม". Wave 4a ปิดช่องนี้: 1 รอบเก็บ = เงินก้อนหนึ่งในมือคนปิดรอบ
//   (custody) · ต้องมี "ใบฝาก" (CfCashDeposit) มายืนยันว่าเงินเข้าธนาคารแล้ว.
//   รอบที่ depositId = null = เงินยัง "ค้างมือ".
//
// หลักการเงิน (นักบัญชี/ผู้สอบบัญชี lens):
//   - expected = Σ เงินเก็บของรอบที่ครอบ (snapshot ตอนฝาก · ยึดยอดที่ระบบบันทึกไว้)
//   - amount   = เงินที่ฝากจริง (จากสลิป) — คนกรอก
//   - variance = amount - expected · |variance| <= ฿20 = OK · ต่ำกว่า = SHORT (ฝากขาด) · สูงกว่า = OVER
//   - ผูกรอบเข้าใบฝากแบบ ATOMIC CLAIM (updateMany where depositId=null) → กันฝากซ้ำ/ฝากชน
//     (2 คนกดฝากรอบเดียวกันพร้อมกัน → คนที่ 2 count ไม่ครบ → rollback ทั้งใบ · ไม่มีเงินถูกนับ 2 ใบ).
//
// org-scoped · TS strict · Result type · transaction · audit trail ในทรานเดียว.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireCfSession,
  userBranchIds,
  isCfBranchManager,
  cfHasAdminPower,
} from "./role-guard";

const DEPOSITS_PATH = "/clawfleet/os/deposits";
const DASHBOARD_PATH = "/clawfleet/os/dashboard";

// รอบที่ "ฝากได้" = ปิดรอบแล้ว (เงินอยู่ในมือ) · ยังไม่ฝาก
const DEPOSITABLE_STATUSES = ["CLOSED", "LOCKED", "ANOMALY_REVIEW"] as const;

// เกณฑ์ยอมรับส่วนต่าง — ต่างในกรอบนี้ถือว่า OK (เศษปัดเศษ/ทอนเล็กน้อย)
const DEPOSIT_TOLERANCE_CENTS = 2000; // ฿20

// mirror repair-actions.ts — แยก ResultOf<T> (มี data) ชัด กัน conditional-type edge ใน TS strict
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

// ── code-gen · DP-YYMMDD-NN (BE ปี 2 หลัก + วันเดือน + suffix กันชน) ──
// รูปแบบ human-readable · unique per org (มี @@unique([orgId, depositCode]) กันชนจริงที่ DB อีกชั้น)
function beDatePart(now: Date): string {
  const yy = String(now.getFullYear() + 543).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}
function depositSuffix(): string {
  const ts = Date.now().toString(36).slice(-3).toUpperCase();
  const rnd = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  return `${ts}${rnd}`;
}
function newDepositCode(now: Date): string {
  return `DP-${beDatePart(now)}-${depositSuffix()}`;
}

const RecordSchema = z.object({
  sessionIds: z
    .array(z.string().uuid("รหัสรอบไม่ถูกต้อง"))
    .min(1, "เลือกรอบที่จะฝากอย่างน้อย 1 รอบ")
    .max(200, "ฝากได้ครั้งละไม่เกิน 200 รอบ"),
  amountCents: z
    .number()
    .int("จำนวนเงินไม่ถูกต้อง")
    .min(0, "จำนวนเงินฝากต้องไม่ติดลบ")
    .max(1_000_000_000, "จำนวนเงินฝากสูงเกินไป"),
  slipPhotoUrl: z.string().trim().max(1000).optional(),
  depositedAt: z.string().trim().min(1, "ไม่ระบุวันเวลาที่ฝาก"),
  note: z.string().trim().max(2000).optional(),
});

/**
 * บันทึกใบฝากเงิน — ผูกหลายรอบเก็บ (custody) เข้าใบฝากเดียว + คิดส่วนต่าง OK/SHORT/OVER.
 *
 * สิทธิ์: คนถือเงิน (closedById = ตัวเองทุกรอบ) หรือ ผจก.สาขา/แอดมิน + branch-scoped
 *   (non-admin ทุกรอบต้องอยู่ในสาขาที่ตัวเองเข้าถึง). viewer เขียนไม่ได้ (ไม่เข้าเงื่อนไขข้างบน).
 *
 * ในทรานแซกชัน:
 *  1) โหลดรอบตาม sessionIds ที่ org + status ∈ depositable + depositId = null (dedup ids ก่อน)
 *  2) count ที่โหลดได้ ≠ ids.length → err (บางรอบฝากไปแล้ว/สถานะไม่ถูกต้อง/ไม่ใช่ org นี้)
 *  3) expected = Σ totalCashCents · variance = amount - expected · status ตามเกณฑ์ ฿20
 *  4) สร้าง CfCashDeposit (depositCode · depositedById/Name จาก session ผู้ใช้ · sessionCount)
 *  5) ATOMIC CLAIM: updateMany ผูก depositId ให้รอบ where ยัง depositId=null + status ถูก →
 *     count ≠ ids.length → throw (rollback · แปลว่ามีคนฝากรอบนี้ตัดหน้าไปแล้ว)
 *  6) auditLog CF_CASH_DEPOSIT (amount/expected/variance/sessionIds · flag SHORT)
 */
export async function recordCashDeposit(input: unknown): Promise<
  ResultOf<{ depositId: string; depositCode: string; status: string; varianceCents: number }>
> {
  const parsed = RecordSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  // dedup sessionIds — กันส่ง id ซ้ำมาแล้วนับเงินซ้ำ (expected เบิ้ล)
  const sessionIds = Array.from(new Set(data.sessionIds));

  // parse วันเวลาที่ฝาก (ISO) → กันค่าเพี้ยน
  const depositedAt = new Date(data.depositedAt);
  if (Number.isNaN(depositedAt.getTime())) return err("วันเวลาที่ฝากไม่ถูกต้อง");

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;
  const userId = session.user.id;
  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";

  // โหลดรอบ (org + status + ยังไม่ฝาก + มีเงิน) นอกทราน เพื่อเช็คสิทธิ์ + คิดยอด + resolve สาขาก่อน
  // totalCashCents > 0 ให้ตรง getPendingDeposits (list) เป๊ะ — กันผูกรอบ 0 บาทที่ list ไม่โชว์
  // (ถ้าไม่กรอง: ส่ง id รอบ 0 บาทมาก็ผูกได้ทั้งที่ผู้ใช้ไม่เห็นในรายการ → count mismatch หา sync ยาก).
  const sessions = await prisma.cfCollectionSession.findMany({
    where: {
      id: { in: sessionIds },
      orgId,
      depositId: null,
      status: { in: [...DEPOSITABLE_STATUSES] },
      totalCashCents: { gt: 0 },
    },
    select: {
      id: true,
      branchId: true,
      closedById: true,
      totalCashCents: true,
      group: { select: { branchId: true } },
    },
  });

  if (sessions.length !== sessionIds.length) {
    return err("บางรอบฝากไปแล้ว/สถานะไม่ถูกต้อง หรือไม่พบในองค์กรนี้ · รีเฟรชแล้วลองใหม่");
  }

  // resolve สาขาของแต่ละรอบ (branchId ตรง ๆ ก่อน · ไม่งั้น group.branchId)
  const branchOf = new Map<string, string>();
  for (const s of sessions) {
    const b = s.branchId ?? s.group?.branchId ?? null;
    if (!b) return err("มีรอบที่ไม่มีสาขา · ฝากไม่ได้");
    branchOf.set(s.id, b);
  }

  // ทุกรอบในใบฝากเดียวต้องเป็นสาขาเดียวกัน (ใบฝาก = ต่อสาขา · ยอดรวมข้ามสาขาไม่มีความหมาย)
  const branchIdSet = new Set(branchOf.values());
  if (branchIdSet.size !== 1) {
    return err("รอบที่เลือกอยู่คนละสาขา · ฝากแยกทีละสาขา");
  }
  const depositBranchId = Array.from(branchIdSet)[0]!;

  // ── สิทธิ์เขียน (ห้ามใช้ userBranchIds()==="ALL" ตัดสิน · viewer ได้ ALL) ──
  const adminPower = await cfHasAdminPower(session);
  const isManager = isCfBranchManager(session.user.role);
  const isCustodyHolder = sessions.every((s) => s.closedById === userId);

  if (!adminPower && !isManager && !isCustodyHolder) {
    return err("เฉพาะคนถือเงินรอบนี้ หรือผู้จัดการสาขา/แอดมินเท่านั้นที่บันทึกการฝากได้");
  }

  // branch-scope สำหรับ non-admin (ผจก./คนถือเงิน) — ทุกรอบต้องอยู่ในสาขาที่ตัวเองเข้าถึง
  if (!adminPower) {
    const scope = await userBranchIds(session);
    if (scope !== "ALL") {
      const allInScope = Array.from(branchOf.values()).every((b) => scope.includes(b));
      if (!allInScope) return err("ไม่มีสิทธิ์ในสาขาของรอบที่เลือก");
    }
  }

  // ── คิดยอด (นอกทราน · ค่าคงที่ · atomic claim จะยืนยันว่ารอบเดิมยังฝากไม่ไปอีกที) ──
  const expectedCents = sessions.reduce((sum, s) => sum + s.totalCashCents, 0);
  const varianceCents = data.amountCents - expectedCents;
  const status: "OK" | "SHORT" | "OVER" =
    Math.abs(varianceCents) <= DEPOSIT_TOLERANCE_CENTS
      ? "OK"
      : varianceCents < 0
        ? "SHORT"
        : "OVER";

  const now = new Date();
  const depositCode = newDepositCode(now);
  const cleanNote = data.note ? data.note.slice(0, 2000) : null;
  const slipUrl = data.slipPhotoUrl ? data.slipPhotoUrl.slice(0, 1000) : null;

  const result = await prisma
    .$transaction(async (tx) => {
      // 4) สร้างใบฝาก
      const deposit = await tx.cfCashDeposit.create({
        data: {
          orgId,
          branchId: depositBranchId,
          depositCode,
          amountCents: data.amountCents,
          expectedCents,
          varianceCents,
          status,
          sessionCount: sessionIds.length,
          slipPhotoUrl: slipUrl,
          note: cleanNote,
          depositedById: userId,
          depositedByName: byName,
          depositedAt,
        },
        select: { id: true },
      });

      // 5) ATOMIC CLAIM — ผูกรอบเข้าใบฝาก เฉพาะที่ยัง depositId=null + status ถูก.
      //    count ต้องเท่าจำนวนรอบที่เลือก · ไม่งั้น = มีคนฝากตัดหน้า → throw → rollback ใบฝากทิ้ง.
      const claim = await tx.cfCollectionSession.updateMany({
        where: {
          id: { in: sessionIds },
          orgId,
          depositId: null,
          status: { in: [...DEPOSITABLE_STATUSES] },
          totalCashCents: { gt: 0 }, // ให้ตรง where ตอนโหลด (กันผูกรอบ 0 บาท)
        },
        data: { depositId: deposit.id },
      });
      if (claim.count !== sessionIds.length) {
        throw new Error("บางรอบเพิ่งถูกฝากไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      // 6) audit trail (ในทรานเดียว · rollback ตามถ้าใบล้ม) — flag SHORT ให้จับตาเป็นพิเศษ
      await tx.auditLog.create({
        data: {
          orgId,
          userId,
          action: "CF_CASH_DEPOSIT",
          resourceType: "CF_CASH_DEPOSIT",
          resourceId: deposit.id,
          diff: {
            new: {
              depositCode,
              branchId: depositBranchId,
              amountCents: data.amountCents,
              expectedCents,
              varianceCents,
              status,
              sessionIds,
              sessionCount: sessionIds.length,
            },
            flagShort: status === "SHORT",
          },
        },
      });

      // คืน depositCode (DP-code human-readable) ให้ client โชว์แทน uuid ที่ผู้ใช้อ่านไม่รู้เรื่อง
      return { depositId: deposit.id, depositCode, status, varianceCents };
    })
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);

  revalidatePath(DEPOSITS_PATH);
  revalidatePath(DASHBOARD_PATH);
  return { ok: true, data: result };
}
