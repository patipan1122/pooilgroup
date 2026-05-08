// /api/docuflow/documents/[id]/download — redirect to fresh signed R2 URL
// GET: validates session + org_id, returns 302 to a 5-min signed URL

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await ctx.params;

  const doc = await prisma.document.findFirst({
    where: {
      id,
      orgId: session.user.org_id,
      isActive: true,
    },
    select: { id: true, fileKey: true, mimeType: true },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const url = await getSignedDownloadUrl(doc.fileKey, 60 * 5);
  return NextResponse.redirect(url, 302);
}
