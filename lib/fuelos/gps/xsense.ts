import "server-only";

// xsense GPS Tracking Open API — ดึงตำแหน่งรถทั้งกอง
// docs: https://positionlog.plus.xsense.co.th/openapi/docs
// auth: 2 header api-id + api-key (DB FuelGpsConfig ก่อน → fallback env FUELOS_XSENSE_*) · /vehicle/tracking = 1 call ได้ทุกคัน
import { getXsenseCreds, type XsenseCreds } from "./creds";

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
  const creds = await getXsenseCreds();
  if (!creds) {
    return { ok: false, error: "ยังไม่ได้ตั้งกุญแจ xsense (ใส่ในหน้าตั้งค่า GPS หรือ env FUELOS_XSENSE_API_ID/KEY)", unconfigured: true };
  }

  try {
    const res = await fetch(`${BASE}/openapi/vehicle/tracking`, {
      headers: { "api-id": creds.apiId, "api-key": creds.apiKey, accept: "application/json" },
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

// ---------- เพิ่มเติม (merge): สถานะ/โควต้า · รายละเอียดน้ำมัน · ประวัติเส้นทาง ----------

export type XsenseStatus = {
  ok: boolean;
  accountName?: string | null;
  quotaTotal?: number | null;
  quotaUsed?: number | null;
  quotaUnlimited?: boolean;
  error?: string;
};

// GET /openapi/api/status — ตรวจคีย์ + โควต้า (รับ creds ตรง ๆ ตอนทดสอบในหน้าตั้งค่า)
export async function getXsenseStatus(creds: XsenseCreds): Promise<XsenseStatus> {
  try {
    const res = await fetch(`${BASE}/openapi/api/status`, {
      headers: { "api-id": creds.apiId, "api-key": creds.apiKey, accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "api-id / api-key ไม่ถูกต้อง" };
    if (!res.ok) return { ok: false, error: `xsense HTTP ${res.status}` };
    const j = (await res.json()) as Row;
    return {
      ok: true,
      accountName: str(pick(j, "name", "account_name")),
      quotaTotal: num(pick(j, "quota")),
      quotaUsed: num(pick(j, "latest", "used")),
      quotaUnlimited: pick(j, "quota_limit", "quotaLimit") === true,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export type XsenseVehicleFuel = {
  deviceId: string | null;
  fuelPct: number | null; // เซ็นเซอร์น้ำมัน % (0 จนกว่าคาลิเบรท)
  fuelRawAdc3: number | null;
  odometerKm: number | null;
};

// GET /openapi/vehicle — ดึงเซ็นเซอร์น้ำมัน/เลขไมล์ต่อคัน → Map keyed by xsenseName
export async function fetchXsenseVehicleFuel(): Promise<Map<string, XsenseVehicleFuel>> {
  const out = new Map<string, XsenseVehicleFuel>();
  const creds = await getXsenseCreds();
  if (!creds) return out;
  try {
    const res = await fetch(`${BASE}/openapi/vehicle`, {
      headers: { "api-id": creds.apiId, "api-key": creds.apiKey, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return out;
    const j = (await res.json()) as Row;
    const arr: Row[] = Array.isArray((j as Row)?.data) ? ((j as Row).data as Row[]) : [];
    for (const o of arr) {
      const name = str(pick(o, "name", "vehicleName"));
      if (!name) continue;
      const attrs = (o.attributes ?? {}) as Row;
      const sensors = Array.isArray(o.sensors) ? (o.sensors as Row[]) : [];
      const fuelSensor = sensors.find((s) => {
        const nm = `${str(s.name) ?? ""}`.toLowerCase();
        const unit = `${str((s.result as Row)?.unit) ?? ""}`;
        return /fuel|น้ำมัน/.test(nm) && (unit === "%" || unit === "Litres");
      });
      out.set(name, {
        deviceId: str(pick(o, "deviceUniqueId", "device_unique_id", "imei")),
        fuelPct: fuelSensor ? num((fuelSensor.result as Row)?.value) : null,
        fuelRawAdc3: num(attrs.adc3),
        odometerKm: num(attrs.odometer),
      });
    }
  } catch {
    /* best-effort */
  }
  return out;
}

export type XsenseHistory = {
  ok: boolean;
  totalDistance: number;
  statusTime: { status: string; seconds: number; distance: number }[];
  fuelStart: number | null;
  fuelEnd: number | null;
  pointCount: number;
  error?: string;
};

// "0 18:56:54" (D HH:MM:SS) → วินาที
function durationToSeconds(s: unknown): number {
  const v = str(s);
  if (!v) return 0;
  const parts = v.trim().split(/\s+/);
  let days = 0;
  let hms = parts[0];
  if (parts.length >= 2) {
    days = parseInt(parts[0], 10) || 0;
    hms = parts[1];
  }
  const [h, m, sec] = hms.split(":").map((x) => parseInt(x, 10) || 0);
  return days * 86400 + (h || 0) * 3600 + (m || 0) * 60 + (sec || 0);
}

// POST /openapi/next/history — ประวัติ 1 คัน (ช่วง ≤ 3 วัน)
export async function fetchXsenseHistory(creds: XsenseCreds, name: string, start: Date, end: Date): Promise<XsenseHistory> {
  const empty: XsenseHistory = { ok: false, totalDistance: 0, statusTime: [], fuelStart: null, fuelEnd: null, pointCount: 0 };
  try {
    const res = await fetch(`${BASE}/openapi/next/history`, {
      method: "POST",
      headers: { "api-id": creds.apiId, "api-key": creds.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name, start_time: start.toISOString(), end_time: end.toISOString() }),
      cache: "no-store",
    });
    if (!res.ok) return { ...empty, error: `xsense HTTP ${res.status}` };
    const j = (await res.json()) as Row;
    const d = (j.data ?? {}) as Row;
    const segs = Array.isArray(d.statusTime) ? (d.statusTime as Row[]) : [];
    const points = Array.isArray(d.data) ? (d.data as Row[]) : [];
    const fuelOf = (p: Row | undefined): number | null => (p ? num((p.fuel as Row)?.value) : null);
    return {
      ok: true,
      totalDistance: num(d.totalDistance) ?? 0,
      statusTime: segs.map((s) => ({
        status: `${str(s.status) ?? ""}`,
        seconds: durationToSeconds(s.totalTime),
        distance: num(s.totalDistance) ?? 0,
      })),
      fuelStart: fuelOf(points[0]),
      fuelEnd: fuelOf(points[points.length - 1]),
      pointCount: num(d.total) ?? points.length,
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "network error" };
  }
}
