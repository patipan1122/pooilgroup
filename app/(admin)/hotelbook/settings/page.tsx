// Hotel settings · /hotelbook/settings
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listHotelsByOrg } from "@/lib/hotelbook/data";
import { HotelSettingsForm } from "./_components/hotel-settings-form";

export const dynamic = "force-dynamic";

export default async function HotelSettingsPage() {
  const session = await requireSession();
  const hotels = await listHotelsByOrg(session.user.org_id);
  const hotel = hotels[0] ?? null;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-3xl mx-auto space-y-5">
      <header>
        <Link href="/hotelbook" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
        <h1 className="text-2xl font-semibold mt-1">ตั้งค่าโรงแรม</h1>
      </header>

      <HotelSettingsForm
        existing={hotel ? {
          id: hotel.id,
          slug: hotel.slug,
          name: hotel.name,
          concept: hotel.concept,
          description: hotel.description,
          reservationPhones: hotel.reservationPhones,
          ownerPhone: hotel.ownerPhone,
          googleMapsUrl: hotel.googleMapsUrl,
          address: hotel.address,
          email: hotel.email,
          brandColor: hotel.brandColor,
          checkInTime: hotel.checkInTime,
          checkOutTime: hotel.checkOutTime,
          is24h: hotel.is24h,
          paymentMethods: hotel.paymentMethods,
          allowsPets: hotel.allowsPets,
          smokingAllowed: hotel.smokingAllowed,
          cancellationNote: hotel.cancellationNote,
          multiNightDiscountNote: hotel.multiNightDiscountNote,
          amenities: hotel.amenities,
          nearbyPlaces: hotel.nearbyPlaces,
          enabled: hotel.enabled,
        } : null}
      />
    </div>
  );
}
