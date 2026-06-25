"use client";

// Playland · ฟอร์มตรวจความปลอดภัย / ทำความสะอาดรายวัน
// ปุ่ม ✓/✗ ใหญ่กดง่ายบนมือถือ (≥44px) · ถ้า ✗ เปิดช่องโน้ตให้ระบุปัญหา
import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitSafetyCheck } from "@/lib/playland/safety";
import { DEFAULT_SAFETY_ITEMS } from "@/lib/playland/safety-checklist";

// re-export ให้ของเดิมที่ import จากไฟล์ฟอร์มยังใช้ได้ (single source อยู่ที่ lib/playland/safety-checklist)
export { DEFAULT_SAFETY_ITEMS };

type CheckType = "safety" | "cleaning";
type Item = { label: string; ok: boolean; note: string };

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const input: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "11px 13px", fontSize: 16, fontFamily: MITR, color: INK, outline: "none", boxSizing: "border-box", width: "100%" };

const DEFAULT_CLEANING_ITEMS: string[] = [
  "บอลพิททำความสะอาด/ฆ่าเชื้อ",
  "เครื่องเล่นเช็ดฆ่าเชื้อ",
  "ห้องน้ำสะอาด",
  "พื้นถูสะอาด",
  "โต๊ะ/เก้าอี้กินขนมสะอาด",
  "ถังขยะเททิ้ง",
];

const toItems = (labels: string[]): Item[] => labels.map((label) => ({ label, ok: true, note: "" }));

/**
 * @param items เช็กลิสต์ "ความปลอดภัย" ที่ตั้งค่าต่อสาขา (ถ้ามี · non-empty) → ใช้แทน default
 *              ถ้าไม่ส่ง/ว่าง = ใช้ DEFAULT_SAFETY_ITEMS เดิม (backward-compatible)
 */
