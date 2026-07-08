"use server";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 1A · N1 ตั้งค่าครั้งแรก (First-collection BASELINE)
// -----------------------------------------------------------------------------
// ทำไมมี (blueprint §2 N1 · CEO R2 2026-07-08):
//   ตู้ที่เพิ่งลงสาขา = "AWAITING_SETUP ⚪" (ยังไม่มี baseline) → drift verdict เทียบอะไรไม่ได้.
//   แม่บ้านไปเก็บครั้งแรกต้อง "ตั้งค่าครั้งแรก": นับตุ๊กตาในตู้ (ครั้งแรกช่องว่าง) · เติมของ · เก็บเงิน ·
//   อ่าน 4 มิเตอร์กายภาพ (money-top/bottom · doll-top/bottom) · ถ่ายรูปตู้+รูปมิเตอร์เป็นหลักฐาน.
//   จากนั้น "ล็อกตู้" (isFirstBaselineLocked=true) → รอบต่อไปเริ่มคิด short/over จริง.
//
// once-only (C2): partial-unique index cf_events_one_baseline_per_machine ON
//   cf_collection_events(machine_id) WHERE event_type='INITIAL' → มี baseline ได้ตู้ละ 1 ครั้ง.
//   2 แม่บ้านกดพร้อมกัน/กดซ้ำ → DB โยน P2002 → คนแรกชนะ · คนหลังได้ข้อความเป็นมิตร.
//
// สิทธิ์ (blueprint §6 C6): แม่บ้าน (branch-access) ทำได้ — ไม่ต้องเป็นแอดมิน.
//   แต่ห้าม gate ด้วย userBranchIds()==='ALL' (viewer ก็ได้ "ALL") → เช็ก membership จริง
//   (UserBranch) หรือ cfHasAdminPower.
//
// per-meter fallback (CEO R2): มิเตอร์ตัวไหนอ่านไม่ออก → เว้นว่าง (null) ได้ ถ้าแนบรูปมิเตอร์นั้น
//   (รูป = หลักฐานแทนตัวเลข). มิเตอร์ที่ไม่ null ต้องเป็นจำนวนเต็ม ≥ 0.
//
// idempotency: clientKey ต่อการกด → ถ้ามี baseline event ที่ clientKey นี้อยู่แล้ว = no-op คืนของเดิม
//   (offline retry / double-tap ไม่สร้างซ้ำ). เก็บ clientKey ใน CfCollectionEvent.notes marker.
//
// มิเตอร์เก็บเป็น Int (ไม่ใช่ cents). เงินเก็บเป็น cents.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds, cfHasAdminPower } from "./role-guard";

const APP_PATHS = [
  "/clawfleet/os/app",
  "/clawfleet/os/dashboard",
  "/clawfleet/os/matrix",
  "/liff/clawfleet",
];

type SubmitResult =
  | { ok: true; sessionId: string; machineId: string }
  | { ok: false; error: string };

type RedoResult = { ok: true; ticketId: string } | { ok: false; error: string };

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

// marker ที่ฝัง clientKey ลง notes เพื่อทำ idempotency (ไม่เพิ่มคอลัมน์ใน event)
const CLIENT_KEY_MARKER = "[BASELINE_KEY]";
function clientKeyNote(clientKey: string): string {
  return `${CLIENT_KEY_MARKER}${clientKey}`;
}

// มิเตอร์ 1 ตัว: null (อ่านไม่ออก) หรือ จำนวนเต็ม ≥ 0. per-meter fallback เช็คคู่รูปทีหลัง.
const zMeter = z.number().int("มิเตอร์ต้องเป็นจำนวนเต็ม").min(0, "มิเตอร์ติดลบไม่ได้").max(2_000_000_000).nullable();
const zPhotoUrl = z.string().trim().url("ลิงก์รูปไม่ถูกต้อง").max(1000);

