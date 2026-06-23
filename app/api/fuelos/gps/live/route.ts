// FuelOS — ตำแหน่งกองรถสด (ดึงจาก xsense · fallback ค่าล่าสุดใน DB)
// ใช้โดยหน้าแผนที่ติดตามรถ (poll ทุก ~30 วิ)
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/fuelos/auth";
import { getFleetSnapshot } from "@/lib/fuelos/gps/fleet-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireUser(); // หน้านี้อยู่หลัง auth — กันคนนอกดูดตำแหน่งรถ
  const snapshot = await getFleetSnapshot();
  return NextResponse.json(snapshot);
}
