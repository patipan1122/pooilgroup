// F10 — Dispatch + GPS data layer
// ดึงข้อมูลสำหรับกระดานจัดรถ + ตำแหน่งรถ (GPS) — ทุก query กรองด้วย orgId เสมอ
import { prisma } from "@/lib/prisma";

// ----- จัดรถ: ออเดอร์ที่รอจัดรถ (ยังไม่มีรถ) -----
export type DispatchOrder = {
  id: string;
  orderNo: string;
  customerName: string;
  zone: string | null;
  locationName: string | null;
  scheduledDate: Date | null;
  subtotal: number;
  totalLiters: number;
  products: string[];
  truckId: string | null;
  truckPlate: string | null;
  status: string;
  deliveredAt: Date | null;
};

function mapOrder(o: {
  id: string;
  orderNo: string;
  customer: { name: string; zone: string | null };
  location: { name: string } | null;
  scheduledDate: Date | null;
  subtotal: unknown;
  truckId: string | null;
  truck: { plate: string } | null;
  status: string;
  deliveredAt: Date | null;
  items: { productType: string; qtyLiters: unknown }[];
}): DispatchOrder {
  return {
    id: o.id,
    orderNo: o.orderNo,
    customerName: o.customer.name,
    zone: o.customer.zone,
    locationName: o.location?.name ?? null,
    scheduledDate: o.scheduledDate,
    subtotal: Number(o.subtotal),
    totalLiters: o.items.reduce((s, it) => s + Number(it.qtyLiters), 0),
    products: o.items.map((it) => it.productType),
    truckId: o.truckId,
    truckPlate: o.truck?.plate ?? null,
    status: o.status,
    deliveredAt: o.deliveredAt,
  };
}

// (A) ออเดอร์ที่รอจัดรถ = AWAITING_CONFIRM + ยังไม่มี truckId
export async function listUnassignedOrders(orgId: string): Promise<DispatchOrder[]> {
  const rows = await prisma.order.findMany({
    where: { orgId, status: "AWAITING_CONFIRM", truckId: null },
    orderBy: [{ scheduledDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
    include: {
      customer: { select: { name: true, zone: true } },
      location: { select: { name: true } },
      truck: { select: { plate: true } },
      items: { select: { productType: true, qtyLiters: true } },
    },
  });
  return rows.map(mapOrder);
}

// ออเดอร์ที่กำลังส่ง (รอยืนยันส่งถึง)
export async function listInTransitOrders(orgId: string): Promise<DispatchOrder[]> {
  const rows = await prisma.order.findMany({
    where: { orgId, status: "DELIVERING" },
    orderBy: [{ scheduledDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
    include: {
      customer: { select: { name: true, zone: true } },
      location: { select: { name: true } },
      truck: { select: { plate: true } },
      items: { select: { productType: true, qtyLiters: true } },
    },
  });
  return rows.map(mapOrder);
}

// รถที่เลือกได้ตอนจัดรถ (active + ใช้งานได้)
export type TruckOption = { id: string; plate: string; status: string; capacityLiters: number };
export async function listAssignableTrucks(orgId: string): Promise<TruckOption[]> {
  const rows = await prisma.truck.findMany({
    where: { orgId, isActive: true, status: { not: "MAINTENANCE" } },
    orderBy: { plate: "asc" },
    select: { id: true, plate: true, status: true, capacityLiters: true },
  });
  return rows.map((t) => ({ id: t.id, plate: t.plate, status: t.status, capacityLiters: t.capacityLiters }));
}

// (B) ตำแหน่งรถ (GPS) — รถที่ active ทั้งหมด พร้อมตำแหน่งล่าสุด
export type TruckGps = {
  id: string;
  plate: string;
  status: string;
  homeDepot: string | null;
  driverName: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKmh: number | null;
  lastEngineOn: boolean | null;
  lastCourseDeg: number | null;
  lastSeenAt: Date | null;
  isMoving: boolean; // ติดเครื่อง + วิ่ง > 3 กม./ชม.
};

export async function listTrucksGps(orgId: string): Promise<TruckGps[]> {
  const rows = await prisma.truck.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ status: "asc" }, { plate: "asc" }],
    include: { currentDriver: { select: { name: true } } },
  });
  return rows.map((t) => {
    const speed = t.lastSpeedKmh != null ? Number(t.lastSpeedKmh) : null;
    return {
      id: t.id,
      plate: t.plate,
      status: t.status,
      homeDepot: t.homeDepot,
      driverName: t.currentDriver?.name ?? null,
      lastLat: t.lastLat != null ? Number(t.lastLat) : null,
      lastLng: t.lastLng != null ? Number(t.lastLng) : null,
      lastSpeedKmh: speed,
      lastEngineOn: t.lastEngineOn,
      lastCourseDeg: t.lastCourseDeg,
      lastSeenAt: t.lastSeenAt,
      isMoving: t.lastEngineOn === true && speed != null && speed > 3,
    };
  });
}

// ลิงก์ Google Maps (เปิดภายนอก ไม่ใช้ API key)
export function googleMapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
