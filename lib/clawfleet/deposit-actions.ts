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
import { extractSlipDetails, checkSlipFraud, getConfiguredAccountNumber } from "./reconcile/slip-ocr";
import { retractDepositFromLedger } from "./reconcile/ledger-push";

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
  // ต้อง > 0 (ไม่ใช่ >= 0): ใบฝาก ฿0 ไม่มีความหมายทางบัญชี และฝั่ง ledger ปฏิเสธยอด 0 อยู่แล้ว
  // (ledger_revenue_entry มี CHECK amount_satang > 0) → ถ้าปล่อยให้สร้างได้ ใบนั้นจะไปตาย
  // ตอนกด "ส่งเข้ากระทบยอด" แล้วพาทั้งสาขาล้มไปด้วย. กันที่ต้นทางแบบเดียวกับ ChairOps
  // (app/(admin)/chairops/collect/actions.ts:480 "ยอดฝากต้องมากกว่า 0").
  amountCents: z
    .number()
    .int("จำนวนเงินไม่ถูกต้อง")
    .positive("ยอดฝากต้องมากกว่า 0")
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
  ResultOf<{ depositId: string; depositCode: string; status: string; varianceCents: number; approvalStatus: string }>
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

  // ใบฝากที่ "ยอดไม่ตรง" → ติดธง PENDING = **รอคนตรวจ** (ไม่ใช่ "ห้ามเงินไหล" อีกต่อไป).
  //   SHORT = เงินเข้าธนาคารไม่ครบ (เงินหายมือ→ธนาคาร) · OVER = ฝากเกินยอดที่ควรได้
  //   (fix 2026-07-20: เดิม OVER → NONE ผ่านอัตโนมัติ → พิมพ์ผิด/ยัดยอดเกิน = ยอด "ฝากเข้าธนาคาร"
  //    บวมปลอมโดยไม่มีใครตรวจ. ตอนนี้ทั้งขาดและเกิน (นอกเกณฑ์ ±฿20) ติดธงเหมือนกัน).
  //   OK (อยู่ในเกณฑ์) → NONE.
  //
  //   ⚠️ การ "ตรวจจับ" ตรงนี้ห้ามอ่อนลงเด็ดขาด — CEO สั่งให้เลิก **กั้น** เงิน ไม่ใช่เลิก **จับ**.
  //   varianceCents/status/approvalStatus ยังถูกคำนวณและบันทึกครบทั้งสองทิศเหมือนเดิมเป๊ะ
  //   พร้อม audit trail ด้านล่าง · สิ่งที่เปลี่ยนคือ ledger-push ไม่กัน PENDING ออกแล้ว.
  const approvalStatus: "NONE" | "PENDING" =
    status === "SHORT" || status === "OVER" ? "PENDING" : "NONE";

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
          approvalStatus, // SHORT → PENDING (รออนุมัติ) · OK/OVER → NONE
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
              approvalStatus,
              sessionIds,
              sessionCount: sessionIds.length,
            },
            flagShort: status === "SHORT",
          },
        },
      });

      // คืน depositCode (DP-code human-readable) ให้ client โชว์แทน uuid ที่ผู้ใช้อ่านไม่รู้เรื่อง
      return { depositId: deposit.id, depositCode, status, varianceCents, approvalStatus };
    })
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);

  revalidatePath(DEPOSITS_PATH);
  revalidatePath(DASHBOARD_PATH);

  // เวิร์กช็อป 2026-08-29 · AI (Gemini) อ่านสลิป (ยอด/วันที่/บัญชีปลายทาง) + ตรวจสลิปซ้ำ/บัญชีผิด
  // นอกธุรกรรม (ไม่บล็อกการฝากที่เพิ่งสำเร็จไปแล้ว) — อ่านไม่ทัน/พังก็ไม่เป็นไร ใบฝากยังใช้ได้ปกติ
  // แค่ไม่มีข้อมูล AI ประกอบ (mirror ChairOps: lib/chairops/reconcile/slip-ocr.ts integration)
  if (slipUrl) {
    try {
      const ocr = await extractSlipDetails(slipUrl, { userId, orgId });
      const configuredAccountNumber = await getConfiguredAccountNumber(depositBranchId);
      const fraud = await checkSlipFraud({
        orgId,
        branchId: depositBranchId,
        depositId: result.depositId,
        ocr,
        configuredAccountNumber,
      });

      await prisma.cfCashDeposit.update({
        where: { id: result.depositId },
        data: {
          ocrAmountCents: ocr.amount != null ? Math.round(ocr.amount * 100) : null,
          ocrDate: ocr.date ? new Date(`${ocr.date}T00:00:00.000Z`) : null,
          ocrAccountName: ocr.accountName,
          ocrAccountNumber: ocr.accountNumber,
          ocrRefNo: ocr.refNo,
          ocrReadAt: new Date(),
          ocrFlagReason: fraud.reason,
        },
      });

      // AI ติดธง (สลิปซ้ำ/บัญชีปลายทางผิด) + ยอดตรง (NONE) → ยกเป็น PENDING ให้ office ตรวจ
      // ตอนนี้ PENDING = "ติดธง รอตรวจ" ไม่ได้กันเงินออกจาก ledger แล้ว → ใบนี้ยังไหลเข้าบัญชี
      // กระทบยอดตามปกติ แต่จะโชว์สีเตือน + เหตุผลที่ AI สงสัย ให้แอดมินกดตรวจย้อนหลัง.
      if (fraud.flagged) {
        await prisma.cfCashDeposit.updateMany({
          where: { id: result.depositId, approvalStatus: "NONE" },
          data: { approvalStatus: "PENDING" },
        });
      }

      revalidatePath(DEPOSITS_PATH);
    } catch (e) {
      // best-effort — อ่านสลิปพัง/ตรวจโกงพัง ต้องไม่ทำให้ใบฝากที่บันทึกสำเร็จแล้วดูเหมือนพังไปด้วย
      console.error("[clawfleet] deposit slip OCR/fraud-check failed (non-fatal)", e);
    }
  }

  return { ok: true, data: result };
}

