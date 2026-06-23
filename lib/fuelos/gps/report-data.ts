import "server-only";

import { prisma } from "@/lib/prisma";

// ---------- config (safe view, ไม่มี key) ----------
export type GpsConfigView = {
  enabled: boolean;
  hasApiId: boolean;
  hasApiKey: boolean;
  accountName: string | null;
  quotaTotal: number | null;
  quotaUsed: number | null;
  quotaUnlimited: boolean;
  trackedGroups: string[];
  lastSyncAt: Date | null;
  lastTestAt: Date | null;
  lastError: string | null;
};

export async function getGpsConfig(orgId: string): Promise<GpsConfigView | null> {
  const c = await prisma.fuelGpsConfig.findUnique({ where: { orgId } });
  if (!c) return null;
  return {
    enabled: c.enabled,
    hasApiId: !!c.apiIdEnc,
    hasApiKey: !!c.apiKeyEnc,
    accountName: c.accountName,
    quotaTotal: c.quotaTotal,
    quotaUsed: c.quotaUsed,
    quotaUnlimited: c.quotaUnlimited ?? false,
    trackedGroups: c.trackedGroups,
    lastSyncAt: c.lastSyncAt,
    lastTestAt: c.lastTestAt,
    lastError: c.lastError,
  };
}

// ---------- รายงานรายวัน (กม./idle ต่อคัน) ----------
export type GpsReportRow = {
  xsenseName: string;
  plate: string | null;
  groupName: string | null;
  driverName: string | null;
  distanceKm: number;
  moveHours: number;
  idleHours: number;
  stopHours: number;
  fuelStartPct: number | null;
  fuelEndPct: number | null;
};

const hr = (s: number) => Math.round((s / 3600) * 10) / 10;

export async function latestReportDate(): Promise<Date | null> {
  const r = await prisma.fuelGpsDailyStat.findFirst({ orderBy: { statDate: "desc" }, select: { statDate: true } });
  return r?.statDate ?? null;
}

export async function listDailyReport(statDate: Date): Promise<GpsReportRow[]> {
  const [stats, vehicles] = await Promise.all([
    prisma.fuelGpsDailyStat.findMany({ where: { statDate } }),
    prisma.fuelGpsVehicle.findMany({ select: { xsenseName: true, plate: true, groupName: true, driverName: true } }),
  ]);
  const vmap = new Map(vehicles.map((v) => [v.xsenseName, v]));
  return stats
    .map((s) => {
      const v = vmap.get(s.xsenseName);
      return {
        xsenseName: s.xsenseName,
        plate: v?.plate ?? s.xsenseName,
        groupName: v?.groupName ?? null,
        driverName: v?.driverName ?? null,
        distanceKm: Number(s.distanceKm),
        moveHours: hr(s.moveSeconds),
        idleHours: hr(s.idleSeconds),
        stopHours: hr(s.stopSeconds),
        fuelStartPct: s.fuelStartPct != null ? Number(s.fuelStartPct) : null,
        fuelEndPct: s.fuelEndPct != null ? Number(s.fuelEndPct) : null,
      };
    })
    .sort((a, b) => b.distanceKm - a.distanceKm);
}
