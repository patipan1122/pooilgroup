// /api/docuflow/documents/[id]/download — redirect to fresh signed R2 URL
// GET: validates session + org_id, returns 302 to a 5-min signed URL

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { userCanViewModule } from "@/lib/auth/module-access";

/** Builds a sensible save-as filename from the document's real display
 *  name — CEO Pinpoint item #16 (2026-10-13): "verify the filename is
 *  sensible (original doc name, not a UUID)". `fileKey` (R2 object key,
 *  `documents/{orgId}/{docId}/{slug}.{ext}`) keeps the true original
 *  extension; `doc.name` is the human-editable display name shown
 *  everywhere else in the UI, so that's what the downloaded file should
 *  be called — just with the real extension appended if it's missing. */
function buildDownloadFilename(docName: string, fileKey: string): string {
  const keyExt = fileKey.includes(".") ? fileKey.split(".").pop() : null;
  const trimmedName = docName.trim() || "document";
  if (!keyExt) return trimmedName;
  const alreadyHasExt = trimmedName.toLowerCase().endsWith(`.${keyExt.toLowerCase()}`);
  return alreadyHasExt ? trimmedName : `${trimmedName}.${keyExt}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!(await userCanViewModule(session.user, "docuflow"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const doc = await prisma.document.findFirst({
    where: {
      id,
      orgId: session.user.org_id,
      isActive: true,
    },
    select: { id: true, name: true, fileKey: true, mimeType: true },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const filename = buildDownloadFilename(doc.name, doc.fileKey);
  const url = await getSignedDownloadUrl(doc.fileKey, 60 * 5, filename);
  return NextResponse.redirect(url, 302);
}
