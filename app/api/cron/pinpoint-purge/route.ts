// Pinpoint — retention cron (PDPA safeguard).
//
// Two sweeps, daily:
//   1. Screenshots older than 30 days → delete the R2 object + null the key.
//      (Comments/structured targets are kept; only the image — which may carry
//       PII — is purged, satisfying the CEO-accepted 30-day TTL.)
//   2. Abandoned DRAFT sessions older than 7 days → delete (cascade pins).
//
// Schedule via vercel.json:
//   { "path": "/api/cron/pinpoint-purge", "schedule": "0 19 * * *" } // 02:00 ICT
// Auth: CRON_SECRET (Vercel cron injects Authorization: Bearer <secret>).

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { deleteObject } from "@/lib/r2/upload";

export const runtime = "nodejs";

const SCREENSHOT_TTL_DAYS = 30;
const DRAFT_TTL_DAYS = 7;
const BATCH = 500;

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode
  return req.headers.get("authorization") === `Bearer ${secret}`;
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
  const admin = adminClient();
  const now = Date.now();
  const shotCutoff = new Date(now - SCREENSHOT_TTL_DAYS * 86400_000).toISOString();
  const draftCutoff = new Date(now - DRAFT_TTL_DAYS * 86400_000).toISOString();

  let screenshotsPurged = 0;
  let draftsDeleted = 0;

  // 1. Expire screenshots.
  const { data: oldPins } = await admin
    .from("pinpoint_pins")
    .select("id, screenshot_key")
    .not("screenshot_key", "is", null)
    .lt("created_at", shotCutoff)
    .limit(BATCH);
  for (const p of (oldPins ?? []) as { id: string; screenshot_key: string }[]) {
    await deleteObject(p.screenshot_key);
    await admin
      .from("pinpoint_pins")
      .update({ screenshot_key: null, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    screenshotsPurged++;
  }

  // 2. Delete abandoned drafts (also frees their screenshots first).
  const { data: oldDrafts } = await admin
    .from("pinpoint_sessions")
    .select("id")
    .eq("status", "draft")
    .lt("created_at", draftCutoff)
    .limit(BATCH);
  for (const s of (oldDrafts ?? []) as { id: string }[]) {
    const { data: pins } = await admin
      .from("pinpoint_pins")
      .select("screenshot_key")
      .eq("session_id", s.id);
    for (const pin of (pins ?? []) as { screenshot_key: string | null }[]) {
      if (pin.screenshot_key) await deleteObject(pin.screenshot_key);
    }
    await admin.from("pinpoint_sessions").delete().eq("id", s.id);
    draftsDeleted++;
  }

  return NextResponse.json({ ok: true, screenshotsPurged, draftsDeleted });
}
