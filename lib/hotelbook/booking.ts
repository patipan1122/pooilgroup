// HotelBook booking workflow.
// Public createBooking is called from the web booking form and LIFF Mini App
// via a server action. Validation rules:
// - guest_phone is required (10-digit TH format suggested)
// - check_out > check_in
// - rooms requested ≤ (room.totalRooms - currently booked overlap)
// - total = nights × rooms × price_thb (server-computed; client value ignored)

import { prisma } from "@/lib/prisma";
import { countBookedRooms } from "./data";

export type BookingInput = {
  hotelSlug: string;
  roomId: string;
  guestName: string;
  guestPhone: string;
  guestEmail?: string;
  guestLineId?: string;
  guestFbPsid?: string;
  checkInDate: string;          // 'YYYY-MM-DD'
  checkOutDate: string;
  rooms: number;
  paymentMethod?: "cash" | "transfer" | "qr";
  source: "web" | "liff" | "fb" | "phone" | "walkin" | "admin";
  note?: string;
};

export type BookingResult =
  | { ok: true; bookingId: string; code: string; totalThb: number }
  | { ok: false; error: string };

function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400_000);
}

function isValidPhone(p: string): boolean {
  const digits = p.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 12;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export async function createBooking(input: BookingInput): Promise<BookingResult> {
  if (!input.guestName?.trim()) return { ok: false, error: "กรุณากรอกชื่อผู้จอง" };
  if (!isValidPhone(input.guestPhone)) return { ok: false, error: "เบอร์โทรไม่ถูกต้อง" };
  if (!isValidDate(input.checkInDate) || !isValidDate(input.checkOutDate)) {
    return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  }
  const nights = daysBetween(input.checkInDate, input.checkOutDate);
  if (nights < 1) return { ok: false, error: "วันเช็คเอาท์ต้องหลังวันเช็คอินอย่างน้อย 1 คืน" };
  if (input.rooms < 1 || input.rooms > 20) return { ok: false, error: "จำนวนห้องไม่ถูกต้อง" };

  const hotel = await prisma.hotel.findUnique({ where: { slug: input.hotelSlug }, select: { id: true, slug: true, enabled: true } });
  if (!hotel || !hotel.enabled) return { ok: false, error: "ไม่พบโรงแรม" };

  const room = await prisma.hotelRoom.findUnique({
    where: { id: input.roomId },
    select: { id: true, hotelId: true, isActive: true, totalRooms: true, priceThb: true, name: true },
  });
  if (!room || !room.isActive || room.hotelId !== hotel.id) {
    return { ok: false, error: "ห้องไม่พร้อมจอง" };
  }

  const checkIn = new Date(`${input.checkInDate}T00:00:00Z`);
  const checkOut = new Date(`${input.checkOutDate}T00:00:00Z`);
  const booked = await countBookedRooms(room.id, checkIn, checkOut);
  const available = room.totalRooms - booked;
  if (input.rooms > available) {
    return { ok: false, error: `ห้องเหลือ ${Math.max(0, available)} ห้องสำหรับช่วงที่เลือก` };
  }

  const price = Number(room.priceThb);
  const totalThb = price * nights * input.rooms;

  // Generate code via RPC (server-side · race-safe via row-level lock isn't ideal,
  // but for our scale + max-N each minute this is fine. UNIQUE constraint catches the collision.)
  const codeRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT public.hotelbook_next_code(${hotel.slug}) AS code
  `;
  const code = codeRows[0]?.code ?? `MX-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  const created = await prisma.hotelBooking.create({
    data: {
      hotelId: hotel.id,
      roomId: room.id,
      code,
      guestName: input.guestName.trim(),
      guestPhone: input.guestPhone.replace(/\D/g, ""),
      guestEmail: input.guestEmail?.trim() || null,
      guestLineId: input.guestLineId ?? null,
      guestFbPsid: input.guestFbPsid ?? null,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      rooms: input.rooms,
      totalAmountThb: totalThb,
      paymentMethod: input.paymentMethod,
      source: input.source,
      note: input.note?.trim() || null,
    },
  });

  return { ok: true, bookingId: created.id, code: created.code, totalThb };
}

export async function updateBookingStatus(id: string, status: "pending" | "confirmed" | "cancelled" | "checked_in" | "completed" | "no_show") {
  return prisma.hotelBooking.update({ where: { id }, data: { status } });
}
