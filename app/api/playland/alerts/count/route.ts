// Unresolved alert count · powers mobile bottom nav badge
// Per Owner Mobile review: alert-blindness when off the cockpit page

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const count = await prisma.playlandAlert.count({
    where: { orgId: session.user.org_id, resolvedAt: null },
  });
  return NextResponse.json({ count });
}