const SubmitBaselineSchema = z.object({
  machineId: z.string().uuid("ไม่ระบุตู้"),
  dollCountNow: z.number().int("จำนวนตุ๊กตาต้องเป็นจำนวนเต็ม").min(0, "ติดลบไม่ได้").max(100_000),
  dollsAdded: z.number().int("จำนวนที่เติมต้องเป็นจำนวนเต็ม").min(0, "ติดลบไม่ได้").max(100_000),
  cashCents: z.number().int("เงินต้องเป็นจำนวนเต็ม (สตางค์)").min(0, "เงินติดลบไม่ได้").max(1_000_000_000),
  meterMoneyTop: zMeter,
  meterMoneyBottom: zMeter,
  meterDollTop: zMeter,
  meterDollBottom: zMeter,
  photoMachineUrl: zPhotoUrl.optional(),
  photoMoneyMeterTopUrl: zPhotoUrl.optional(),
  photoMoneyMeterBottomUrl: zPhotoUrl.optional(),
  photoDollMeterTopUrl: zPhotoUrl.optional(),
  photoDollMeterBottomUrl: zPhotoUrl.optional(),
  loadout: z
    .array(
      z.object({
        productId: z.string().uuid("สินค้าไม่ถูกต้อง"),
        qty: z.number().int().min(1).max(100_000),
      }),
    )
    .max(50)
    .optional(),
  clientKey: z.string().trim().min(1, "ไม่มี clientKey").max(200),
});

/**
 * ตั้งค่าครั้งแรก (baseline) ให้ตู้ 1 ตัว — แม่บ้าน (branch-access) ทำได้ · ตู้ละ 1 ครั้ง.
 *
 * ทำใน $transaction เดียว (ไม่มี half-written baseline):
 *   1) สร้าง CfCollectionSession { isBaseline:true, status:CLOSED, branchId, openedById, closedAt }
 *   2) สร้าง CfCollectionEvent { eventType:INITIAL, coinMeterBefore = machine.lastCoinMeter,
 *        coinMeterAfter = ค่าอ่านเหรียญที่ดีที่สุด, 4 มิเตอร์กายภาพ, รูป photo_*,
 *        stockAfter = dollCountNow, refillQty = dollsAdded, cashCountedCents = cashCents }
 *      → trigger cf_update_machine_mirror จะ sync last_coin_meter / last_doll_stock ให้เอง.
 *   3) snapshot loadout → เปิดแถว CfMachineLoadout (effectiveTo=null) ตามที่ส่งมา
 *   4) lock ตู้: isFirstBaselineLocked=true, firstBaselineAppliedAt=now
 *   5) audit_log CF_FIRST_BASELINE_APPLIED (เวลาที่ล็อก)
 *
 * once-only: INITIAL insert ชน partial-unique → P2002 → "ตู้นี้ตั้งค่าครั้งแรกไปแล้ว".
 * idempotency: clientKey ซ้ำ → คืน baseline เดิม (no-op).
 */
