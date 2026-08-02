// ClawFleet — ปิดรอบเก็บเงินอัตโนมัติ "ตอนจบวัน" (CEO 2026-08-02)
// Schedule via vercel.json:
//   { "path": "/api/cron/clawfleet-session-autoclose", "schedule": "30 17 * * *" }  // 00:30 ICT (สิ้นวันไทย) = 17:30 UTC
//
// เดิม: ปิดเฉพาะรอบเปิดค้าง > 24 ชม. → รอบเก็บไม่ครบค้าง "กำลังเก็บ" ข้ามวันเป็น 44 ชม.
// ตอนนี้ (CEO "จบวันรอบควรจะปิด"): ปิดทุกรอบที่เปิดค้างจาก "วันก่อนหน้า" (openedAt < เที่ยงคืนวันนี้ตามเวลาไทย)
//   - เก็บไม่ครบก็ปิดตามจริง (8/37 = ปิดที่ 8) · ไม่เตือนว่า "เก็บไม่ครบ"
//   - status ตัดสินจากกระทบยอดจริง (เงิน/ตุ๊กตาตรง → CLOSED · ไม่ตรง → ANOMALY_REVIEW) เหมือนกดปิดเอง
//     (เดิมบังคับ ANOMALY_REVIEW เสมอ → รอบสะอาดก็ขึ้นแดงหลอก)

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeBranchCloseCrossCheck } from "@/lib/clawfleet/branch-close";

export const runtime = "nodejs";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // "จบวัน" = เที่ยงคืนตามเวลาไทย (Asia/Bangkok = UTC+7 · ไม่มี DST → บวก 7 ชม.ตรง ๆ พอ
  // ไม่ต้องพึ่ง lib timezone · RULE L Ladder). รอบที่ openedAt < เที่ยงคืนวันนี้(ไทย) = รอบของ
  // "วันก่อนหน้า" ที่ยังไม่ปิด → ปิดให้. cron ตั้งเวลา 00:30 ICT จึงกวาดรอบเมื่อวานทุกคืน.
  const now = new Date();
  const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
  const bkkNow = new Date(now.getTime() + BKK_OFFSET_MS);
  const bkkMidnightUtcMs =
    Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), bkkNow.getUTCDate(), 0, 0, 0) - BKK_OFFSET_MS;
  const cutoff = new Date(bkkMidnightUtcMs);

  const stale = await prisma.cfCollectionSession.findMany({
    where: {
      status: "OPEN",
      openedAt: { lt: cutoff },
    },
    select: { id: true, orgId: true, sessionCode: true, openedAt: true, _count: { select: { events: true } } },
    take: 100,
  });

  let review = 0;
  let closed = 0;
  let cancelled = 0;
  const errored: { id: string; error: string }[] = [];

  for (const s of stale) {
    try {
      if (s._count.events === 0) {
        // E2 (audit 2026-07-01): รอบว่าง (เปิดแล้วไม่กรอกอะไรเลย) — trigger G7 จะ RAISE ถ้า
        // สั่งปิด CLOSED/ANOMALY_REVIEW → เดิม catch แล้วข้าม = ค้าง OPEN ถาวร ลองซ้ำทุกคืน.
        // เก็บกวาดเป็น CANCELLED (trigger ข้าม เพราะไม่อยู่ใน CLOSED/ANOMALY_REVIEW).
        // R (ultrareview 2026-07-01 · manual-close race): guard status:"OPEN" ใน where →
        // ถ้าพนักงานเพิ่งกดปิดรอบเอง (OPEN → CLOSED/ANOMALY_REVIEW) ระหว่าง cron ทำงาน
        // updateMany จะ count=0 แล้วข้ามเงียบ ไม่เขียนทับสถานะที่ปิดไปแล้ว.
        const upd = await prisma.cfCollectionSession.updateMany({
          where: { id: s.id, status: "OPEN" },
          data: {
            status: "CANCELLED",
            closedAt: now,
            reviewNote: `auto-cancelled by cron · รอบว่าง (0 รายการ) เปิดค้างข้ามวัน`,
          },
        });
        if (upd.count > 0) cancelled += 1;
      } else {
        // A4 (audit 2026-07-01 · fix 2026-07-20 · CEO policy 2026-08-02):
        // รอบมีรายการแต่พนักงานไม่กดปิด → cron ปิดให้ตอนสิ้นวัน.
        // run cross-check เดียวกับกดปิดเอง (computeBranchCloseCrossCheck) ให้ครบ →
        // totalCashCents/เงินขาด/ตุ๊กตาหาย ถูกคำนวณ (เข้าลิสต์ custody · ไม่มีช่องหนีระบบตรวจ).
        // status ตัดสิน "จากกระทบยอดจริง" เหมือนกดปิดเอง: มีธง(เงิน/ตุ๊กตา/มิเตอร์ไม่ตรง) → ANOMALY_REVIEW ·
        // ไม่มีธง → CLOSED (เดิมบังคับ ANOMALY_REVIEW เสมอ → รอบสะอาด/เก็บไม่ครบก็ขึ้นแดงหลอก · CEO ไม่เอา).
        // เก็บไม่ครบ "ไม่ใช่ธง" — cross-check ดูเฉพาะตู้ที่เก็บมา (มิเตอร์สะสม · ตู้ที่ยังไม่เก็บได้ delta รอบหน้า).
        // รอบกลุ่ม/คำนวณไม่ได้ → cc = null → fallback ANOMALY_REVIEW (ปลอดภัยไว้ก่อน · ให้คนดู).
        // manual-close race guard (เหมือนด้านบน): เขียนเฉพาะรอบที่ยัง OPEN จริง.
        const cc = await computeBranchCloseCrossCheck(s.orgId, s.id);
        const autoStatus = cc && cc.anomalyFlags.length === 0 ? "CLOSED" : "ANOMALY_REVIEW";
        const upd = await prisma.cfCollectionSession.updateMany({
          where: { id: s.id, status: "OPEN" },
          data: cc
            ? {
                status: autoStatus,
                closedAt: now,
                expectedCashCents: cc.expectedCashCents,
                actualCashCents: cc.actualCashCents,
                cashVarianceBps: cc.cashVarianceBps,
                prizeMeterOut: cc.prizeMeterOut,
                prizeCountedOut: cc.prizeCountedOut,
                prizeVariance: cc.prizeVariance,
                totalCashCents: cc.totalCashCents,
                anomalyFlags: cc.anomalyFlags,
                reviewNote:
                  autoStatus === "CLOSED"
                    ? `auto-closed by cron (ปิดสิ้นวัน) · เงิน/ตุ๊กตาตรง`
                    : `auto-closed by cron (ปิดสิ้นวัน) · พบส่วนต่าง ต้องตรวจ`,
              }
            : {
                status: "ANOMALY_REVIEW",
                closedAt: now,
                reviewNote: `auto-closed by cron (ปิดสิ้นวัน) · คำนวณกระทบยอดไม่ได้ · ต้องตรวจ`,
              },
        });
        if (upd.count > 0) {
          if (autoStatus === "CLOSED") closed += 1;
          else review += 1;
        }
      }
    } catch (e) {
      errored.push({ id: s.id, error: (e as Error).message });
    }
  }

  // E2: ถ้ามี errored = สัญญาณรอบค้างจริง (ต้องคนดู) — log ให้เห็นใน cron output/monitoring
  if (errored.length > 0) {
    console.error("[clawfleet-session-autoclose] errored sessions:", JSON.stringify(errored));
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    found: stale.length,
    closed,
    toReview: review,
    cancelled,
    errored,
  });
}
