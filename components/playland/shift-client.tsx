"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openShift, closeShift } from "@/lib/playland/actions";
import { thb, fmtDateTime } from "@/lib/playland/format";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";

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

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · ปิดกะ/ปิดวัน · {branchName}</div>
          <h1>{open ? `กะที่เปิดอยู่ · ${open.shiftCode}` : "ไม่มีกะที่เปิดอยู่"}</h1>
        </div>
      </header>

      {msg && (
        <div style={{ padding: "8px 16px", background: msg.kind === "ok" ? "#dcfce7" : "#fee2e2", color: msg.kind === "ok" ? "#166534" : "#991b1b", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}
        </div>
      )}

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {!open ? (
          <div className="pl-card">
            <div className="pl-eyebrow" style={{ marginBottom: 8 }}>เปิดกะใหม่</div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>เงินเริ่มต้นใน drawer (บาท)</label>
            <input className="pl-input" type="number" inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
            <button className="pl-btn pl-btn-primary" onClick={doOpen} disabled={pending} style={{ marginTop: 10, width: "100%" }}>
              <Clock size={14} /> เปิดกะ
            </button>
          </div>
        ) : (
          <div className="pl-card">
            <div className="pl-eyebrow" style={{ marginBottom: 8 }}>กะปัจจุบัน</div>
            <div style={{ display: "grid", gap: 6, fontSize: 14, marginBottom: 12 }}>
              <div><span style={{ color: "var(--pl-text-muted)" }}>เปิดเมื่อ:</span> {fmtDateTime(open.startedAt)}</div>
              <div><span style={{ color: "var(--pl-text-muted)" }}>เริ่มต้นเงิน:</span> {thb(open.openingCashCents)}</div>
              <div><span style={{ color: "var(--pl-text-muted)" }}>ยอดขายในกะ:</span> {thb(open.totalSalesCents)}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}><span style={{ color: "var(--pl-text-muted)", fontSize: 12, fontWeight: 400 }}>คาดว่าใน drawer:</span> {thb(expected)}</div>
            </div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>นับเงินจริงใน drawer (บาท)</label>
            <input className="pl-input" type="number" inputMode="decimal" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} placeholder="เช่น 5230" />
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 8, display: "block" }}>โน้ต (ถ้ามี)</label>
            <textarea className="pl-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            <label style={{ display: "block", fontSize: 13, marginTop: 8 }}>
              <input type="checkbox" checked={isDayClose} onChange={(e) => setIsDayClose(e.target.checked)} style={{ marginRight: 6 }} />
              นี่คือ "ปิดวัน" (กะสุดท้ายของวัน)
            </label>
            <button className="pl-btn pl-btn-primary" onClick={doClose} disabled={pending} style={{ marginTop: 12, width: "100%" }}>
              {isDayClose ? "ปิดวัน" : "ปิดกะ"} · {closingCash ? thb(Math.round(parseFloat(closingCash) * 100)) : "—"}
            </button>
          </div>
        )}

        <div className="pl-card">
          <div className="pl-eyebrow" style={{ marginBottom: 8 }}>กะล่าสุด</div>
          {recent.length === 0 ? (
            <div className="pl-empty">ยังไม่มีกะ</div>
          ) : (
            <table className="pl-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>กะ</th>
                  <th>เริ่ม</th>
                  <th>สิ้น</th>
                  <th>ขาย</th>
                  <th>variance</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.shiftCode}</div>
                      {r.isDayClose && <span className="pl-chip pl-chip-brand">ปิดวัน</span>}
                    </td>
                    <td>{fmtDateTime(r.startedAt)}</td>
                    <td>{r.endedAt ? fmtDateTime(r.endedAt) : <span className="pl-chip pl-chip-ok">เปิดอยู่</span>}</td>
                    <td>{thb(r.totalSalesCents)}</td>
                    <td style={{ color: r.varianceCents === null ? "var(--pl-text-muted)" : r.varianceCents === 0 ? "var(--pl-ok)" : r.varianceCents > 0 ? "var(--pl-info)" : "var(--pl-danger)" }}>
                      {r.varianceCents === null ? "—" : r.varianceCents === 0 ? "ตรง" : (r.varianceCents > 0 ? "+" : "") + thb(r.varianceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
