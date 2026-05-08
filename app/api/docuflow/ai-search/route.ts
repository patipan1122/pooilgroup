// POST /api/docuflow/ai-search — Capability G "ภาษาคน"
// ────────────────────────────────────────────────────────────────────
// Executive role guard. Validates query (max 500 chars), runs Claude
// with tool-use against canonical loaders, audits every call.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isExecutiveRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { runAiSearch } from "@/lib/docuflow/ai-search";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // tool-use rounds can take a few seconds

const Schema = z.object({
  query: z.string().trim().min(2, "คำถามสั้นเกินไป").max(500, "คำถามยาวเกิน 500 ตัวอักษร"),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();

  // Guard — read endpoint, executive tier only (super_admin/org_admin/admin/area_manager/viewer)
  if (!isExecutiveRole(session.user.role)) {
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์ใช้ AI Search" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
      },
      { status: 400 },
    );
  }

  const { query } = parsed.data;
  const orgId = session.user.org_id;

  try {
    const result = await runAiSearch(orgId, query);

    // Audit — log every call (cached or not) for cost tracking
    await audit({
      orgId,
      userId: session.user.id,
      action: "DOCUFLOW_SEARCH",
      resourceType: "ai_search",
      diff: {
        new: {
          query,
          resultCount: result.resultCount,
          cached: result.cached,
          toolRounds: result.toolRounds ?? 0,
          citationCount: result.citations.length,
        },
      },
    });

    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      cached: result.cached,
    });
  } catch (err: unknown) {
    console.error("[ai-search]", err);
    const msg =
      err instanceof Error ? err.message : "ติดต่อ AI ไม่ได้ในขณะนี้";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
