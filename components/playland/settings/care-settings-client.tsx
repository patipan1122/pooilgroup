"use client";

// Playland · ตั้งค่าเช็กลิสต์ "ความปลอดภัย" ต่อสาขา — สไตล์ Play a lot · พื้นขาว · น้ำเงิน #2D6CB1
// แก้รายการตรวจ (เพิ่ม/ลบ/เลื่อนขึ้น-ลง) → กดบันทึก → เรียก updateSafetyChecklist
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSafetyChecklist } from "@/lib/playland/safety";
import { ShieldCheck, PlusCircle, Trash2, ArrowUp, ArrowDown, RotateCcw, CheckCircle2, AlertCircle } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const inp: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, fontFamily: MITR, color: INK, background: "#fff", outline: "none", boxSizing: "border-box" };
const MAX_ITEMS = 40;
const MAX_LEN = 120;

export function CareSettingsClient({
  branchId,
  branchName,
  initialItems,
  defaultItems,
}: {
  branchId: string;
  branchName: string;
  initialItems: string[];
  defaultItems: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [items, setItems] = useState<string[]>(initialItems.length > 0 ? initialItems : defaultItems);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const setAt = (i: number, v: string) => setItems((xs) => xs.map((x, idx) => (idx === i ? v.slice(0, MAX_LEN) : x)));
  const remove = (i: number) => { setItems((xs) => xs.filter((_, idx) => idx !== i)); setMsg(null); };
  const add = () => { if (items.length >= MAX_ITEMS) { setMsg({ kind: "err", text: `เพิ่มได้สูงสุด ${MAX_ITEMS} ข้อ` }); return; } setItems((xs) => [...xs, ""]); setMsg(null); };
  const move = (i: number, dir: -1 | 1) => setItems((xs) => {
    const j = i + dir;
    if (j < 0 || j >= xs.length) return xs;
    const next = [...xs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const resetDefault = () => { setItems(defaultItems); setMsg(null); };

  const save = () => {
    const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 0);
    if (cleaned.length === 0) { setMsg({ kind: "err", text: "ต้องมีรายการตรวจอย่างน้อย 1 ข้อ" }); return; }
    start(async () => {
      const res = await updateSafetyChecklist({ branchId, items: cleaned });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setItems(cleaned);
      setMsg({ kind: "ok", text: `บันทึกแล้ว · ${res.data.count} รายการ` });
      router.refresh();
    });
  };

  return (
    <div style={{ fontFamily: MITR, color: INK, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontFamily: FREDOKA, fontSize: "1.05rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={18} color={BLUE} /> เช็กลิสต์ความปลอดภัย
          <span style={{ fontFamily: MONO, fontSize: 13, color: MUTED, fontWeight: 400 }}>{branchName}</span>
        </h2>
        <button type="button" onClick={resetDefault} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, background: "#fff", color: MUTED, cursor: "pointer", fontFamily: MITR }}>
          <RotateCcw size={14} /> ใช้ค่าตั้งต้น
        </button>
      </div>

      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>
        รายการนี้จะแสดงให้พนักงานติ๊ก ✓/✗ ตอนตรวจก่อนเปิด-ปิดร้าน · ตั้งทีละสาขา (สาขานี้: <b style={{ color: INK }}>{branchName}</b>)
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 11, marginBottom: 14, background: msg.kind === "ok" ? "#eaf3eb" : "#fdeceb", color: msg.kind === "ok" ? GREEN : RED, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}
        </div>
      )}

      <div style={{ ...card, padding: 16, display: "grid", gap: 9 }}>
        {items.length === 0 && (
          <div style={{ color: MUTED, fontSize: 13, padding: "10px 0" }}>ยังไม่มีรายการ · กด “เพิ่มรายการ” ด้านล่าง</div>
        )}
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: MUTED, width: 22, textAlign: "right", flexShrink: 0 }}>{i + 1}.</span>
            <input
              value={it}
              maxLength={MAX_LEN}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder="เช่น น็อต/สกรูเครื่องเล่นแน่น"
              style={inp}
            />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="เลื่อนขึ้น" style={iconBtn(i === 0)}><ArrowUp size={15} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="เลื่อนลง" style={iconBtn(i === items.length - 1)}><ArrowDown size={15} /></button>
            <button type="button" onClick={() => remove(i)} aria-label="ลบ" style={{ ...iconBtn(false), color: RED, borderColor: "#f0cfc9" }}><Trash2 size={15} /></button>
          </div>
        ))}

        <button type="button" onClick={add} style={{ marginTop: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: `1.5px dashed ${LINE}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, background: "#fbfbf9", color: BLUE, cursor: "pointer", fontFamily: MITR }}>
          <PlusCircle size={16} /> เพิ่มรายการ
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <button type="button" onClick={save} disabled={pending} style={{ border: "none", borderRadius: 12, padding: "12px 28px", fontSize: 15, fontWeight: 600, background: BLUE, color: "#fff", cursor: pending ? "wait" : "pointer", fontFamily: MITR, opacity: pending ? 0.6 : 1 }}>
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>{items.filter((x) => x.trim()).length} รายการ</span>
      </div>
    </div>
  );
}

const iconBtn = (disabled: boolean): React.CSSProperties => ({
  width: 36, height: 36, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: `1px solid ${LINE}`, borderRadius: 9, background: "#fff", color: disabled ? "#cfc4b2" : MUTED,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
});