// =============================================================
// "ตรวจแล้ว" / ตีกลับ ใบฝากที่ยอดไม่ตรง — ตัวชี้วัดการตรวจ (ไม่ใช่ประตูกั้นเงินอีกต่อไป)
//
// CEO 2026-09-22: "ยอดไหน กรอกมา ฝากมา ขึ้นเลย ... อาจจะติดสีที่ตัวเลข เพื่อโชว์ความผิดปกติ
//   เฉย ๆ แล้วกดที่ตรงนั้นให้แอดมินยืนยันตรวจสอบได้"
//   → เงินไหลเข้า ledger ทันทีแม้ยอดไม่ตรง (ดู reconcile/ledger-push.ts) · ปุ่มนี้กลายเป็น
//     "รับทราบว่าตรวจแล้ว" ไม่ใช่ "ปลดล็อกเงิน".
//
//     - เฉพาะ ผจก.สาขา/แอดมิน (cfHasAdminPower || isCfBranchManager) · branch-scoped ด้วย deposit.branchId
//     - ✅ approve ("ตรวจแล้ว"): **ตัวเองกดใบตัวเองได้แล้ว** — เดิมห้าม (maker ≠ checker) เพราะมันคือ
//       ประตูปล่อยเงิน · ตอนนี้ไม่ใช่ประตูแล้ว และสาขาที่มีพนักงานคนเดียวจะไม่มีใครกดได้เลย
//       (= ต้นเหตุที่เงินค้างเงียบตลอดไป). ยังบันทึกครบว่าใครกด/เมื่อไร → ตรวจย้อนหลังได้
//     - ⛔ reject ("ตีกลับ"): **ยังคง maker ≠ checker** — อันนี้ขยับเงินจริง (ทำให้ใบเป็นโมฆะ
//       + คืนรอบให้ฝากใหม่ + ถอนยอดออกจาก ledger) ถ้าปล่อยให้คนฝากตีกลับใบตัวเองได้เงียบ ๆ
//       = ลบร่องรอยตัวเองได้ → ช่องโกงจริง จึงไม่ผ่อน
//     - ต้องเป็นใบ approvalStatus = PENDING เท่านั้น · atomic claim (updateMany) กันกดซ้ำ/race
//     - approve → APPROVED + stamp reviewer (รอบยังผูกใบเดิม · ยอดใน ledger อยู่เหมือนเดิม)
//     - reject  → REJECTED + ถอนแถวออกจาก ledger (ถ้ายังไม่กระทบยอด) + un-set sessions.depositId
//                 = null (คืนรอบกลับ "รอฝาก") + stamp
//     - ทั้งหมดใน $transaction เดียว + auditLog CF_CASH_DEPOSIT_REVIEW
// =============================================================
const ReviewDepositSchema = z.object({
  depositId: z.string().uuid("ใบฝากไม่ถูกต้อง"),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export async function reviewCashDeposit(
  input: unknown,
): Promise<ResultOf<{ depositId: string; approvalStatus: "APPROVED" | "REJECTED" }>> {
  const parsed = ReviewDepositSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { depositId, decision, note } = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // หาใบฝากก่อน (org-scoped) เพื่อ assert สิทธิ์ตามสาขา + เช็ก maker + สถานะ
  const head = await prisma.cfCashDeposit.findFirst({
    where: { id: depositId, orgId },
    select: {
      id: true,
      branchId: true,
      status: true,
      approvalStatus: true,
      depositedById: true,
    },
  });
  if (!head) return err("ไม่พบใบฝาก");

  // role-rank guard — เฉพาะ ผจก.สาขา/แอดมิน (mirror auth ฝั่งสร้าง · ห้ามใช้ scope==="ALL" ตัดสิน)
  const adminPower = await cfHasAdminPower(session);
  const isManager = isCfBranchManager(session.user.role);
  if (!adminPower && !isManager) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่อนุมัติ/ตีกลับใบฝากขาดได้");
  }

  // branch-scope สำหรับ non-admin (ผจก.) — ต้องเข้าถึงสาขาของใบฝากนี้
  if (!adminPower) {
    const scope = await userBranchIds(session);
    if (scope !== "ALL" && !scope.includes(head.branchId)) {
      return err("ไม่มีสิทธิ์ในสาขาของใบฝากนี้");
    }
  }

  // maker ≠ checker — เหลือเฉพาะ "ตีกลับ" (ขยับเงินจริง) · "ตรวจแล้ว" ผ่อนให้กดใบตัวเองได้
  // (CEO 2026-09-22 · ดูเหตุผลเต็มในหัวข้อด้านบน — สาขาพนักงานคนเดียวต้องปิดงานตัวเองได้)
  if (decision === "reject" && head.depositedById === session.user.id) {
    return err("ตีกลับใบที่ตัวเองบันทึกฝากไม่ได้ · ให้คนอื่นตรวจ (maker ≠ checker)");
  }

  // ต้องเป็นใบที่ยัง PENDING เท่านั้น — ตัดสินไปแล้วห้ามซ้ำ · NONE (ยอดตรง) ไม่ต้องตรวจ
  if (head.approvalStatus !== "PENDING") {
    return err(
      head.approvalStatus === "APPROVED"
        ? "ใบนี้ตรวจแล้ว"
        : head.approvalStatus === "REJECTED"
          ? "ใบนี้ถูกตีกลับไปแล้ว"
          : "ใบนี้ยอดตรง ไม่ต้องตรวจ",
    );
  }

  const newStatus: "APPROVED" | "REJECTED" = decision === "approve" ? "APPROVED" : "REJECTED";
  const reviewerName = session.user.name || session.user.email || "ไม่ทราบชื่อ";

  const result = await prisma
    .$transaction(async (tx) => {
      // 🔒 atomic claim — ตัดสินได้ครั้งเดียว: อัปเดตเฉพาะแถวที่ยัง PENDING.
      // 2 คนกดพร้อมกัน → คนที่สอง match 0 แถว → throw → rollback (ไม่ตัดสินซ้ำ/คืนรอบซ้ำ).
      const claim = await tx.cfCashDeposit.updateMany({
        where: { id: head.id, orgId, approvalStatus: "PENDING" },
        data: {
          approvalStatus: newStatus,
          reviewedById: session.user.id,
          reviewedByName: reviewerName,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });
      if (claim.count !== 1) {
        throw new Error("ใบนี้เพิ่งถูกตัดสินไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      // reject → คืนรอบกลับ "รอฝาก": un-set depositId ของทุกรอบที่ผูกใบนี้ → กลับไปฝากใหม่ได้.
      // approve → ไม่ต้องแตะรอบ (ส่วนต่างถูกรับทราบ · รอบยังผูกใบเดิมเป็นหลักฐาน).
      if (newStatus === "REJECTED") {
        // 🔒 ต้องถอนยอดออกจาก ledger ก่อน — ตอนนี้ใบติดธงเข้า ledger ไปแล้วตั้งแต่ก่อนตรวจ
        //    ถ้าไม่ถอน: ตีกลับ → ฝากใหม่ → ส่งอีกครั้ง = เงินก้อนเดียวถูกนับ 2 แถว.
        //    ถ้าแถวนั้นจับคู่ statement แล้ว ถอนไม่ได้ → ยกเลิกทั้งทราน (ห้ามตีกลับ)
        const retracted = await retractDepositFromLedger(tx, orgId, head.id);
        if (!retracted) {
          throw new Error(
            "ใบนี้จับคู่กับรายการธนาคารในบัญชีกระทบยอดแล้ว · ตีกลับไม่ได้ " +
              "(ธนาคารยืนยันว่าเงินเข้าจริง) — ให้ยกเลิกการจับคู่ที่หน้ากระทบยอดก่อน " +
              "หรือกด “ตรวจแล้ว” แทนถ้ายอมรับส่วนต่างนี้",
          );
        }
        await tx.cfCollectionSession.updateMany({
          where: { orgId, depositId: head.id },
          data: { depositId: null },
        });
      }

      // audit trail (ในทรานเดียว · rollback ตามถ้า claim ล้ม) — ใครอนุมัติ/ตีกลับ + จากสถานะไหนไปไหน
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_CASH_DEPOSIT_REVIEW",
          resourceType: "CF_CASH_DEPOSIT",
          resourceId: head.id,
          diff: {
            old: { approvalStatus: "PENDING" },
            new: {
              decision,
              approvalStatus: newStatus,
              reviewNote: note || null,
              depositedById: head.depositedById,
              // reject คืนรอบให้ฝากใหม่ (unlinked) · approve คงผูกรอบเดิมไว้
              sessionsUnlinked: newStatus === "REJECTED",
            },
          },
        },
      });

      return { approvalStatus: newStatus };
    })
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);

  revalidatePath(DEPOSITS_PATH);
  revalidatePath(DASHBOARD_PATH);
  return { ok: true, data: { depositId, approvalStatus: result.approvalStatus } };
}
