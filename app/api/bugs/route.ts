// Bug Report API
// 2026-05-20 (CEO request): ปุ่มแจ้งบัคซ่อนใต้ AI floating button
//
// POST /api/bugs  : create bug report (any auth user · rate-limited)
// GET  /api/bugs  : list bugs (admin tier only)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { serverClient, adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { isAdminTier } from "@/lib/auth/role-guards";

const CreateSchema = z.object({
  url: z.string().min(1).max(500),
  description: z.string().min(3).max(2000),
  screenshotKey: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
});

// In-memory rate limit (per process) — 5 bug reports / hour / user.
// Anti-spam · resets on cold-start which is fine for bug reports.
const RATE_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;
const reportCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = reportCounts.get(userId);
  if (!entry || now > entry.resetAt) {
    reportCounts.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const meta = getRequestMeta(req);

  if (!checkRateLimit(session.user.id)) {
    return NextResponse.json(
      { error: "ส่งบัคได้ ${RATE_LIMIT} ครั้งต่อชั่วโมง · ลองใหม่ภายหลัง" },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { url, description, screenshotKey, userAgent } = parsed.data;

  // Use serverClient — RLS applies (org isolation enforced)
  const supabase = await serverClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("bug_reports")
    .insert({
      id,
      org_id: session.user.org_id,
      reporter_id: session.user.id,
      url,
      description,
      screenshot_key: screenshotKey ?? null,
      user_agent: userAgent ?? meta.userAgent ?? null,
      status: "new",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /bugs] insert error", error);
    return NextResponse.json({ error: "บันทึกบัคไม่สำเร็จ" }, { status: 500 });
  }

  // Audit (intentional adminClient — audit must succeed)
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "CREATE_REPORT",
    resourceType: "bug_report",
    resourceId: data.id,
    diff: { new: { url, hasScreenshot: Boolean(screenshotKey) } },
    ...meta,
  });

  return NextResponse.json({ id: data.id, ok: true });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // optional filter

  const admin = adminClient();
  let q = admin
    .from("bug_reports")
    .select(
      "id, url, description, screenshot_key, status, admin_note, acknowledged_at, fixed_at, created_at, updated_at, reporter:reporter_id(id, name, email), acknowledged_by:acknowledged_by_id(id, name)",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (
    status === "new" ||
    status === "acked" ||
    status === "fixed" ||
    status === "closed"
  ) {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[GET /bugs] error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Attach screenshotUrl (public R2 URL — bucket is public per R2_PUBLIC_URL pattern).
  // If bucket is later switched to private, add a signed-download endpoint.
  const r2Base = process.env.R2_PUBLIC_URL ?? "";
  const bugs = (data ?? []).map((b: { screenshot_key?: string | null }) => ({
    ...b,
    screenshotUrl: b.screenshot_key && r2Base ? `${r2Base}/${b.screenshot_key}` : null,
  }));

  return NextResponse.json({ bugs });
}
