"use client";

// Playland · ของหาย-ของเก็บได้ — ฟอร์มบันทึกของใหม่ (ซ้าย) + ปุ่มคืนของ/ทิ้ง ต่อรายการ (ขวา)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordLostItem, claimLostItem, disposeLostItem } from "@/lib/playland/lost-found";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const input: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 10, padding: "12px 13px", fontSize: 16, fontFamily: MITR, color: "#3A3026", outline: "none", boxSizing: "border-box", width: "100%" };
const label: React.CSSProperties = { fontSize: 13, color: "#8a7f70", marginBottom: 6 };

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm สำหรับ datetime-local
}

// ── ฟอร์มบันทึกของเก็บได้ใหม่ ──
export function LostFoundForm({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [itemName, setItemName] = useState("");
  const [foundLocation, setFoundLocation] = useState("");
  const [foundAt, setFoundAt] = useState(nowLocal());
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!itemName.trim()) { setMsg("ใส่ชื่อของที่เก็บได้"); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await recordLostItem({ branchId, itemName, foundLocation, foundAt, description, contactPhone });
      if (res.ok) {
        setMsg(`✓ บันทึกแล้ว · ${res.data.itemCode}`);
        setItemName(""); setFoundLocation(""); setDescription(""); setContactPhone(""); setFoundAt(nowLocal());
        router.refresh();
      } else setMsg("❌ " + res.error);
    } catch { setMsg("❌ บันทึกไม่สำเร็จ · ลองใหม่"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 18, display: "grid", gap: 12 }}>
        <div>
          <div style={label}>ของอะไร *</div>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="เช่น กระเป๋าเป้สีฟ้า · ขวดน้ำ Hydro · รองเท้าเด็ก" style={input} />
        </div>
        <div>
          <div style={label}>เก็บได้ที่ไหน (ไม่บังคับ)</div>
          <input value={foundLocation} onChange={(e) => setFoundLocation(e.target.value)} placeholder="เช่น โซนบ้านบอล · หน้าเคาน์เตอร์ · ห้องน้ำ" style={input} />
        </div>
        <div>
          <div style={label}>เก็บได้เมื่อ</div>
          <input type="datetime-local" value={foundAt} onChange={(e) => setFoundAt(e.target.value)} style={input} />
        </div>
        <div>
          <div style={label}>รายละเอียดเพิ่มเติม (ไม่บังคับ)</div>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="เช่น มีพวงกุญแจการ์ตูน · มีชื่อเขียนไว้" style={input} />
        </div>
        <div>
          <div style={label}>เบอร์ติดต่อเจ้าของ (ถ้ามี)</div>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" placeholder="เช่น 081-234-5678" style={input} />
        </div>
      </div>

      {msg && <div style={{ borderRadius: 10, padding: "12px 16px", fontSize: 15, background: msg.startsWith("✓") ? "#eaf3eb" : "#fdecea", color: msg.startsWith("✓") ? "#1F8A5B" : "#c0392b" }}>{msg}</div>}
      <button onClick={submit} disabled={busy} style={{ background: "#2D6CB1", color: "#fff", border: "none", borderRadius: 14, padding: 16, fontFamily: MITR, fontWeight: 500, fontSize: 18, minHeight: 44, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "กำลังบันทึก…" : "บันทึกของเก็บได้"}</button>
    </div>
  );
}

// ── แถวปุ่มต่อรายการ: คืนของ (กรอกชื่อผู้รับ) / ทิ้ง-บริจาค ──
export function LostFoundActions({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const doClaim = async () => {
    if (busy) return;
    if (!name.trim()) { setMsg("ใส่ชื่อผู้มารับ"); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await claimLostItem({ itemId, claimedByName: name });
      if (res.ok) router.refresh();
      else { setMsg(res.error); setBusy(false); }
    } catch { setMsg("คืนของไม่สำเร็จ"); setBusy(false); }
  };

  const doDispose = async () => {
    if (busy) return;
    if (!window.confirm("ยืนยันทิ้ง/บริจาคของชิ้นนี้?")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await disposeLostItem({ itemId });
      if (res.ok) router.refresh();
      else { setMsg(res.error); setBusy(false); }
    } catch { setMsg("ทำรายการไม่สำเร็จ"); setBusy(false); }
  };

  if (claiming) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="ชื่อผู้มารับของ" style={{ flex: 1, minWidth: 160, background: "#fff", border: "1px solid #ece5d8", borderRadius: 10, padding: "10px 12px", fontSize: 16, fontFamily: MITR, color: "#3A3026", outline: "none" }} />
        <button onClick={doClaim} disabled={busy} style={{ background: "#1F8A5B", color: "#fff", border: "none", borderRadius: 10, padding: "0 16px", minHeight: 44, fontFamily: MITR, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "…" : "ยืนยันคืน"}</button>
        <button onClick={() => { setClaiming(false); setMsg(null); }} disabled={busy} style={{ background: "#fff", color: "#8a7f70", border: "1px solid #ece5d8", borderRadius: 10, padding: "0 14px", minHeight: 44, fontFamily: MITR, fontSize: 15, cursor: "pointer" }}>ยกเลิก</button>
        {msg && <div style={{ width: "100%", fontSize: 13, color: "#c0392b" }}>{msg}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button onClick={() => setClaiming(true)} style={{ background: "#2D6CB1", color: "#fff", border: "none", borderRadius: 10, padding: "0 16px", minHeight: 44, fontFamily: MITR, fontSize: 15, cursor: "pointer" }}>คืนของ</button>
      <button onClick={doDispose} disabled={busy} style={{ background: "#fff", color: "#a9791a", border: "1px solid #ece5d8", borderRadius: 10, padding: "0 16px", minHeight: 44, fontFamily: MITR, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>ทิ้ง/บริจาค</button>
      {msg && <div style={{ fontSize: 13, color: "#c0392b", alignSelf: "center" }}>{msg}</div>}
    </div>
  );
}
