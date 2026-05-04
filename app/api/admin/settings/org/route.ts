// PATCH /api/admin/settings/org — update organization name + settings JSON
// Slug + id are immutable.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  name: z.string().min(2).max(120).optional(),
  logoUrl: z.string().url().nullable().optional(),
  settings: z
    .object({
      timezone: z.string().optional(),
      currency: z.string().optional(),
      reconcileMode: z.enum(["binary", "tolerance"]).optional(),
      defaultDeadline: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      reconcileTolerancePercent: z.number().min(0).max(20).optional(),
      spikeMultiplier: z.number().min(1).max(10).optional(),
      offHoursStart: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      offHoursEnd: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
    })
    .partial()
    .optional(),
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
    .select("id, name, settings, logo_url")
    .eq("id", session.user.org_id)
    .single();

  if (!existing) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.logoUrl !== undefined) updates.logo_url = parsed.data.logoUrl;
  if (parsed.data.settings) {
    const merged = {
      ...((existing.settings as Record<string, unknown>) ?? {}),
      ...parsed.data.settings,
    };
    updates.settings = merged;
  }

  const { error } = await admin
    .from("organizations")
    .update(updates)
    .eq("id", session.user.org_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER", // closest existing action; org-update audit added later
    resourceType: "organization",
    resourceId: session.user.org_id,
    diff: { old: existing, new: updates },
  });

  return NextResponse.json({ success: true });
}
