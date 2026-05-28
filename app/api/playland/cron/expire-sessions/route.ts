// Playland · Cron-callable session expiration
// Schedule via Vercel cron (vercel.json) every 1 minute
// Hits playland session engine to mark EXPIRED/FORFEITED + warn at -10min

import { NextRequest, NextResponse } from "next/server";
import { expireDueSessions } from "@/lib/playland/session-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Verify cron secret if set
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await expireDueSessions();
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
