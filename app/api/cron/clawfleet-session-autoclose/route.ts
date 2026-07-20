// ClawFleet — auto-close sessions stuck OPEN >24h
// Schedule via vercel.json:
//   { "path": "/api/cron/clawfleet-session-autoclose", "schedule": "0 23 * * *" }  // 06:00 ICT = 23:00 UTC prev day

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULTS } from "@/lib/clawfleet/types";
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
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - DEFAULTS.SESSION_AUTO_CLOSE_HOURS);

  const stale = await prisma.cfCollectionSession.findMany({
    where: {
      status: "OPEN",
      openedAt: { lt: cutoff },
    },
    select: { id: true, orgId: true, sessionCode: true, openedAt: true, _count: { select: { events: true } } },
    take: 100,
  });

  let review = 0;
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
            reviewNote: `auto-cancelled by cron · รอบว่าง (0 รายการ) เปิดค้าง > ${DEFAULTS.SESSION_AUTO_CLOSE_HOURS} ชม.`,
          },
        });
        if (upd.count > 0) cancelled += 1;
      } else {
        // A4 (audit 2026-07-01 · fix 2026-07-20): รอบมีรายการแต่พนักงานไม่กดปิด.
        // เดิม cron แค่พลิก status = ANOMALY_REVIEW เฉย ๆ → totalCashCents ค้าง default 0 +
        // ไม่มีธงเงินขาด/ตุ๊กตาหาย → เงินไม่เข้าลิสต์ "เงินค้างมือต้องฝาก" + หนีระบบตรวจ.
        // ตอนนี้: run cross-check เดียวกับกดปิดเอง (computeBranchCloseCrossCheck) ให้ครบ —
        // แต่ยัง "บังคับ ANOMALY_REVIEW เสมอ" เพราะพนักงานไม่ยอมปิดเอง = ต้องมีคนตรวจ
        // (ไม่ปิดเงียบเป็น CLOSED แม้เงินจะตรง). รอบกลุ่ม/คำนวณไม่ได้ → cc = null → fallback flip.
        // manual-close race guard (เหมือนด้านบน): เขียนเฉพาะรอบที่ยัง OPEN จริง.
        const cc = await computeBranchCloseCrossCheck(s.orgId, s.id);
        const upd = await prisma.cfCollectionSession.updateMany({
          where: { id: s.id, status: "OPEN" },
          data: cc
            ? {
                status: "ANOMALY_REVIEW",
                expectedCashCents: cc.expectedCashCents,
                actualCashCents: cc.actualCashCents,
                cashVarianceBps: cc.cashVarianceBps,
                prizeMeterOut: cc.prizeMeterOut,
                prizeCountedOut: cc.prizeCountedOut,
                prizeVariance: cc.prizeVariance,
                totalCashCents: cc.totalCashCents,
                anomalyFlags: cc.anomalyFlags,
                reviewNote: `auto-closed by cron (เปิดค้าง > ${DEFAULTS.SESSION_AUTO_CLOSE_HOURS} ชม.) · คำนวณเงินขาด/ตุ๊กตาให้แล้ว · ต้องตรวจ`,
              }
            : {
                status: "ANOMALY_REVIEW",
                reviewNote: `auto-closed by cron (เปิดค้าง > ${DEFAULTS.SESSION_AUTO_CLOSE_HOURS} ชม.) · ต้องตรวจ`,
              },
        });
        if (upd.count > 0) review += 1;
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
    toReview: review,
    cancelled,
    errored,
  });
}
