// PATCH /api/admin/settings/security
// Persist session + password policy under organizations.settings.security
//
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings · Security + RULES.md Rule 21
// Audit: SETTINGS_UPDATED
// Auth:  super_admin / org_admin only

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  sessionIdleMinutes: z.number().int().min(5).max(720),
  accessTokenHours: z.number().int().min(1).max(72),
  lockAfterFailedAttempts: z.number().int().min(3).max(20),
  lockDurationMinutes: z.number().int().min(5).max(180),
  password: z.object({
    minLength: z.number().int().min(6).max(64),
    requireSymbol: z.boolean(),
    requireNumber: z.boolean(),
    requireUpper: z.boolean(),
    forceChangeOnFirstLogin: z.boolean(),
  }),
});

export async function PATCH(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");

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

  const admin = adminClient();
  const { data: existing } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", session.user.org_id)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  const settings = (existing.settings as Record<string, unknown>) ?? {};
  const prevSecurity = (settings.security as Record<string, unknown>) ?? {};
  const newSecurity = parsed.data;
  const newSettings = { ...settings, security: newSecurity };

  const { error } = await admin
    .from("organizations")
    .update({ settings: newSettings, updated_at: new Date().toISOString() })
    .eq("id", session.user.org_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "SETTINGS_UPDATED",
    resourceType: "settings.security",
    resourceId: session.user.org_id,
    diff: { old: prevSecurity, new: newSecurity },
  });

  return NextResponse.json({ success: true });
}
