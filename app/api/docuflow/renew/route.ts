// /api/docuflow/renew — Renew a vehicle or person document
// POST: creates new Document + entity link + renewal,
//       marks oldDocumentId's renewal as renewed (if provided),
//       returns presigned R2 upload URL for the client to PUT the new file.

import { NextResponse } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { buildDocumentKey } from "@/lib/docuflow/r2";
import { getUploadUrl } from "@/lib/r2/upload";

const RenewSchema = z.object({
  entityType: z.enum(["vehicle", "person"]),
  entityId: zUUID(),
  docType: z.string().min(1).max(64),
  oldDocumentId: zUUID().optional(),
  name: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(128),
  fileSize: z.number().int().nonnegative().max(50 * 1024 * 1024), // 50MB
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  alertDays: z
    .array(z.number().int().positive())
    .max(5)
    .optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RenewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const orgId = session.user.org_id;

  // Verify entity exists in this org
  if (data.entityType === "vehicle") {
    const v = await prisma.vehicle.findFirst({
      where: { id: data.entityId, orgId },
      select: { id: true, branchId: true, companyId: true },
    });
    if (!v) {
      return NextResponse.json(
        { error: "Vehicle not found" },
        { status: 404 },
      );
    }
  } else {
    const u = await prisma.user.findFirst({
      where: { id: data.entityId, orgId },
      select: { id: true },
    });
    if (!u) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  const documentId = crypto.randomUUID();
  const fileKey = buildDocumentKey(orgId, documentId, data.filename);
  const { url: uploadUrl, publicUrl } = await getUploadUrl(
    fileKey,
    data.mimeType,
  );

  const today = new Date().toISOString().slice(0, 10);
  const expiryDateObj = new Date(data.expiryDate);

  await prisma.$transaction(async (tx) => {
    // 1. Create the new Document row
    await tx.document.create({
      data: {
        id: documentId,
        orgId,
        name: data.name,
        fileKey,
        filePublicUrl: publicUrl,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        uploadedById: session.user.id,
      },
    });

    // 2. Ownership + entity link
    if (data.entityType === "vehicle") {
      const v = await tx.vehicle.findUnique({
        where: { id: data.entityId },
        select: { branchId: true, companyId: true },
      });
      await tx.documentOwnership.create({
        data: {
          orgId,
          documentId,
          level: v?.branchId
            ? "branch"
            : v?.companyId
              ? "company"
              : "group",
          branchId: v?.branchId ?? null,
          companyId: v?.companyId ?? null,
        },
      });
      await tx.vehicleDocument.create({
        data: {
          orgId,
          vehicleId: data.entityId,
          documentId,
          docType: data.docType,
          expiryDate: expiryDateObj,
        },
      });
    } else {
      await tx.documentOwnership.create({
        data: {
          orgId,
          documentId,
          level: "person",
          personId: data.entityId,
        },
      });
      await tx.personDocument.create({
        data: {
          orgId,
          userId: data.entityId,
          documentId,
          docType: data.docType,
          expiryDate: expiryDateObj,
        },
      });
    }

    // 3. Tags (optional)
    if (data.tags && data.tags.length > 0) {
      await tx.documentTag.createMany({
        data: data.tags.map((tag) => ({ orgId, documentId, tag })),
        skipDuplicates: true,
      });
    }

    // 4. New renewal record (status pending)
    await tx.documentRenewal.create({
      data: {
        orgId,
        documentId,
        expiryDate: expiryDateObj,
        alertDays: data.alertDays ?? [90, 30, 7],
        status: "pending",
      },
    });

    // 5. Mark old document's renewal as renewed
    if (data.oldDocumentId) {
      await tx.documentRenewal.updateMany({
        where: {
          orgId,
          documentId: data.oldDocumentId,
          status: { not: "renewed" },
        },
        data: {
          status: "renewed",
          lastRenewedDate: new Date(today),
          nextRenewalDate: expiryDateObj,
        },
      });
    }
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_RENEW",
    resourceType: "document",
    resourceId: documentId,
    diff: {
      new: {
        entityType: data.entityType,
        entityId: data.entityId,
        docType: data.docType,
        oldDocumentId: data.oldDocumentId,
        expiryDate: data.expiryDate,
      },
    },
  });

  return NextResponse.json({
    documentId,
    uploadUrl,
    fileKey,
    publicUrl,
  });
}
