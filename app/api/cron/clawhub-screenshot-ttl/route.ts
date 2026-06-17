// ClawHub (JOLLY PLAY) — refund screenshot retention cron.
// Deletes R2 refund-screenshot objects older than CLAWHUB_SCREENSHOT_RETENTION_DAYS
// (default 90) and marks the row purged. screenshot_r2_key is a NON-NULL column,
// so we blank it to "" to flag "screenshot purged" rather than null it.
// Schedule via vercel.json:
//   { "path": "/api/cron/clawhub-screenshot-ttl", "schedule": "0 19 * * *" }  // 02:00 ICT = 19:00 UTC
// Auth: CRON_SECRET env (Vercel cron injects in header)

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/clawhub/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = Number(process.env.CLAWHUB_SCREENSHOT_RETENTION_DAYS ?? 90);
const BATCH = 500;

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

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Old refund requests that still carry a screenshot key (not yet purged).
  // "" is the purged sentinel, so { not: "" } skips rows already cleaned.
  const requests = await prisma.clawhubRefundRequest.findMany({
    where: {
      createdAt: { lt: cutoff },
      screenshotR2Key: { not: "" },
    },
    select: { id: true, screenshotR2Key: true },
    take: BATCH,
  });

  let purged = 0;

  for (const r of requests) {
    const key = r.screenshotR2Key;
    if (!key) continue;

    // deleteObject is best-effort; the extra try/catch keeps one bad key from
    // aborting the whole batch.
    try {
      await deleteObject(key);
    } catch (err) {
      console.error("[clawhub-screenshot-ttl] R2 delete failed", err);
      continue;
    }

    await prisma.clawhubRefundRequest.update({
      where: { id: r.id },
      data: { screenshotR2Key: "" }, // mark purged (column is non-null)
    });
    purged += 1;
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    scanned: requests.length,
    purged,
  });
}
