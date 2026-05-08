// /docuflow/documents/[id]/signatures — Admin signature placement editor
// ────────────────────────────────────────────────────────────────────
// Admin tier only. Loads:
//   - the document (canonical loader)
//   - existing placements
//   - org users (signer picker)
//   - a fresh 1h signed download URL for the PDF (consumed by react-pdf)
//
// All heavy UI lives in <SignaturePlacementEditor /> ("use client").
// ────────────────────────────────────────────────────────────────────

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { loadDocumentById } from "@/lib/docuflow/data";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/ui/back-button";
import {
  SignaturePlacementEditor,
  type PlacementVm,
  type UserOption,
  type SignerRole,
} from "@/components/docuflow/signature-placement-editor";
import { thaiDateLong } from "@/lib/utils/format";

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
  if (doc.mimeType && doc.mimeType !== "application/pdf") {
    // Only PDFs supported for the placement editor.
    notFound();
  }

  // Fresh 1h signed URL for react-pdf to fetch
  const pdfUrl = await getSignedDownloadUrl(doc.fileKey).catch(() => null);
  if (!pdfUrl) notFound();

  const [rawPlacements, users] = await Promise.all([
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
  ]);

  const placements: PlacementVm[] = rawPlacements.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    pageNumber: r.pageNumber,
    xRatio: r.xRatio,
    yRatio: r.yRatio,
    widthRatio: r.widthRatio,
    heightRatio: r.heightRatio,
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

  // Origin for share links — derive from the request so dev/prod just work
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("host") || "localhost:3100";
  const origin = `${proto}://${host}`;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <BackButton fallbackHref={`/docuflow/documents/${id}`} />
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
          📄 DocuFlow · ตั้งจุดเซ็น · {thaiDateLong(new Date())}
        </p>
        <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display leading-[0.95] line-clamp-2">
          {doc.name}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 max-w-2xl">
          ลากกล่องลายเซ็นมาวางตรงจุดที่ต้องการ ระบุผู้เซ็นแต่ละจุด
          แล้วส่งลิงก์ให้ผู้เซ็นออนไลน์ผ่านมือถือหรือคอมพิวเตอร์
        </p>
      </header>

      <SignaturePlacementEditor
        documentId={doc.id}
        documentName={doc.name}
        pdfUrl={pdfUrl}
        initialPlacements={placements}
        users={userOptions}
        origin={origin}
      />
    </div>
  );
}
