"use client";

import { useState, useTransition } from "react";
import { FaceCapture } from "./face-capture";
import { CheckCircle2, AlertCircle } from "lucide-react";

export function MobileFaceRegister({ branchId, bookingId, customerName, customerPhone }: { branchId: string; bookingId?: string; customerName?: string; customerPhone?: string }) {
  const [pending, start] = useTransition();
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState(customerName ?? "");
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) { setMsg({ kind: "err", text: "ถ่ายรูปหน้าก่อนครับ" }); return; }
    if (!name.trim() || !phone.trim()) { setMsg({ kind: "err", text: "ใส่ชื่อและเบอร์" }); return; }
    if (!consent) { setMsg({ kind: "err", text: "ต้องยินยอม PDPA" }); return; }
    start(async () => {
      const res = await fetch("/api/playland/public/register-face", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchId, bookingId, name: name.trim(), phone: phone.trim(), photoDataUrl: photo, consent }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setMsg({ kind: "err", text: data.error ?? "error" }); return; }
      setMsg({ kind: "ok", text: `ลงทะเบียนสำเร็จ · ที่ร้านสแกนหน้าเข้าได้เลย` });
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      {msg && (
        <div className="pl-card" style={{ background: msg.kind === "ok" ? "#dcfce7" : "#fee2e2", color: msg.kind === "ok" ? "#166534" : "#991b1b", display: "flex", gap: 8, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{msg.text}
        </div>
      )}

      <FaceCapture value={photo} onChange={setPhoto} label="ถ่ายรูปหน้าให้ชัด · กล้องหน้า" />

      <div>
        <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อ-นามสกุล</label>
        <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>เบอร์โทร</label>
        <input className="pl-input" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <label style={{ fontSize: 13 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginRight: 6 }} />
        ยินยอมให้เก็บรูปหน้า + ข้อมูลส่วนตัว ตาม PDPA · เก็บ 1 ปี · ขอลบได้ทุกเมื่อ
      </label>
      <button type="submit" className="pl-btn pl-btn-primary" disabled={pending} style={{ padding: "12px 16px" }}>
        {pending ? "กำลังลงทะเบียน..." : "ลงทะเบียนหน้า"}
      </button>
    </form>
  );
}
