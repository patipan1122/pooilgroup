"use client";

// DC คลังกลาง · ตั้งค่า — เรตค่าขนส่งจีน-ไทย ต่อ 1 คิว (m³) แยกรถ(TRUCK)/เรือ(SEA) (#4)
// ใช้ server actions จาก @/lib/dc/freight-actions (import เข้า client ได้เพราะเป็น "use server"):
//   • getFreightRateSettings() → คืนเรตเป็น "สตางค์" → แปลงเป็นบาทเพื่อโชว์ (บาท = สตางค์/100)
//   • setFreightRate({mode,ratePerCbmSatang}) → ตอนเซฟคูณ 100 ปัดเป็นจำนวนเต็ม
// ค่าขนส่งคิดอัตโนมัติ = ปริมาตร CBM × เรตนี้ ตอนจ่ายเงิน + คิดต้นทุนนำเข้า.

import { useEffect, useState } from "react";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { getFreightRateSettings, setFreightRate } from "@/lib/dc/freight-actions";

type Mode = "TRUCK" | "SEA";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

// แปลงสตางค์ (จาก DB) → ข้อความบาท (โชว์ในช่อง)
function satangToBahtStr(satang: number): string {
  if (!Number.isFinite(satang) || satang <= 0) return "";
  return String(satang / 100);
}
// ข้อความบาท (จากช่อง) → สตางค์จำนวนเต็ม (ตอนเซฟ) · invalid/ติดลบ → null
function bahtStrToSatang(baht: string): number | null {
  const n = Number(baht.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function fmtBaht(satang: number): string {
  return (satang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MODE_META: Record<Mode, { label: string; emoji: string; hint: string }> = {
  TRUCK: { label: "รถ (ทางบก)", emoji: "🚚", hint: "ขนส่งทางรถข้ามแดนจีน–ไทย" },
  SEA: { label: "เรือ (ทางทะเล)", emoji: "🚢", hint: "ขนส่งทางเรือ ตู้คอนเทนเนอร์" },
};

export default function DcSettingsPage() {
  const [loading, setLoading] = useState(true);
  // ค่าในช่อง = ข้อความบาท (ผู้ใช้กรอก/แก้)
  const [truck, setTruck] = useState("");
  const [sea, setSea] = useState("");
  // เรตที่บันทึกล่าสุด (สตางค์) — ไว้โชว์สรุป/ตัวอย่างคำนวณ
  const [savedTruckSatang, setSavedTruckSatang] = useState(0);
  const [savedSeaSatang, setSavedSeaSatang] = useState(0);
  const [save, setSave] = useState<Record<Mode, SaveState>>({
    TRUCK: { kind: "idle" },
    SEA: { kind: "idle" },
  });

  useEffect(() => {
    let alive = true;
    getFreightRateSettings()
      .then((r) => {
        if (!alive) return;
        setTruck(satangToBahtStr(r.truckPerCbmSatang));
        setSea(satangToBahtStr(r.seaPerCbmSatang));
        setSavedTruckSatang(r.truckPerCbmSatang);
        setSavedSeaSatang(r.seaPerCbmSatang);
      })
      .catch(() => {
        if (alive) setSave((s) => ({ ...s, TRUCK: { kind: "error", message: "โหลดเรตไม่สำเร็จ" } }));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function onSave(mode: Mode) {
    const value = mode === "TRUCK" ? truck : sea;
    const satang = bahtStrToSatang(value);
    if (satang === null) {
      setSave((s) => ({ ...s, [mode]: { kind: "error", message: "กรอกตัวเลขบาทที่ไม่ติดลบ" } }));
      return;
    }
    setSave((s) => ({ ...s, [mode]: { kind: "saving" } }));
    try {
      const res = await setFreightRate({ mode, ratePerCbmSatang: satang });
      if (res.ok) {
        if (mode === "TRUCK") setSavedTruckSatang(satang);
        else setSavedSeaSatang(satang);
        setSave((s) => ({ ...s, [mode]: { kind: "ok" } }));
      } else {
        setSave((s) => ({ ...s, [mode]: { kind: "error", message: res.error } }));
      }
    } catch {
      setSave((s) => ({ ...s, [mode]: { kind: "error", message: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" } }));
    }
  }

  return (
    <DcOfficeShell active="reports">
      <div className="dcx" style={{ display: "block" }}>
        {/* header */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ตั้งค่า · เรตค่าขนส่ง</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            ใช้คิดค่าขนส่งอัตโนมัติ = ปริมาตร CBM × เรตนี้ ตอนจ่ายเงินและคิดต้นทุนนำเข้า
          </p>
        </div>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 14, padding: "32px 0" }}>กำลังโหลดเรต…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {(["TRUCK", "SEA"] as Mode[]).map((mode) => {
              const meta = MODE_META[mode];
              const value = mode === "TRUCK" ? truck : sea;
              const setValue = mode === "TRUCK" ? setTruck : setSea;
              const st = save[mode];
              const savedSatang = mode === "TRUCK" ? savedTruckSatang : savedSeaSatang;
              return (
                <div key={mode} className="dc-card" style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: 18, boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 22 }} aria-hidden>{meta.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{meta.label}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{meta.hint}</div>
                    </div>
                  </div>

                  <label htmlFor={`rate-${mode}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink2)", margin: "14px 0 6px" }}>
                    เรตต่อ 1 คิว (m³)
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 13px" }}>
                    <input
                      id={`rate-${mode}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        if (st.kind !== "idle") setSave((s) => ({ ...s, [mode]: { kind: "idle" } }));
                      }}
                      placeholder="0.00"
                      className="num"
                      style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, fontWeight: 700, fontFamily: "inherit", color: "var(--ink)", minWidth: 0 }}
                    />
                    <span style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>บาท / คิว</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSave(mode)}
                    disabled={st.kind === "saving"}
                    style={{
                      marginTop: 14, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                      background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 16px",
                      fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                      cursor: st.kind === "saving" ? "default" : "pointer", opacity: st.kind === "saving" ? 0.7 : 1,
                      boxShadow: "0 2px 6px rgba(31,79,214,.25)",
                    }}
                  >
                    {st.kind === "saving" ? "กำลังบันทึก…" : "บันทึกเรต"}
                  </button>

                  {/* feedback */}
                  {st.kind === "ok" ? (
                    <div style={{ marginTop: 10, fontSize: 13, color: "#1F8A55", background: "#E1F0E8", border: "1px solid #C7E4D4", borderRadius: 9, padding: "8px 12px" }}>
                      ✓ บันทึกแล้ว
                    </div>
                  ) : st.kind === "error" ? (
                    <div style={{ marginTop: 10, fontSize: 13, color: "#B45309", background: "#FEF1DE", border: "1px solid #F3D9C0", borderRadius: 9, padding: "8px 12px" }}>
                      {st.message}
                    </div>
                  ) : null}

                  {/* ตัวอย่างคำนวณจากเรตที่บันทึกล่าสุด */}
                  {savedSatang > 0 ? (
                    <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                      ตัวอย่าง: ของ 2.5 คิว × {fmtBaht(savedSatang)} บาท ={" "}
                      <b style={{ color: "var(--ink2)" }}>{fmtBaht(savedSatang * 2.5)} บาท</b>
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>ยังไม่ได้ตั้งเรต — กรอกแล้วกดบันทึก</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DcOfficeShell>
  );
}
