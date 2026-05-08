// PATCH /api/admin/settings/backup
// Persist backup schedule + retention + destination under organizations.settings.backup
//
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings · Backup
// Audit: SETTINGS_UPDATED
// Auth:  super_admin / org_admin only

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const TimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const Schema = z.object({
  autoDailyAt: z.string().regex(TimeRegex),
  retentionDays: z.number().int().min(1).max(365),
  destination: z.enum(["cloudflare_r2", "supabase_storage"]),
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
  const prevBackup = (settings.backup as Record<string, unknown>) ?? {};
  const newBackup = parsed.data;
  const newSettings = { ...settings, backup: newBackup };

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
    resourceType: "settings.backup",
    resourceId: session.user.org_id,
    diff: { old: prevBackup, new: newBackup },
  });

  return NextResponse.json({ success: true });
}
