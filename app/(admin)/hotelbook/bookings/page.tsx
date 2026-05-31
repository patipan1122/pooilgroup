// Bookings management · /hotelbook/bookings
// Full table + status change.

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listHotelsByOrg, listBookings } from "@/lib/hotelbook/data";
import { BookingStatusSelect } from "./_components/booking-status-select";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const session = await requireSession();
  const hotels = await listHotelsByOrg(session.user.org_id);
  const hotel = hotels[0];
  if (!hotel) return <Empty />;

  const bookings = await listBookings(hotel.id, { limit: 200 });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-6xl mx-auto space-y-5">
      <header>
        <Link href="/hotelbook" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
        <h1 className="text-2xl font-semibold mt-1">รายการจอง · {hotel.name}</h1>
      </header>

      <section className="rounded-xl ring-1 ring-zinc-200 bg-white overflow-hidden">
        {bookings.length === 0 ? (
          <p className="text-sm text-zinc-500 py-12 text-center">ยังไม่มีการจอง</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">รหัส</th>
                  <th className="text-left px-3 py-2 font-medium">ผู้จอง</th>
                  <th className="text-left px-3 py-2 font-medium">ห้อง</th>
                  <th className="text-left px-3 py-2 font-medium">เข้าพัก</th>
                  <th className="text-right px-3 py-2 font-medium">ยอด</th>
                  <th className="text-left px-3 py-2 font-medium">ช่อง</th>
                  <th className="text-left px-3 py-2 font-medium">สถานะ</th>
                  <th className="text-left px-3 py-2 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{b.code}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{b.guestName}</div>
                      <div className="text-[11px] text-zinc-500">
                        <a href={`tel:${b.guestPhone}`} className="hover:underline">{b.guestPhone}</a>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{b.room.name}</div>
                      <div className="text-[11px] text-zinc-500">{b.rooms} ห้อง × {b.nights} คืน</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{b.checkInDate.toLocaleDateString("th-TH")}</div>
                      <div className="text-zinc-400">→ {b.checkOutDate.toLocaleDateString("th-TH")}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">฿{Number(b.totalAmountThb).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{sourceLabel(b.source)}</td>
                    <td className="px-3 py-2"><BookingStatusSelect id={b.id} current={b.status} /></td>
                    <td className="px-3 py-2 text-xs text-zinc-500 max-w-[200px] truncate" title={b.note ?? ""}>{b.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Empty() {
  return (
    <div className="px-4 py-12 text-center text-zinc-500">ยังไม่มีโรงแรม · <Link href="/hotelbook/settings" className="text-blue-600 hover:underline">ตั้งค่าก่อน</Link></div>
  );
}

function sourceLabel(s: string): string {
  return ({ web: "🌐 เว็บ", liff: "📱 LINE", fb: "💬 FB", phone: "📞 โทร", walkin: "🚶 Walk-in", admin: "👤 แอดมิน" } as Record<string, string>)[s] ?? s;
}
