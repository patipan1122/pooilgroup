// POST /api/cashhub/amazon-branch/delete — ลบสาขา Amazon ที่เพิ่มเอง (super_admin)
// ลบได้เฉพาะสาขา custom (ที่เพิ่มผ่านหน้าจัดการ) — สาขามากับระบบไม่มี id ลบไม่ได้.
// ไม่กระทบยอดที่เคยเซฟ (cashhub_amazon_daily แยกตาราง) — แค่เลิกจับคู่ไฟล์ใหม่.
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { deleteAmazonBranch } from "@/lib/cashhub/amazon-branch-data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json(
      { error: "เฉพาะ super_admin ลบสาขาได้" },
      { status: 403 },
    );

  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "ไม่มีรหัสสาขา" }, { status: 400 });

  const res = await deleteAmazonBranch(adminClient(), session.user.org_id, id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DELETE_AMAZON_BRANCH",
    resourceType: "cashhub_amazon_branch",
    diff: { old: { id } },
  });
  return NextResponse.json({ ok: true });
}
