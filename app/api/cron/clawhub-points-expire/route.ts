// ClawHub (JOLLY PLAY) — points expiry cron.
// Expires due point lots FIFO across all orgs (writes EXPIRE ledger entries +
// decrements member.pointsBalance — all the real work lives in expireDuePoints()).
// Schedule via vercel.json:
//   { "path": "/api/cron/clawhub-points-expire", "schedule": "0 1 * * *" }  // 08:00 ICT = 01:00 UTC
// Auth: CRON_SECRET env (Vercel cron injects in header)

import { NextResponse, type NextRequest } from "next/server";
import { expireDuePoints } from "@/lib/clawhub/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
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

  const { count, totalExpired } = await expireDuePoints();

  return NextResponse.json({ ok: true, count, totalExpired });
}