export async function submitFirstBaseline(input: {
  machineId: string;
  dollCountNow: number;
  dollsAdded: number;
  cashCents: number;
  meterMoneyTop: number | null;
  meterMoneyBottom: number | null;
  meterDollTop: number | null;
  meterDollBottom: number | null;
  photoMachineUrl?: string;
  photoMoneyMeterTopUrl?: string;
  photoMoneyMeterBottomUrl?: string;
  photoDollMeterTopUrl?: string;
  photoDollMeterBottomUrl?: string;
  loadout?: { productId: string; qty: number }[];
  clientKey: string;
}): Promise<SubmitResult> {
  const parsed = SubmitBaselineSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  // per-meter fallback (CEO R2): มิเตอร์ตัวไหน "ว่าง" (null) ต้องมี "รูปมิเตอร์ตัวนั้น" เป็นหลักฐาน.
  // ตัวไหนมีเลขก็ไม่ต้องบังคับรูป. (รูปเป็น optional โดยรวม แต่ถ้าเว้นเลข = ต้องมีรูป.)
  const meterChecks: { value: number | null; photo: string | undefined; label: string }[] = [
    { value: data.meterMoneyTop, photo: data.photoMoneyMeterTopUrl, label: "มิเตอร์เงินบน" },
    { value: data.meterMoneyBottom, photo: data.photoMoneyMeterBottomUrl, label: "มิเตอร์เงินล่าง" },
    { value: data.meterDollTop, photo: data.photoDollMeterTopUrl, label: "มิเตอร์ตุ๊กตาบน" },
    { value: data.meterDollBottom, photo: data.photoDollMeterBottomUrl, label: "มิเตอร์ตุ๊กตาล่าง" },
  ];
  for (const m of meterChecks) {
    if (m.value === null && !m.photo) {
      return err(`${m.label} อ่านไม่ออก · ต้องแนบรูปมิเตอร์ตัวนี้เป็นหลักฐาน`);
    }
  }

  // P2 (audit 2026-07-08): มิเตอร์ "เงิน" ต้องมีเลขจริงอย่างน้อย 1 ตำแหน่ง — ห้าม photo-only.
  // ถ้าปล่อยมิเตอร์เงินว่างทั้งคู่ → bestCoinReading fallback = machine.lastCoinMeter (=0 ตู้ใหม่)
  // → coin baseline = 0 (ไร้ความหมาย) → revenue รอบจริงรอบแรกพองผิด. รูปแทนได้เฉพาะมิเตอร์ตุ๊กตา.
  if (data.meterMoneyTop === null && data.meterMoneyBottom === null) {
    return err("มิเตอร์เงินต้องกรอกเลขอย่างน้อย 1 ตำแหน่ง (รูปแทนได้เฉพาะมิเตอร์ตุ๊กตา)");
  }

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // โหลดตู้ (org scope) — ต้องเป็น CLAW ที่ยังไม่ล็อก baseline
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId },
    select: {
      id: true,
      branchId: true,
      kind: true,
      lastCoinMeter: true,
      isFirstBaselineLocked: true,
    },
  });
  if (!machine) return err("ไม่พบตู้ในองค์กรนี้");

  // สิทธิ์ = branch-access จริง (membership UserBranch) หรือ admin-power.
  // ⚠️ ห้าม gate ด้วย userBranchIds()==='ALL' (viewer ได้ "ALL" ด้วย · C6).
  const adminPower = await cfHasAdminPower(session);
  if (!adminPower) {
    const ub = await prisma.userBranch.findFirst({
      where: { userId: session.user.id, branchId: machine.branchId },
      select: { id: true },
    });
    if (!ub) return err("ไม่มีสิทธิ์ตั้งค่าตู้ในสาขานี้");
  }

  if (machine.isFirstBaselineLocked) {
    return err("ตู้นี้ตั้งค่าครั้งแรกไปแล้ว");
  }

  // idempotency (offline retry / double-tap) — baseline INITIAL ที่ clientKey นี้มีอยู่แล้ว → คืนของเดิม
  const existing = await prisma.cfCollectionEvent.findFirst({
    where: {
      orgId,
      machineId: machine.id,
      eventType: "INITIAL",
      notes: { contains: clientKeyNote(data.clientKey) },
    },
    select: { id: true, sessionId: true },
  });
  if (existing?.sessionId) {
    return { ok: true, sessionId: existing.sessionId, machineId: machine.id };
  }

  // coinMeterAfter = ค่าอ่านเหรียญที่ดีที่สุด (money-top ก่อน · ถ้า null ใช้ money-bottom · ถ้าไม่มีเลย
  // ใช้ mirror เดิมของตู้ = ไม่ขยับ). ใช้เป็น "หลัง" ของ INITIAL → trigger sync mirror ให้.
  const bestCoinReading =
    data.meterMoneyTop ?? data.meterMoneyBottom ?? machine.lastCoinMeter;
  const bestDollReading = data.meterDollTop ?? data.meterDollBottom ?? null;

  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1) baseline session (ปิดทันที · ไม่ค้าง OPEN)
      const cfSession = await tx.cfCollectionSession.create({
        data: {
          orgId,
          branchId: machine.branchId,
          sessionCode: `BASE-${machine.id.slice(0, 8)}-${data.clientKey.slice(0, 24)}`,
          isBaseline: true,
          status: "CLOSED",
          openedById: session.user.id,
          closedById: session.user.id,
          closedAt: now,
          totalCashCents: data.cashCents,
        },
        select: { id: true },
      });

      // 2) INITIAL event (partial-unique lock ตู้ครั้งเดียว) — clientKey ฝังใน notes
      await tx.cfCollectionEvent.create({
        data: {
          orgId,
          sessionId: cfSession.id,
          machineId: machine.id,
          eventType: "INITIAL",
          collectedAt: now,
          collectedById: session.user.id,
          coinMeterBefore: machine.lastCoinMeter,
          coinMeterAfter: bestCoinReading,
          cashCountedCents: data.cashCents,
          dollMeterBefore: null,
          dollMeterAfter: bestDollReading,
          stockBefore: null,
          stockAfter: data.dollCountNow,
          refillQty: data.dollsAdded,
          // N1 · 4 มิเตอร์กายภาพ (คอลัมน์ dedicated · ไม่ยืมช่อง 5-photo เดิมที่ชื่อไม่ตรง content)
          meterMoneyTop: data.meterMoneyTop,
          meterMoneyBottom: data.meterMoneyBottom,
          meterDollTop: data.meterDollTop,
          meterDollBottom: data.meterDollBottom,
          photoMoneyMeterTopUrl: data.photoMoneyMeterTopUrl ?? null,
          photoMoneyMeterBottomUrl: data.photoMoneyMeterBottomUrl ?? null,
          photoDollMeterTopUrl: data.photoDollMeterTopUrl ?? null,
          photoDollMeterBottomUrl: data.photoDollMeterBottomUrl ?? null,
          photoMachineUrl: data.photoMachineUrl ?? null,
          notes: clientKeyNote(data.clientKey),
        },
      });

      // 3) snapshot loadout → เปิดแถว current (effectiveTo=null) ตามที่ส่งมา
      if (data.loadout && data.loadout.length > 0) {
        for (const line of data.loadout) {
          await tx.cfMachineLoadout.create({
            data: {
              orgId,
              machineId: machine.id,
              productId: line.productId,
              // จำนวน (qty) ไม่ใช่ราคา — pricePerPlayCoins คงค่า default (1) เพราะ baseline
              // สนใจ "มีสินค้าอะไรในตู้" เป็นหลัก · ราคา/ครั้ง ปรับทีหลังผ่าน config/refill.
              pricePerPlayCoins: 1,
              effectiveFrom: now,
              effectiveTo: null,
              setById: session.user.id,
              notes: `baseline setup · จำนวน ${line.qty}`,
            },
          });
        }
      }

      // 4) lock ตู้ (once-only). mirror last_coin_meter/last_doll_stock → trigger เขียนจาก event ให้แล้ว.
      await tx.cfMachine.update({
        where: { id: machine.id },
        data: {
          isFirstBaselineLocked: true,
          firstBaselineAppliedAt: now,
          // รูปตู้ล่าสุด (N4) — ถ้าแนบมา เก็บลง CfMachine.photoUrl ด้วย
          ...(data.photoMachineUrl ? { photoUrl: data.photoMachineUrl } : {}),
        },
      });

      // 5) audit — บันทึกช่วงเวลาที่ baseline ถูกใช้ (anti-fraud trail)
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_FIRST_BASELINE_APPLIED",
          resourceType: "CF_MACHINE",
          resourceId: machine.id,
          diff: {
            branchId: machine.branchId,
            appliedBy: byName,
            dollCountNow: data.dollCountNow,
            dollsAdded: data.dollsAdded,
            cashCents: data.cashCents,
            meters: {
              moneyTop: data.meterMoneyTop,
              moneyBottom: data.meterMoneyBottom,
              dollTop: data.meterDollTop,
              dollBottom: data.meterDollBottom,
            },
          },
        },
      });

      return { sessionId: cfSession.id };
    });

    for (const p of APP_PATHS) revalidatePath(p);
    return { ok: true, sessionId: result.sessionId, machineId: machine.id };
  } catch (e) {
    // P2002 = ชน partial-unique baseline index (ตู้นี้มี INITIAL แล้ว) = คนอื่นตั้ง baseline ไปก่อน
    if ((e as { code?: string }).code === "P2002") {
      return err("ตู้นี้ตั้งค่าครั้งแรกไปแล้ว");
    }
    return err(`ตั้งค่าครั้งแรกไม่สำเร็จ: ${(e as Error).message}`);
  }
}

