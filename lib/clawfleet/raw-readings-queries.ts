// ClawFleet · ข้อมูลดิบมิเตอร์ (Raw readings) query layer — server-only.
//
// ตารางแบบ Excel: 1 แถว = 1 รายการที่พนักงานกรอก (INITIAL ยอดตั้งต้น + COLLECTION รอบเก็บ)
// ของทั้งสาขา ในหน้าเดียว — ไม่กรองด้วยสถานะรอบ (โชว์ทุกอย่างที่กรอกจริง แม้รอบยังเปิดอยู่)
// ต่างจาก matrix-queries (ที่รวมรายวัน + กรองเฉพาะรอบปิดแล้ว) — อันนี้ "ดิบ" รายรายการ เพื่อให้
// แอดมินเห็นเลขที่พนักงานกรอก แล้วกดแก้ได้ (COLLECTION เท่านั้น · baseline แก้ผ่านเมนูตั้งค่าตู้).
//
// มิเตอร์เก็บ 2 หน้าปัด/ค่า: เฟือง (meterMoneyTop/meterDollTop) + ดิจิตอล (coinMeterAfter/dollMeterAfter).
// เลขที่ใช้คิดเงินจริง = ดิจิตอล (coinMeterAfter). เฟือง = ตัวเทียบกันโกง (ขยับเท่ากันทุกรอบ).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import { cleanNote } from "./validation";

/** ป้ายรูปหลักฐาน (สำหรับ lightbox) */
export type RawReadingPhoto = { label: string; url: string };

/** 1 แถว = 1 event ที่พนักงานกรอก (ดิบ) */
export type RawReadingRow = {
  eventId: string;
  /** INITIAL = ยอดตั้งต้น (ตั้งค่าตู้ครั้งแรก) · COLLECTION = รอบเก็บเงินปกติ */
  kind: "INITIAL" | "COLLECTION";
  /** เวลาไทย */
  iso: string; // "YYYY-MM-DD HH:mm" (Asia/Bangkok) — สำหรับเรียง/แสดง
  dateLabel: string; // "1 ส.ค. 69"
  timeLabel: string; // "14:52"
  machineCode: string;
  machineNickname: string | null;
  collectedByName: string;
  // มิเตอร์เหรียญ (coin) — เฟือง(gear) / ดิจิตอล(digital) + ค่าก่อนหน้า(ดิจิตอล)
  coinBefore: number | null;
  coinDigital: number; // = coinMeterAfter (ใช้คิดเงิน)
  coinGear: number | null; // = meterMoneyTop (หลัง)
  coinGearBefore: number | null; // เฟืองเหรียญรอบก่อน (chain · เฉพาะ cell popup) — โชว์ ก่อน→หลัง
  // มิเตอร์ตุ๊กตา (doll)
  dollBefore: number | null;
  dollDigital: number | null; // = dollMeterAfter
  dollGear: number | null; // = meterDollTop (หลัง)
  dollGearBefore: number | null; // เฟืองตุ๊กตารอบก่อน (chain · เฉพาะ cell popup)
  // เงิน / สต๊อก / เติม
  cashBaht: number;
  stockBefore: number | null;
  stockAfter: number | null;
  refillQty: number | null;
  // ธง / หมายเหตุ / สถานะรอบ
  shortReason: string | null;
  anomalyFlags: string[];
  notes: string | null;
  sessionStatus: string | null; // OPEN/CLOSED/ANOMALY_REVIEW/LOCKED/CANCELLED/null
  deposited: boolean; // ฝากธนาคารแล้ว → immutable
  /** CEO 2026-08-02 · ตรวจ/ยืนยันรายตู้แล้วหรือยัง (ISO · null = ยังไม่ตรวจ) — matrix ช่องแดง→ฟ้า */
  reviewedAt: string | null;
  /** แก้เลขได้ไหม (เฉพาะ COLLECTION · รอบปิดรอตรวจ · ยังไม่ฝาก/ไม่ล็อก) */
  editable: boolean;
  photos: RawReadingPhoto[];
};

