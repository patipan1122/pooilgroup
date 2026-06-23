// Pure types สำหรับกองรถ GPS — ใช้ได้ทั้งฝั่ง server (fleet-data) และ client (แผนที่)
// แยกจาก fleet-data.ts (ที่ import prisma/server-only) เพื่อไม่ให้ server-only หลุดเข้า client bundle

export type FleetVehicle = {
  name: string;
  plate: string | null;
  province: string | null;
  groupName: string | null;
  driverName: string | null;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  engineOn: boolean | null;
  moving: boolean | null;
  address: string | null;
  gpsTime: string | null; // ISO
};

export type FleetSource = "live" | "stored" | "unconfigured" | "error";

export type FleetSnapshot = {
  source: FleetSource;
  error?: string;
  updatedAt: string | null;
  groups: string[];
  vehicles: FleetVehicle[];
};
