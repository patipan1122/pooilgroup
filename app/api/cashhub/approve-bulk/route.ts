// Bulk approve — owner clicks "Approve all" once.
// Each report still goes through canApproveBranch + audit.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { canApproveBranch } from "@/lib/auth/permissions";

const Schema = z.object({
  reportIds: z.array(zUUID()).min(1).max(50),
});

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  const meta = getRequestMeta(req);

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

  const { reportIds } = parsed.data;
  const admin = adminClient();

  // Pull reports + check org match
  // submitted_by_id needed for SoD enforcement below
  const { data: reports } = await admin
    .from("daily_reports")
    .select("id, org_id, branch_id, status, submitted_by_id")
    .in("id", reportIds)
    .eq("org_id", session.user.org_id);

  if (!reports || reports.length === 0) {
    return NextResponse.json({ error: "ไม่พบรายงานในรายการนี้" }, { status: 404 });
  }

  // Pull user's branches
  const { data: ub } = await admin
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", session.user.id)
    .eq("is_active", true);
  const userBranchIds = ub?.map((u) => u.branch_id as string) ?? [];

  let skipped = 0;
  const now = new Date().toISOString();

  let skippedSelfApprove = 0;
  const eligible = reports.filter((r) => {
    if (r.status === "approved") {
      skipped += 1;
      return false;
    }
    if (!canApproveBranch(session.user, r.branch_id, userBranchIds)) {
      skipped += 1;
      return false;
    }
    // Segregation of Duties — ผู้กรอกห้ามอนุมัติเอง (Finance audit · 2026-05-20)
    if (r.submitted_by_id === session.user.id) {
      skipped += 1;
      skippedSelfApprove += 1;
      return false;
    }
    return true;
  });

  const eligibleIds = eligible.map((r) => r.id as string);
  const errors: string[] = [];
  let approved = 0;

  if (eligibleIds.length > 0) {
    // Atomic: ใส่ .eq("status", "submitted") ใน UPDATE เพื่อกัน race
    // ถ้ามีคนอื่น approve ระหว่างนั้น row จะ filter ออกเอง (returned id ลดลง)
    const { data: updated, error } = await admin
      .from("daily_reports")
      .update({
        status: "approved",
        approved_by_id: session.user.id,
        approved_at: now,
        updated_at: now,
      })
      .in("id", eligibleIds)
      .eq("status", "submitted")
      .select("id");

    if (error) {
      errors.push(error.message);
    } else {
      const updatedIds = new Set((updated ?? []).map((r) => r.id as string));
      approved = updatedIds.size;
      // Track what we lost to race (eligible but not actually updated)
      const raceSkipped = eligible.filter((r) => !updatedIds.has(r.id as string));
      skipped += raceSkipped.length;
      // Audit only reports we actually approved
      await Promise.all(
        eligible
          .filter((r) => updatedIds.has(r.id as string))
          .map((r) =>
            audit({
              orgId: r.org_id,
              userId: session.user.id,
              action: "APPROVE_REPORT",
              resourceType: "daily_report",
              resourceId: r.id,
              diff: { old: { status: r.status }, new: { status: "approved", bulk: true } },
              ...meta,
            }),
          ),
      );
    }
  }

  return NextResponse.json({
    success: true,
    approved,
    skipped,
    skippedSelfApprove,
    errors: errors.slice(0, 5),
  });
}
