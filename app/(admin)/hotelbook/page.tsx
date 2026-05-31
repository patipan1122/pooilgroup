// HotelBook · Admin overview · /hotelbook
// Shows hotels list (only 1 for now) + KPI strip + recent bookings.

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listHotelsByOrg, listBookingStats, listBookings } from "@/lib/hotelbook/data";

export const dynamic = "force-dynamic";

export default async function HotelBookOverviewPage() {
  const session = await requireSession();
  const hotels = await listHotelsByOrg(session.user.org_id);

  if (hotels.length === 0) {
    return (
      <div className="px-4 py-12 sm:px-8 max-w-3xl mx-auto text-center">
        <div className="text-6xl mb-4">🏨</div>
        <h1 className="text-2xl font-bold mb-2">ยังไม่มีโรงแรม</h1>
        <p className="text-zinc-500 mb-6">ตั้งค่าโรงแรมแรกของคุณเพื่อเริ่มรับจอง</p>
        <Link href="/hotelbook/settings" className="inline-flex h-11 px-6 rounded-xl bg-zinc-900 text-white font-medium items-center">
          ตั้งค่าโรงแรม
        </Link>
      </div>
    );
  }

  const hotel = hotels[0];
  const [stats, recent] = await Promise.all([
    listBookingStats(hotel.id),
    listBookings(hotel.id, { limit: 8 }),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">ระบบจองโรงแรม</p>
          <h1 className="text-2xl font-semibold text-zinc-900">{hotel.name}</h1>
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            <a href={`/hotel/${hotel.slug}`} target="_blank" rel="noopener" className="text-blue-600 hover:underline">เปิดหน้าจองสาธารณะ ↗</a>
            <span className="text-zinc-300">·</span>
            <a href={`/liff/hotel?slug=${hotel.slug}`} target="_blank" rel="noopener" className="text-emerald-600 hover:underline">เปิด LINE Mini App ↗</a>
          </div>
        </div>
        <Link href="/hotelbook/settings" className="h-9 px-4 rounded-lg ring-1 ring-zinc-200 text-sm hover:bg-zinc-50">⚙️ ตั้งค่า</Link>
      </header>

      <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Kpi label="จองทั้งหมด" value={String(stats.total)} />
        <Kpi label="รออนุมัติ" value={String(stats.pending)} tone="warn" />
        <Kpi label="ยืนยันแล้ว" value={String(stats.confirmed)} tone="ok" />
        <Kpi label="กำลังเข้าพัก" value={String(stats.checkedIn)} tone="accent" />
      </section>

      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">การจองล่าสุด</h2>
          <Link href="/hotelbook/bookings" className="text-xs text-blue-600 hover:underline">ดูทั้งหมด →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">ยังไม่มีการจอง</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">รหัส</th>
                  <th className="text-left px-3 py-2 font-medium">ผู้จอง</th>
                  <th className="text-left px-3 py-2 font-medium">ห้อง</th>
                  <th className="text-left px-3 py-2 font-medium">เช็คอิน</th>
                  <th className="text-right px-3 py-2 font-medium">ยอด</th>
                  <th className="text-left px-3 py-2 font-medium">สถานะ</th>
                  <th className="text-left px-3 py-2 font-medium">ช่อง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {recent.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-mono text-xs">{b.code}</td>
                    <td className="px-3 py-2">{b.guestName}<div className="text-[11px] text-zinc-500">{b.guestPhone}</div></td>
                    <td className="px-3 py-2 text-zinc-700">{b.room.name}<div className="text-[11px] text-zinc-500">{b.rooms} ห้อง × {b.nights} คืน</div></td>
                    <td className="px-3 py-2 text-xs">{b.checkInDate.toLocaleDateString("th-TH")}</td>
                    <td className="px-3 py-2 text-right font-mono">฿{Number(b.totalAmountThb).toLocaleString()}</td>
                    <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{sourceLabel(b.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold mb-3">ห้องและราคา</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {hotel.rooms.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg ring-1 ring-zinc-100">
              <div className="flex-1">
                <div className="font-medium text-zinc-900">{r.name}</div>
                <div className="text-xs text-zinc-500">{r.bedDescription}</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-semibold">฿{Number(r.priceThb).toLocaleString()}</div>
                <div className="text-[11px] text-zinc-500">{r.totalRooms} ห้อง</div>
              </div>
            </div>
          ))}
        </div>
        <Link href="/hotelbook/rooms" className="inline-block mt-3 text-xs text-blue-600 hover:underline">จัดการห้อง →</Link>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "accent" }) {
  const bg = tone === "ok" ? "bg-emerald-50 ring-emerald-200" : tone === "warn" ? "bg-amber-50 ring-amber-200" : tone === "accent" ? "bg-violet-50 ring-violet-200" : "bg-white ring-zinc-200";
  return (
    <div className={`rounded-xl ring-1 p-3 ${bg}`}>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold text-zinc-900">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { label: string; cls: string }> = {
    pending:    { label: "รออนุมัติ",   cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    confirmed:  { label: "ยืนยัน",       cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    cancelled:  { label: "ยกเลิก",       cls: "bg-zinc-100 text-zinc-500 ring-zinc-200" },
    checked_in: { label: "เข้าพัก",      cls: "bg-violet-50 text-violet-700 ring-violet-200" },
    completed:  { label: "เสร็จสิ้น",     cls: "bg-blue-50 text-blue-700 ring-blue-200" },
    no_show:    { label: "ไม่มา",         cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  };
  const v = m[status] ?? { label: status, cls: "bg-zinc-50 text-zinc-700 ring-zinc-200" };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ring-1 ${v.cls}`}>{v.label}</span>;
}

function sourceLabel(s: string): string {
  return ({ web: "เว็บ", liff: "LINE", fb: "Facebook", phone: "โทร", walkin: "Walk-in", admin: "แอดมิน" } as Record<string, string>)[s] ?? s;
}
