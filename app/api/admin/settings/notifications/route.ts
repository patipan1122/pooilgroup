// PATCH /api/admin/settings/notifications
// Persist Telegram + Email notification config under organizations.settings.notifications
//
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings · Notifications + §5 Notifications
// Audit: SETTINGS_UPDATED on every successful change
// Auth:  super_admin / org_admin only

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const TimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const Schema = z.object({
  morningBriefAt: z.string().regex(TimeRegex).optional(),
  eveningCheckAt: z.string().regex(TimeRegex).optional(),
  audience: z.enum(["super_admin_only", "with_org_admin", "with_branch_managers"]),
  channels: z.object({
    telegram: z.boolean(),
    email: z.boolean(),
  }),
  telegramChatIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  emailRecipients: z.array(z.string().email()).max(50).default([]),
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
  const prevNotifications =
    (settings.notifications as Record<string, unknown>) ?? {};

  const newNotifications = {
    morningBriefAt: parsed.data.morningBriefAt ?? "07:00",
    eveningCheckAt: parsed.data.eveningCheckAt ?? "18:00",
    audience: parsed.data.audience,
    channels: parsed.data.channels,
    telegramChatIds: parsed.data.telegramChatIds,
    emailRecipients: parsed.data.emailRecipients,
  };

  const newSettings = { ...settings, notifications: newNotifications };

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
    resourceType: "settings.notifications",
    resourceId: session.user.org_id,
    diff: { old: prevNotifications, new: newNotifications },
  });

  return NextResponse.json({ success: true });
}