export type RawReadings = {
  branch: { id: string; name: string; code: string } | null;
  rows: RawReadingRow[];
  /** จำนวนที่แสดง (หลัง cap) · total = จริงทั้งหมด → ถ้า total > rows.length แปลว่าตัดบางส่วน */
  total: number;
  truncated: boolean;
};

const CAP = 500; // กันตารางบานเมื่อสาขาใหญ่ (ปกติ 1 สาขา < 100 รายการ) — ถ้าเกินติดธง truncated

const D_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "2-digit",
});
const T_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const ISO_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function pushPhoto(out: RawReadingPhoto[], label: string, url: string | null | undefined) {
  if (url) out.push({ label, url });
}

/**
 * ข้อมูลดิบมิเตอร์ของ "สาขาเดียว" — ทุก event (INITIAL + COLLECTION) เรียงใหม่→เก่า.
 * scope: orgId + branch-scope ของ user (แอดมิน = ALL). ไม่กรองสถานะรอบ (ดิบจริง).
 */
export async function getBranchRawReadings(opts: {
  branchCode?: string | null;
  /** กรองเฉพาะตู้เดียว (ใช้ตอนกดช่องในเมทริกซ์ → popup) */
  machineId?: string;
  /** กรองเฉพาะวันเดียว "YYYY-MM-DD" (เวลาไทย) — คู่กับ machineId สำหรับ popup รายช่อง */
  isoDay?: string;
}): Promise<RawReadings> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branchIds = await userBranchIds(session);

  // filter รายช่อง (ตู้ × วัน) — ดึงครบ ไม่ cap เพราะช่องเดียวมีไม่กี่รายการ
  const cellFilter = !!opts.machineId && !!opts.isoDay;
  const dayStart = opts.isoDay ? new Date(`${opts.isoDay}T00:00:00+07:00`) : null;
  const dayEnd = dayStart ? new Date(dayStart.getTime() + 86_400_000) : null;
  const dayWhere = dayStart && dayEnd ? { collectedAt: { gte: dayStart, lt: dayEnd } } : {};
  const machineWhere = opts.machineId ? { id: opts.machineId } : {};

  // หา branch เป้าหมาย (ในขอบเขต user) — ไม่บังคับ isActive (chip ที่เลือกมากรองแล้ว)
  const branch = await prisma.branch.findFirst({
    where: {
      orgId,
      businessType: "claw_machine",
      ...(opts.branchCode ? { code: opts.branchCode } : {}),
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });
  if (!branch) return { branch: null, rows: [], total: 0, truncated: false };

  const where: Prisma.CfCollectionEventWhereInput = {
    orgId,
    eventType: { in: ["INITIAL", "COLLECTION"] },
    machine: { branchId: branch.id, kind: "CLAW", ...machineWhere },
    ...dayWhere,
  };

  const total = await prisma.cfCollectionEvent.count({ where });

  const events = await prisma.cfCollectionEvent.findMany({
    where,
    orderBy: [{ collectedAt: "desc" }],
    take: cellFilter ? 100 : CAP,
    select: {
      id: true,
      eventType: true,
      collectedAt: true,
      coinMeterBefore: true,
      coinMeterAfter: true,
      dollMeterBefore: true,
      dollMeterAfter: true,
      meterMoneyTop: true,
      meterMoneyBottom: true,
      meterDollTop: true,
      meterDollBottom: true,
      cashCountedCents: true,
      stockBefore: true,
      stockAfter: true,
      refillQty: true,
      shortReason: true,
      anomalyFlags: true,
      reviewedAt: true,
      notes: true,
      photoMeterBeforeUrl: true,
      photoPrizeMeterUrl: true,
      photoCashUrl: true,
      photoMeterAfterUrl: true,
      photoStockUrl: true,
      photoMoneyMeterTopUrl: true,
      photoMoneyMeterBottomUrl: true,
      photoDollMeterTopUrl: true,
      photoDollMeterBottomUrl: true,
      photoMachineUrl: true,
      machine: { select: { code: true, nickname: true } },
      collectedBy: { select: { name: true } },
      session: { select: { status: true, depositId: true } },
    },
  });

  // CEO 2026-08-02 · เฟืองก่อน→หลัง (chain) — เฉพาะ cell popup (machine เดียว) · เฟืองเก็บค่าเดียว/รอบ
  //   → "ก่อน" = เฟืองของรอบก่อนหน้า (chain ตามเวลา · normalize COLLECTION=Top / INITIAL=Bottom)
  const gearBeforeByEvent = new Map<string, { coin: number | null; doll: number | null }>();
  if (cellFilter && opts.machineId) {
    const chain = await prisma.cfCollectionEvent.findMany({
      where: { orgId, machineId: opts.machineId, eventType: { in: ["INITIAL", "COLLECTION"] } },
      select: { id: true, eventType: true, meterMoneyTop: true, meterMoneyBottom: true, meterDollTop: true, meterDollBottom: true },
      orderBy: { collectedAt: "desc" },
      take: 200,
    });
    const gearOf = (ev: (typeof chain)[number]) => ({
      coin: (ev.eventType === "COLLECTION" ? ev.meterMoneyTop : ev.meterMoneyBottom) ?? null,
      doll: (ev.eventType === "COLLECTION" ? ev.meterDollTop : ev.meterDollBottom) ?? null,
    });
    const asc = chain.slice().reverse(); // เก่า→ใหม่ เพื่อ chain "ก่อน"
    for (let i = 0; i < asc.length; i++) {
      gearBeforeByEvent.set(asc[i].id, i > 0 ? gearOf(asc[i - 1]) : { coin: null, doll: null });
    }
  }

  const rows: RawReadingRow[] = events.map((e) => {
    const status = e.session?.status ?? null;
    const deposited = !!e.session?.depositId;
    const editable =
      e.eventType === "COLLECTION" &&
      !deposited &&
      (status === "CLOSED" || status === "ANOMALY_REVIEW");

    // CEO 2026-08-02 · รูปมิเตอร์เหลือ 2 (จอดิจิตอล + แผงเฟือง · แต่ละรูปเห็นเหรียญ+ตุ๊กตา) · relabel ตรงกับ 2-photo model
    const photos: RawReadingPhoto[] = [];
    if (e.eventType === "INITIAL") {
      pushPhoto(photos, "จอดิจิตอล (เหรียญ+ตุ๊กตา)", e.photoMoneyMeterTopUrl);
      pushPhoto(photos, "แผงเฟือง (เหรียญ+ตุ๊กตา)", e.photoMoneyMeterBottomUrl);
      pushPhoto(photos, "มิเตอร์ตุ๊กตา ดิจิตอล (เดิม)", e.photoDollMeterTopUrl);
      pushPhoto(photos, "มิเตอร์ตุ๊กตา เฟือง (เดิม)", e.photoDollMeterBottomUrl);
      pushPhoto(photos, "หน้าตู้", e.photoMachineUrl);
    } else {
      pushPhoto(photos, "จอดิจิตอล (เหรียญ+ตุ๊กตา)", e.photoMeterAfterUrl);
      pushPhoto(photos, "แผงเฟือง (เหรียญ+ตุ๊กตา)", e.photoPrizeMeterUrl);
      pushPhoto(photos, "สต็อกก่อนเติม", e.photoStockUrl);
      pushPhoto(photos, "สต็อกหลังเติม", e.photoMeterBeforeUrl);
      // CEO 2026-08-02 · ตัดรูปเงินสดออกถาวร (ไม่มีการถ่ายรูปเงินสด)
    }

    return {
      eventId: e.id,
      kind: e.eventType === "INITIAL" ? "INITIAL" : "COLLECTION",
      iso: ISO_FMT.format(e.collectedAt).replace("T", " "),
      dateLabel: D_FMT.format(e.collectedAt),
      timeLabel: T_FMT.format(e.collectedAt),
      machineCode: e.machine.code,
      machineNickname: e.machine.nickname,
      collectedByName: e.collectedBy?.name ?? "—",
      coinBefore: e.coinMeterBefore ?? null,
      coinDigital: e.coinMeterAfter,
      // เฟือง normalize ตาม eventType (กฎถาวร บน=ดิจิตอล ล่าง=เฟือง · COLLECTION เก็บกลับหัว):
      //   COLLECTION → เฟือง=Top · INITIAL → เฟือง=Bottom (เดิม hardcode Top ทำ baseline อ่านสลับ)
      coinGear: (e.eventType === "COLLECTION" ? e.meterMoneyTop : e.meterMoneyBottom) ?? null,
      coinGearBefore: gearBeforeByEvent.get(e.id)?.coin ?? null,
      dollBefore: e.dollMeterBefore ?? null,
      dollDigital: e.dollMeterAfter ?? null,
      dollGear: (e.eventType === "COLLECTION" ? e.meterDollTop : e.meterDollBottom) ?? null,
      dollGearBefore: gearBeforeByEvent.get(e.id)?.doll ?? null,
      cashBaht: Math.round(e.cashCountedCents / 100),
      stockBefore: e.stockBefore ?? null,
      stockAfter: e.stockAfter ?? null,
      refillQty: e.refillQty ?? null,
      shortReason: cleanNote(e.shortReason),
      anomalyFlags: e.anomalyFlags ?? [],
      reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
      notes: cleanNote(e.notes),
      sessionStatus: status,
      deposited,
      editable,
      photos,
    };
  });

  return {
    branch: { id: branch.id, name: branch.name, code: branch.code },
    rows,
    total,
    truncated: total > rows.length,
  };
}