const RedoSchema = z.object({
  machineId: z.string().uuid("ไม่ระบุตู้"),
  reason: z.string().trim().min(1, "กรอกเหตุผลที่ขอตั้งค่าใหม่").max(2000),
});

/**
 * ขอ "ตั้งค่าครั้งแรกใหม่" (redo baseline) — สร้างใบขอที่ super_admin คนเดียวอนุมัติได้.
 *
 * เพราะ baseline = ตัวหารรายได้ (เหมือน rebaseline มิเตอร์) → การล้างล็อกเพื่อตั้งใหม่ = เรื่องเงิน ·
 *   ห้ามให้แม่บ้าน/ผจก.สาขา ปลดล็อกเอง → route ไป super_admin ผ่าน CfRepairTicket kind='FIRST_SETUP'
 *   approverRole='super_admin' + meterResetRequested=true (resolveRepairTicket จะ enforce super_admin-ONLY).
 *
 * ผู้เสนอ = คนปัจจุบัน (branch-access). อนุมัติ = super_admin เท่านั้น (คนละคน · maker≠checker enforce ตอน resolve).
 */
export async function requestBaselineRedo(input: {
  machineId: string;
  reason: string;
}): Promise<RedoResult> {
  const parsed = RedoSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId },
    select: { id: true, branchId: true, code: true },
  });
  if (!machine) return err("ไม่พบตู้ในองค์กรนี้");

  // สิทธิ์เสนอ = เข้าถึงสาขาของตู้ได้ (branch-access จริง หรือ admin-power) — ห้าม gate ด้วย 'ALL'
  const adminPower = await cfHasAdminPower(session);
  if (!adminPower) {
    const ub = await prisma.userBranch.findFirst({
      where: { userId: session.user.id, branchId: machine.branchId },
      select: { id: true },
    });
    if (!ub) return err("ไม่มีสิทธิ์ขอตั้งค่าตู้สาขานี้ใหม่");
  }

  const byName = session.user.name || session.user.email || "ไม่ทราบชื่อ";

  try {
    const ticketId = await prisma.$transaction(async (tx) => {
      const ticket = await tx.cfRepairTicket.create({
        data: {
          orgId,
          branchId: machine.branchId,
          machineId: machine.id,
          machineCode: machine.code,
          symptom: data.reason,
          kind: "FIRST_SETUP",
          approverRole: "super_admin",
          meterResetRequested: true,
          status: "OPEN",
          reportedById: session.user.id,
          reportedByName: byName,
        },
        select: { id: true },
      });

      await tx.cfRepairLog.create({
        data: {
          orgId,
          ticketId: ticket.id,
          action: "REPORT",
          byId: session.user.id,
          byName,
          note: `ขอตั้งค่าครั้งแรกใหม่ (FIRST_SETUP redo): ${data.reason}`,
        },
      });

      return ticket.id;
    });

    revalidatePath("/clawfleet/os/repairs");
    return { ok: true, ticketId };
  } catch (e) {
    return err(`ขอตั้งค่าใหม่ไม่สำเร็จ: ${(e as Error).message}`);
  }
}
