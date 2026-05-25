import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listBranches, listBookings } from "@/lib/playland/queries";
import { fmtTime, fmtDateTime, bookingStatusChipClass, bookingStatusLabel, thb } from "@/lib/playland/format";
import { CalendarClock, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ branch?: string; date?: string; status?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  const date = sp.date ? new Date(sp.date) : new Date();

  if (!branchId) {
    return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;
  }

  const bookings = await listBookings(orgId, { branchId, date, status: sp.status });
  const branch = branches.find((b) => b.id === branchId);
  const publicUrl = `/p/playland/${branch?.slug ?? branchId}/book`;

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · จองล่วงหน้า</div>
          <h1>จองวันที่ {date.toLocaleDateString("th-TH")}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="date" className="pl-input" defaultValue={date.toISOString().slice(0, 10)} onChange={(e) => { window.location.href = `/playland/bookings?branch=${branchId}&date=${e.target.value}`; }} style={{ width: 160 }} />
          <a href={publicUrl} target="_blank" rel="noopener" className="pl-btn">ดู public form →</a>
          <Link href={`${publicUrl}`} className="pl-btn pl-btn-primary"><PlusCircle size={14} /> จองให้ลูกค้า</Link>
        </div>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <div className="pl-card pl-stat"><span className="pl-stat-label">ทั้งหมด</span><span className="pl-stat-value">{bookings.length}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">รอชำระ</span><span className="pl-stat-value">{bookings.filter((b) => b.status === "PENDING").length}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">ชำระแล้ว</span><span className="pl-stat-value">{bookings.filter((b) => b.status === "PAID").length}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">เข้าแล้ว</span><span className="pl-stat-value">{bookings.filter((b) => b.status === "CHECKED_IN").length}</span></div>
        <div className="pl-card pl-stat"><span className="pl-stat-label">รายได้</span><span className="pl-stat-value">{thb(bookings.reduce((a, b) => a + b.amountCents, 0))}</span></div>
      </div>

      <div className="pl-pane" style={{ flex: 1, overflowY: "auto" }}>
        <table className="pl-table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>เวลา</th>
              <th>ลูกค้า</th>
              <th>Package</th>
              <th>ราคา</th>
              <th>สถานะ</th>
              <th>สร้างเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 && (
              <tr><td colSpan={7}><div className="pl-empty"><CalendarClock size={32} opacity={0.4} />ไม่มีการจองวันนี้</div></td></tr>
            )}
            {bookings.map((b) => (
              <tr key={b.id}>
                <td><div style={{ fontWeight: 600 }}>{b.bookingCode}</div></td>
                <td>{fmtTime(b.slotStart)} — {fmtTime(b.slotEnd)}</td>
                <td><div>{b.customerName}</div><div style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{b.customerPhone}</div></td>
                <td>{b.package.name}</td>
                <td>{thb(b.amountCents)}</td>
                <td><span className={bookingStatusChipClass(b.status)}>{bookingStatusLabel(b.status)}</span></td>
                <td style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{fmtDateTime(b.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
