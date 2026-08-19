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
// photos OPTIONAL (CEO 2026-07-12): รูปไม่บล็อกการบันทึกอีกต่อไป — "ตัวเลข" คือ anchor.
//   แทนที่ "มิเตอร์ OR รูป" → เป็น "มิเตอร์ต้องมีเลข (non-null), รูปเสริมได้ (optional)".
//   รอบที่ยังไม่แนบรูป (photo_* = null) = "ยังไม่ครบ (incomplete)" — task อื่นอ่านจากคอลัมน์รูป null เอง.
//   มิเตอร์ที่ไม่ null ต้องเป็นจำนวนเต็ม ≥ 0 (schema เดิม).
//
// idempotency: clientKey ต่อการกด → ถ้ามี baseline event ที่ clientKey นี้อยู่แล้ว = no-op คืนของเดิม
//   (offline retry / double-tap ไม่สร้างซ้ำ). เก็บ clientKey ใน CfCollectionEvent.notes marker.
//
// มิเตอร์เก็บเป็น Int (ไม่ใช่ cents). เงินเก็บเป็น cents.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
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
  // ราคาขายตุ๊กตา "ต่อตู้" (ราคาเดียวต่อตู้ · บาท×100) · optional · display/reference (ไม่แตะกระทบยอดเงิน)
  sellPriceCents: z.number().int("ราคาต้องเป็นจำนวนเต็ม (สตางค์)").min(0, "ราคาติดลบไม่ได้").max(10_000_000).optional(),
  // ดีไซน์ใหม่ · รูปตุ๊กตา "ก่อน/หลังใส่" ตอนตั้งค่า — ยืมช่องเดียวกับรอบเก็บเงิน (photoStockUrl / photoMeterBeforeUrl)
  photoStockBeforeUrl: zPhotoUrl.optional(),
  photoStockAfterUrl: zPhotoUrl.optional(),
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
 * เขียนผ่าน Supabase adminClient เรียงทีละขั้น (ไม่ใช้ prisma.$transaction — 2026-08-19: interactive
 * tx บน prod transaction pooler บางทีไม่ commit จริงทั้งที่ action ตอบสำเร็จ) + rollback มือถ้าขั้น
 * หลังพัง กัน half-written baseline:
 *   1) สร้าง cf_collection_sessions { is_baseline:true, status:CLOSED, branch_id, opened_by_id, closed_at }
 *   2) สร้าง cf_collection_events { event_type:INITIAL, coin_meter_before = machine.lastCoinMeter,
 *        coin_meter_after = ค่าอ่านเหรียญที่ดีที่สุด, 4 มิเตอร์กายภาพ, รูป photo_*,
 *        stock_after = dollCountNow, refill_qty = dollsAdded, cash_counted_cents = cashCents }
 *      → trigger cf_update_machine_mirror จะ sync last_coin_meter / last_doll_stock ให้เอง.
 *   3) snapshot loadout → เปิดแถว cf_machine_loadouts (effective_to=null) ตามที่ส่งมา
 *   4) lock ตู้: is_first_baseline_locked=true, first_baseline_applied_at=now
 *   5) audit_log CF_FIRST_BASELINE_APPLIED (เวลาที่ล็อก) — ผ่าน audit() helper (adminClient เสมออยู่แล้ว)
 *
 * once-only: INITIAL insert ชน partial-unique → 23505 → "ตู้นี้ตั้งค่าครั้งแรกไปแล้ว" (+ rollback
 *   orphan session ที่คำขอนี้เพิ่งสร้าง). ขั้น 3/4 พัง → rollback event+session+loadout ที่สร้างไปแล้วทั้งหมด.
 * idempotency: clientKey ซ้ำ → คืน baseline เดิม (no-op) — เช็คแบบ read-first ด้านล่าง + ปิด race
 *   window ด้วย sessionCode ที่ผูกกับ clientKey ตรงๆ (ชน unique ที่ขั้น 1 ก่อนใคร ถ้า race กันจริง).
 */
