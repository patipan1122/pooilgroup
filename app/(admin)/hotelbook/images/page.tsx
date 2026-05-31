// Images management · /hotelbook/images
// Gallery + hero · drag-drop upload · set hero.

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listHotelsByOrg } from "@/lib/hotelbook/data";
import { prisma } from "@/lib/prisma";
import { ImagesManager } from "./_components/images-manager";

export const dynamic = "force-dynamic";

export default async function ImagesPage() {
  const session = await requireSession();
  const hotels = await listHotelsByOrg(session.user.org_id);
  const hotel = hotels[0];
  if (!hotel) {
    return <div className="p-8 text-zinc-500">ตั้งค่าโรงแรมก่อน</div>;
  }
  const galleryImages = await prisma.hotelImage.findMany({
    where: { hotelId: hotel.id, roomId: null },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-5xl mx-auto space-y-5">
      <header>
        <Link href="/hotelbook" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
        <h1 className="text-2xl font-semibold mt-1">รูปภาพ · {hotel.name}</h1>
        <p className="text-sm text-zinc-500 mt-1">อัปโหลดรูปประกอบโรงแรม · กดเพื่อตั้งเป็นภาพ hero (โชว์ด้านบน)</p>
      </header>

      <ImagesManager
        hotelId={hotel.id}
        currentHeroUrl={hotel.heroImageUrl}
        images={galleryImages.map((i) => ({ id: i.id, url: i.url }))}
      />
    </div>
  );
}
