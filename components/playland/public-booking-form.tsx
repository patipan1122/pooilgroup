"use client";

import { useState, useTransition } from "react";
import { thb } from "@/lib/playland/format";
import { CalendarClock, CheckCircle2, AlertCircle } from "lucide-react";

interface Pkg {
  id: string;
  name: string;
  description: string | null;
  type: string;
  minutes: number | null;
  price: number;
}

export function PublicBookingForm({ branchId, branchSlug, packages }: { branchId: string; branchSlug: string; packages: Pkg[] }) {
  const [pending, start] = useTransition();
  const [selectedPkg, setSelectedPkg] = useState<string>(packages[0]?.id ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [hour, setHour] = useState("13");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState("1");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; url?: string } | null>(null);

  const hourly = Array.from({ length: 12 }, (_, i) => 10 + i); // 10:00 - 21:00
  const pkg = packages.find((p) => p.id === selectedPkg);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pkg) return;
    if (!name.trim() || !phone.trim()) { setMsg({ kind: "err", text: "ใส่ชื่อและเบอร์โทรครับ" }); return; }
    start(async () => {
      const res = await fetch("/api/playland/bookings/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          packageId: pkg.id,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          partySize: parseInt(partySize || "1"),
          slotDate: date,
          slotHour: parseInt(hour),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setMsg({ kind: "err", text: data.error ?? `error ${res.status}` }); return; }
      setMsg({ kind: "ok", text: `จองสำเร็จ · booking ${data.bookingCode}`, url: data.paymentUrl });
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
      {msg && (
        <div className="pl-card" style={{ background: msg.kind === "ok" ? "#dcfce7" : "#fee2e2", color: msg.kind === "ok" ? "#166534" : "#991b1b", display: "flex", gap: 8, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <div>{msg.text}{msg.url && <div style={{ fontSize: 12, marginTop: 4 }}>กำลังพาไปหน้าชำระเงิน...</div>}</div>
        </div>
      )}

      <div className="pl-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>1. เลือกแพคเกจ</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {packages.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setSelectedPkg(p.id)}
              className="pl-card"
              style={{
                textAlign: "left", cursor: "pointer",
                border: selectedPkg === p.id ? "2px solid var(--pl-brand)" : "1px solid var(--pl-line)",
                background: selectedPkg === p.id ? "var(--pl-brand-soft)" : "white",
              }}
            >
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 2 }}>
                {p.type === "DAY_PASS" ? "ทั้งวัน" : p.type === "PER_MINUTE" ? "คิดตามนาที" : `${p.minutes ?? 0} นาที`}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, color: "var(--pl-brand-dark)" }}>{thb(p.price)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="pl-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>2. วันและเวลา</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>วัน</label>
            <input className="pl-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} min={today} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>เวลาเข้า</label>
            <select className="pl-select" value={hour} onChange={(e) => setHour(e.target.value)}>
              {hourly.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>จำนวนเด็ก</label>
            <input className="pl-input" type="number" min={1} max={10} value={partySize} onChange={(e) => setPartySize(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="pl-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>3. ข้อมูลติดต่อ</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อผู้ปกครอง *</label>
            <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>เบอร์โทร *</label>
            <input className="pl-input" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" />
          </div>
        </div>
      </div>

      {pkg && (
        <div className="pl-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--pl-brand-soft)" }}>
          <div>
            <div style={{ fontWeight: 600 }}>{pkg.name}</div>
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{date} เวลา {hour}:00</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{thb(pkg.price * parseInt(partySize || "1"))}</div>
        </div>
      )}

      <button type="submit" className="pl-btn pl-btn-primary" disabled={pending || !pkg} style={{ padding: "12px 16px", fontSize: 15 }}>
        {pending ? "กำลังจอง..." : (
          <><CalendarClock size={16} /> จอง + ชำระเงิน</>
        )}
      </button>

      <p style={{ fontSize: 11, color: "var(--pl-text-muted)", textAlign: "center" }}>
        ระบบจองจะเปิด link จ่ายเงินอัตโนมัติ · ถ้าจ่ายภายใน 30 นาที booking จะ confirmed
      </p>
    </form>
  );
}
