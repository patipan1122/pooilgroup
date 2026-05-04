// Public endpoint — anyone can submit a "want to join" request.
// No org_id chosen by user (we hard-code Pooilgroup org for now).
// Admin reviews queue at /admin/users/requests.
//
// Rate-limit: 3 requests per IP per hour (basic abuse guard).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const POOL_GROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

const Schema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().regex(/^[0-9-+\s]{9,20}$/, "เบอร์โทรไม่ถูกต้อง"),
  email: z.string().email().optional().or(z.literal("")),
  branchId: z.string().uuid().nullable().optional(),
  requestedRole: z.enum(["staff", "branch_manager", "driver", "viewer"]),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const admin = adminClient();

  const ipAddress =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;

  // Basic rate limit: 3 pending requests per phone in last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("register_requests")
    .select("id", { count: "exact", head: true })
    .eq("phone", data.phone)
    .gte("created_at", since);

  if ((recentCount ?? 0) >= 3) {
    return NextResponse.json(
      { error: "ส่งคำขอเกินกำหนด — กรุณาติดต่อ Admin โดยตรง" },
      { status: 429 },
    );
  }

  const id = crypto.randomUUID();
  const { error } = await admin.from("register_requests").insert({
    id,
    org_id: POOL_GROUP_ORG_ID,
    name: data.name,
    phone: data.phone.trim(),
    email: data.email || null,
    branch_id: data.branchId ?? null,
    requested_role: data.requestedRole,
    notes: data.notes || null,
    status: "pending",
    ip_address: ipAddress,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: POOL_GROUP_ORG_ID,
    userId: null,
    action: "CREATE_USER",
    resourceType: "register_request",
    resourceId: id,
    diff: { new: { name: data.name, phone: data.phone, role: data.requestedRole } },
    ipAddress: ipAddress ?? undefined,
  });

  // TODO Phase C4b: notify admins via Telegram bot

  return NextResponse.json({ success: true, requestId: id });
}
