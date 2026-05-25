// POST /api/docuflow/upload-proxy
// ────────────────────────────────────────────────────────────────────
// Server-side upload proxy — bypasses R2 CORS by sending the file
// through the Next.js server. Used for files ≤ 25 MB (Vercel Pro body
// limit headroom). Larger files still use the presigned-URL flow in
// /api/docuflow/upload.
//
// Why: browser → R2 PUT failed silently on production (CORS not
// allowlisted on bucket). This route eliminates that whole class of
// bugs by uploading server-side via the AWS SDK directly.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { buildDocumentKey } from "@/lib/docuflow/r2";
import { putObject } from "@/lib/r2/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  .refine((o) => {
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
  }, { message: "ownership level must include the matching id/type" });

const RenewalSchema = z.object({
  expiryDate: z.string().min(1),
  renewalPeriodYears: z.number().int().min(1).max(50).optional(),
  alertDays: z.array(z.number().int().min(0).max(365)).optional(),
  responsibleUserId: zUUID().optional(),
  notes: z.string().max(2000).optional(),
});

const MetadataSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  documentType: z.string().max(255).optional(),
  ownerships: z.array(OwnershipSchema).min(1),
  tags: z.array(z.string().min(1).max(64)).default([]),
  renewal: RenewalSchema.optional(),
});

const MAX_PROXY_SIZE = 25 * 1024 * 1024; // 25 MB

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid multipart form data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const metadataRaw = formData.get("metadata");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (typeof metadataRaw !== "string") {
    return NextResponse.json({ error: "missing metadata" }, { status: 400 });
  }
  if (file.size > MAX_PROXY_SIZE) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกิน ${MAX_PROXY_SIZE / 1024 / 1024} MB · ใช้ presigned upload` },
      { status: 413 },
    );
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return NextResponse.json({ error: "Invalid metadata JSON" }, { status: 400 });
  }

  const parsed = MetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { name, description, documentType, ownerships, tags, renewal } = parsed.data;
  const orgId = session.user.org_id;

  const documentId = crypto.randomUUID();
  const fileKey = buildDocumentKey(orgId, documentId, file.name);
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`;
  const mimeType = file.type || "application/octet-stream";

  // Upload to R2 FIRST so we don't have orphan DB rows if the network blip
  // happens server-side. If R2 fails, we never wrote anything.
  try {
    const arrayBuffer = await file.arrayBuffer();
    await putObject(fileKey, Buffer.from(arrayBuffer), mimeType);
  } catch (err) {
    console.error("[upload-proxy] R2 put failed", err);
    return NextResponse.json(
      {
        error: "ส่งไฟล์ไป R2 ไม่สำเร็จ",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

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
          fileSize: file.size,
          uploadedById: session.user.id,
          isActive: true,
        },
      });

      await tx.documentOwnership.createMany({
        data: ownerships.map((o) => ({
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
          data: dedupedTags.map((tag) => ({ orgId, documentId, tag })),
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
    console.error("[upload-proxy] DB transaction failed", err);
    return NextResponse.json(
      {
        error: "บันทึกเอกสารไม่สำเร็จ",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_UPLOAD",
    resourceType: "document",
    resourceId: documentId,
    diff: {
      new: {
        name,
        ownerships: ownerships.map((o) => o.level),
        ownershipCount: ownerships.length,
        tags: dedupedTags,
        hasRenewal: Boolean(renewal),
        via: "proxy",
      },
    },
  });

  return NextResponse.json({ documentId, publicUrl });
}
