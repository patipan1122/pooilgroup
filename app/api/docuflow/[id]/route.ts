// GET    /api/docuflow/[id]  — fetch + fresh signed download URL
// PATCH  /api/docuflow/[id]  — update name/description/tags/renewal
// DELETE /api/docuflow/[id]  — soft delete (isActive=false)
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { loadDocumentById } from "@/lib/docuflow/data";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const IdSchema = z.string().uuid();

/* ============================================================
   GET — single document + fresh signed download URL
   ============================================================ */

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const doc = await loadDocumentById(session.user.org_id, id);
  if (!doc || !doc.isActive) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  const downloadUrl = await getSignedDownloadUrl(doc.fileKey).catch(
    (err: unknown) => {
      console.error("[GET /api/docuflow/:id] sign failed", err);
      return null;
    },
  );

  return NextResponse.json({ document: doc, downloadUrl });
}

/* ============================================================
   PATCH — update name / description / tags / renewal
   ============================================================ */

const RenewalPatchSchema = z.object({
  expiryDate: z.string().min(1).optional(),
  renewalPeriodYears: z.number().int().min(1).max(50).nullable().optional(),
  alertDays: z.array(z.number().int().min(0).max(365)).optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  status: z
    .enum(["pending", "in_progress", "renewed", "overdue"])
    .optional(),
  lastRenewedDate: z.string().min(1).nullable().optional(),
  nextRenewalDate: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const PatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).optional(),
  renewal: RenewalPatchSchema.optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const orgId = session.user.org_id;

  const existing = await prisma.document.findFirst({
    where: { id, orgId },
    include: { tags: true, renewals: { orderBy: { expiryDate: "asc" }, take: 1 } },
  });
  if (!existing || !existing.isActive) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  const { name, description, tags, renewal } = parsed.data;

  const oldDiff: Record<string, unknown> = {};
  const newDiff: Record<string, unknown> = {};

  try {
    await prisma.$transaction(async (tx) => {
      // Update doc fields
      if (name !== undefined || description !== undefined) {
        await tx.document.update({
          where: { id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
          },
        });
        if (name !== undefined && name !== existing.name) {
          oldDiff.name = existing.name;
          newDiff.name = name;
        }
        if (description !== undefined && description !== existing.description) {
          oldDiff.description = existing.description;
          newDiff.description = description;
        }
      }

      // Replace tags wholesale (caller sends the desired final set)
      if (tags !== undefined) {
        const desired = Array.from(
          new Set(tags.map((t) => t.trim()).filter(Boolean)),
        );
        const current = existing.tags.map((t) => t.tag);
        const toRemove = current.filter((t) => !desired.includes(t));
        const toAdd = desired.filter((t) => !current.includes(t));
        if (toRemove.length > 0) {
          await tx.documentTag.deleteMany({
            where: { orgId, documentId: id, tag: { in: toRemove } },
          });
        }
        if (toAdd.length > 0) {
          await tx.documentTag.createMany({
            data: toAdd.map((tag) => ({ orgId, documentId: id, tag })),
            skipDuplicates: true,
          });
        }
        if (toRemove.length > 0 || toAdd.length > 0) {
          oldDiff.tags = current;
          newDiff.tags = desired;
        }
      }

      // Renewal: upsert latest row (by id if exists, else create)
      if (renewal !== undefined) {
        const current = existing.renewals[0] ?? null;
        const data: Record<string, unknown> = {};
        if (renewal.expiryDate !== undefined)
          data.expiryDate = new Date(renewal.expiryDate);
        if (renewal.renewalPeriodYears !== undefined)
          data.renewalPeriodYears = renewal.renewalPeriodYears;
        if (renewal.alertDays !== undefined && renewal.alertDays.length > 0)
          data.alertDays = renewal.alertDays;
        if (renewal.responsibleUserId !== undefined)
          data.responsibleUserId = renewal.responsibleUserId;
        if (renewal.status !== undefined) data.status = renewal.status;
        if (renewal.lastRenewedDate !== undefined)
          data.lastRenewedDate =
            renewal.lastRenewedDate === null
              ? null
              : new Date(renewal.lastRenewedDate);
        if (renewal.nextRenewalDate !== undefined)
          data.nextRenewalDate =
            renewal.nextRenewalDate === null
              ? null
              : new Date(renewal.nextRenewalDate);
        if (renewal.notes !== undefined) data.notes = renewal.notes;

        if (current) {
          if (Object.keys(data).length > 0) {
            await tx.documentRenewal.update({
              where: { id: current.id },
              data,
            });
          }
          oldDiff.renewal = {
            expiryDate: current.expiryDate,
            status: current.status,
          };
          newDiff.renewal = data;
        } else if (renewal.expiryDate) {
          await tx.documentRenewal.create({
            data: {
              orgId,
              documentId: id,
              expiryDate: new Date(renewal.expiryDate),
              renewalPeriodYears: renewal.renewalPeriodYears ?? null,
              ...(renewal.alertDays && renewal.alertDays.length > 0
                ? { alertDays: renewal.alertDays }
                : {}),
              responsibleUserId: renewal.responsibleUserId ?? null,
              status: renewal.status ?? "pending",
              notes: renewal.notes ?? null,
            },
          });
          newDiff.renewal = { created: true, expiryDate: renewal.expiryDate };
        }
      }
    });
  } catch (err) {
    console.error("[PATCH /api/docuflow/:id]", err);
    return NextResponse.json(
      { error: "อัปเดตไม่สำเร็จ ลองใหม่" },
      { status: 500 },
    );
  }

  // Pick the right action — renewal change → DOCUFLOW_RENEW, tag-only →
  // DOCUFLOW_TAG, otherwise generic update folds into DOCUFLOW_RENEW.
  let action:
    | "DOCUFLOW_RENEW"
    | "DOCUFLOW_TAG"
    | "DOCUFLOW_UPLOAD" = "DOCUFLOW_RENEW";
  if (newDiff.tags !== undefined && newDiff.renewal === undefined) {
    action = "DOCUFLOW_TAG";
  }

  await audit({
    orgId,
    userId: session.user.id,
    action,
    resourceType: "document",
    resourceId: id,
    diff: { old: oldDiff, new: newDiff },
  });

  const refreshed = await loadDocumentById(orgId, id);
  return NextResponse.json({ document: refreshed });
}

/* ============================================================
   DELETE — soft delete via isActive=false
   ============================================================ */

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  const existing = await prisma.document.findFirst({
    where: { id, orgId },
    select: { id: true, isActive: true, name: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }
  if (!existing.isActive) {
    return NextResponse.json(
      { error: "เอกสารถูกลบแล้ว" },
      { status: 409 },
    );
  }

  await prisma.document.update({
    where: { id },
    data: { isActive: false },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_DELETE",
    resourceType: "document",
    resourceId: id,
    diff: {
      old: { isActive: true, name: existing.name },
      new: { isActive: false },
    },
  });

  return NextResponse.json({ success: true });
}
