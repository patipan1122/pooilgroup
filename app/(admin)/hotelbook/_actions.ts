"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { putObject, deleteObject } from "@/lib/r2/upload";
import { updateBookingStatus } from "@/lib/hotelbook/booking";

async function gateAdmin() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) throw new Error("ไม่มีสิทธิ์");
  return session;
}

export async function actUpdateBookingStatus(id: string, status: "pending" | "confirmed" | "cancelled" | "checked_in" | "completed" | "no_show") {
  await gateAdmin();
  await updateBookingStatus(id, status);
  revalidatePath("/hotelbook/bookings");
  revalidatePath("/hotelbook");
}

export async function actUpsertHotel(input: {
  id?: string;
  slug: string;
  name: string;
  concept?: string;
  description?: string;
  reservationPhones: string[];
  ownerPhone?: string;
  googleMapsUrl?: string;
  address?: string;
  email?: string;
  brandColor?: string;
  checkInTime?: string;
  checkOutTime?: string;
  is24h: boolean;
  paymentMethods: string[];
  allowsPets: boolean;
  smokingAllowed: boolean;
  cancellationNote?: string;
  multiNightDiscountNote?: string;
  amenities: string[];
  nearbyPlaces: string[];
  enabled: boolean;
}) {
  const session = await gateAdmin();
  if (input.id) {
    await prisma.hotel.update({
      where: { id: input.id },
      data: {
        slug: input.slug,
        name: input.name,
        concept: input.concept,
        description: input.description,
        reservationPhones: input.reservationPhones,
        ownerPhone: input.ownerPhone,
        googleMapsUrl: input.googleMapsUrl,
        address: input.address,
        email: input.email,
        brandColor: input.brandColor ?? "#7c3aed",
        checkInTime: input.checkInTime,
        checkOutTime: input.checkOutTime,
        is24h: input.is24h,
        paymentMethods: input.paymentMethods,
        allowsPets: input.allowsPets,
        smokingAllowed: input.smokingAllowed,
        cancellationNote: input.cancellationNote,
        multiNightDiscountNote: input.multiNightDiscountNote,
        amenities: input.amenities,
        nearbyPlaces: input.nearbyPlaces,
        enabled: input.enabled,
      },
    });
  } else {
    await prisma.hotel.create({
      data: {
        orgId: session.user.org_id,
        slug: input.slug,
        name: input.name,
        concept: input.concept,
        description: input.description,
        reservationPhones: input.reservationPhones,
        ownerPhone: input.ownerPhone,
        googleMapsUrl: input.googleMapsUrl,
        address: input.address,
        email: input.email,
        brandColor: input.brandColor ?? "#7c3aed",
        checkInTime: input.checkInTime,
        checkOutTime: input.checkOutTime,
        is24h: input.is24h,
        paymentMethods: input.paymentMethods,
        allowsPets: input.allowsPets,
        smokingAllowed: input.smokingAllowed,
        cancellationNote: input.cancellationNote,
        multiNightDiscountNote: input.multiNightDiscountNote,
        amenities: input.amenities,
        nearbyPlaces: input.nearbyPlaces,
        enabled: input.enabled,
      },
    });
  }
  revalidatePath("/hotelbook");
  revalidatePath("/hotelbook/settings");
  revalidatePath(`/hotel/${input.slug}`);
  revalidatePath("/liff/hotel");
}

export async function actUpsertRoom(input: {
  id?: string;
  hotelId: string;
  slug: string;
  name: string;
  description?: string;
  bedDescription?: string;
  priceThb: number;
  totalRooms: number;
  amenities: string[];
  sortOrder: number;
  isActive: boolean;
}) {
  await gateAdmin();
  if (input.id) {
    await prisma.hotelRoom.update({
      where: { id: input.id },
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        bedDescription: input.bedDescription,
        priceThb: input.priceThb,
        totalRooms: input.totalRooms,
        amenities: input.amenities,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
  } else {
    await prisma.hotelRoom.create({
      data: {
        hotelId: input.hotelId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        bedDescription: input.bedDescription,
        priceThb: input.priceThb,
        totalRooms: input.totalRooms,
        amenities: input.amenities,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
  }
  revalidatePath("/hotelbook/rooms");
  revalidatePath("/hotelbook");
}

export async function actDeleteRoom(id: string) {
  await gateAdmin();
  await prisma.hotelRoom.delete({ where: { id } });
  revalidatePath("/hotelbook/rooms");
}

/** Upload an image to R2 and link to hotel (and optionally to room).
 *  Accepts dataURL base64 from client to keep things simple — small images
 *  only (we cap at ~5MB). For prod-scale flow, presigned PUT would be better. */
export async function actUploadImage(input: {
  hotelId: string;
  roomId?: string;
  dataUrl: string;       // 'data:image/jpeg;base64,...'
  altText?: string;
  sortOrder?: number;
}): Promise<{ id: string; url: string }> {
  await gateAdmin();
  const m = input.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("รูปแบบรูปไม่ถูกต้อง");
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 5 * 1024 * 1024) throw new Error("รูปใหญ่เกิน 5MB");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const key = `hotelbook/${input.hotelId}/${input.roomId ?? "hotel"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const url = await putObject(key, buf, mime);

  const created = await prisma.hotelImage.create({
    data: {
      hotelId: input.hotelId,
      roomId: input.roomId,
      url,
      altText: input.altText,
      sortOrder: input.sortOrder ?? 0,
    },
  });

  // If room has no primary image yet, set this one
  if (input.roomId) {
    const room = await prisma.hotelRoom.findUnique({ where: { id: input.roomId }, select: { primaryImageUrl: true } });
    if (room && !room.primaryImageUrl) {
      await prisma.hotelRoom.update({ where: { id: input.roomId }, data: { primaryImageUrl: url } });
    }
  }
  // If hotel has no hero image yet, set this one
  if (!input.roomId) {
    const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId }, select: { heroImageUrl: true } });
    if (hotel && !hotel.heroImageUrl) {
      await prisma.hotel.update({ where: { id: input.hotelId }, data: { heroImageUrl: url } });
    }
  }

  revalidatePath("/hotelbook/images");
  revalidatePath("/hotelbook/rooms");
  revalidatePath(`/hotel/[slug]`, "page");
  revalidatePath("/liff/hotel");

  return { id: created.id, url };
}

export async function actDeleteImage(id: string) {
  await gateAdmin();
  const img = await prisma.hotelImage.findUnique({ where: { id } });
  if (!img) return;
  // strip leading R2_PUBLIC_URL to derive key (best-effort)
  const pubBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const key = pubBase && img.url.startsWith(pubBase) ? img.url.slice(pubBase.length + 1) : null;
  await prisma.hotelImage.delete({ where: { id } });
  if (key) await deleteObject(key);
  revalidatePath("/hotelbook/images");
  revalidatePath("/hotelbook/rooms");
}

export async function actSetPrimaryImage(roomId: string, url: string) {
  await gateAdmin();
  await prisma.hotelRoom.update({ where: { id: roomId }, data: { primaryImageUrl: url } });
  revalidatePath("/hotelbook/rooms");
  revalidatePath(`/hotel/[slug]`, "page");
}

export async function actSetHotelHero(hotelId: string, url: string) {
  await gateAdmin();
  await prisma.hotel.update({ where: { id: hotelId }, data: { heroImageUrl: url } });
  revalidatePath("/hotelbook");
  revalidatePath(`/hotel/[slug]`, "page");
}