export function SafetyForm({ branchId, items: safetyItems }: { branchId: string; items?: string[] }) {
  const router = useRouter();
  // เช็กลิสต์ safety = ตั้งค่าต่อสาขา (ถ้ามี) · cleaning = default ตายตัว
  const safetyLabels = safetyItems && safetyItems.length > 0 ? safetyItems : DEFAULT_SAFETY_ITEMS;
  const makeItems = (t: CheckType): Item[] => toItems(t === "cleaning" ? DEFAULT_CLEANING_ITEMS : safetyLabels);

  const [checkType, setCheckType] = useState<CheckType>("safety");
  const [shiftLabel, setShiftLabel] = useState<string>("เปิดร้าน");
  const [items, setItems] = useState<Item[]>(() => makeItems("safety"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const switchType = (t: CheckType) => { setCheckType(t); setItems(makeItems(t)); setMsg(null); };
  const setOk = (i: number, ok: boolean) => setItems((xs) => xs.map((it, idx) => (idx === i ? { ...it, ok } : it)));
  const setItemNote = (i: number, n: string) => setItems((xs) => xs.map((it, idx) => (idx === i ? { ...it, note: n } : it)));

  const failCount = items.filter((it) => !it.ok).length;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await submitSafetyCheck({
        branchId,
        checkType,
        shiftLabel,
        items: items.map((it) => ({ label: it.label, ok: it.ok, note: it.note.trim() || undefined })),
        note: note.trim() || undefined,
      });
      if (res.ok) {
        setMsg(failCount === 0 ? "✓ บันทึกแล้ว · ผ่านทุกจุด" : `✓ บันทึกแล้ว · พบปัญหา ${failCount} จุด`);
        setItems(makeItems(checkType));
        setNote("");
        router.refresh();
      } else setMsg("❌ " + res.error);
    } catch { setMsg("❌ บันทึกไม่สำเร็จ · ลองใหม่"); }
    finally { setBusy(false); }
  };

  const toggleBtn = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1, minHeight: 44, padding: "10px 8px", borderRadius: 12, cursor: "pointer",
    fontFamily: MITR, fontWeight: 600, fontSize: 16, border: `1.5px solid ${active ? color : LINE}`,
    background: active ? color : "#fff", color: active ? "#fff" : MUTED,
  });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ประเภทการตรวจ */}
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: 18, display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>ตรวจอะไร</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => switchType("safety")} style={toggleBtn(checkType === "safety", BLUE)}>🛡️ ความปลอดภัยเครื่องเล่น</button>
            <button type="button" onClick={() => switchType("cleaning")} style={toggleBtn(checkType === "cleaning", BLUE)}>🧼 ทำความสะอาด</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>ช่วงเวลา</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setShiftLabel("เปิดร้าน")} style={toggleBtn(shiftLabel === "เปิดร้าน", GREEN)}>🌅 เปิดร้าน</button>
            <button type="button" onClick={() => setShiftLabel("ปิดร้าน")} style={toggleBtn(shiftLabel === "ปิดร้าน", GREEN)}>🌙 ปิดร้าน</button>
          </div>
        </div>
      </div>

      {/* รายการเช็ก */}
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 14, color: MUTED }}>รายการตรวจ ({items.length} จุด)</div>
          {failCount > 0 && <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>พบปัญหา {failCount} จุด</div>}
        </div>
        <div style={{ border: `1px solid #f2ebdd`, borderRadius: 12, overflow: "hidden" }}>
          {items.map((it, i) => (
            <div key={it.label} style={{ padding: "12px 14px", borderBottom: i < items.length - 1 ? "1px solid #f2ebdd" : "none", background: it.ok ? "#fff" : "#fdf3f2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{it.label}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => setOk(i, true)} aria-label="ผ่าน" style={{ width: 44, height: 44, borderRadius: 10, cursor: "pointer", fontSize: 18, border: `1.5px solid ${it.ok ? GREEN : LINE}`, background: it.ok ? GREEN : "#fff", color: it.ok ? "#fff" : "#cfc4b2" }}>✓</button>
                  <button type="button" onClick={() => setOk(i, false)} aria-label="ไม่ผ่าน" style={{ width: 44, height: 44, borderRadius: 10, cursor: "pointer", fontSize: 18, border: `1.5px solid ${!it.ok ? RED : LINE}`, background: !it.ok ? RED : "#fff", color: !it.ok ? "#fff" : "#cfc4b2" }}>✗</button>
                </div>
              </div>
              {!it.ok && (
                <input value={it.note} onChange={(e) => setItemNote(i, e.target.value)} placeholder="ระบุปัญหาที่พบ เช่น สายพานหลวม / พื้นลื่น" style={{ ...input, marginTop: 10, fontSize: 16, borderColor: "#f0cfc9" }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* โน้ตรวม */}
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>หมายเหตุเพิ่มเติม (ไม่บังคับ)</div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น แจ้งช่างมาดูสายพานพรุ่งนี้" style={input} />
      </div>

      {msg && <div style={{ borderRadius: 10, padding: "12px 16px", fontSize: 15, background: msg.startsWith("✓") ? "#eaf3eb" : "#fdecea", color: msg.startsWith("✓") ? GREEN : "#c0392b" }}>{msg}</div>}
      <button onClick={submit} disabled={busy} style={{ background: BLUE, color: "#fff", border: "none", borderRadius: 14, padding: 16, fontFamily: MITR, fontWeight: 500, fontSize: 18, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? "กำลังบันทึก…" : failCount === 0 ? "บันทึกผลตรวจ · ผ่านทุกจุด" : `บันทึกผลตรวจ · พบปัญหา ${failCount} จุด`}
      </button>
      <div style={{ fontSize: 12, color: MUTED, textAlign: "center", fontFamily: FREDOKA }}>บันทึกแล้วแก้ไม่ได้ · เก็บเป็นหลักฐานเคลมประกัน</div>
    </div>
  );
}
