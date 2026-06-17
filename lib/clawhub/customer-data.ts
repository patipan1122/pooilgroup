// ClawHub (JOLLY PLAY) — read-side helpers for the CUSTOMER LIFF app.
// All read-only. Writes live in member.ts / refund.ts / rewards.ts.

import { prisma } from "@/lib/prisma";
import { availableBalance } from "./points";

/** A point-ledger row shaped for the customer history list (serializable). */
export type PointHistoryRow = {
  id: string;
  delta: number;
  kind: "EARN_REFUND" | "REDEEM" | "EXPIRE" | "ADJUST";
  note: string | null;
  createdAt: string; // ISO
  expiresAt: string | null; // ISO (EARN lots only)
};

/** A refund-request row shaped for the customer history list. */
export type RefundHistoryRow = {
  id: string;
  status: "AUTO_APPROVED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  pointsAwarded: number;
  claimedBaht: number;
  machineCode: string | null;
  createdAt: string; // ISO
};

/** A redemption row shaped for the customer history list. */
export type RedemptionHistoryRow = {
  id: string;
  productName: string | null;
  pointsSpent: number;
  status: "PENDING" | "FULFILLED" | "CANCELLED";
  pickupCode: string;
  createdAt: string; // ISO
};

export type MemberSummary = {
  memberCode: string;
  displayName: string | null;
  /** Real full name captured at registration (for prefill). */
  fullName: string | null;
  /** Contact phone (for prefill). */
  phone: string | null;
  /** Date of birth as ISO "YYYY-MM-DD" (for prefill + age display), or null. */
  birthDate: string | null;
  /** Gender: ชาย / หญิง / ไม่ระบุ (for prefill), or null. */
  gender: string | null;
  /** Delivery address (for prefill). */
  address: string | null;
  pictureUrl: string | null;
  consented: boolean;
  balance: number;
  /** ISO date of the soonest-expiring unexpired lot, or null. */
  nearestExpiryAt: string | null;
  /** Points expiring on that soonest date (sum of lots sharing the min expiry). */
  nearestExpiryPoints: number;
};

/**
 * The headline numbers for the home / points screens. `balance` is recomputed from
 * unexpired lots (source of truth), and the nearest-expiry is the soonest lot still
 * carrying remainingPoints.
 */
export async function getMemberSummary(
  member: {
    id: string;
    memberCode: string;
    displayName: string | null;
    fullName: string | null;
    phone: string | null;
    birthDate: Date | null;
    gender: string | null;
    address: string | null;
    pictureUrl: string | null;
    consentAt: Date | null;
  },
): Promise<MemberSummary> {
  const balance = await availableBalance(member.id);

  const now = new Date();
  const soonest = await prisma.clawhubPointEntry.findFirst({
    where: {
      memberId: member.id,
      kind: { in: ["EARN_REFUND", "ADJUST"] },
      remainingPoints: { gt: 0 },
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "asc" },
    select: { expiresAt: true },
  });

  let nearestExpiryPoints = 0;
  if (soonest?.expiresAt) {
    const agg = await prisma.clawhubPointEntry.aggregate({
      where: {
        memberId: member.id,
        kind: { in: ["EARN_REFUND", "ADJUST"] },
        remainingPoints: { gt: 0 },
        expiresAt: soonest.expiresAt,
      },
      _sum: { remainingPoints: true },
    });
    nearestExpiryPoints = agg._sum.remainingPoints ?? 0;
  }

  return {
    memberCode: member.memberCode,
    displayName: member.displayName,
    fullName: member.fullName,
    phone: member.phone,
    // @db.Date → UTC midnight; emit date-only ISO "YYYY-MM-DD" (no timezone drift).
    birthDate: member.birthDate ? member.birthDate.toISOString().slice(0, 10) : null,
    gender: member.gender,
    address: member.address,
    pictureUrl: member.pictureUrl,
    consented: member.consentAt != null,
    balance,
    nearestExpiryAt: soonest?.expiresAt ? soonest.expiresAt.toISOString() : null,
    nearestExpiryPoints,
  };
}

/** Recent point-ledger entries (newest first). */
export async function getPointHistory(
  memberId: string,
  limit = 50,
): Promise<PointHistoryRow[]> {
  const rows = await prisma.clawhubPointEntry.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    delta: r.delta,
    kind: r.kind,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  }));
}

/** Recent refund requests (newest first). */
export async function getRefundHistory(
  memberId: string,
  limit = 20,
): Promise<RefundHistoryRow[]> {
  const rows = await prisma.clawhubRefundRequest.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    pointsAwarded: r.pointsAwarded,
    claimedBaht: r.claimedBaht,
    machineCode: r.machineCode,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Recent redemptions (newest first). */
export async function getRedemptionHistory(
  memberId: string,
  limit = 20,
): Promise<RedemptionHistoryRow[]> {
  const rows = await prisma.clawhubRedemption.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    productName: r.productName,
    pointsSpent: r.pointsSpent,
    status: r.status,
    pickupCode: r.pickupCode,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ResolvedMachine = {
  machineId: string;
  machineCode: string;
  machineQrToken: string;
  branchId: string;
  branchName: string | null;
};

/**
 * Resolve a `?machine=` value (the rich-menu / QR may pass either the human code like
 * "CW-001" OR the qrToken) to a machine + its branch name, for ANY org (single-tenant).
 * Read-only + soft: returns null if nothing matches (refund still proceeds machine-less).
 */
export async function resolveMachine(
  orgId: string,
  codeOrToken: string,
): Promise<ResolvedMachine | null> {
  const needle = codeOrToken.trim();
  if (!needle) return null;

  const machine = await prisma.cfMachine.findFirst({
    where: {
      orgId,
      OR: [{ qrToken: needle }, { code: needle }],
    },
    select: {
      id: true,
      code: true,
      qrToken: true,
      branchId: true,
      branch: { select: { name: true } },
    },
  });
  if (!machine) return null;

  return {
    machineId: machine.id,
    machineCode: machine.code,
    machineQrToken: machine.qrToken,
    branchId: machine.branchId,
    branchName: machine.branch?.name ?? null,
  };
}
