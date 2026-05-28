// /docuflow/documents/[id]/signatures — Admin signature placement editor
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopSigning canvas (header chrome).
// Admin tier only. Heavy UI lives in <SignaturePlacementEditor /> (client).
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft, PenSquare, History, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { loadDocumentById } from "@/lib/docuflow/data";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { prisma } from "@/lib/prisma";
import {
  SignaturePlacementEditor,
  type PlacementVm,
  type UserOption,
  type SignerRole,
} from "@/components/docuflow/signature-placement-editor";
import {
  DfButton,
  DfEyebrow,
  DfPageHeader,
  DfPill,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

export default async function SignaturePlacementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const doc = await loadDocumentById(orgId, id);
  if (!doc || !doc.isActive) notFound();
  if (doc.mimeType && doc.mimeType !== "application/pdf") notFound();

  const pdfUrl = await getSignedDownloadUrl(doc.fileKey).catch(() => null);
  if (!pdfUrl) notFound();

  const [rawPlacements, users, totalPending] = await Promise.all([
    prisma.documentSignaturePlacement.findMany({
      where: { orgId, documentId: id },
      orderBy: [{ pageNumber: "asc" }, { ordering: "asc" }],
      include: {
        signerUser: { select: { id: true, name: true, role: true } },
      },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.documentSignaturePlacement.count({
      where: {
        document: { orgId, isActive: true },
        signerUserId: session.user.id,
        signedAt: null,
      },
    }),
  ]);

  const placements: PlacementVm[] = rawPlacements.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    pageNumber: r.pageNumber,
    xRatio: r.xRatio,
    yRatio: r.yRatio,
    widthRatio: r.widthRatio,
    heightRatio: r.heightRatio,
    placementType:
      (r.placementType as "signature" | "date" | "name" | "text") ??
      "signature",
    autoFillValue: r.autoFillValue,
    signerRole: r.signerRole as SignerRole,
    signerUserId: r.signerUserId,
    signerName: r.signerName,
    signerUser: r.signerUser
      ? { id: r.signerUser.id, name: r.signerUser.name, role: r.signerUser.role }
      : null,
    label: r.label,
    ordering: r.ordering,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
    signedImageKey: r.signedImageKey,
    signedFileKey: r.signedFileKey,
  }));

  const userOptions: UserOption[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
  }));

  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("host") || "localhost:3100";
  const origin = `${proto}://${host}`;

  const totalPlacements = placements.length;
  const signedPlacements = placements.filter((p) => p.signedAt).length;

  return (
    <div
      style={{
        padding: "20px clamp(12px, 3vw, 32px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <Link
        href={`/docuflow/documents/${id}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับเอกสาร
      </Link>

      <DfPageHeader
        eyebrow={<DfEyebrow>ลายเซ็น · ผู้บริหาร</DfEyebrow>}
        title={doc.name}
        description="ลากกล่องลายเซ็นไปวางจุดที่ต้องการ — ระบบจะส่งลิงก์ให้ผู้รับเซ็นออนไลน์ทาง LINE หรืออีเมล"
        actions={
          <>
            {totalPending > 0 && (
              <DfPill tone="accent">
                <PenSquare size={12} /> {totalPending} ฉบับรอฉันเซ็น
              </DfPill>
            )}
            {totalPlacements > 0 && (
              <DfPill
                tone={signedPlacements === totalPlacements ? "success" : "warn"}
              >
                เซ็นแล้ว {signedPlacements}/{totalPlacements}
              </DfPill>
            )}
            <DfButton variant="ghost">
              <History size={14} />
              ประวัติ
            </DfButton>
          </>
        }
      />

      <SignaturePlacementEditor
        documentId={doc.id}
        documentName={doc.name}
        pdfUrl={pdfUrl}
        initialPlacements={placements}
        users={userOptions}
        origin={origin}
      />

      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--df-muted)",
        }}
      >
        <Lock size={11} /> ยืนยันด้วย OTP · บันทึก timestamp + IP อัตโนมัติ
      </div>
    </div>
  );
}
