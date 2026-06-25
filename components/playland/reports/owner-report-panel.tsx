"use client";

// Playland · รายงานเจ้าของ (P&L) — แผงจัดการต้นทุน: รายการ + เพิ่มเอง + AI ช่วยกรอก + ลบ
// embed ใน owner view ของ reports/page.tsx · server คำนวณยอดเฉลี่ยต่อช่วงมาให้แล้ว (allocatedCents)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addExpense, deleteExpense, aiParseExpenses, EXPENSE_KINDS, type ParsedExpense } from "@/lib/playland/expenses";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";

const KIND_LABEL: Record<string, string> = {
  labor: "ค่าแรง/พนักงาน", electricity: "ค่าไฟ", rent: "ค่าเช่า", water: "ค่าน้ำ",
  supplies: "วัสดุ/ของใช้", marketing: "โฆษณา", other: "อื่นๆ",
};

const thb = (cents: number) => `฿${(cents / 100).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export interface ExpenseRow {
  id: string;
  kind: string;
  label: string | null;
  amountCents: number;      // ยอดเต็มของรายการ (เช่น ค่าเช่า/เดือน)
  allocatedCents: number;   // ยอดที่เฉลี่ยมาในช่วง [from,to] (server คิดให้)
  staffCount: number | null;
  period: "once" | "monthly";
}

interface Props {
  branchId: string;
  defaultDate: string; // YYYY-MM-DD (= to)
  expenses: ExpenseRow[];
}

const inputStyle: React.CSSProperties = {
  width: "100%", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px",
  fontSize: 16, fontFamily: MITR, color: INK, background: "#fff", outline: "none",
};
const labelStyle: React.CSSProperties = { fontSize: 12.5, color: MUTED, marginBottom: 5, display: "block" };

export function OwnerReportPanel({ branchId, defaultDate, expenses }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ── ฟอร์มเพิ่มเอง (ซ่อนไว้หลังปุ่ม "+ เพิ่มข้อมูล" → รายงานอ่านสะอาด) ──
  const [showAdd, setShowAdd] = useState(false);
  const [mode, setMode] = useState<"form" | "ai">("form");

  const [kind, setKind] = useState<string>("labor");
  const [amount, setAmount] = useState("");
  const [staffCount, setStaffCount] = useState("");
  const [period, setPeriod] = useState<"once" | "monthly">("once");
  const [label, setLabel] = useState("");

  // ── AI ช่วยกรอก ──
  const [aiText, setAiText] = useState("");
  const [aiItems, setAiItems] = useState<ParsedExpense[] | null>(null);
  const [aiBusy, startAi] = useTransition();

  function resetForm() {
    setKind("labor"); setAmount(""); setStaffCount(""); setPeriod("once"); setLabel("");
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const baht = Number(amount);
    if (!Number.isFinite(baht) || baht <= 0) { alert("ใส่จำนวนเงินให้ถูกต้อง"); return; }
    const sc = kind === "labor" && staffCount ? Number(staffCount) : undefined;
    startTransition(async () => {
      const res = await addExpense({
        branchId, expenseDate: defaultDate, kind,
        amountCents: Math.round(baht * 100),
        staffCount: sc != null && Number.isFinite(sc) && sc > 0 ? Math.round(sc) : undefined,
        period, label: label.trim() || undefined,
      });
      if (res.ok) { resetForm(); setShowAdd(false); router.refresh(); }
      else alert(res.error || "บันทึกไม่สำเร็จ");
    });
  }

  function runAi() {
    if (!aiText.trim()) { alert("พิมพ์ข้อความก่อน"); return; }
    setAiItems(null);
    startAi(async () => {
      const res = await aiParseExpenses({ branchId, text: aiText });
      if (res.ok) setAiItems(res.data.items);
      else alert(res.error || "AI แยกรายการไม่ได้");
    });
  }

  function saveAllAi() {
    if (!aiItems || aiItems.length === 0) return;
    startTransition(async () => {
      for (const it of aiItems) {
        const res = await addExpense({
          branchId, expenseDate: defaultDate, kind: it.kind,
          amountCents: it.amountCents, staffCount: it.staffCount,
          period: it.period, label: it.label || undefined,
        });
        if (!res.ok) { alert(`บันทึก "${it.label || it.kind}" ไม่สำเร็จ: ${res.error}`); return; }
      }
      setAiItems(null); setAiText(""); setShowAdd(false); router.refresh();
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`ลบ "${name}" ?`)) return;
    startTransition(async () => {
      const res = await deleteExpense(id);
      if (res.ok) router.refresh();
      else alert(res.error || "ลบไม่สำเร็จ");
    });
  }

  const totalAllocated = expenses.reduce((m, e) => m + e.allocatedCents, 0);

  return (
    <div style={{ fontFamily: MITR, color: INK }}>
      {/* ── รายการต้นทุน (รายการจริงในช่วงนี้) ── */}
      {expenses.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 14, padding: "10px 0" }}>ยังไม่มีรายการต้นทุนในช่วงนี้ — กด “+ เพิ่มข้อมูล” เพื่อกรอก</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {expenses.map((e) => {
            const name = e.label?.trim() || KIND_LABEL[e.kind] || e.kind;
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid #f2ebdd` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{KIND_LABEL[e.kind] || e.kind}</span>
                    {e.kind === "labor" && e.staffCount != null && (
                      <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>{e.staffCount} คน</span>
                    )}
                    <span style={badge(e.period === "monthly" ? BLUE : MUTED, e.period === "monthly" ? "#eaf3f6" : "#f4f0e8")}>
                      {e.period === "monthly" ? "รายเดือน" : "ครั้งเดียว"}
                    </span>
                  </div>
                  {e.label?.trim() && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{e.label}</div>}
                  {e.period === "monthly" && (
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2, fontFamily: MONO }}>
                      {thb(e.amountCents)}/เดือน → {thb(e.allocatedCents)} ในช่วงนี้
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", fontFamily: MONO, fontWeight: 700, fontSize: 15, color: RED, whiteSpace: "nowrap" }}>
                  {thb(e.allocatedCents)}
                </div>
                <button
                  onClick={() => onDelete(e.id, name)}
                  disabled={pending}
                  title="ลบรายการ"
                  style={{ border: `1px solid ${LINE}`, background: "#fff", color: RED, borderRadius: 8, padding: "6px 9px", cursor: pending ? "default" : "pointer", fontSize: 14, lineHeight: 1 }}
                >🗑</button>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0 2px", borderTop: `2px solid ${LINE}`, fontWeight: 700 }}>
            <span style={{ fontFamily: FREDOKA }}>รวมต้นทุน (เฉลี่ยในช่วงนี้)</span>
            <span style={{ fontFamily: MONO, color: RED }}>{thb(totalAllocated)}</span>
          </div>
        </div>
      )}

      {/* ── ปุ่มสลับฟอร์มเพิ่ม ── */}
      <div style={{ marginTop: 14 }}>
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ เพิ่มข้อมูล</button>
        ) : (
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, background: "#fbfaf7" }}>
            {/* tab: กรอกเอง / AI */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => setMode("form")} style={tabBtn(mode === "form")}>กรอกเอง</button>
              <button onClick={() => setMode("ai")} style={tabBtn(mode === "ai")}>🤖 AI ช่วยกรอก</button>
              <button onClick={() => { setShowAdd(false); setAiItems(null); }} style={{ ...tabBtn(false), marginLeft: "auto", color: MUTED }}>ปิด</button>
            </div>

            {mode === "form" ? (
              <form onSubmit={submitForm} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>ประเภท</label>
                    <select value={kind} onChange={(ev) => setKind(ev.target.value)} style={inputStyle}>
                      {EXPENSE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>จำนวนเงิน (บาท)</label>
                    <input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0" style={inputStyle} />
                  </div>
                </div>
                {kind === "labor" && (
                  <div>
                    <label style={labelStyle}>จำนวนพนักงาน (คน)</label>
                    <input type="number" inputMode="numeric" min="0" step="1" value={staffCount} onChange={(ev) => setStaffCount(ev.target.value)} placeholder="เช่น 4" style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>รอบจ่าย</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => setPeriod("once")} style={toggleBtn(period === "once")}>ครั้งเดียว</button>
                    <button type="button" onClick={() => setPeriod("monthly")} style={toggleBtn(period === "monthly")}>รายเดือน</button>
                  </div>
                  {period === "monthly" && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>* รายเดือน = ระบบจะเฉลี่ยหารต่อวันให้ตามจำนวนวันในเดือน</div>}
                </div>
                <div>
                  <label style={labelStyle}>หมายเหตุ / ชื่อรายการ (ไม่บังคับ)</label>
                  <input type="text" value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="เช่น ค่าเช่าตึก, ค่าแรงพิเศษ" style={inputStyle} />
                </div>
                <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
                  {pending ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </form>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <textarea
                  value={aiText}
                  onChange={(ev) => setAiText(ev.target.value)}
                  rows={3}
                  placeholder="เช่น พนักงาน 4 คน ค่าแรงวันนี้ 2000 ค่าไฟเดือนนี้ 8000 ค่าเช่า 30000"
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
                <button onClick={runAi} disabled={aiBusy} style={{ ...primaryBtn, opacity: aiBusy ? 0.6 : 1 }}>
                  {aiBusy ? "AI กำลังแยกรายการ…" : "ให้ AI แยกรายการ"}
                </button>

                {aiItems && (
                  <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, background: "#fff" }}>
                    <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 8 }}>AI แยกได้ {aiItems.length} รายการ — ตรวจก่อนบันทึก</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {aiItems.map((it, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                          <span style={{ fontWeight: 600 }}>{KIND_LABEL[it.kind] || it.kind}</span>
                          {it.kind === "labor" && it.staffCount != null && <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>{it.staffCount} คน</span>}
                          <span style={badge(it.period === "monthly" ? BLUE : MUTED, it.period === "monthly" ? "#eaf3f6" : "#f4f0e8")}>{it.period === "monthly" ? "รายเดือน" : "ครั้งเดียว"}</span>
                          {it.label && <span style={{ fontSize: 12, color: MUTED }}>{it.label}</span>}
                          <span style={{ marginLeft: "auto", fontFamily: MONO, fontWeight: 700, color: RED }}>{thb(it.amountCents)}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={saveAllAi} disabled={pending} style={{ ...primaryBtn, marginTop: 12, width: "100%", opacity: pending ? 0.6 : 1 }}>
                      {pending ? "กำลังบันทึก…" : `บันทึกทั้งหมด (${aiItems.length})`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function badge(color: string, bg: string): React.CSSProperties {
  return { display: "inline-block", fontSize: 11, fontWeight: 600, color, background: bg, borderRadius: 999, padding: "2px 9px" };
}
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none",
  background: BLUE, color: "#fff", borderRadius: 10, padding: "11px 18px", fontSize: 15, fontWeight: 600,
  cursor: "pointer", fontFamily: MITR,
};
function tabBtn(active: boolean): React.CSSProperties {
  return { border: `1px solid ${active ? BLUE : LINE}`, background: active ? BLUE : "#fff", color: active ? "#fff" : INK,
    borderRadius: 9, padding: "7px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: MITR };
}
function toggleBtn(active: boolean): React.CSSProperties {
  return { flex: 1, border: `1px solid ${active ? BLUE : LINE}`, background: active ? "#eaf3f6" : "#fff", color: active ? BLUE : MUTED,
    borderRadius: 9, padding: "10px 12px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: MITR };
}
