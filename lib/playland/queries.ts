// Playland · Server queries (cache-wrapped per [[react-cache-on-getsession-pattern]])
// All queries respect RLS via Prisma's auto-scoping to current_org_id() in DB
// but we ALSO explicitly filter by orgId for defense-in-depth.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

export type SessionWithMember = Prisma.PlaylandSessionGetPayload<{
  include: { member: true; package: true };
}>;

export const getActiveSessions = cache(async (orgId: string, branchId?: string) => {
  return prisma.playlandSession.findMany({
    where: {
      orgId,
      branchId: branchId ?? undefined,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    include: { member: true, package: true },
    orderBy: { checkInAt: "desc" },
  });
});

export const getExpiringSoon = cache(async (orgId: string, withinMinutes = 10, branchId?: string) => {
  const deadline = new Date(Date.now() + withinMinutes * 60_000);
  return prisma.playlandSession.findMany({
    where: {
      orgId,
      branchId: branchId ?? undefined,
      status: "ACTIVE",
      expiresAt: { lte: deadline, gt: new Date() },
    },
    include: { member: true, package: true },
    orderBy: { expiresAt: "asc" },
  });
});

export const getUnreadAlerts = cache(async (orgId: string, branchId?: string) => {
  return prisma.playlandAlert.findMany({
    where: { orgId, branchId: branchId ?? undefined, resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
});

export const getTodayStats = cache(async (orgId: string, branchId?: string) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [memberCount, sessionsToday, salesAgg, bookingsToday] = await Promise.all([
    prisma.playlandMember.count({ where: { orgId, branchId: branchId ?? undefined, deletedAt: null } }),
    prisma.playlandSession.findMany({
      where: { orgId, branchId: branchId ?? undefined, checkInAt: { gte: startOfDay } },
      select: { id: true, status: true, packagePriceCents: true },
    }),
    prisma.playlandSale.aggregate({
      where: { orgId, branchId: branchId ?? undefined, soldAt: { gte: startOfDay }, voidedAt: null },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
    prisma.playlandBooking.count({
      where: {
        orgId,
        branchId: branchId ?? undefined,
        slotStart: { gte: startOfDay, lte: new Date(Date.now() + 24 * 60 * 60_000) },
        status: { in: ["PENDING", "PAID", "CHECKED_IN"] },
      },
    }),
  ]);

  const entryRevenue = sessionsToday.reduce((acc, s) => acc + s.packagePriceCents, 0);
  const productRevenue = salesAgg._sum.totalCents ?? 0;
  const activeSessions = sessionsToday.filter((s) => s.status === "ACTIVE" || s.status === "PAUSED").length;
  const expiredSessions = sessionsToday.filter((s) => s.status === "EXPIRED").length;

  return {
    memberCount,
    sessionsToday: sessionsToday.length,
    activeSessions,
    expiredSessions,
    bookingsToday,
    entryRevenueCents: entryRevenue,
    productRevenueCents: productRevenue,
    totalRevenueCents: entryRevenue + productRevenue,
    salesCount: salesAgg._count._all,
  };
});

export const listBranches = cache(async (orgId: string) => {
  return prisma.playlandBranch.findMany({
    where: { orgId, active: true },
    orderBy: { name: "asc" },
  });
});

export const listPackages = cache(async (orgId: string, branchId?: string) => {
  return prisma.playlandPackage.findMany({
    where: {
      orgId,
      active: true,
      OR: branchId ? [{ branchId }, { branchId: null }] : undefined,
    },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
});

export const listProducts = cache(async (orgId: string, branchId: string) => {
  return prisma.playlandProduct.findMany({
    where: { orgId, branchId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});

export const listActiveDevices = cache(async (orgId: string, branchId?: string) => {
  return prisma.playlandDevice.findMany({
    where: { orgId, branchId: branchId ?? undefined, status: { not: "DISABLED" } },
    include: { branch: true },
    orderBy: { createdAt: "asc" },
  });
});

export async function searchMembers(orgId: string, query: string, branchId?: string, limit = 20) {
  return prisma.playlandMember.findMany({
    where: {
      orgId,
      branchId: branchId ?? undefined,
      deletedAt: null,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
        { memberCode: { contains: query, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { lastVisitAt: "desc" },
  });
}

export async function getMemberDetail(orgId: string, memberId: string) {
  return prisma.playlandMember.findFirst({
    where: { orgId, id: memberId, deletedAt: null },
    include: {
      familyMemberships: { include: { familyGroup: { include: { members: { include: { member: true } } } } } },
      sessions: { orderBy: { checkInAt: "desc" }, take: 20, include: { package: true } },
      waivers: { orderBy: { signedAt: "desc" }, take: 5 },
      loyalty: { include: { ledger: { take: 20, orderBy: { createdAt: "desc" } } } },
    },
  });
}

export async function listBookings(orgId: string, opts: { branchId?: string; status?: string; date?: Date }) {
  const date = opts.date ?? new Date();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return prisma.playlandBooking.findMany({
    where: {
      orgId,
      branchId: opts.branchId ?? undefined,
      slotStart: { gte: dayStart, lt: dayEnd },
      ...(opts.status ? { status: opts.status as Prisma.EnumPlaylandBookingStatusFilter["equals"] } : {}),
    },
    include: { package: true, member: true },
    orderBy: { slotStart: "asc" },
  });
}

export async function listOpenShift(orgId: string, branchId: string, cashierUserId: string) {
  return prisma.playlandShift.findFirst({
    where: { orgId, branchId, cashierUserId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });
}
