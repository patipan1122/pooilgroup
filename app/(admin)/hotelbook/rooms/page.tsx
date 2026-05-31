// Room management · /hotelbook/rooms
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listHotelsByOrg } from "@/lib/hotelbook/data";
import { prisma } from "@/lib/prisma";
import { RoomsManager } from "./_components/rooms-manager";

export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  const session = await requireSession();
  const hotels = await listHotelsByOrg(session.user.org_id);
  const hotel = hotels[0];
  if (!hotel) {
    return <div className="p-8 text-zinc-500">ตั้งค่าโรงแรมก่อนใน <Link href="/hotelbook/settings" className="text-blue-600">/hotelbook/settings</Link></div>;
  }

  const rooms = await prisma.hotelRoom.findMany({
    where: { hotelId: hotel.id },
    orderBy: { sortOrder: "asc" },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-5xl mx-auto space-y-5">
      <header>
        <Link href="/hotelbook" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
        <h1 className="text-2xl font-semibold mt-1">จัดการห้อง · {hotel.name}</h1>
        <p className="text-sm text-zinc-500 mt-1">เพิ่ม/แก้ไขประเภทห้อง · ราคา · จำนวนห้อง · upload รูป</p>
      </header>

      <RoomsManager
        hotelId={hotel.id}
        rooms={rooms.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          bedDescription: r.bedDescription,
          priceThb: Number(r.priceThb),
          totalRooms: r.totalRooms,
          amenities: r.amenities,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          primaryImageUrl: r.primaryImageUrl,
          images: r.images.map((i) => ({ id: i.id, url: i.url })),
        }))}
      />
    </div>
  );
}
