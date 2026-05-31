// HotelBook read-side data helpers.
import { prisma } from "@/lib/prisma";

export async function getHotelBySlug(slug: string) {
  return prisma.hotel.findUnique({
    where: { slug },
    include: {
      rooms: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 3 },
        },
      },
      images: { where: { roomId: null }, orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function listHotelsByOrg(orgId: string) {
  return prisma.hotel.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    include: { rooms: { where: { isActive: true } } },
  });
}

export async function getHotelById(id: string) {
  return prisma.hotel.findUnique({
    where: { id },
    include: {
      rooms: { orderBy: { sortOrder: "asc" }, include: { images: { orderBy: { sortOrder: "asc" } } } },
      images: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getRoomById(id: string) {
  return prisma.hotelRoom.findUnique({
    where: { id },
    include: { hotel: true, images: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function listBookings(hotelId: string, opts?: { status?: string; limit?: number }) {
  return prisma.hotelBooking.findMany({
    where: { hotelId, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
    include: { room: true },
  });
}

export async function getBookingByCode(code: string) {
  return prisma.hotelBooking.findUnique({
    where: { code },
    include: { room: true, hotel: true },
  });
}

/** Count booked rooms per room-type on a given date range (overlap-aware). */
export async function countBookedRooms(roomId: string, checkIn: Date, checkOut: Date): Promise<number> {
  const rows = await prisma.hotelBooking.aggregate({
    where: {
      roomId,
      status: { notIn: ["cancelled", "no_show"] },
      checkInDate: { lt: checkOut },
      checkOutDate: { gt: checkIn },
    },
    _sum: { rooms: true },
  });
  return rows._sum.rooms ?? 0;
}

export async function listBookingStats(hotelId: string) {
  const [total, pending, confirmed, checkedIn] = await Promise.all([
    prisma.hotelBooking.count({ where: { hotelId } }),
    prisma.hotelBooking.count({ where: { hotelId, status: "pending" } }),
    prisma.hotelBooking.count({ where: { hotelId, status: "confirmed" } }),
    prisma.hotelBooking.count({ where: { hotelId, status: "checked_in" } }),
  ]);
  return { total, pending, confirmed, checkedIn };
}
