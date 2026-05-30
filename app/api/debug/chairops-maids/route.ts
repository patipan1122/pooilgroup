// Debug-only — lists every ChairopsUser with role=MAID and reports whether
// their Pool plumbing (public.users row + user_modules chairops grant) exists.
// Gated by header `x-debug-key` matching CRON_SECRET so it's not freely
// accessible from the internet but I can curl it.

import { type NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-debug-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const maids = await prisma.chairopsUser.findMany({
    where: { role: "MAID" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      lineUserId: true,
      authUserId: true,
      orgId: true,
      primaryBranchId: true,
      isActive: true,
      createdAt: true,
    },
  });

  const admin = adminClient();
  const result = await Promise.all(
    maids.map(async (m) => {
      let poolRow: { id?: string; role?: string; is_active?: boolean } | null =
        null;
      let moduleRow: { id?: string; is_active?: boolean } | null = null;
      if (m.authUserId) {
        const { data: pr } = await admin
          .from("users")
          .select("id, role, is_active")
          .eq("id", m.authUserId)
          .maybeSingle();
        poolRow = pr;
        const { data: mr } = await admin
          .from("user_modules")
          .select("id, is_active")
          .eq("org_id", m.orgId)
          .eq("user_id", m.authUserId)
          .eq("module_name", "chairops")
          .maybeSingle();
        moduleRow = mr;
      }
      return {
        chairopsId: m.id,
        email: m.email,
        displayName: m.displayName,
        lineUserId: m.lineUserId?.slice(0, 10) ?? null,
        authUserId: m.authUserId?.slice(0, 8) ?? null,
        primaryBranchId: m.primaryBranchId,
        isActive: m.isActive,
        createdAt: m.createdAt,
        poolUserPresent: !!poolRow,
        poolUserActive: !!poolRow?.is_active,
        poolUserRole: poolRow?.role ?? null,
        moduleGrantPresent: !!moduleRow,
        moduleGrantActive: !!moduleRow?.is_active,
        ready:
          !!poolRow?.is_active &&
          !!moduleRow?.is_active &&
          m.isActive &&
          !!m.authUserId,
      };
    }),
  );

  return NextResponse.json({
    count: result.length,
    ready: result.filter((r) => r.ready).length,
    notReady: result.filter((r) => !r.ready).length,
    maids: result,
  });
}
