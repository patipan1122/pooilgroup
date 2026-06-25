"use client";

// Playland · ฟอร์มบันทึกอุบัติเหตุ/เหตุการณ์ → กันคดี/เคลมประกัน
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIncident } from "@/lib/playland/incidents";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const input: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 10, padding: "11px 13px", fontSize: 16, fontFamily: MITR, color: "#3A3026", outline: "none", boxSizing: "border-box", width: "100%" };
const label: React.CSSProperties = { fontSize: 13, color: "#8a7f70", marginBottom: 6 };

const KINDS = [
  { v: "injury", t: "บาดเจ็บ" },
  { v: "conflict", t: "ทะเลาะวิวาท" },
  { v: "health", t: "ป่วย-สุขภาพ" },
  { v: "property", t: "ทรัพย์สินเสียหาย" },
  { v: "lost-child", t: "เด็กหลง" },
  { v: "other", t: "อื่นๆ" },
];
const SEVERITIES = [
  { v: "minor", t: "เล็กน้อย" },
  { v: "moderate", t: "ปานกลาง" },
  { v: "serious", t: "ร้ายแรง" },
];

// datetime-local ต้องการ "YYYY-MM-DDTHH:mm" ตามเวลาเครื่อง (ไม่ใช่ UTC)
function nowLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function IncidentForm({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [kind, setKind] = useState("injury");
  const [severity, setSeverity] = useState("minor");
  const [childName, setChildName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [parentNotified, setParentNotified] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = () => {
    if (pending) return;
    if (!description.trim()) { setMsg("ใส่รายละเอียดเหตุการณ์"); return; }
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await createIncident({ branchId, occurredAt, kind, severity, childName, location, description, actionTaken, parentNotified });
        if (res.ok) {
          setMsg("✓ บันทึกเหตุการณ์แล้ว");
          setKind("injury"); setSeverity("minor"); setChildName(""); setLocation("");
          setDescription(""); setActionTaken(""); setParentNotified(false); setOccurredAt(nowLocal());
          router.refresh();
        } else setMsg("❌ " + res.error);
      } catch { setMsg("❌ บันทึกไม่สำเร็จ · ลองใหม่"); }
    });
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 18, display: "grid", gap: 12 }}>
        <div>
          <div style={label}>เวลาที่เกิดเหตุ *</div>
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} style={input} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={label}>ประเภทเหตุการณ์</div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={input}>
              {KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
            </select>
          </div>
          <div>
            <div style={label}>ความรุนแรง</div>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={input}>
              {SEVERITIES.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={label}>ชื่อเด็ก/ผู้เกี่ยวข้อง (ไม่บังคับ)</div>
            <input value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="เช่น น้องมาย" style={input} />
          </div>
          <div>
            <div style={label}>จุดเกิดเหตุ (ไม่บังคับ)</div>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="เช่น บ่อบอล โซน A" style={input} />
          </div>
        </div>
        <div>
          <div style={label}>รายละเอียดเหตุการณ์ *</div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="เกิดอะไรขึ้น · ใคร · ตรงไหน · บาดเจ็บยังไง" style={{ ...input, resize: "vertical" }} />
        </div>
        <div>
          <div style={label}>การจัดการ — ปฐมพยาบาล/แจ้งผู้ปกครอง? (ไม่บังคับ)</div>
          <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={3} placeholder="เช่น ทำแผล แจ้งแม่น้อง โทรเรียกพยาบาล" style={{ ...input, resize: "vertical" }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, cursor: "pointer", color: "#3A3026" }}>
          <input type="checkbox" checked={parentNotified} onChange={(e) => setParentNotified(e.target.checked)} style={{ width: 18, height: 18 }} />
          แจ้งผู้ปกครองแล้ว
        </label>
      </div>

      {msg && <div style={{ borderRadius: 10, padding: "12px 16px", fontSize: 15, background: msg.startsWith("✓") ? "#eaf3eb" : "#fdecea", color: msg.startsWith("✓") ? "#1F8A5B" : "#c0392b" }}>{msg}</div>}
      <button onClick={submit} disabled={pending} style={{ background: "#2D6CB1", color: "#fff", border: "none", borderRadius: 14, padding: 16, fontFamily: MITR, fontWeight: 500, fontSize: 18, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}>{pending ? "กำลังบันทึก…" : "บันทึกเหตุการณ์"}</button>
    </div>
  );
}
