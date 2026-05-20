// /api/docuflow/[id]/renewal-history — Capability J
// ────────────────────────────────────────────────────────────────────
// GET   → load full renewal chain + cached AI metadata (read-only,
//          executive role).
// POST  → trigger AI metadata extraction on the current document
//          (admin tier only — Claude calls cost money).
//
// Cache: structured metadata stored in document_analyses
//        (analysisType='metadata') keyed by (documentId, fileKey, kind).
// Audit: POST logs DOCUFLOW_EXTRACT_METADATA with kind + tokensUsed.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isExecutiveRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { loadRenewalChain } from "@/lib/docuflow/renewal-history";
import {
  extractDocumentMetadata,
  loadCachedMetadataMap,
  type MetadataKind,
} from "@/lib/docuflow/metadata-extract";

export const dynamic = "force-dynamic";
// AI extraction can take 5-15s end-to-end (R2 → PDF parse → Claude)
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const IdSchema = zUUID();

/* ============================================================
   GET — chain + cached metadata
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

  const orgId = session.user.org_id;
  const chain = await loadRenewalChain(orgId, id);

  if (chain.length === 0) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  const metaMap = await loadCachedMetadataMap(
    orgId,
    chain.map((n) => n.document.id),
  );

  return NextResponse.json({
    chain: chain.map((n) => ({
      ...n,
      metadata: metaMap.get(n.document.id) ?? null,
    })),
    length: chain.length,
  });
}

/* ============================================================
   POST — extract metadata for current document (admin tier)
   ============================================================ */

const PostBodySchema = z
  .object({
    kind: z
      .enum(["insurance", "rental", "registration", "auto"])
      .optional(),
  })
  .optional();

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

  let parsedBody: { kind?: MetadataKind } | undefined;
  try {
    const raw = await req.text();
    if (raw) {
      const parsed = PostBodySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
      parsedBody = parsed.data;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  try {
    const result = await extractDocumentMetadata(
      id,
      orgId,
      parsedBody?.kind ?? "auto",
    );

    // Only audit on real (non-cached) Claude calls — cache hits are free
    if (!result.cached) {
      await audit({
        orgId,
        userId: session.user.id,
        action: "DOCUFLOW_EXTRACT_METADATA",
        resourceType: "document",
        resourceId: id,
        diff: {
          new: {
            kind: result.metadata.kind,
            modelUsed: result.modelUsed,
            tokensUsed: result.tokensUsed,
          },
        },
      });
    }

    return NextResponse.json({
      metadata: result.metadata,
      cached: result.cached,
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,
      analyzedAt: result.analyzedAt,
    });
  } catch (err: unknown) {
    console.error("[POST /api/docuflow/:id/renewal-history]", err);
    const msg = err instanceof Error ? err.message : "ดึงข้อมูลไม่สำเร็จ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
