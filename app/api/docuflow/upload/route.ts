// POST /api/docuflow/upload
// ────────────────────────────────────────────────────────────────────
// Create Document row + ownership + tags + (optional) renewal in a
// Prisma transaction, then return a presigned R2 upload URL so the
// client can PUT the file directly to Cloudflare.
//
// Spec: ดีเทลv1/DOCUFLOW.md §15 (Infrastructure / R2 + schema)
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { buildDocumentKey, getUploadUrl } from "@/lib/docuflow/r2";
import { validateDocumentMime } from "@/lib/docuflow/mime-validate";

export const dynamic = "force-dynamic";

const OWNERSHIP_LEVELS = [
  "group",
  "company",
  "business_type",
  "branch",
  "person",
] as const;

const OwnershipSchema = z
  .object({
    level: z.enum(OWNERSHIP_LEVELS),
    companyId: zUUID().nullish(),
    branchId: zUUID().nullish(),
    personId: zUUID().nullish(),
    businessType: z.string().min(1).nullish(),
  })
  .refine(
    (o) => {
      // require the right key for the chosen level (group has no extra key)
      switch (o.level) {
        case "group":
          return true;
        case "company":
          return Boolean(o.companyId);
        case "business_type":
          return Boolean(o.businessType);
        case "branch":
          return Boolean(o.branchId);
        case "person":
          return Boolean(o.personId);
      }
    },
    { message: "ownership level must include the matching id/type" },
  );

const RenewalSchema = z.object({
  expiryDate: z.string().min(1), // ISO date "yyyy-MM-dd" or full ISO
  renewalPeriodYears: z.number().int().min(1).max(50).optional(),
  alertDays: z.array(z.number().int().min(0).max(365)).optional(),
  responsibleUserId: zUUID().optional(),
  notes: z.string().max(2000).optional(),
});

const UploadSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  /** Canonical doc type key from canonical-docs.ts (e.g. "fuel_station:ใบอนุญาตสถานีบริการน้ำมัน")
      — set when admin uses smart-upload template; null for free-form uploads. */
  documentType: z.string().max(255).optional(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(500 * 1024 * 1024), // 500 MB
  /** Multi-select ownership: doc can span บริษัท + ธุรกิจ + สาขา + บุคคล + กลุ่ม พร้อมกัน.
      Legacy single `ownership` still accepted for back-compat. */
  ownerships: z.array(OwnershipSchema).min(1).optional(),
  ownership: OwnershipSchema.optional(),
  tags: z.array(z.string().min(1).max(64)).default([]),
  renewal: RenewalSchema.optional(),
}).refine((v) => v.ownerships !== undefined || v.ownership !== undefined, {
  message: "ต้องระบุ ownership หรือ ownerships อย่างน้อยหนึ่ง",
  path: ["ownerships"],
});

export async function POST(req: NextRequest) {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET ||
    !process.env.R2_PUBLIC_URL
  ) {
    return NextResponse.json(
      { error: "R2 env vars are not configured" },
      { status: 500 },
    );
  }

  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden — admin tier only" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    name,
    description,
    documentType,
    filename,
    mimeType,
    fileSize,
    ownerships: ownershipsInput,
    ownership: legacyOwnership,
    tags,
    renewal,
  } = parsed.data;

  // MIME / extension whitelist (B9 fix). Presigned flow can't sniff bytes
  // here — the file hasn't been uploaded yet — so we rely on the declared
  // MIME + filename extension. The browser still has to PUT with the same
  // Content-Type that was signed, so a malicious client can't lie cheaply.
  const mimeCheck = validateDocumentMime({ filename, mimeType });
  if (!mimeCheck.ok) {
    return NextResponse.json(
      { error: mimeCheck.reason || "ประเภทไฟล์ไม่อนุญาต" },
      { status: 415 },
    );
  }

  // Normalize: array form is canonical, legacy single → wrap in array
  const ownershipRows = ownershipsInput ?? (legacyOwnership ? [legacyOwnership] : []);
  const orgId = session.user.org_id;

  // Build the doc id up front so we can compute the R2 key before insert.
  const documentId = crypto.randomUUID();
  const fileKey = buildDocumentKey(orgId, documentId, filename);
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`;

  // De-dupe tags before insert
  const dedupedTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: documentId,
          orgId,
          name,
          description: description ?? null,
          documentType: documentType ?? null,
          fileKey,
          filePublicUrl: publicUrl,
          mimeType,
          fileSize,
          uploadedById: session.user.id,
          isActive: true,
        },
      });

      // Multi-select ownership: write one row per (level, scope) the admin
      // picked. A single doc can belong to บริษัท + ธุรกิจ + สาขา + บุคคล
      // simultaneously — this matches reality (e.g. ใบผ่อนผัน applies at all).
      await tx.documentOwnership.createMany({
        data: ownershipRows.map((o) => ({
          orgId,
          documentId,
          level: o.level,
          companyId: o.companyId ?? null,
          branchId: o.branchId ?? null,
          personId: o.personId ?? null,
          businessType: o.businessType ?? null,
        })),
      });

      if (dedupedTags.length > 0) {
        await tx.documentTag.createMany({
          data: dedupedTags.map((tag) => ({
            orgId,
            documentId,
            tag,
          })),
          skipDuplicates: true,
        });
      }

      if (renewal) {
        await tx.documentRenewal.create({
          data: {
            orgId,
            documentId,
            expiryDate: new Date(renewal.expiryDate),
            renewalPeriodYears: renewal.renewalPeriodYears ?? null,
            ...(renewal.alertDays && renewal.alertDays.length > 0
              ? { alertDays: renewal.alertDays }
              : {}),
            responsibleUserId: renewal.responsibleUserId ?? null,
            notes: renewal.notes ?? null,
            status: "pending",
          },
        });
      }
    });
  } catch (err) {
    console.error("[POST /api/docuflow/upload]", err);
    return NextResponse.json(
      { error: "บันทึกเอกสารไม่สำเร็จ ลองใหม่" },
      { status: 500 },
    );
  }

  // Presigned PUT URL (5 min lifetime — see lib/r2/upload.ts)
  const { url: uploadUrl } = await getUploadUrl(fileKey, mimeType);

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_UPLOAD",
    resourceType: "document",
    resourceId: documentId,
    diff: {
      new: {
        name,
        ownerships: ownershipRows.map((o) => o.level),
        ownershipCount: ownershipRows.length,
        tags: dedupedTags,
        hasRenewal: Boolean(renewal),
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

// DELETE /api/docuflow/upload?id=<docId>
// Orphan cleanup — called by the client when the browser → R2 PUT fails so
// we don't leave a stub document row pointing at a file that never existed.
export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  try {
    // Only delete docs owned by this org AND uploaded by this user within
    // the last 10 min — safeguards against stray DELETE calls.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const result = await prisma.document.deleteMany({
      where: {
        id,
        orgId: session.user.org_id,
        uploadedById: session.user.id,
        uploadedAt: { gte: tenMinAgo },
      },
    });
    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    console.error("[DELETE /api/docuflow/upload]", err);
    return NextResponse.json({ error: "cleanup failed" }, { status: 500 });
  }
}
