// LINE Mini App entry · /liff/hotel
// Mobile-only narrow viewport · single hotel (Mix Hotel) for now.
// Reuses /hotel/[slug] booking-flow logic but renders in a LIFF-optimized layout.

import { redirect } from "next/navigation";
import { getHotelBySlug } from "@/lib/hotelbook/data";
import { LiffBookingApp } from "./_components/liff-booking-app";

export const dynamic = "force-dynamic";

const DEFAULT_HOTEL_SLUG = "mix-hotel";

export default async function HotelLiffPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const sp = await searchParams;
  const slug = sp.slug || DEFAULT_HOTEL_SLUG;
  const hotel = await getHotelBySlug(slug);
  if (!hotel || !hotel.enabled) redirect("/");

  return (
    <LiffBookingApp
      hotel={{
        slug: hotel.slug,
        name: hotel.name,
        concept: hotel.concept,
        description: hotel.description,
        brandColor: hotel.brandColor,
        heroImageUrl: hotel.heroImageUrl,
        checkInTime: hotel.checkInTime,
        checkOutTime: hotel.checkOutTime,
        reservationPhones: hotel.reservationPhones,
        ownerPhone: hotel.ownerPhone,
        googleMapsUrl: hotel.googleMapsUrl,
        paymentMethods: hotel.paymentMethods,
        amenities: hotel.amenities,
        rooms: hotel.rooms.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          bedDescription: r.bedDescription,
          priceThb: Number(r.priceThb),
          totalRooms: r.totalRooms,
          amenities: r.amenities,
          primaryImageUrl: r.primaryImageUrl,
          imageUrls: r.images.map((i) => i.url),
        })),
      }}
    />
  );
}
