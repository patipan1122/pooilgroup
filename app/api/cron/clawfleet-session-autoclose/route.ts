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
    select: { id: true, sessionCode: true, openedAt: true },
    take: 100,
  });

  let closed = 0;
  const errored: { id: string; error: string }[] = [];

  for (const s of stale) {
    try {
      // trigger fires on this update → cross-check + anomaly_flags
      await prisma.cfCollectionSession.update({
        where: { id: s.id },
        data: {
          status: "CLOSED",
          reviewNote: `auto-closed by cron (open > ${DEFAULTS.SESSION_AUTO_CLOSE_HOURS}h)`,
        },
      });
      closed += 1;
    } catch (e) {
      errored.push({ id: s.id, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    found: stale.length,
    closed,
    errored,
  });
}
