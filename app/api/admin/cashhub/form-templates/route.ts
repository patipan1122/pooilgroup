// GET /api/admin/cashhub/form-templates?type=<businessType>
//   → list templates for that business type (auto-seeds default if none exists)
// POST /api/admin/cashhub/form-templates
//   → create a new template (optionally clone from another)
//
// Permission: super_admin / org_admin only

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import {
  BUSINESS_TYPES,
  type BusinessTypeKey,
} from "@/constants/business-types";
import {
  listTemplates,
  ensureDefaultTemplate,
  createTemplate,
} from "@/lib/cashhub/form-templates";

export async function GET(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";

  if (!BUSINESS_TYPES[type]) {
    return NextResponse.json(
      { error: "ไม่รู้จักประเภทธุรกิจ" },
      { status: 400 },
    );
  }
  const businessType = type as BusinessTypeKey;

  // Make sure the default exists
  await ensureDefaultTemplate(
    session.user.org_id,
    businessType,
    session.user.id,
  );

  const templates = await listTemplates(session.user.org_id, businessType);
  return NextResponse.json({ templates });
}

const CreateSchema = z.object({
  businessType: z.string().min(1),
  name: z.string().min(1).max(80),
  cloneFromId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }
  const { businessType, name, cloneFromId } = parsed.data;
  if (!BUSINESS_TYPES[businessType]) {
    return NextResponse.json(
      { error: "ไม่รู้จักประเภทธุรกิจ" },
      { status: 400 },
    );
  }

  try {
    const created = await createTemplate(
      session.user.org_id,
      businessType as BusinessTypeKey,
      name,
      cloneFromId,
      session.user.id,
    );
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "UPDATE_USER",
      resourceType: "form_template",
      resourceId: created.id,
      diff: {
        new: {
          businessType,
          name: created.name,
          version: created.version,
          clonedFrom: cloneFromId ?? null,
        } as Record<string, unknown>,
      },
    });
    return NextResponse.json({ template: created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "สร้างไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
