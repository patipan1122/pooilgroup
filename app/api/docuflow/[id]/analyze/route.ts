// /api/docuflow/[id]/analyze — Capability H · AI Risk Analysis
// ────────────────────────────────────────────────────────────────────
// POST  → run (or refresh) Claude analysis. Admin tier only — Claude
//         calls cost money, so only admins can trigger.
// GET   → read cache (any executive role can view existing analysis).
//
// Cache: keyed by (documentId, fileKey, "risk") in document_analyses.
// Audit: POST logs DOCUFLOW_ANALYZE with riskLevel + tokensUsed.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isExecutiveRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import {
  analyzeDocument,
  getCachedAnalysis,
} from "@/lib/docuflow/ai-analyze";

export const dynamic = "force-dynamic";
// Claude calls + R2 download + PDF parse can take 5-15s; bump runtime.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const IdSchema = z.string().uuid();

const PostBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

/* ============================================================
   POST — run analysis (admin tier only)
   ============================================================ */

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden — admin tier only" },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let parsedBody: { force?: boolean } | undefined;
  try {
    const raw = await req.text();
    if (raw) {
      const parsed = PostBodySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body" },
          { status: 400 },
        );
      }
      parsedBody = parsed.data;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  try {
    const analysis = await analyzeDocument(id, orgId, {
      force: parsedBody?.force ?? false,
    });

    // Only audit when we actually ran a Claude call (cache miss / forced)
    if (!analysis.fromCache) {
      await audit({
        orgId,
        userId: session.user.id,
        action: "DOCUFLOW_ANALYZE",
        resourceType: "document",
        resourceId: id,
        diff: {
          new: {
            documentId: id,
            riskLevel: analysis.riskLevel,
            tokensUsed: analysis.tokensUsed,
            modelUsed: analysis.modelUsed,
          },
        },
      });
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[POST /api/docuflow/:id/analyze]", err);
    const message =
      err instanceof Error ? err.message : "วิเคราะห์ไม่สำเร็จ ลองใหม่";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ============================================================
   GET — read cached analysis (any executive)
   ============================================================ */

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  if (!isExecutiveRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const analysis = await getCachedAnalysis(id, session.user.org_id);
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[GET /api/docuflow/:id/analyze]", err);
    return NextResponse.json(
      { error: "อ่านผลวิเคราะห์ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
