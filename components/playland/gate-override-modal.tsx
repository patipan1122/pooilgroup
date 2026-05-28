"use client";

// Manual gate override modal · anti-fraud · /bigfeature Phase A
// Mandatory webcam snapshot + reason before opening gate.
// Per [[playland-manual-override-antifraud]]: every press logged with who/why/photo.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FaceCapture } from "./face-capture";
import { manualGateOverride, type OverrideReason } from "@/lib/playland/gate-override";
import { ShieldAlert, X, DoorOpen, AlertCircle, CheckCircle2 } from "lucide-react";

const REASON_LABELS: Record<OverrideReason, string> = {
  QR_DAMAGED: "QR เปียก/ขาด/อ่านไม่ออก",
  NET_SLOW: "ระบบช้า · ลูกค้ารอนาน",
  CHILD_EMERGENCY: "เด็กฉุกเฉิน",
  VIP_STAFF: "VIP / พนักงาน",
  OTHER: "อื่นๆ (พิมพ์เหตุผล)",
};

export function GateOverrideModal({
  branchId,
  wristbandCode,
  onClose,
}: {
  branchId: string;
  wristbandCode?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [reason, setReason] = useState<OverrideReason>("QR_DAMAGED");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function submit() {
    if (!snapshot) { setMsg({ kind: "err", text: "ต้องถ่ายรูปก่อน (กันทุจริต)" }); return; }
    if (reason === "OTHER" && !note.trim()) { setMsg({ kind: "err", text: "เลือก 'อื่นๆ' ต้องพิมพ์เหตุผล" }); return; }
    start(async () => {
      const res = await manualGateOverride({
        branchId,
        reason,
        reasonNote: note.trim() || undefined,
        snapshotDataUrl: snapshot,
        wristbandCode,
      });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({
        kind: "ok",
        text: res.data.gateOpened
          ? "เปิดประตูแล้ว · บันทึก + ถ่ายรูปเก็บเรียบร้อย"
          : "บันทึก + ถ่ายรูปแล้ว · ⚠️ สั่งเปิดประตูอัตโนมัติไม่ได้ · เปิดที่เครื่องเอง",
      });
      router.refresh();
      setTimeout(onClose, 1600);
    });
  }

  return (
    <div
      onClick={() => !pending && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 16, zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="pl-card"
        style={{ maxWidth: 460, width: "100%", display: "grid", gap: 14, padding: 18, background: "white", maxHeight: "92vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldAlert size={20} color="var(--pl-danger-ink)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.2rem", fontWeight: 600 }}>เปิดประตูเอง (Override)</div>
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ทุกครั้งถ่ายรูป + บันทึกชื่อคนกด · กันทุจริต</div>
          </div>
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={onClose} disabled={pending}><X size={16} /></button>
        </div>

        {msg && (
          <div className="pl-card" style={{
            background: msg.kind === "ok" ? "var(--pl-ok-soft)" : "var(--pl-danger-soft)",
            color: msg.kind === "ok" ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)",
            display: "flex", gap: 8, alignItems: "center", fontSize: 13,
          }}>
            {msg.kind === "ok" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {msg.text}
          </div>
        )}

        {/* MANDATORY snapshot */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: "var(--pl-danger-ink)" }}>*</span> ถ่ายรูปคนที่จะเข้า (บังคับ)
          </div>
          <FaceCapture value={snapshot} onChange={setSnapshot} label="" />
        </div>

        {/* Reason */}
        <div>
          <label className="pl-label">เหตุผล</label>
          <div style={{ display: "grid", gap: 4 }}>
            {(Object.keys(REASON_LABELS) as OverrideReason[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="pl-card"
                style={{
                  textAlign: "left", padding: "8px 10px", cursor: "pointer", fontSize: 13,
                  border: reason === r ? "2px solid var(--pl-brand)" : "1px solid var(--pl-line)",
                  background: reason === r ? "var(--pl-brand-soft)" : "white",
                }}
              >
                {REASON_LABELS[r]}
              </button>
            ))}
          </div>
          {reason === "OTHER" && (
            <input
              className="pl-input"
              style={{ marginTop: 6 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="พิมพ์เหตุผล..."
              autoFocus
            />
          )}
        </div>

        <button
          type="button"
          className="pl-btn pl-btn-danger pl-btn-lg"
          onClick={submit}
          disabled={pending || !snapshot}
        >
          <DoorOpen size={16} /> {pending ? "กำลังเปิด..." : "ยืนยัน · เปิดประตู"}
        </button>
      </div>
    </div>
  );
}
