import "server-only";

// xsense GPS Tracking Open API — ดึงตำแหน่งรถทั้งกอง
// docs: https://positionlog.plus.xsense.co.th/openapi/docs
// auth: 2 header api-id + api-key (env FUELOS_XSENSE_*) · /vehicle/tracking = 1 call ได้ทุกคัน
const BASE = process.env.FUELOS_XSENSE_BASE_URL || "https://positionlog.plus.xsense.co.th";

export type XsenseVehicle = {
  xsenseName: string; // "70-6630|นม"
  plate: string | null;
  province: string | null;
  groupName: string | null;
  deviceId: string | null;
  driverId: string | null;
  driverName: string | null;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  engineOn: boolean | null; // engineStatus 1 = ติดเครื่อง
  moving: boolean | null; // vehicleStatus 'R' = วิ่ง
  courseDeg: number | null;
  address: string | null; // ที่อยู่ไทย
  gpsTime: Date | null;
};

export type XsenseResult =
  | { ok: true; vehicles: XsenseVehicle[] }
  | { ok: false; error: string; unconfigured?: boolean };

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// รองรับหลายชื่อ key (xsense อาจคืน camel/snake ต่างเอกสาร) → หยิบตัวแรกที่มีค่า
function pick(o: Row, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] != null && o[k] !== "") return o[k];
  }
  return null;
}

// "70-6630|นม" หรือ "70-6631|นม H" → plate=70-6630, province=นม
function parseName(name: string): { plate: string | null; province: string | null } {
  const [left, right] = name.split("|");
  const plate = (left ?? "").trim() || null;
  const province = right ? right.trim().split(/\s+/)[0] || null : null;
  return { plate, province };
}

function parseTime(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  // รองรับ "yyyy-MM-dd HH:mm:ss" (ทำให้เป็น ISO) และ ISO/epoch
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(" ", "T") : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRow(o: Row): XsenseVehicle | null {
  const name = str(pick(o, "name", "vehicleName", "vehicle_name", "deviceName"));
  if (!name) return null;
  const { plate, province } = parseName(name);

  const engineStatus = pick(o, "engineStatus", "engine_status", "engine");
  const vehicleStatus = str(pick(o, "vehicleStatus", "vehicle_status", "status"));

  return {
    xsenseName: name,
    plate: str(pick(o, "plate", "licensePlate")) ?? plate,
    province,
    groupName: str(pick(o, "groupName", "group_name", "group")),
    deviceId: str(pick(o, "deviceUniqueId", "device_unique_id", "imei", "deviceId")),
    driverId: str(pick(o, "driverId", "driver_id")),
    driverName: str(pick(o, "driverName", "driver_name", "driver")),
    lat: num(pick(o, "lat", "latitude")),
    lng: num(pick(o, "lng", "lon", "longitude")),
    speedKmh: num(pick(o, "speed", "speedKmh", "speed_kmh")),
    engineOn: engineStatus == null ? null : num(engineStatus) === 1 || engineStatus === true || engineStatus === "1",
    moving: vehicleStatus == null ? null : vehicleStatus.toUpperCase() === "R",
    courseDeg: (() => {
      const c = num(pick(o, "course", "courseDeg", "heading", "direction"));
      return c == null ? null : Math.round(c);
    })(),
    address: str(pick(o, "position", "address", "location")),
    gpsTime: parseTime(pick(o, "gpsTime", "gps_time", "deviceTime", "device_time", "time")),
  };
}

export async function fetchXsenseTracking(): Promise<XsenseResult> {
  const apiId = process.env.FUELOS_XSENSE_API_ID;
  const apiKey = process.env.FUELOS_XSENSE_API_KEY;
  if (!apiId || !apiKey) {
    return { ok: false, error: "ยังไม่ได้ตั้งกุญแจ xsense (FUELOS_XSENSE_API_ID / FUELOS_XSENSE_API_KEY)", unconfigured: true };
  }

  try {
    const res = await fetch(`${BASE}/openapi/vehicle/tracking`, {
      headers: { "api-id": apiId, "api-key": apiKey, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `xsense HTTP ${res.status}` };

    const j: unknown = await res.json();
    const arr: Row[] = Array.isArray(j)
      ? (j as Row[])
      : Array.isArray((j as Row)?.data)
        ? ((j as Row).data as Row[])
        : Array.isArray((j as Row)?.result)
          ? ((j as Row).result as Row[])
          : Array.isArray((j as Row)?.vehicles)
            ? ((j as Row).vehicles as Row[])
            : [];

    const vehicles = arr.map(mapRow).filter((v): v is XsenseVehicle => v != null);
    return { ok: true, vehicles };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
