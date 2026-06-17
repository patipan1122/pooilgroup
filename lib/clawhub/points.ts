// ClawHub (JOLLY PLAY) — points ledger (append-only) with FIFO expiring lots.
//
// MODEL: each EARN_REFUND/ADJUST(+) entry is a "lot" carrying remainingPoints and
// an expiresAt. Spending consumes the OLDEST unexpired lots first (FIFO) so points
// closest to expiry are used first. member.pointsBalance is a CACHE kept in lock-
// step inside the same transaction; availableBalance() recomputes from lots and is
// the source of truth (use it to reconcile / audit the cache).
//
// 1 POINT = 10 BAHT. Points expire POINT_EXPIRE_DAYS after being earned.

import type { Prisma, ClawhubPointEntry } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { POINT_EXPIRE_DAYS } from "./constants";

type Tx = Prisma.TransactionClient;

export type CreditPointsArgs = {
  orgId: string;
  memberId: string;
  points: number;
  kind: "EARN_REFUND" | "ADJUST";
  refType?: string;
  refId?: string;
  note?: string;
};

/**
 * Credit points to a member (inside a caller-provided transaction).
 * - EARN_REFUND: creates an expiring lot (remainingPoints=points, expiresAt=now+N days).
 * - ADJUST: positive manual credit; treated as a lot too so it can be spent/expired.
 * Increments the cached member.pointsBalance. Caller MUST run this in $transaction.
 */
export async function creditPoints(
  tx: Tx,
  args: CreditPointsArgs,
): Promise<ClawhubPointEntry> {
  if (args.points <= 0) {
    throw new Error("[clawhub] creditPoints: points must be positive");
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + POINT_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

  const entry = await tx.clawhubPointEntry.create({
    data: {
      orgId: args.orgId,
      memberId: args.memberId,
      delta: args.points,
      kind: args.kind,
      remainingPoints: args.points, // lot starts fully unspent
      refType: args.refType ?? null,
      refId: args.refId ?? null,
      note: args.note ?? null,
      expiresAt,
    },
  });

  await tx.clawhubMember.update({
    where: { id: args.memberId },
    data: { pointsBalance: { increment: args.points } },
  });

  return entry;
}

export type SpendPointsArgs = {
  orgId: string;
  memberId: string;
  points: number;
  refType?: string;
  refId?: string;
};

/**
 * Spend points FIFO across the member's oldest unexpired EARN lots (inside a
 * caller-provided transaction). Decrements each consumed lot's remainingPoints,
 * writes ONE REDEEM entry (delta = -points), decrements the cached balance.
 * Throws if available (unexpired) points are insufficient.
 */
export async function spendPoints(
  tx: Tx,
  args: SpendPointsArgs,
): Promise<ClawhubPointEntry> {
  if (args.points <= 0) {
    throw new Error("[clawhub] spendPoints: points must be positive");
  }
  const now = new Date();

  // Oldest unexpired lots first (FIFO — burn soonest-to-expire first).
  const lots = await tx.clawhubPointEntry.findMany({
    where: {
      orgId: args.orgId,
      memberId: args.memberId,
      kind: { in: ["EARN_REFUND", "ADJUST"] },
      remainingPoints: { gt: 0 },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "asc" },
  });

  const available = lots.reduce((sum, l) => sum + l.remainingPoints, 0);
  if (available < args.points) {
    throw new Error(
      `[clawhub] spendPoints: insufficient points (have ${available}, need ${args.points})`,
    );
  }

  let toSpend = args.points;
  for (const lot of lots) {
    if (toSpend <= 0) break;
    const take = Math.min(lot.remainingPoints, toSpend);
    await tx.clawhubPointEntry.update({
      where: { id: lot.id },
      data: { remainingPoints: { decrement: take } },
    });
    toSpend -= take;
  }

  const entry = await tx.clawhubPointEntry.create({
    data: {
      orgId: args.orgId,
      memberId: args.memberId,
      delta: -args.points,
      kind: "REDEEM",
      remainingPoints: 0,
      refType: args.refType ?? null,
      refId: args.refId ?? null,
    },
  });

  await tx.clawhubMember.update({
    where: { id: args.memberId },
    data: { pointsBalance: { decrement: args.points } },
  });

  return entry;
}

/**
 * SOURCE OF TRUTH balance: sum of remainingPoints across unexpired EARN/ADJUST lots.
 * (member.pointsBalance is a cache; this recomputes from the ledger.)
 */
export async function availableBalance(memberId: string): Promise<number> {
  const now = new Date();
  const agg = await prisma.clawhubPointEntry.aggregate({
    where: {
      memberId,
      kind: { in: ["EARN_REFUND", "ADJUST"] },
      remainingPoints: { gt: 0 },
      expiresAt: { gt: now },
    },
    _sum: { remainingPoints: true },
  });
  return agg._sum.remainingPoints ?? 0;
}

export type ExpireResult = { count: number; totalExpired: number };

/**
 * Expire all due lots (cron). For each EARN/ADJUST lot with expiresAt<=now,
 * remainingPoints>0, expiredAt null: write an EXPIRE entry (delta = -remaining),
 * zero the lot, set expiredAt, decrement the member cache. Idempotent (expiredAt
 * guard means re-running does nothing). Pass orgId to scope, omit for all orgs.
 * Returns how many lots expired + total points removed.
 */
export async function expireDuePoints(orgId?: string): Promise<ExpireResult> {
  const now = new Date();
  const due = await prisma.clawhubPointEntry.findMany({
    where: {
      ...(orgId ? { orgId } : {}),
      kind: { in: ["EARN_REFUND", "ADJUST"] },
      remainingPoints: { gt: 0 },
      expiresAt: { lte: now },
      expiredAt: null,
    },
    select: {
      id: true,
      orgId: true,
      memberId: true,
      remainingPoints: true,
    },
    take: 1000,
  });

  let count = 0;
  let totalExpired = 0;

  for (const lot of due) {
    const remaining = lot.remainingPoints;
    if (remaining <= 0) continue;
    await prisma.$transaction(async (tx) => {
      // Re-read inside tx to stay idempotent under concurrency.
      const fresh = await tx.clawhubPointEntry.findUnique({
        where: { id: lot.id },
        select: { remainingPoints: true, expiredAt: true },
      });
      if (!fresh || fresh.expiredAt || fresh.remainingPoints <= 0) return;
      const rem = fresh.remainingPoints;

      await tx.clawhubPointEntry.create({
        data: {
          orgId: lot.orgId,
          memberId: lot.memberId,
          delta: -rem,
          kind: "EXPIRE",
          remainingPoints: 0,
          refType: "expire",
          refId: lot.id,
        },
      });
      await tx.clawhubPointEntry.update({
        where: { id: lot.id },
        data: { remainingPoints: 0, expiredAt: now },
      });
      await tx.clawhubMember.update({
        where: { id: lot.memberId },
        data: { pointsBalance: { decrement: rem } },
      });
      count += 1;
      totalExpired += rem;
    });
  }

  return { count, totalExpired };
}
