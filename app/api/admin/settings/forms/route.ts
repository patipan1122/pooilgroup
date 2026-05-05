// PATCH /api/admin/settings/forms — update one business-type's form overrides
//
// Persisted under organizations.settings.formOverrides[businessType].
// Sanitization + locked-field protection in lib/cashhub/form-config.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  BUSINESS_TYPES,
  type BusinessTypeKey,
} from "@/constants/business-types";
import {
  sanitizeOverridesForType,
  type FormOverridesMap,
} from "@/lib/cashhub/form-config";

const FieldOverrideSchema = z.object({
  label: z.string().max(80).optional(),
  placeholder: z.string().max(80).optional(),
  hint: z.string().max(200).optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

const Schema = z.object({
  businessType: z.string().min(1),
  overrides: z.record(z.string(), FieldOverrideSchema),
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

  const { businessType, overrides } = parsed.data;
  if (!BUSINESS_TYPES[businessType]) {
    return NextResponse.json(
      { error: "ไม่รู้จักประเภทธุรกิจ" },
      { status: 400 },
    );
  }

  const cleaned = sanitizeOverridesForType(
    businessType as BusinessTypeKey,
    overrides,
  );

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
  const prevMap = (settings.formOverrides as FormOverridesMap) ?? {};
  const nextMap: FormOverridesMap = { ...prevMap };

  if (Object.keys(cleaned).length === 0) {
    delete nextMap[businessType as BusinessTypeKey];
  } else {
    nextMap[businessType as BusinessTypeKey] = cleaned;
  }

  const newSettings = { ...settings, formOverrides: nextMap };

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
    action: "UPDATE_USER", // closest existing action — extend when audit catalog grows
    resourceType: "form_overrides",
    resourceId: businessType,
    diff: {
      old: { [businessType]: prevMap[businessType as BusinessTypeKey] ?? null },
      new: { [businessType]: nextMap[businessType as BusinessTypeKey] ?? null },
    },
  });

  return NextResponse.json({ success: true, applied: cleaned });
}
