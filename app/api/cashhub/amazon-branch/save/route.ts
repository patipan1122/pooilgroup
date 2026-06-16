// POST /api/cashhub/amazon-branch/save — เพิ่ม/แก้สาขา Amazon (super_admin)
// เรื่องนี้แตะ TRCloud (ออกใบกำกับ/ภาษี) → super_admin เท่านั้น ตาม super_admin-only connection gating.
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  upsertAmazonBranch,
  type AmazonBranchInput,
} from "@/lib/cashhub/amazon-branch-data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json(
      { error: "เฉพาะ super_admin เพิ่ม/แก้สาขาได้" },
      { status: 403 },
    );

  let body: { branch?: AmazonBranchInput };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const branch = body.branch;
  if (!branch || typeof branch !== "object")
    return NextResponse.json({ error: "ไม่มีข้อมูลสาขา" }, { status: 400 });

  const res = await upsertAmazonBranch(
    adminClient(),
    session.user.org_id,
    branch,
    session.user.id,
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPSERT_AMAZON_BRANCH",
    resourceType: "cashhub_amazon_branch",
    diff: {
      new: { project: branch.project, label: branch.label, type: branch.type },
    },
  });
  return NextResponse.json({ ok: true });
}
