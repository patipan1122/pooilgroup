"use client";

// Public booking form · single-page stepper (1: package → 2: time → 3: contact)
// Steps visible at once for short flow · animated focus

import { useState, useTransition } from "react";
import { thb } from "@/lib/playland/format";
import { CalendarClock, CheckCircle2, AlertCircle, ArrowRight, Users } from "lucide-react";

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

  const hourly = Array.from({ length: 12 }, (_, i) => 10 + i);
  const pkg = packages.find((p) => p.id === selectedPkg);
  const grandTotal = pkg ? pkg.price * parseInt(partySize || "1") : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pkg) return;
    if (!name.trim() || !phone.trim()) { setMsg({ kind: "err", text: "ใส่ชื่อและเบอร์โทร" }); return; }
    start(async () => {
      const res = await fetch("/api/playland/bookings/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId, packageId: pkg.id,
          customerName: name.trim(), customerPhone: phone.trim(),
          partySize: parseInt(partySize || "1"),
          slotDate: date, slotHour: parseInt(hour),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setMsg({ kind: "err", text: data.error ?? `error ${res.status}` }); return; }
      setMsg({ kind: "ok", text: `จองสำเร็จ · ${data.bookingCode}`, url: data.paymentUrl });
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    });
  }

  return (
    <form onSubmit={submit} className="pl-stagger" style={{ display: "grid", gap: 20 }}>
      {msg && (
        <div className="pl-card" style={{
          background: msg.kind === "ok" ? "var(--pl-ok-soft)" : "var(--pl-danger-soft)",
          color: msg.kind === "ok" ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <div>{msg.text}{msg.url && <div style={{ fontSize: 12, marginTop: 4 }}>กำลังพาไปหน้าชำระเงิน...</div>}</div>
        </div>
      )}

      {/* STEP 1 — Package */}
      <section>
        <div className="pl-eyebrow" style={{ marginBottom: 10 }}>① เลือกแพคเกจ</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {packages.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setSelectedPkg(p.id)}
              className={`pl-card pl-card-hover ${selectedPkg === p.id ? "pl-card-accent" : ""}`}
              style={{
                textAlign: "left", cursor: "pointer",
                border: selectedPkg === p.id ? "2px solid var(--pl-brand)" : undefined,
                position: "relative",
              }}
            >
              <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1rem", fontWeight: 600, marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)" }}>
                {p.type === "DAY_PASS" ? "ทั้งวัน" : p.type === "PER_MINUTE" ? "คิดตามนาที" : `${p.minutes ?? 0} นาที`}
              </div>
              <div className="pl-stat-value" style={{ marginTop: 10, fontSize: "1.65rem", color: "var(--pl-brand-dark)" }}>
                {thb(p.price)}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* STEP 2 — Time */}
      <section>
        <div className="pl-eyebrow" style={{ marginBottom: 10 }}>② วันเวลา + จำนวน</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <label className="pl-label">วันที่</label>
            <input className="pl-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} min={today} />
          </div>
          <div>
            <label className="pl-label">เวลาเข้า</label>
            <select className="pl-select" value={hour} onChange={(e) => setHour(e.target.value)}>
              {hourly.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <div>
            <label className="pl-label">จำนวนเด็ก</label>
            <div style={{ position: "relative" }}>
              <Users size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--pl-text-muted)" }} />
              <input className="pl-input" type="number" min={1} max={20} value={partySize} onChange={(e) => setPartySize(e.target.value)} style={{ paddingLeft: 32 }} />
            </div>
          </div>
        </div>
      </section>

      {/* STEP 3 — Contact */}
      <section>
        <div className="pl-eyebrow" style={{ marginBottom: 10 }}>③ ข้อมูลติดต่อ</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="pl-label">ชื่อผู้ปกครอง *</label>
            <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="คุณ..." />
          </div>
          <div>
            <label className="pl-label">เบอร์โทร *</label>
            <input className="pl-input" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" />
          </div>
        </div>
      </section>

      {/* Summary + CTA */}
      {pkg && (
        <div className="pl-card pl-card-accent" style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          position: "sticky", bottom: 16,
          boxShadow: "var(--pl-shadow-3)",
        }}>
          <div>
            <div className="pl-eyebrow" style={{ marginBottom: 2 }}>ยอดรวม</div>
            <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.05rem", fontWeight: 500 }}>
              {pkg.name} × {partySize}
              <span style={{ color: "var(--pl-text-muted)", marginLeft: 8, fontSize: 12, fontFamily: "var(--pl-font-mono)" }}>{date} · {hour}:00</span>
            </div>
          </div>
          <div className="pl-stat-value" style={{ fontSize: "2rem" }}>{thb(grandTotal)}</div>
        </div>
      )}

      <button type="submit" className="pl-btn pl-btn-primary pl-btn-lg" disabled={pending || !pkg}>
        {pending ? "กำลังจอง..." : <><CalendarClock size={16} /> จอง + ชำระเงิน <ArrowRight size={14} /></>}
      </button>

      <p style={{ fontSize: 11, color: "var(--pl-text-muted)", textAlign: "center" }}>
        ระบบจะเปิด link จ่ายเงินอัตโนมัติ · ถ้าจ่ายภายใน 30 นาที booking จะ confirmed
      </p>
    </form>
  );
}
