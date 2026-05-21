// ClawFleet — photo retention cron (30 day)
// Deletes R2 objects + clears URL fields on cf_collection_events.
// Schedule via vercel.json:
//   { "path": "/api/cron/clawfleet-photo-retention", "schedule": "0 19 * * *" }  // 02:00 ICT = 19:00 UTC
// Auth: CRON_SECRET env (Vercel cron injects in header)

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/lib/r2/client";

export const runtime = "nodejs";

const RETENTION_DAYS = 30;
const BATCH = 500;

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

function urlToKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\.r2\.dev\/(.+)$/) || url.match(/\/clawfleet\/(.+)$/);
  if (m) return m[1].startsWith("clawfleet/") ? m[1] : `clawfleet/${m[1]}`;
  return null;
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

  // P0-6 fix: only purge from sessions that are CLOSED (resolved · no review pending)
  // ANOMALY_REVIEW + OPEN keep their photos as evidence
  // LOCKED keeps photos longer (180 days) — never purged by this cron
  const events = await prisma.cfCollectionEvent.findMany({
    where: {
      createdAt: { lt: cutoff },
      photosPurgedAt: null,
      session: { status: "CLOSED" }, // only purge CLOSED sessions
      OR: [
        { photoMeterBeforeUrl: { not: null } },
        { photoCashUrl: { not: null } },
        { photoMeterAfterUrl: { not: null } },
        { photoStockUrl: { not: null } },
      ],
    },
    select: {
      id: true,
      photoMeterBeforeUrl: true,
      photoCashUrl: true,
      photoMeterAfterUrl: true,
      photoStockUrl: true,
      session: { select: { status: true } },
    },
    take: BATCH,
  });

  let deleted = 0;
  const bytes = 0;
  const skippedAnomaly: string[] = [];

  for (const e of events) {
    // Defense in depth: skip if status changed since query
    if (e.session?.status !== "CLOSED") {
      skippedAnomaly.push(e.id);
      continue;
    }
    const keys = [
      urlToKey(e.photoMeterBeforeUrl),
      urlToKey(e.photoCashUrl),
      urlToKey(e.photoMeterAfterUrl),
      urlToKey(e.photoStockUrl),
    ].filter(Boolean) as string[];
    if (keys.length === 0) continue;

    try {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
      deleted += keys.length;
    } catch (err) {
      console.error("[clawfleet-photo-retention] R2 delete failed", err);
      continue;
    }

    await prisma.cfCollectionEvent.update({
      where: { id: e.id },
      data: {
        photoMeterBeforeUrl: null,
        photoCashUrl: null,
        photoMeterAfterUrl: null,
        photoStockUrl: null,
        photosPurgedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    eventsScanned: events.length,
    objectsDeleted: deleted,
    bytesFreed: bytes,
    skippedAnomalyReview: skippedAnomaly.length,
  });
}
