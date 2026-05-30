// Debug-only — lists every ChairopsUser with role=MAID and reports whether
// their Pool plumbing (public.users row + user_modules chairops grant) exists.
// Gated by header `x-debug-key` matching CRON_SECRET so it's not freely
// accessible from the internet but I can curl it.

import { type NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@/lib/generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET is open (no auth) and redacts PII — only returns whether the Pool
// plumbing is present per row, no names/emails/LINE IDs.  Lets me curl the
// endpoint to verify state without managing yet-another secret.  POST keeps
// the CRON_SECRET gate because it writes to the DB.
export async function GET(_req: NextRequest) {
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
        chairopsId: m.id.slice(0, 8),
        hasAuthUserId: !!m.authUserId,
        hasLineUserId: !!m.lineUserId,
        primaryBranchAssigned: !!m.primaryBranchId,
        chairopsActive: m.isActive,
        createdAt: m.createdAt.toISOString(),
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

// POST = backfill Pool plumbing for every MAID that is missing it. Idempotent.
// Used to retroactively fix maids that self-registered before
// ensurePoolMembership shipped — saves CEO a retest cycle.
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-debug-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const maids = await prisma.chairopsUser.findMany({
    where: { role: "MAID", isActive: true },
    select: {
      id: true,
      email: true,
      displayName: true,
      authUserId: true,
      orgId: true,
    },
  });

  const fixed: Array<{ id: string; action: string; error?: string }> = [];
  for (const m of maids) {
    if (!m.authUserId || !m.email) {
      fixed.push({ id: m.id, action: "skipped (no authUserId/email)" });
      continue;
    }
    try {
      const existingPool = await prisma.user.findUnique({
        where: { id: m.authUserId },
        select: { id: true, isActive: true },
      });
      if (!existingPool) {
        await prisma.user.create({
          data: {
            id: m.authUserId,
            orgId: m.orgId,
            email: m.email,
            name: m.displayName,
            role: UserRole.staff,
            isActive: true,
          },
        });
        fixed.push({ id: m.id, action: "users inserted (prisma)" });
      } else if (!existingPool.isActive) {
        await prisma.user.update({
          where: { id: m.authUserId },
          data: { isActive: true },
        });
        fixed.push({ id: m.id, action: "users reactivated (prisma)" });
      }
      const existingMod = await prisma.userModule.findUnique({
        where: {
          orgId_userId_moduleName: {
            orgId: m.orgId,
            userId: m.authUserId,
            moduleName: "chairops",
          },
        },
        select: { id: true, isActive: true },
      });
      if (!existingMod) {
        await prisma.userModule.create({
          data: {
            orgId: m.orgId,
            userId: m.authUserId,
            moduleName: "chairops",
            isActive: true,
          },
        });
        fixed.push({ id: m.id, action: "user_modules inserted (prisma)" });
      } else if (!existingMod.isActive) {
        await prisma.userModule.update({
          where: { id: existingMod.id },
          data: { isActive: true },
        });
        fixed.push({ id: m.id, action: "user_modules reactivated (prisma)" });
      }
    } catch (e) {
      fixed.push({
        id: m.id,
        action: "FAILED",
        error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
    }
  }

  return NextResponse.json({
    total: maids.length,
    operations: fixed,
  });
}
