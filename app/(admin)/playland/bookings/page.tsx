import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listBranches, listBookings } from "@/lib/playland/queries";
import { fmtTime, fmtDateTime, bookingStatusChipClass, bookingStatusLabel, thb } from "@/lib/playland/format";
import { NavSelect } from "@/components/playland/nav-select";
import { CalendarClock, PlusCircle, ArrowLeft, ExternalLink } from "lucide-react";

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

  const summary = {
    total: bookings.length,
    pending: bookings.filter((b) => b.status === "PENDING").length,
    paid: bookings.filter((b) => b.status === "PAID").length,
    checked: bookings.filter((b) => b.status === "CHECKED_IN").length,
    revenue: bookings.reduce((a, b) => a + b.amountCents, 0),
  };

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1>การจอง · <span style={{ fontFamily: "var(--pl-font-mono)", fontSize: "0.85rem", color: "var(--pl-text-muted)", fontWeight: 400 }}>{date.toLocaleDateString("th-TH", { day: "numeric", month: "long" })}</span></h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {branches.length > 1 && <NavSelect param="branch" value={branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 160 }} />}
          <NavSelect param="date" value={date.toISOString().slice(0, 10)} options={[
            { value: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), label: "เมื่อวาน" },
            { value: new Date().toISOString().slice(0, 10), label: "วันนี้" },
            { value: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), label: "พรุ่งนี้" },
          ]} style={{ width: 130 }} />
          <a href={publicUrl} target="_blank" rel="noopener" className="pl-btn"><ExternalLink size={12} /> Public form</a>
        </div>
      </header>

      <div className="pl-mobile-stats" style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, borderBottom: "1px solid var(--pl-line)", background: "var(--pl-paper)" }}>
        <div className="pl-stat"><span className="pl-stat-label">ทั้งหมด</span><span className="pl-stat-value">{summary.total}</span></div>
        <div className="pl-stat"><span className="pl-stat-label">รอชำระ</span><span className="pl-stat-value" style={{ color: summary.pending > 0 ? "var(--pl-warn)" : undefined }}>{summary.pending}</span></div>
        <div className="pl-stat"><span className="pl-stat-label">ชำระแล้ว</span><span className="pl-stat-value" style={{ color: "var(--pl-ok)" }}>{summary.paid}</span></div>
        <div className="pl-stat"><span className="pl-stat-label">เข้าแล้ว</span><span className="pl-stat-value">{summary.checked}</span></div>
        <div className="pl-stat"><span className="pl-stat-label">รายได้</span><span className="pl-stat-value">{thb(summary.revenue)}</span></div>
      </div>

      <div className="pl-pane" style={{ flex: 1, overflowY: "auto" }}>
        {bookings.length === 0 ? (
          <div className="pl-empty">
            <div className="pl-empty-icon"><CalendarClock size={22} /></div>
            <div className="pl-empty-title">ไม่มีการจอง</div>
            <div className="pl-empty-message">ลูกค้าจองผ่าน <code style={{ background: "var(--pl-ink-100)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{publicUrl}</code></div>
            <a href={publicUrl} target="_blank" rel="noopener" className="pl-btn pl-btn-primary" style={{ marginTop: 8 }}>
              <ExternalLink size={12} /> เปิด Public form
            </a>
          </div>
        ) : (
          <table className="pl-table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>เวลา</th>
                <th>ลูกค้า</th>
                <th>Package</th>
                <th style={{ textAlign: "right" }}>ราคา</th>
                <th>สถานะ</th>
                <th>สร้างเมื่อ</th>
              </tr>
            </thead>
            <tbody className="pl-stagger">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td><div style={{ fontWeight: 600, fontFamily: "var(--pl-font-mono)" }}>{b.bookingCode}</div></td>
                  <td className="pl-num">{fmtTime(b.slotStart)} – {fmtTime(b.slotEnd)}</td>
                  <td>
                    <div>{b.customerName}</div>
                    <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)" }}>{b.customerPhone}</div>
                  </td>
                  <td>{b.package.name}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }} className="pl-num">{thb(b.amountCents)}</td>
                  <td><span className={bookingStatusChipClass(b.status)}>{bookingStatusLabel(b.status)}</span></td>
                  <td className="pl-num" style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{fmtDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
