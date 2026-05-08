// /api/docuflow/risk-aggregate — Item 2 / spec §7 part 2
// ────────────────────────────────────────────────────────────────────
// GET   → return cached/fresh org-wide risk summary + narrative.
//         Any executive role can read.
// POST  → admin tier only. Forces a fresh Claude run (bypass cache).
//
// Cache is keyed daily per-org via AiSearchCache (24h TTL).
// Audit: DOCUFLOW_ANALYZE with diff { scope: 'org', orgId, riskCounts }.
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isExecutiveRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { adminClient } from "@/lib/db/server";
import { computeOrgRiskSummary } from "@/lib/docuflow/risk-aggregate";
import { narrateOrgRisk } from "@/lib/docuflow/risk-narrate";

export const dynamic = "force-dynamic";
// Org-wide aggregation + Claude can take a few seconds — bump runtime.
export const maxDuration = 60;

/* ============================================================
   Helpers
   ============================================================ */

async function getOrgName(orgId: string): Promise<string> {
  try {
    const admin = adminClient();
    const { data } = await admin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    return (data?.name as string | undefined) ?? "Pooilgroup";
  } catch {
    return "Pooilgroup";
  }
}

/* ============================================================
   GET — read-only (cache hit fast path)
   ============================================================ */

export async function GET() {
  const session = await requireSession();
  if (!isExecutiveRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = session.user.org_id;

  try {
    const [summary, orgName] = await Promise.all([
      computeOrgRiskSummary(orgId),
      getOrgName(orgId),
    ]);
    const narrative = await narrateOrgRisk(summary, orgName);
    return NextResponse.json({ summary, narrative });
  } catch (err) {
    console.error("[GET /api/docuflow/risk-aggregate]", err);
    const message =
      err instanceof Error ? err.message : "ดึงข้อมูลความเสี่ยงไม่สำเร็จ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ============================================================
   POST — force refresh (admin tier only)
   ============================================================ */

export async function POST() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden — admin tier only" },
      { status: 403 },
    );
  }
  const orgId = session.user.org_id;

  try {
    const [summary, orgName] = await Promise.all([
      computeOrgRiskSummary(orgId),
      getOrgName(orgId),
    ]);
    const narrative = await narrateOrgRisk(summary, orgName, { force: true });

    // Audit only when a real Claude call happened (not the empty short-circuit
    // and not a cache hit — narrative.fromCache will be false on force=true
    // unless the model failed and we returned a fallback).
    if (narrative.modelUsed) {
      await audit({
        orgId,
        userId: session.user.id,
        action: "DOCUFLOW_ANALYZE",
        resourceType: "org_risk",
        diff: {
          new: {
            scope: "org",
            orgId,
            riskCounts: {
              expired: summary.totals.expired,
              critical: summary.totals.critical,
              urgent: summary.totals.urgent,
              watch: summary.totals.watch,
              grandTotal: summary.totals.grandTotal,
            },
            modelUsed: narrative.modelUsed,
            tokensUsed: narrative.tokensUsed,
          },
        },
      });
    }

    return NextResponse.json({ summary, narrative });
  } catch (err) {
    console.error("[POST /api/docuflow/risk-aggregate]", err);
    const message =
      err instanceof Error ? err.message : "วิเคราะห์ใหม่ไม่สำเร็จ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
