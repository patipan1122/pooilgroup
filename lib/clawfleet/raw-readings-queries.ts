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
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

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
  coinGear: number | null; // = meterMoneyTop
  // มิเตอร์ตุ๊กตา (doll)
  dollBefore: number | null;
  dollDigital: number | null; // = dollMeterAfter
  dollGear: number | null; // = meterDollTop
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
}): Promise<RawReadings> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branchIds = await userBranchIds(session);

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

  const total = await prisma.cfCollectionEvent.count({
    where: {
      orgId,
      eventType: { in: ["INITIAL", "COLLECTION"] },
      machine: { branchId: branch.id, kind: "CLAW" },
    },
  });

  const events = await prisma.cfCollectionEvent.findMany({
    where: {
      orgId,
      eventType: { in: ["INITIAL", "COLLECTION"] },
      machine: { branchId: branch.id, kind: "CLAW" },
    },
    orderBy: [{ collectedAt: "desc" }],
    take: CAP,
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

  const rows: RawReadingRow[] = events.map((e) => {
    const status = e.session?.status ?? null;
    const deposited = !!e.session?.depositId;
    const editable =
      e.eventType === "COLLECTION" &&
      !deposited &&
      (status === "CLOSED" || status === "ANOMALY_REVIEW");

    const photos: RawReadingPhoto[] = [];
    if (e.eventType === "INITIAL") {
      pushPhoto(photos, "มิเตอร์เหรียญ เฟือง", e.photoMoneyMeterTopUrl);
      pushPhoto(photos, "มิเตอร์เหรียญ ดิจิตอล", e.photoMoneyMeterBottomUrl);
      pushPhoto(photos, "มิเตอร์ตุ๊กตา เฟือง", e.photoDollMeterTopUrl);
      pushPhoto(photos, "มิเตอร์ตุ๊กตา ดิจิตอล", e.photoDollMeterBottomUrl);
      pushPhoto(photos, "หน้าตู้", e.photoMachineUrl);
    } else {
      pushPhoto(photos, "มิเตอร์ก่อน", e.photoMeterBeforeUrl);
      pushPhoto(photos, "มิเตอร์ตุ๊กตา", e.photoPrizeMeterUrl);
      pushPhoto(photos, "เงินสด", e.photoCashUrl);
      pushPhoto(photos, "มิเตอร์หลัง", e.photoMeterAfterUrl);
      pushPhoto(photos, "ตุ๊กตาในตู้", e.photoStockUrl);
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
      // เฟือง: ใช้ meterMoneyTop ถ้ามี (รอบใหม่เก็บแล้ว) — รอบเก่าไม่มี = null
      coinGear: e.meterMoneyTop ?? null,
      dollBefore: e.dollMeterBefore ?? null,
      dollDigital: e.dollMeterAfter ?? null,
      dollGear: e.meterDollTop ?? null,
      cashBaht: Math.round(e.cashCountedCents / 100),
      stockBefore: e.stockBefore ?? null,
      stockAfter: e.stockAfter ?? null,
      refillQty: e.refillQty ?? null,
      shortReason: e.shortReason,
      anomalyFlags: e.anomalyFlags ?? [],
      notes: e.notes,
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
