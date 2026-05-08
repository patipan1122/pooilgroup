// GET    /api/docuflow/[id]/signatures           — list placements
// POST   /api/docuflow/[id]/signatures           — create placement (admin tier)
// PATCH  /api/docuflow/[id]/signatures           — bulk update (admin tier)
// DELETE /api/docuflow/[id]/signatures?placementId=X — remove placement (admin tier)
// ────────────────────────────────────────────────────────────────────
// Coordinate system: normalized 0..1 with TOP-LEFT origin (UI-friendly).
// Each placement is one signature box on one page of one document.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  requireAdminTier,
  requireExecutiveRole,
} from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const IdSchema = z.string().uuid();

const SignerRoleSchema = z.enum([
  "owner",
  "employee",
  "counterparty",
  "other",
]);

const RatioSchema = z.number().min(0).max(1);

const CreateSchema = z.object({
  pageNumber: z.number().int().min(1).max(2000),
  xRatio: RatioSchema,
  yRatio: RatioSchema,
  widthRatio: z.number().min(0.01).max(1),
  heightRatio: z.number().min(0.01).max(1),
  signerRole: SignerRoleSchema,
  signerUserId: z.string().uuid().nullable().optional(),
  signerName: z.string().max(120).nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  ordering: z.number().int().min(0).max(9999).optional(),
});

const UpdateOneSchema = z.object({
  id: z.string().uuid(),
  pageNumber: z.number().int().min(1).max(2000).optional(),
  xRatio: RatioSchema.optional(),
  yRatio: RatioSchema.optional(),
  widthRatio: z.number().min(0.01).max(1).optional(),
  heightRatio: z.number().min(0.01).max(1).optional(),
  signerRole: SignerRoleSchema.optional(),
  signerUserId: z.string().uuid().nullable().optional(),
  signerName: z.string().max(120).nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  ordering: z.number().int().min(0).max(9999).optional(),
});

const PatchSchema = z.object({
  updates: z.array(UpdateOneSchema).min(1).max(200),
});

/* ============================================================
   GET — list placements for a document
   ============================================================ */

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  // Placement metadata exposes signerUserId / signedImageKey / signedFileKey for
  // potentially sensitive admin-tier documents — restrict to executive roles.
  requireExecutiveRole(session.user.role);
  const { id: documentId } = await ctx.params;
  if (!IdSchema.safeParse(documentId).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId, isActive: true },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  const rows = await prisma.documentSignaturePlacement.findMany({
    where: { orgId, documentId },
    orderBy: [{ pageNumber: "asc" }, { ordering: "asc" }],
    include: {
      signerUser: { select: { id: true, name: true, role: true } },
    },
  });

  return NextResponse.json({
    placements: rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      pageNumber: r.pageNumber,
      xRatio: r.xRatio,
      yRatio: r.yRatio,
      widthRatio: r.widthRatio,
      heightRatio: r.heightRatio,
      signerRole: r.signerRole,
      signerUserId: r.signerUserId,
      signerName: r.signerName,
      signerUser: r.signerUser
        ? {
            id: r.signerUser.id,
            name: r.signerUser.name,
            role: r.signerUser.role,
          }
        : null,
      label: r.label,
      ordering: r.ordering,
      signedAt: r.signedAt,
      signedImageKey: r.signedImageKey,
      signedFileKey: r.signedFileKey,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}

/* ============================================================
   POST — create a placement (admin tier)
   ============================================================ */

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const { id: documentId } = await ctx.params;
  if (!IdSchema.safeParse(documentId).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const orgId = session.user.org_id;

  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId, isActive: true },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  // Validate signerUser belongs to same org (if provided)
  if (parsed.data.signerUserId) {
    const u = await prisma.user.findFirst({
      where: { id: parsed.data.signerUserId, orgId },
      select: { id: true },
    });
    if (!u) {
      return NextResponse.json(
        { error: "ผู้เซ็นที่เลือกไม่อยู่ในระบบ" },
        { status: 400 },
      );
    }
  }

  const created = await prisma.documentSignaturePlacement.create({
    data: {
      orgId,
      documentId,
      pageNumber: parsed.data.pageNumber,
      xRatio: parsed.data.xRatio,
      yRatio: parsed.data.yRatio,
      widthRatio: parsed.data.widthRatio,
      heightRatio: parsed.data.heightRatio,
      signerRole: parsed.data.signerRole,
      signerUserId: parsed.data.signerUserId ?? null,
      signerName: parsed.data.signerName ?? null,
      label: parsed.data.label ?? null,
      ordering: parsed.data.ordering ?? 0,
    },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SIGN_PLACEMENT_ADD",
    resourceType: "document_signature_placement",
    resourceId: created.id,
    diff: {
      new: {
        documentId,
        pageNumber: created.pageNumber,
        signerRole: created.signerRole,
        signerUserId: created.signerUserId,
        signerName: created.signerName,
      },
    },
  });

  return NextResponse.json({ placement: created });
}

