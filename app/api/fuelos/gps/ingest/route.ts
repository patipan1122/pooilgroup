// F10 — GPS ingest (Pattern A: vendor push, DLT format)
// ผู้ให้บริการ GPS ส่งตำแหน่งรถมาในรูปแบบ DLT เดียวกับที่ส่งกรมขนส่ง
// เรา map unit_id → Truck.gpsUnitId → อัปเดตตำแหน่งล่าสุด + เก็บประวัติ
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DltLocation = {
  unit_id?: string | number;
  lat?: number | string;
  lon?: number | string;
  speed?: number | string;
  engine_status?: number | string | boolean;
  course?: number | string;
  utc_ts?: number | string; // unix sec/ms หรือ ISO string
};

type DltPayload = {
  vender_id?: string | number; // (DLT สะกดแบบนี้จริง)
  locations_count?: number;
  locations?: DltLocation[];
};

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// engine_status: 1/"1"/true = ติดเครื่อง · 0/"0"/false = ดับ
function toEngine(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  // "idle" = เครื่องติดแต่จอดอยู่กับที่ (ไม่ใช่ดับ) → นับเป็นติดเครื่อง
  if (["1", "on", "true", "running", "idle"].includes(s)) return true;
  if (["0", "off", "false", "stopped"].includes(s)) return false;
  return null;
}

// utc_ts → Date: รองรับ unix วินาที, มิลลิวินาที, หรือ ISO string
function toTimestamp(v: unknown): Date {
  const n = toNum(v);
  if (n != null) {
    // ถ้าเป็นวินาที (10 หลัก) คูณ 1000
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export async function POST(req: Request) {
  // fail-closed: ต้องตั้ง GPS_INGEST_TOKEN เสมอ — กันคนนอกยิงพิกัดปลอมเข้ารถทั้งระบบ
  const expected = process.env.GPS_INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json({ code: 0, message: "gps ingest not configured" }, { status: 503 });
  }
  const got =
    req.headers.get("x-gps-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (got !== expected) {
    return NextResponse.json({ code: 0, message: "unauthorized" }, { status: 401 });
  }

  let payload: DltPayload;
  try {
    payload = (await req.json()) as DltPayload;
  } catch {
    return NextResponse.json({ code: 0, message: "invalid json" }, { status: 400 });
  }

  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  if (locations.length === 0) {
    return NextResponse.json({ code: 1, message: "ok", received_records: 0 });
  }

  let received = 0;
  for (const loc of locations) {
    const unitId = loc.unit_id != null ? String(loc.unit_id).trim() : "";
    const lat = toNum(loc.lat);
    const lng = toNum(loc.lon);
    if (!unitId || lat == null || lng == null) continue;

    // map unit_id → Truck (gpsUnitId unique) — รู้ org จากตัวรถเอง
    const truck = await prisma.truck.findUnique({
      where: { gpsUnitId: unitId },
      select: { id: true, orgId: true },
    });
    if (!truck) continue; // กล่องที่ยังไม่ผูกกับรถ → ข้าม

    const speed = toNum(loc.speed);
    const engineOn = toEngine(loc.engine_status);
    const course = toNum(loc.course);
    const recordedAt = toTimestamp(loc.utc_ts);

    await prisma.$transaction([
      prisma.truck.update({
        where: { id: truck.id },
        data: {
          lastLat: lat,
          lastLng: lng,
          lastSpeedKmh: speed ?? undefined,
          lastEngineOn: engineOn ?? undefined,
          lastCourseDeg: course != null ? Math.round(course) : undefined,
          lastSeenAt: recordedAt,
        },
      }),
      prisma.truckLocation.create({
        data: {
          orgId: truck.orgId,
          truckId: truck.id,
          lat,
          lng,
          speedKmh: speed ?? undefined,
          engineOn: engineOn ?? undefined,
          courseDeg: course != null ? Math.round(course) : undefined,
          recordedAt,
        },
      }),
    ]);
    received += 1;
  }

  return NextResponse.json({ code: 1, message: "ok", received_records: received });
}
