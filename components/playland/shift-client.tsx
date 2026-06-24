"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openShift, closeShift } from "@/lib/playland/actions";
import { thb, fmtDateTime } from "@/lib/playland/format";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)", padding: 22 };
const fieldLabel: React.CSSProperties = { fontSize: 12, color: MUTED, marginBottom: 4, display: "block" };
const input: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 12px", fontSize: 14, fontFamily: MITR, color: INK, background: "#fff", outline: "none", boxSizing: "border-box" };

interface OpenShift {
  id: string;
  shiftCode: string;
  startedAt: string;
  openingCashCents: number;
  totalSalesCents: number;
}

interface Recent {
  id: string;
  shiftCode: string;
  cashierUserId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  openingCashCents: number;
  closingCashCents: number | null;
  totalSalesCents: number;
  varianceCents: number | null;
  isDayClose: boolean;
}

export function ShiftClient({ branchId, branchName, openShift: open, recent }: { branchId: string; branchName: string; openShift: OpenShift | null; recent: Recent[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [isDayClose, setIsDayClose] = useState(false);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function doOpen() {
    start(async () => {
      const c = Math.round(parseFloat(openingCash || "0") * 100);
      const res = await openShift(branchId, c);
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: `เปิดกะแล้ว · เริ่มต้นเงิน ${thb(c)}` });
      router.refresh();
    });
  }

  function doClose() {
    if (!open) return;
    start(async () => {
      const c = Math.round(parseFloat(closingCash || "0") * 100);
      const res = await closeShift({ shiftId: open.id, closingCashCents: c, isDayClose, notes: notes || undefined });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      const v = res.data.varianceCents;
      const verb = v > 0 ? "เกิน" : v < 0 ? "ขาด" : "ตรง";
      setMsg({ kind: "ok", text: `ปิดกะแล้ว · ${verb}${v !== 0 ? ` ${thb(Math.abs(v))}` : ""}${isDayClose ? " (ปิดวัน)" : ""}` });
      setClosingCash("");
      setNotes("");
      setIsDayClose(false);
      router.refresh();
    });
  }

  const expected = open ? open.openingCashCents + open.totalSalesCents : 0;
  const countedCents = closingCash ? Math.round(parseFloat(closingCash) * 100) : null;
  const diffCents = countedCents != null ? countedCents - expected : null;

  return (
    <div style={{ fontFamily: MITR, color: INK }}>
      {msg && (
        <div style={{ padding: "10px 16px", borderRadius: 11, marginBottom: 16, background: msg.kind === "ok" ? "#eaf3eb" : "#fdeceb", color: msg.kind === "ok" ? GREEN : RED, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{msg.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "start" }}>
        {/* เปิด/ปิดกะ */}
        {!open ? (
          <div style={card}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4, fontFamily: FREDOKA }}>เปิดกะใหม่</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>{branchName}</div>
            <label style={fieldLabel}>เงินเริ่มต้นในลิ้นชัก (บาท)</label>
            <input style={input} type="number" inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
            <button onClick={doOpen} disabled={pending} style={{ ...primaryBtn, marginTop: 12, opacity: pending ? 0.6 : 1 }}>
              <Clock size={15} /> เปิดกะ
            </button>
          </div>
        ) : (
          <div style={card}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4, fontFamily: FREDOKA }}>กะปัจจุบัน · {open.shiftCode}</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>{branchName}</div>
            <div style={{ display: "grid", gap: 8, fontSize: 14, marginBottom: 16 }}>
              <Row label="เปิดเมื่อ" value={fmtDateTime(open.startedAt)} />
              <Row label="เริ่มต้นเงิน" value={thb(open.openingCashCents)} mono />
              <Row label="ยอดขายในกะ" value={thb(open.totalSalesCents)} mono />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 8, borderTop: `1px solid #f2ebdd` }}>
                <span style={{ fontSize: 12, color: MUTED }}>คาดว่าในลิ้นชัก</span>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20 }}>{thb(expected)}</span>
              </div>
            </div>
            <label style={fieldLabel}>นับเงินจริงในลิ้นชัก (บาท)</label>
            <input style={input} type="number" inputMode="decimal" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} placeholder="เช่น 5230" />
            {diffCents != null && (
              <div style={{ marginTop: 8, fontSize: 13, fontFamily: MONO, color: diffCents === 0 ? GREEN : diffCents > 0 ? BLUE : RED }}>
                {diffCents === 0 ? "ตรงพอดี" : `${diffCents > 0 ? "เกิน" : "ขาด"} ${thb(Math.abs(diffCents))}`}
              </div>
            )}
            <label style={{ ...fieldLabel, marginTop: 12 }}>โน้ต (ถ้ามี)</label>
            <textarea style={{ ...input, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 10 }}>
              <input type="checkbox" checked={isDayClose} onChange={(e) => setIsDayClose(e.target.checked)} />
              นี่คือ "ปิดวัน" (กะสุดท้ายของวัน)
            </label>
            <button onClick={doClose} disabled={pending} style={{ ...primaryBtn, marginTop: 14, opacity: pending ? 0.6 : 1 }}>
              {isDayClose ? "ปิดวัน" : "ปิดกะ"} · {closingCash ? thb(Math.round(parseFloat(closingCash) * 100)) : "—"}
            </button>
          </div>
        )}

        {/* กะล่าสุด */}
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "18px 22px 12px" }}>
            <div style={{ fontWeight: 600, fontSize: 16, fontFamily: FREDOKA }}>กะล่าสุด</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{recent.length} กะล่าสุด · {branchName}</div>
          </div>
          {recent.length === 0 ? (
            <div style={{ padding: "30px 22px", color: MUTED, fontSize: 14, textAlign: "center" }}>ยังไม่มีกะ</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: MUTED, fontWeight: 500, textAlign: "left" }}>
                    <th style={th}>กะ</th>
                    <th style={th}>เริ่ม</th>
                    <th style={th}>สิ้นสุด</th>
                    <th style={{ ...th, textAlign: "right" }}>ขาย</th>
                    <th style={{ ...th, textAlign: "right" }}>ส่วนต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => {
                    const vColor = r.varianceCents === null ? MUTED : r.varianceCents === 0 ? GREEN : r.varianceCents > 0 ? BLUE : RED;
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid #f2ebdd` }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{r.shiftCode}</div>
                          {r.isDayClose && <span style={badge(BLUE, "#eaf3f6")}>ปิดวัน</span>}
                        </td>
                        <td style={{ ...td, color: MUTED }}>{fmtDateTime(r.startedAt)}</td>
                        <td style={td}>{r.endedAt ? <span style={{ color: MUTED }}>{fmtDateTime(r.endedAt)}</span> : <span style={badge(GREEN, "#eaf3eb")}>เปิดอยู่</span>}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>{thb(r.totalSalesCents)}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: MONO, color: vColor }}>
                          {r.varianceCents === null ? "—" : r.varianceCents === 0 ? "ตรง" : (r.varianceCents > 0 ? "+" : "") + thb(r.varianceCents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={mono ? { fontFamily: MONO } : undefined}>{value}</span>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 9, padding: "10px 16px", fontSize: 14, fontWeight: 600, background: BLUE, color: "#fff", border: "none", cursor: "pointer", fontFamily: MITR };
const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 500, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 14px", verticalAlign: "top" };
const badge = (color: string, bg: string): React.CSSProperties => ({ display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 600, color, background: bg, borderRadius: 999, padding: "2px 9px" });
