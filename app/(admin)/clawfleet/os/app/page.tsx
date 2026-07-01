/**
 * ตู้คีบ OS — แอปพนักงาน (หน้าบ้าน · mobile employee app)
 * Server: ลองโหลดสาขา/กลุ่ม/ตู้/SKU จริงด้วย getGroupCollectData() ใน try/catch.
 * ถ้าว่าง (DB ยังไม่ seed / ยังไม่ migrate) → client ใช้ demo fallback (id ขึ้นต้น "demo-").
 * หน้านี้แสดงทั้งใน back-office (กรอบมือถือ) และใช้เต็มจอบนมือถือจริง (component เดียว render สองที่).
 */
import { getGroupCollectData } from "@/lib/clawfleet/group-data";
import { getClawfleetPolicy } from "@/lib/clawfleet/policy";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { StaffAppClient, type StaffHistoryRow } from "./staff-app-client";
import type { GroupCollectBranch, CollectSku } from "@/lib/clawfleet/group-data";

export const dynamic = "force-dynamic";

// ต้นวันนี้ตามเวลาไทย (Asia/Bangkok = UTC+7) — ใช้กรองรอบที่ปิด "วันนี้"
function startOfTodayBangkok(): Date {
  const now = new Date();
  // เลื่อนเป็นเวลาไทยแล้วตัดเวลาให้เหลือ 00:00 ของวันไทย จากนั้นแปลงกลับ UTC
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = bkk.getUTCFullYear();
  const m = bkk.getUTCMonth();
  const d = bkk.getUTCDate();
  // 00:00 ไทย = 17:00 UTC ของวันก่อนหน้า → ลบ 7 ชม.
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - 7 * 60 * 60 * 1000);
}

export default async function StaffAppPage() {
  let orgId = "";
  let branches: GroupCollectBranch[] = [];
  let skus: CollectSku[] = [];
  try {
    const data = await getGroupCollectData();
    orgId = data.orgId;
    branches = data.branches;
    skus = data.skus;
  } catch {
    // graceful: ยังไม่ migrate / DB ว่าง → client จะ demo fallback เอง
  }

  // ชื่อพนักงานที่ล็อกอิน (โชว์ทักทาย) — graceful: ถ้าไม่ login → ปล่อยว่าง (client ใช้ default)
  let userName = "";
  let userId = "";
  try {
    const session = await getSession();
    userName = session?.user.name ?? "";
    userId = session?.user.id ?? "";
    orgId = orgId || (session?.user.org_id ?? "");
  } catch {
    // graceful: อ่าน session ไม่ได้ → ไม่โชว์ชื่อจริง
  }

  // 📊 ความคืบหน้าวันนี้ (ของจริง) + ประวัติการเก็บของฉันวันนี้ —
  // นับ/ดึงจาก cf_collection_events ที่ "ฉัน" (userId) เก็บ ตั้งแต่ต้นวันไทย.
  // ใช้ COLLECTION event เป็นตัวแทน "รอบที่เก็บเสร็จจริง" (draft ที่ยังไม่ปิด ไม่ถูกนับ).
  // graceful: อ่านไม่ได้ / ยังไม่ migrate → closedTodayCount=0, history=[] (แอปโชว์ empty state).
  let closedTodayCount = 0;
  let history: StaffHistoryRow[] = [];
  if (orgId && userId) {
    try {
      const since = startOfTodayBangkok();
      const events = await prisma.cfCollectionEvent.findMany({
        where: {
          orgId,
          collectedById: userId,
          eventType: "COLLECTION",
          collectedAt: { gte: since },
        },
        orderBy: { collectedAt: "desc" },
        select: {
          collectedAt: true,
          cashCountedCents: true,
          anomalyFlags: true,
          machine: { select: { code: true } },
        },
        take: 50,
      });
      closedTodayCount = events.length;
      history = events.map((e) => ({
        code: e.machine.code,
        time: e.collectedAt.toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Bangkok",
        }),
        cashBaht: Math.round(e.cashCountedCents / 100),
        ok: e.anomalyFlags.length === 0,
      }));
    } catch {
      // graceful: ยังไม่ migrate / query ล้ม → คงค่า default (0 / [])
    }
  }

  // นโยบายถ่ายรูป (photoRequired) — อ่าน server-side ส่งให้แอปพนักงานบังคับถ่ายรูป.
  // graceful: ถ้าอ่านไม่ได้ (ยังไม่ login / DB ว่าง) → ใช้ default false (ถ่ายได้-ข้ามได้).
  let photoRequired = false;
  try {
    const policy = await getClawfleetPolicy();
    photoRequired = policy.photoRequired;
  } catch {
    // graceful: ใช้ default (ไม่บังคับ) เมื่ออ่าน policy ไม่ได้
  }

  return (
    <StaffAppClient
      orgId={orgId}
      branches={branches}
      skus={skus}
      photoRequired={photoRequired}
      userName={userName}
      closedTodayCount={closedTodayCount}
      history={history}
    />
  );
}
