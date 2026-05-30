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

  const admin = adminClient();
  const fixed: Array<{ id: string; action: string; error?: string }> = [];
  for (const m of maids) {
    if (!m.authUserId || !m.email) {
      fixed.push({ id: m.id, action: "skipped (no authUserId/email)" });
      continue;
    }
    // Pool users
    const { data: existingPool } = await admin
      .from("users")
      .select("id, is_active")
      .eq("id", m.authUserId)
      .maybeSingle();
    if (!existingPool) {
      const { error: insErr } = await admin.from("users").insert({
        id: m.authUserId,
        org_id: m.orgId,
        email: m.email,
        name: m.displayName,
        role: "staff",
        is_active: true,
      });
      if (insErr) {
        fixed.push({
          id: m.id,
          action: "users insert FAILED",
          error: insErr.message,
        });
        continue;
      }
      fixed.push({ id: m.id, action: "users inserted" });
    } else if (!(existingPool as { is_active: boolean }).is_active) {
      await admin
        .from("users")
        .update({ is_active: true })
        .eq("id", m.authUserId);
      fixed.push({ id: m.id, action: "users reactivated" });
    }
    // user_modules
    const { data: existingMod } = await admin
      .from("user_modules")
      .select("id, is_active")
      .eq("org_id", m.orgId)
      .eq("user_id", m.authUserId)
      .eq("module_name", "chairops")
      .maybeSingle();
    if (!existingMod) {
      const { error: insErr } = await admin.from("user_modules").insert({
        org_id: m.orgId,
        user_id: m.authUserId,
        module_name: "chairops",
        is_active: true,
      });
      if (insErr) {
        fixed.push({
          id: m.id,
          action: "user_modules insert FAILED",
          error: insErr.message,
        });
        continue;
      }
      fixed.push({ id: m.id, action: "user_modules inserted" });
    } else if (!existingMod.is_active) {
      await admin
        .from("user_modules")
        .update({ is_active: true })
        .eq("id", existingMod.id);
      fixed.push({ id: m.id, action: "user_modules reactivated" });
    }
  }

  return NextResponse.json({
    total: maids.length,
    operations: fixed,
  });
}
