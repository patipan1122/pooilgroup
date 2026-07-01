// FlowCo branch mapping API.
//   GET  → current mapping state (per station: linked / suggested / to-create)
//   POST → apply decisions (link existing branch or create new fuel_station branch)

import { NextRequest, NextResponse } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { fetchFlowcoSteIds } from "@/lib/cashhub/flowco-source";
import {
  buildFlowcoMapState,
  applyFlowcoMapping,
  type MapDecision,
} from "@/lib/cashhub/flowco-branch-map";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const orgId = gate.session.user.org_id;

  const admin = adminClient();
  try {
    const steIds = await fetchFlowcoSteIds(admin);
    const state = await buildFlowcoMapState(admin, orgId, steIds);
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function isValidDecision(d: unknown): d is MapDecision {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  if (typeof o.steId !== "number") return false;
  if (o.action === "skip") return true;
  if (o.action === "link") return typeof o.branchId === "string";
  if (o.action === "create") return typeof o.name === "string" && o.name.trim().length > 0;
  return false;
}

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const { session } = gate;
  const orgId = session.user.org_id;

  let body: { decisions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const raw = Array.isArray(body.decisions) ? body.decisions : [];
  const decisions = raw.filter(isValidDecision);
  if (decisions.length === 0) {
    return NextResponse.json({ error: "ไม่มีรายการจับคู่ที่ถูกต้อง" }, { status: 400 });
  }

  const admin = adminClient();
  try {
    const result = await applyFlowcoMapping(
      admin,
      orgId,
      session.user.id,
      decisions,
    );
    await audit({
      orgId,
      userId: session.user.id,
      action: "UPDATE_BRANCH",
      resourceType: "branch",
      diff: {
        new: {
          context: "flowco_branch_map",
          linked: result.linked,
          created: result.created,
          errors: result.errors.length,
        },
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
