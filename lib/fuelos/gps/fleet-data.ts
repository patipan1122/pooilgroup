import "server-only";

import { prisma } from "@/lib/prisma";
import { fetchXsenseTracking, type XsenseVehicle } from "./xsense";
import type { FleetVehicle, FleetSnapshot } from "./types";

export type { FleetVehicle, FleetSnapshot } from "./types";

function toFleet(v: XsenseVehicle): FleetVehicle {
  return {
    name: v.xsenseName,
    plate: v.plate,
    province: v.province,
    groupName: v.groupName,
    driverName: v.driverName,
    lat: v.lat,
    lng: v.lng,
    speedKmh: v.speedKmh,
    engineOn: v.engineOn,
    moving: v.moving,
    address: v.address,
    gpsTime: v.gpsTime ? v.gpsTime.toISOString() : null,
  };
}

function groupsOf(vehicles: { groupName: string | null }[]): string[] {
  return [...new Set(vehicles.map((v) => v.groupName).filter((g): g is string => !!g))].sort();
}

// เขียนตำแหน่งล่าสุดลง DB (best-effort · ใช้เป็น fallback ตอน xsense ล่ม/ยังไม่ตั้งกุญแจ)
async function storeVehicles(vehicles: XsenseVehicle[]): Promise<number> {
  const now = new Date();
  let count = 0;
  for (const v of vehicles) {
    const data = {
      plate: v.plate,
      province: v.province,
      groupName: v.groupName,
      deviceId: v.deviceId,
      driverId: v.driverId,
      driverName: v.driverName,
      lat: v.lat,
      lng: v.lng,
      speedKmh: v.speedKmh,
      engineOn: v.engineOn,
      moving: v.moving,
      courseDeg: v.courseDeg,
      address: v.address,
      gpsTime: v.gpsTime,
      seenAt: now,
    };
    await prisma.fuelGpsVehicle.upsert({
      where: { xsenseName: v.xsenseName },
      create: { xsenseName: v.xsenseName, ...data },
      update: data,
    });
    count += 1;
  }
  return count;
}

async function getStoredFleet(): Promise<{ vehicles: FleetVehicle[]; updatedAt: string | null }> {
  const rows = await prisma.fuelGpsVehicle.findMany({ orderBy: { seenAt: "desc" }, take: 1000 });
  const vehicles: FleetVehicle[] = rows.map((r) => ({
    name: r.xsenseName,
    plate: r.plate,
    province: r.province,
    groupName: r.groupName,
    driverName: r.driverName,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    speedKmh: r.speedKmh != null ? Number(r.speedKmh) : null,
    engineOn: r.engineOn,
    moving: r.moving,
    address: r.address,
    gpsTime: r.gpsTime ? r.gpsTime.toISOString() : null,
  }));
  const updatedAt = rows[0]?.seenAt ? rows[0].seenAt.toISOString() : null;
  return { vehicles, updatedAt };
}

// ดึงตำแหน่งกองรถ — ลองดึงสดจาก xsense ก่อน (พร้อมเก็บลง DB) · ถ้าล้ม → คืนค่าล่าสุดจาก DB
export async function getFleetSnapshot(): Promise<FleetSnapshot> {
  const r = await fetchXsenseTracking();

  if (r.ok) {
    void storeVehicles(r.vehicles).catch(() => {}); // เก็บเป็น fallback แบบไม่บล็อกการตอบ
    const vehicles = r.vehicles.map(toFleet);
    return {
      source: "live",
      updatedAt: new Date().toISOString(),
      groups: groupsOf(vehicles),
      vehicles,
    };
  }

  // xsense ใช้ไม่ได้ → ใช้ค่าล่าสุดที่เก็บไว้
  const stored = await getStoredFleet();
  return {
    source: r.unconfigured ? "unconfigured" : "error",
    error: r.error,
    updatedAt: stored.updatedAt,
    groups: groupsOf(stored.vehicles),
    vehicles: stored.vehicles,
  };
}

// สำหรับ cron — ดึง+เก็บ แล้วคืนจำนวน
export async function refreshFleet(): Promise<{ ok: boolean; count: number; error?: string; unconfigured?: boolean }> {
  const r = await fetchXsenseTracking();
  if (!r.ok) return { ok: false, count: 0, error: r.error, unconfigured: r.unconfigured };
  const count = await storeVehicles(r.vehicles);
  return { ok: true, count };
}
