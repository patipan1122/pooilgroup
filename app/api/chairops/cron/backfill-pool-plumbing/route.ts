// One-shot cron — backfills public.users + user_modules(chairops) for every
// active MAID ChairopsUser that is still missing those rows. Idempotent;
// safe to leave scheduled until verified, then remove the vercel.json entry.
//
// Background: self-registered maids prior to commit 5df0e39 had their Pool
// plumbing INSERT silently dropped because the Supabase admin REST client
// does not auto-populate the @updatedAt column. This cron uses Prisma
// (which handles @updatedAt) to fix the stale rows without needing the maid
// to re-test through the LIFF flow.

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

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

  const ops: Array<{
    id: string;
    action: string;
    error?: string;
  }> = [];

  for (const m of maids) {
    if (!m.authUserId || !m.email) {
      ops.push({ id: m.id, action: "skip (no authUserId/email)" });
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
        ops.push({ id: m.id, action: "users.create" });
      } else if (!existingPool.isActive) {
        await prisma.user.update({
          where: { id: m.authUserId },
          data: { isActive: true },
        });
        ops.push({ id: m.id, action: "users.reactivate" });
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
        ops.push({ id: m.id, action: "user_modules.create" });
      } else if (!existingMod.isActive) {
        await prisma.userModule.update({
          where: { id: existingMod.id },
          data: { isActive: true },
        });
        ops.push({ id: m.id, action: "user_modules.reactivate" });
      }
    } catch (e) {
      ops.push({
        id: m.id,
        action: "FAILED",
        error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    totalMaids: maids.length,
    operations: ops.length,
    summary: ops,
  });
}