export async function submitFirstBaseline(input: {
  machineId: string;
  dollCountNow: number;
  dollsAdded: number;
  cashCents: number;
  sellPriceCents?: number; // ราคาขายตุ๊กตาต่อตู้ (ราคาเดียว · บาท×100) · optional
  photoStockBeforeUrl?: string; // รูปตุ๊กตาก่อนใส่ (ตั้งค่า) · optional
  photoStockAfterUrl?: string; // รูปตุ๊กตาหลังใส่ (ตั้งค่า) · optional
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

  // ✅ NUMBERS = anchor (CEO 2026-07-12): รูปทุกใบ optional (ไม่บล็อกการบันทึก) แต่ "เลขมิเตอร์" ต้องมี
  //   อย่างน้อย 1 หน้าปัดต่อคู่ (เงิน: บน-หรือ-ล่าง · ตุ๊กตา: บน-หรือ-ล่าง) ให้ตรงกับที่คณิตใช้จริง
  //   (bestCoinReading = top ?? bottom). ตู้ที่หน้าปัดล่างเสีย/อ่านไม่ออก → ยังตั้ง baseline ได้จากตัวบน.
  //   ว่างทั้งคู่ = anchor คู่นั้นพัง → บล็อก. เดิม "มิเตอร์ OR รูป" → "มิเตอร์ต้องมีเลข ≥1/คู่, รูปเสริม".
  const moneyMeterOk = data.meterMoneyTop !== null || data.meterMoneyBottom !== null;
  const dollMeterOk = data.meterDollTop !== null || data.meterDollBottom !== null;
  if (!moneyMeterOk) {
    return err("มิเตอร์เงิน ยังไม่ได้กรอกเลข — ต้องมีอย่างน้อย 1 หน้าปัด (บนหรือล่าง)");
  }
  if (!dollMeterOk) {
    return err("มิเตอร์ตุ๊กตา ยังไม่ได้กรอกเลข — ต้องมีอย่างน้อย 1 หน้าปัด (บนหรือล่าง)");
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
  //   AUD 2026-07-19: เช็คคอลัมน์ clientKey จริง (index) เป็นหลัก + fallback notes marker สำหรับแถวเก่าก่อน migration
  const existing = await prisma.cfCollectionEvent.findFirst({
    where: {
      orgId,
      machineId: machine.id,
      eventType: "INITIAL",
      OR: [
        { clientKey: data.clientKey },
        { notes: { contains: clientKeyNote(data.clientKey) } }, // legacy rows (marker ใน notes)
      ],
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

  // เขียนผ่าน Supabase adminClient (ไม่ใช้ prisma.$transaction) — 2026-08-19: บน prod
  // transaction pooler interactive tx บางทีไม่ commit จริงทั้งที่ action ตอบสำเร็จ (จอบอก
  // "ตั้งค่าสำเร็จ" แต่ตู้ยังค้าง "ตั้งค่าครั้งแรก" — ตระกูลเดียวกับ inviteCfStaff ลิงก์ล่องหน
  // commit 7451e500 · แก้ด้วยแพทเทิร์นเดียวกัน: adminClient REST เรียงทีละขั้น + rollback มือ
  // ถ้าขั้นหลังพัง → กันทั้ง (1) "สำเร็จ" ที่จริงไม่ลง (2) เขียนค้างครึ่งเดียว (half-write).
  const admin = adminClient();
  const sessionId = randomUUID();
  const eventId = randomUUID();

  try {
    // 1) baseline session (ปิดทันที · ไม่ค้าง OPEN). sessionCode ผูกกับ clientKey ตรงๆ (deterministic)
    //    → retry เดิม (double-tap/offline resend) ชน unique ที่นี่ก่อนใคร ไม่ใช่แค่ event ด้านล่าง.
    const { error: sessionErr } = await admin.from("cf_collection_sessions").insert({
      id: sessionId,
      org_id: orgId,
      branch_id: machine.branchId,
      session_code: `BASE-${machine.id.slice(0, 8)}-${data.clientKey.slice(0, 24)}`,
      is_baseline: true,
      status: "CLOSED",
      opened_by_id: session.user.id,
      closed_by_id: session.user.id,
      closed_at: now.toISOString(),
      total_cash_cents: data.cashCents,
    });
    if (sessionErr) {
      if (sessionErr.code === "23505") {
        // sessionCode ชนกัน = clientKey นี้เคยยิงมาแล้ว → หา session เดิมคืนให้ (idempotent no-op จริง
        // ไม่ใช่แค่ error เฉยๆ — เข้าเงื่อนไขเดียวกับเช็ค `existing` ด้านบนแต่ปิด race window ตรงนี้)
        const retry = await prisma.cfCollectionEvent.findFirst({
          where: { orgId, machineId: machine.id, eventType: "INITIAL", clientKey: data.clientKey },
          select: { sessionId: true },
        });
        if (retry?.sessionId) return { ok: true, sessionId: retry.sessionId, machineId: machine.id };
        return err("ตู้นี้ตั้งค่าครั้งแรกไปแล้ว");
      }
      return err(`ตั้งค่าครั้งแรกไม่สำเร็จ: ${sessionErr.message}`);
    }

    // 2) INITIAL event (partial-unique lock ตู้ครั้งเดียว) — clientKey เป็นคอลัมน์จริง (ไม่ใช่ marker ใน notes)
    const { error: eventErr } = await admin.from("cf_collection_events").insert({
      id: eventId,
      org_id: orgId,
      session_id: sessionId,
      machine_id: machine.id,
      event_type: "INITIAL",
      client_key: data.clientKey,
      collected_at: now.toISOString(),
      collected_by_id: session.user.id,
      coin_meter_before: machine.lastCoinMeter,
      coin_meter_after: bestCoinReading,
      cash_counted_cents: data.cashCents,
      doll_meter_before: null,
      doll_meter_after: bestDollReading,
      stock_before: null,
      stock_after: data.dollCountNow,
      refill_qty: data.dollsAdded,
      // N1 · 4 มิเตอร์กายภาพ (คอลัมน์ dedicated · ไม่ยืมช่อง 5-photo เดิมที่ชื่อไม่ตรง content)
      meter_money_top: data.meterMoneyTop,
      meter_money_bottom: data.meterMoneyBottom,
      meter_doll_top: data.meterDollTop,
      meter_doll_bottom: data.meterDollBottom,
      photo_money_meter_top_url: data.photoMoneyMeterTopUrl ?? null,
      photo_money_meter_bottom_url: data.photoMoneyMeterBottomUrl ?? null,
      photo_doll_meter_top_url: data.photoDollMeterTopUrl ?? null,
      photo_doll_meter_bottom_url: data.photoDollMeterBottomUrl ?? null,
      photo_machine_url: data.photoMachineUrl ?? null,
      // ดีไซน์ใหม่ · รูปตุ๊กตาก่อน/หลังใส่ — ยืมช่องเดียวกับ submitBranchEvent (ดู comment mapping ที่ actions.ts)
      //   photo_stock_url       = ตุ๊กตาก่อนใส่ (stock before)
      //   photo_meter_before_url = ตุ๊กตาหลังใส่ (stock after · reused slot)
      photo_stock_url: data.photoStockBeforeUrl ?? null,
      photo_meter_before_url: data.photoStockAfterUrl ?? null,
      // notes = ว่างสำหรับ baseline (clientKey ย้ายไปคอลัมน์แล้ว · ไม่มี marker รั่วออกจอ)
      notes: null,
    });
    if (eventErr) {
      await admin.from("cf_collection_sessions").delete().eq("id", sessionId); // กัน orphan session
      if (eventErr.code === "23505") return err("ตู้นี้ตั้งค่าครั้งแรกไปแล้ว");
      return err(`ตั้งค่าครั้งแรกไม่สำเร็จ: ${eventErr.message}`);
    }

    // 3) snapshot loadout → เปิดแถว current (effectiveTo=null) ตามที่ส่งมา
    //    ⚠️ ต้องกันชน unique `cf_loadouts_one_active_per_machine` (1 ตู้ = loadout active
    //    ได้แค่ 1 แถว · บน machine_id ล้วน). ถ้าสินค้าถูกเพิ่มไปแล้วผ่าน AddProductPanel/
    //    addSetupProductWithDolls มันมี loadout current อยู่แล้ว → insert ซ้ำ = 23505 →
    //    rollback event+session ทั้งคู่ (กัน half-write · ตู้ไม่ถูกล็อกลอยๆ).
    //    → ข้ามสินค้าที่มี loadout current แล้ว + เคารพเพดาน 1 active/ตู้.
    const insertedLoadoutIds: string[] = [];
    if (data.loadout && data.loadout.length > 0) {
      const activeLoadouts = await prisma.cfMachineLoadout.findMany({
        where: { orgId, machineId: machine.id, effectiveTo: null },
        select: { productId: true },
      });
      const loadedIds = new Set(activeLoadouts.map((r) => r.productId));
      let machineHasActive = loadedIds.size > 0; // เพดาน 1 active/ตู้
      for (const line of data.loadout) {
        if (loadedIds.has(line.productId)) continue; // มีในตู้แล้ว → ไม่ต้องเปิดซ้ำ
        if (machineHasActive) continue; // ตู้เต็มช่อง active แล้ว → เปิดเพิ่มไม่ได้ (กันชน unique)
        const loadoutId = randomUUID();
        const { error: loadoutErr } = await admin.from("cf_machine_loadouts").insert({
          id: loadoutId,
          org_id: orgId,
          machine_id: machine.id,
          product_id: line.productId,
          // จำนวน (qty) ไม่ใช่ราคา — price_per_play_coins คงค่า default (1) เพราะ baseline
          // สนใจ "มีสินค้าอะไรในตู้" เป็นหลัก · ราคา/ครั้ง ปรับทีหลังผ่าน config/refill.
          price_per_play_coins: 1,
          effective_from: now.toISOString(),
          effective_to: null,
          set_by_id: session.user.id,
          notes: `baseline setup · จำนวน ${line.qty}`,
        });
        if (loadoutErr) {
          for (const id of insertedLoadoutIds) await admin.from("cf_machine_loadouts").delete().eq("id", id);
          await admin.from("cf_collection_events").delete().eq("id", eventId);
          await admin.from("cf_collection_sessions").delete().eq("id", sessionId);
          return err(`ตั้งค่าครั้งแรกไม่สำเร็จ: ${loadoutErr.message}`);
        }
        insertedLoadoutIds.push(loadoutId);
        loadedIds.add(line.productId);
        machineHasActive = true;
      }
    }

    // 4) lock ตู้ (once-only). mirror last_coin_meter/last_doll_stock → trigger เขียนจาก event ให้แล้ว.
    const { error: lockErr } = await admin
      .from("cf_machines")
      .update({
        is_first_baseline_locked: true,
        first_baseline_applied_at: now.toISOString(),
        // รูปตู้ล่าสุด (N4) — ถ้าแนบมา เก็บลง cf_machines.photo_url ด้วย
        ...(data.photoMachineUrl ? { photo_url: data.photoMachineUrl } : {}),
        // ราคาขายตุ๊กตาต่อตู้ (ราคาเดียว) — ตั้งตอนตั้งค่าครั้งแรก · เก็บถ้าส่งมา
        ...(data.sellPriceCents != null ? { sell_price_cents: data.sellPriceCents } : {}),
      })
      .eq("id", machine.id);
    if (lockErr) {
      for (const id of insertedLoadoutIds) await admin.from("cf_machine_loadouts").delete().eq("id", id);
      await admin.from("cf_collection_events").delete().eq("id", eventId);
      await admin.from("cf_collection_sessions").delete().eq("id", sessionId);
      return err(`ตั้งค่าครั้งแรกไม่สำเร็จ: ${lockErr.message}`);
    }

    // 5) audit — บันทึกช่วงเวลาที่ baseline ถูกใช้ (anti-fraud trail) · audit() ใช้ adminClient เสมออยู่แล้ว
    await audit({
      orgId,
      userId: session.user.id,
      action: "CF_FIRST_BASELINE_APPLIED",
      resourceType: "CF_MACHINE",
      resourceId: machine.id,
      diff: {
        new: {
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

    for (const p of APP_PATHS) revalidatePath(p);
    return { ok: true, sessionId, machineId: machine.id };
  } catch (e) {
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
