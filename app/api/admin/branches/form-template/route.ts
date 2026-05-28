// POST /api/admin/branches/form-template
//   body: { branchIds: string[], templateId: string | null }
// Bulk-assign a form_template to a list of branches (or unassign with null).
// Used by /cashhub/settings/forms/[type] · feedback_role_scoped_views.md (super_admin/org_admin only)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  branchIds: z.array(zUUID()).min(1).max(500),
  templateId: zUUID().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin", "admin");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const { branchIds, templateId } = parsed.data;
  const admin = adminClient();

  // Validate template exists in this org if not null
  if (templateId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tpl } = await (admin.from as any)("form_templates")
      .select("id, business_type")
      .eq("id", templateId)
      .eq("org_id", session.user.org_id)
      .maybeSingle();
    if (!tpl) {
      return NextResponse.json(
        { error: "ไม่พบเวอร์ชั่นฟอร์มนี้" },
        { status: 404 },
      );
    }
    // Validate all branches are same biz_type as template
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: badBranches } = await (admin.from as any)("branches")
      .select("id, code, business_type")
      .in("id", branchIds)
      .eq("org_id", session.user.org_id)
      .neq("business_type", tpl.business_type);
    if (badBranches && badBranches.length > 0) {
      const codes = badBranches
        .map((b: { code: string }) => b.code)
        .join(", ");
      return NextResponse.json(
        {
          error: `ประเภทธุรกิจไม่ตรงกับเทมเพลต: ${codes}`,
        },
        { status: 422 },
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from as any)("branches")
    .update({ form_template_id: templateId })
    .in("id", branchIds)
    .eq("org_id", session.user.org_id);

  if (error) {
    console.error("[POST /admin/branches/form-template]", error);
    return NextResponse.json({ error: "อัปเดตไม่สำเร็จ" }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "ASSIGN_FORM_TEMPLATE",
    resourceType: "branch",
    resourceId: branchIds.join(","),
    diff: { new: { templateId, count: branchIds.length } },
  });

  return NextResponse.json({ success: true, count: branchIds.length });
}
