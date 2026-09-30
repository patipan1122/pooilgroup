// Playland · serve a member's registered face photo to the cashier UI.
//
// Deliberately NOT a public R2 URL — these are children's face photos (PDPA
// consent-gated, see PlaylandMember.consentAt/retentionUntil). Streamed
// server-side through an authenticated session check instead, same posture
// as every other R2 read in this codebase (agent/face-sync route, incidents).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "@/lib/playland/role-guard";
import { getObject } from "@/lib/r2/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return new NextResponse("forbidden", { status: 403 });

  const { id } = await params;
  const member = await prisma.playlandMember.findFirst({
    where: { id, orgId: session.user.org_id, deletedAt: null },
    select: { photoR2Path: true },
  });
  if (!member?.photoR2Path) return new NextResponse("not found", { status: 404 });

  try {
    const buf = await getObject(member.photoR2Path);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" },
    });
  } catch {
    return new NextResponse("read failed", { status: 502 });
  }
}
