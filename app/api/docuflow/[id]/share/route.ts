// GET    /api/docuflow/[id]/share          — list branches sharing this doc
// POST   /api/docuflow/[id]/share          — body: { branchIds: string[] } add shares
// DELETE /api/docuflow/[id]/share?branchId — remove a single share
// ────────────────────────────────────────────────────────────────────
// Capability E · Cross-branch Document Sharing
//   - requireExecutiveRole for read · requireAdminTier for write
//   - Multi-tenant orgId scope ทุก query
//   - skipDuplicates on bulk add (link table has @@unique(documentId, branchId))
//   - Audit DOCUFLOW_SHARE on every mutation
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import {
  requireExecutiveRole,
  requireAdminTier,
} from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const IdSchema = zUUID();
const PostSchema = z.object({
  branchIds: z.array(zUUID()).min(1).max(200),
});

/* ============================================================
   GET — list branches sharing this doc (with name/code/biztype)
   ============================================================ */

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const { id } = await ctx.params;

  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Confirm doc exists in this org (avoid leaking shares for other orgs)
  const doc = await prisma.document.findFirst({
    where: { id, orgId },
    select: { id: true, isActive: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  const rows = await prisma.documentSharedBranch.findMany({
    where: { orgId, documentId: id },
    include: {
      branch: {
        select: {
          id: true,
          code: true,
          name: true,
          businessType: true,
          isActive: true,
        },
      },
    },
    orderBy: { addedAt: "asc" },
  });

  return NextResponse.json({
    shares: rows.map((r) => ({
      id: r.id,
      branchId: r.branchId,
      addedAt: r.addedAt,
      branch: r.branch,
    })),
  });
}

/* ============================================================
   POST — add shares (skipDuplicates)
   ============================================================ */

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;
  const { id } = await ctx.params;

  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { branchIds } = parsed.data;

  // Confirm doc belongs to this org and is active
  const doc = await prisma.document.findFirst({
    where: { id, orgId },
    select: { id: true, isActive: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }
  if (!doc.isActive) {
    return NextResponse.json(
      { error: "เอกสารถูกลบแล้ว" },
      { status: 409 },
    );
  }

  // Confirm all branchIds are in this org (security — cross-tenant guard)
  const dedupedBranchIds = Array.from(new Set(branchIds));
  const validBranches = await prisma.branch.findMany({
    where: { orgId, id: { in: dedupedBranchIds } },
    select: { id: true },
  });
  const validIds = new Set(validBranches.map((b) => b.id));
  const acceptedIds = dedupedBranchIds.filter((b) => validIds.has(b));

  if (acceptedIds.length === 0) {
    return NextResponse.json(
      { error: "ไม่พบสาขาที่เลือก" },
      { status: 400 },
    );
  }

  const result = await prisma.documentSharedBranch.createMany({
    data: acceptedIds.map((branchId) => ({
      orgId,
      documentId: id,
      branchId,
    })),
    skipDuplicates: true,
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SHARE",
    resourceType: "document",
    resourceId: id,
    diff: {
      new: { added: acceptedIds, count: result.count },
    },
  });

  return NextResponse.json({
    success: true,
    added: result.count,
    requested: dedupedBranchIds.length,
  });
}

/* ============================================================
   DELETE — remove a single share by branchId query param
   ============================================================ */

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;
  const { id } = await ctx.params;

  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const branchId = req.nextUrl.searchParams.get("branchId");
  if (!branchId || !IdSchema.safeParse(branchId).success) {
    return NextResponse.json(
      { error: "ระบุ branchId ในรูปแบบ UUID" },
      { status: 400 },
    );
  }

  // Confirm doc belongs to this org (cross-tenant guard)
  const doc = await prisma.document.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  const existing = await prisma.documentSharedBranch.findFirst({
    where: { orgId, documentId: id, branchId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "ไม่พบการแชร์รายการนี้" },
      { status: 404 },
    );
  }

  await prisma.documentSharedBranch.delete({
    where: { id: existing.id },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SHARE",
    resourceType: "document",
    resourceId: id,
    diff: {
      old: { removed: branchId },
    },
  });

  return NextResponse.json({ success: true });
}
