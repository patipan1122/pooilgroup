// ClawFleet — auto-close sessions stuck OPEN >24h
// Schedule via vercel.json:
//   { "path": "/api/cron/clawfleet-session-autoclose", "schedule": "0 23 * * *" }  // 06:00 ICT = 23:00 UTC prev day

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULTS } from "@/lib/clawfleet/types";

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
    select: { id: true, sessionCode: true, openedAt: true, _count: { select: { events: true } } },
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
        await prisma.cfCollectionSession.update({
          where: { id: s.id },
          data: {
            status: "CANCELLED",
            reviewNote: `auto-cancelled by cron · รอบว่าง (0 รายการ) เปิดค้าง > ${DEFAULTS.SESSION_AUTO_CLOSE_HOURS} ชม.`,
          },
        });
        cancelled += 1;
      } else {
        // A4 (audit 2026-07-01): รอบที่มีรายการแต่พนักงานไม่กดปิด — เดิม cron ปิดเป็น CLOSED
        // ตรง ๆ · trigger คำนวณ cross-check เงินสด/ตุ๊กตา 2 ทางเฉพาะรอบ "กลุ่ม" ไม่ใช่รอบ "สาขา"
        // (นั่นอยู่ที่ app-layer closeBranchSession) → รอบสาขาถูกปิดสะอาดโดยไม่ตรวจเงินขาด =
        // ช่องหนี "เปิดรอบทิ้ง 24 ชม." → บังคับเข้า ANOMALY_REVIEW ให้คนตรวจเสมอ (ไม่ปิดเงียบ).
        await prisma.cfCollectionSession.update({
          where: { id: s.id },
          data: {
            status: "ANOMALY_REVIEW",
            reviewNote: `auto-closed by cron (เปิดค้าง > ${DEFAULTS.SESSION_AUTO_CLOSE_HOURS} ชม.) · ต้องตรวจ`,
          },
        });
        review += 1;
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