/* ============================================================
   PATCH — bulk update (drag rearrange + label edit)
   ============================================================ */

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const { id: documentId } = await ctx.params;
  if (!IdSchema.safeParse(documentId).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const orgId = session.user.org_id;

  // Fetch existing rows in scope to ensure org/document match
  const ids = parsed.data.updates.map((u) => u.id);
  const existing = await prisma.documentSignaturePlacement.findMany({
    where: { id: { in: ids }, orgId, documentId },
    select: { id: true },
  });
  const validIds = new Set(existing.map((r) => r.id));

  const applied = parsed.data.updates.filter((u) => validIds.has(u.id));

  await prisma.$transaction(
    applied.map((u) =>
      prisma.documentSignaturePlacement.update({
        where: { id: u.id },
        data: {
          ...(u.pageNumber !== undefined ? { pageNumber: u.pageNumber } : {}),
          ...(u.xRatio !== undefined ? { xRatio: u.xRatio } : {}),
          ...(u.yRatio !== undefined ? { yRatio: u.yRatio } : {}),
          ...(u.widthRatio !== undefined ? { widthRatio: u.widthRatio } : {}),
          ...(u.heightRatio !== undefined
            ? { heightRatio: u.heightRatio }
            : {}),
          ...(u.signerRole !== undefined ? { signerRole: u.signerRole } : {}),
          ...(u.signerUserId !== undefined
            ? { signerUserId: u.signerUserId }
            : {}),
          ...(u.signerName !== undefined ? { signerName: u.signerName } : {}),
          ...(u.label !== undefined ? { label: u.label } : {}),
          ...(u.ordering !== undefined ? { ordering: u.ordering } : {}),
        },
      }),
    ),
  );

  if (applied.length > 0) {
    await audit({
      orgId,
      userId: session.user.id,
      action: "DOCUFLOW_SIGN_PLACEMENT_UPDATE",
      resourceType: "document",
      resourceId: documentId,
      diff: {
        new: {
          count: applied.length,
          placementIds: applied.map((u) => u.id),
        },
      },
    });
  }

  return NextResponse.json({ updated: validIds.size });
}

/* ============================================================
   DELETE — remove a single placement (admin tier)
   ============================================================ */

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const { id: documentId } = await ctx.params;
  if (!IdSchema.safeParse(documentId).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const placementId = url.searchParams.get("placementId");
  if (!placementId || !IdSchema.safeParse(placementId).success) {
    return NextResponse.json(
      { error: "ต้องระบุ placementId" },
      { status: 400 },
    );
  }

  const orgId = session.user.org_id;

  const existing = await prisma.documentSignaturePlacement.findFirst({
    where: { id: placementId, orgId, documentId },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "ไม่พบจุดเซ็นที่ต้องการลบ" },
      { status: 404 },
    );
  }

  await prisma.documentSignaturePlacement.delete({
    where: { id: placementId },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SIGN_PLACEMENT_DELETE",
    resourceType: "document_signature_placement",
    resourceId: placementId,
    diff: {
      old: {
        pageNumber: existing.pageNumber,
        signerRole: existing.signerRole,
        signerUserId: existing.signerUserId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
