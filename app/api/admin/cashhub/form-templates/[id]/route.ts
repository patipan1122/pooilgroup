// PATCH /api/admin/cashhub/form-templates/[id]
//   → update template (name / overrides / custom_fields)
// DELETE /api/admin/cashhub/form-templates/[id]
//   → soft delete (only if no branches use it, default cannot be deleted)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from "@/lib/cashhub/form-templates";

const FieldOverrideSchema = z.object({
  label: z.string().max(80).optional(),
  placeholder: z.string().max(80).optional(),
  hint: z.string().max(200).optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  numericOnly: z.boolean().optional(),
});

const CustomFieldSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  type: z.enum(["currency", "number", "text"]),
  group: z.enum([
    "sales",
    "received",
    "shortage",
    "rental",
    "training",
    "notes",
    "custom",
  ]),
  required: z.boolean(),
  hint: z.string().max(200).optional(),
  placeholder: z.string().max(80),
  unit: z.string().max(16).optional(),
  numericOnly: z.boolean().optional(),
  isPaymentChannel: z.boolean().optional(),
  sortOrder: z.number(),
});

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  overrides: z.record(z.string(), FieldOverrideSchema).optional(),
  custom_fields: z.array(CustomFieldSchema).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await params;

  const existing = await getTemplate(session.user.org_id, id);
  if (!existing) {
    return NextResponse.json({ error: "ไม่พบ template" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  try {
    const updated = await updateTemplate(session.user.org_id, id, parsed.data);
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "UPDATE_USER",
      resourceType: "form_template",
      resourceId: id,
      diff: {
        old: {
          name: existing.name,
          overrides: existing.overrides,
          customFieldsCount: existing.custom_fields.length,
        },
        new: {
          name: updated.name,
          overrides: updated.overrides,
          customFieldsCount: updated.custom_fields.length,
        },
      },
    });
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await params;

  const existing = await getTemplate(session.user.org_id, id);
  if (!existing) {
    return NextResponse.json({ error: "ไม่พบ template" }, { status: 404 });
  }

  const result = await deleteTemplate(session.user.org_id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "form_template",
    resourceId: id,
    diff: {
      old: { name: existing.name, version: existing.version } as Record<
        string,
        unknown
      >,
    },
  });
  return NextResponse.json({ success: true });
}