/** เติมตุ๊กตา "นอกรอบเก็บ" 1 รายการ (สำหรับป๊อปอัปช่อง refill-only ในรายงานเจาะสาขา) */
export type CellRefill = {
  id: string;
  qty: number;
  timeLabel: string;
  byName: string;
  productName: string | null;
  photoUrl: string | null;
};

/**
 * เติมตุ๊กตา "นอกรอบเก็บ" (standalone refill · cf_stock_movements ref_table='cf_refill_dolls')
 * ของตู้เดียว ในวันเดียว (เวลาไทย) — ใช้ในป๊อปอัปช่องเมื่อกดช่อง 🧸 refill-only. READ-ONLY.
 * scope: orgId + branch-scope ของ user. วันไทยตัดด้วย +07:00 (ไม่ใช่ UTC server).
 */
export async function getMachineDayRefills(opts: {
  machineId: string;
  isoDay: string;
}): Promise<CellRefill[]> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branchIds = await userBranchIds(session);
  const dayStart = new Date(`${opts.isoDay}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const moves = await prisma.cfStockMovement.findMany({
    where: {
      orgId,
      machineId: opts.machineId,
      refTable: "cf_refill_dolls",
      occurredAt: { gte: dayStart, lt: dayEnd },
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    },
    select: {
      id: true,
      qty: true,
      occurredAt: true,
      receiptR2Key: true,
      createdBy: { select: { name: true } },
      product: { select: { name: true } },
    },
    orderBy: { occurredAt: "asc" },
  });
  return moves.map((m) => ({
    id: m.id,
    qty: Math.abs(m.qty),
    timeLabel: T_FMT.format(m.occurredAt),
    byName: m.createdBy?.name ?? "—",
    productName: m.product?.name ?? null,
    photoUrl: m.receiptR2Key || null,
  }));
}
