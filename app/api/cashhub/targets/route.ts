// Targets CRUD — Owner sets monthly target per branch.
// Two helpers:
//   PUT /api/cashhub/targets   — upsert one target { branchId, year, month, amount }
//   POST /api/cashhub/targets/derive — derive from prior 3-month avg + factor

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { isAdmin } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit/log";

const PutSchema = z.object({
  branchId: zUUID(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  amount: z.number().min(0),
});

export async function PUT(req: NextRequest) {
  const gate = await cashHubApiGuard();
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { branchId, year, month, amount } = parsed.data;
  const admin = adminClient();

  // Verify branch in same org
  const { data: branch } = await admin
    .from("branches")
    .select("id, org_id")
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (!branch) return NextResponse.json({ error: "ไม่พบสาขา" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = admin.from("branch_targets");
  const { error } = await builder.upsert(
    {
      id: crypto.randomUUID(),
      org_id: branch.org_id,
      branch_id: branchId,
      year,
      month,
      amount,
      source: "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "branch_id,year,month" },
  );
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json(
        { error: "ตาราง branch_targets ยังไม่ถูกสร้าง — รัน migration ก่อน" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await audit({
    orgId: branch.org_id,
    userId: session.user.id,
    action: "UPDATE_BRANCH",
    resourceType: "branch_target",
    resourceId: branchId,
    diff: { new: { year, month, amount } },
  });
  return NextResponse.json({ ok: true });
}
