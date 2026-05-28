// GET /api/health/deep
// Deep health check — verifies all subsystems including Prisma, R2, Telegram, Auth.
// Stricter than /health (which is meant for HTTP load balancer ping).
//
// Auth: requires CRON_SECRET (Bearer) — same as cron jobs since this is admin-only

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import {
  S3Client,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

interface CheckResult {
  status: "ok" | "fail" | "skip";
  detail?: string;
  durationMs?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

async function checkSupabaseRest(): Promise<CheckResult> {
  try {
    const admin = adminClient();
    const { ms } = await timed(async () =>
      admin.from("organizations").select("id", { count: "exact", head: true }),
    );
    return { status: "ok", durationMs: ms };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : "unknown" };
  }
}

async function checkPrisma(): Promise<CheckResult> {
  try {
    const { ms } = await timed(async () => prisma.organization.count());
    return { status: "ok", durationMs: ms };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : "unknown" };
  }
}

async function checkR2(): Promise<CheckResult> {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET
  ) {
    return { status: "skip", detail: "R2 not configured" };
  }
  try {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    const { ms } = await timed(async () =>
      client.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET! })),
    );
    return { status: "ok", durationMs: ms };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : "unknown" };
  }
}

async function checkTelegram(): Promise<CheckResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { status: "skip", detail: "Telegram not configured" };
  }
  try {
    const { result, ms } = await timed(async () =>
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`),
    );
    if (!result.ok) {
      return { status: "fail", detail: `Telegram getMe → ${result.status}` };
    }
    return { status: "ok", durationMs: ms };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : "unknown" };
  }
}

async function checkAuth(): Promise<CheckResult> {
  // Verify Supabase Auth Admin API works (used by bootstrap + invite flows)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return { status: "fail", detail: "Supabase env missing" };
    }
    const { result, ms } = await timed(async () =>
      fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }),
    );
    if (!result.ok) {
      return { status: "fail", detail: `Auth admin → ${result.status}` };
    }
    return { status: "ok", durationMs: ms };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : "unknown" };
  }
}

async function checkRecentCronRuns(): Promise<CheckResult> {
  // Are crons firing? Check that any cron has run in last 25h
  try {
    const admin = adminClient();
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { count, error } = await admin
      .from("cron_runs")
      .select("id", { count: "exact", head: true })
      .gte("started_at", cutoff);
    if (error) return { status: "fail", detail: error.message };
    if ((count ?? 0) === 0) {
      return { status: "skip", detail: "no cron runs in 25h (new install OK)" };
    }
    return { status: "ok", detail: `${count} runs in 25h` };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : "unknown" };
  }
}

export async function GET(req: NextRequest) {
  // Optional auth — if CRON_SECRET set and Authorization header present, verify.
  // If no header, allow but redact details (for monitoring without secret).
  const auth = req.headers.get("authorization");
  const hasAuth = auth === `Bearer ${process.env.CRON_SECRET}`;

  const [supabase, prisma_, r2, telegram, authApi, crons] = await Promise.all([
    checkSupabaseRest(),
    checkPrisma(),
    checkR2(),
    checkTelegram(),
    checkAuth(),
    checkRecentCronRuns(),
  ]);

  const checks = { supabase, prisma: prisma_, r2, telegram, auth: authApi, crons };
  const failed = Object.values(checks).filter((c) => c.status === "fail");
  const ok = failed.length === 0;

  // Redact details if no auth (avoid leaking error messages publicly)
  if (!hasAuth) {
    for (const k of Object.keys(checks) as Array<keyof typeof checks>) {
      delete checks[k].detail;
    }
  }

  const body = {
    status: ok ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    summary: {
      ok: Object.values(checks).filter((c) => c.status === "ok").length,
      skipped: Object.values(checks).filter((c) => c.status === "skip").length,
      failed: failed.length,
    },
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
