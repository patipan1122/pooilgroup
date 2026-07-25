"use client";

// ClawFleet · ตู้คีบ OS — ด่านนุ่ม "ตัวเลขไม่ตรง" (mobile)
// -----------------------------------------------------------------------------
// โผล่ "หลัง" submit แล้ว server คืน needsReason (คำนวณที่ server ไม่ใช่ client):
//   - SHORT (เงินขาด) → เลือกเหตุผล (ตุ๊กตาค้าง / เครื่องเสีย / อื่น) + โน้ต (ไม่บังคับ)
//   - INTEGRITY (มิเตอร์เสีย / ตัวเลขผิดธรรมชาติ · CEO 2026-07-25) → เลือกว่ามิเตอร์ตัวไหนเสีย
//       (บน/เฟือง · ล่าง/ดิจิตอล · ตุ๊กตาค้าง · อื่น) → บันทึกเงินที่นับจริง + ติดธงไว้ให้ผู้จัดการตรวจ
//   ทั้งคู่ "ไม่บล็อกแข็ง" — แค่ต้องระบุเหตุผลก่อนบันทึกผ่าน (signal ไม่ใช่ข้อหา).
//   ปุ่มบันทึก DISABLED จนกว่าจะเลือกเหตุผล → onConfirmShort(reason, note).
//   โทน neutral/amber "เป็นกลาง" — ไม่ใช่แดงกล่าวหา (memory: ห้ามทำแม่บ้านซื่อรู้สึกผิด).
// ⚪/amber tokens เท่านั้น · ไม่มีภาษาดีไซน์ใหม่.

import { useState } from "react";

type Reason = { value: string; label: string };

// เหตุผลเงินขาด (SHORT)
const SHORT_REASONS: Reason[] = [
  { value: "ตุ๊กตาค้าง", label: "ตุ๊กตาค้างในราง (ยังไม่ตก)" },
  { value: "เครื่องเสีย", label: "เครื่อง/มิเตอร์เสีย อ่านเพี้ยน" },
  { value: "อื่น", label: "อื่น ๆ (ระบุในโน้ต)" },
];

// เหตุผลมิเตอร์เสีย/ตัวเลขผิดธรรมชาติ (INTEGRITY) — CEO 2026-07-25 "ตัวไหนตรงเงิน = ตัวนั้นดี · อีกตัวเสีย"
const METER_REASONS: Reason[] = [
  { value: "มิเตอร์ล่างเสีย", label: "มิเตอร์ล่าง (ดิจิตอล) เสีย · อ่านเพี้ยน" },
  { value: "มิเตอร์บนเสีย", label: "มิเตอร์บน (เฟือง) เสีย · อ่านเพี้ยน" },
  { value: "ตุ๊กตาค้าง", label: "ตุ๊กตาค้างในราง (ยังไม่ตก)" },
  { value: "อื่น", label: "อื่น ๆ (ระบุในโน้ต)" },
];

export interface MismatchGateProps {
  /** ชนิดด่าน: SHORT = เงินขาด · INTEGRITY = มิเตอร์เสีย/ตัวเลขผิดธรรมชาติ */
  gateKind: "SHORT" | "INTEGRITY";
  /** ข้อความจาก server (เช่น "มิเตอร์เหรียญไม่ขยับแต่มีเงินสด") — โชว์ให้พนักงานรู้ว่าติดตรงไหน */
  message?: string;
  onConfirmShort: (reason: string, note: string) => void;
  /** ยกเลิก/ปิดด่าน (กลับไปแก้ตัวเลข) */
  onProceed: () => void;
}

export function MismatchGate({ gateKind, message, onConfirmShort, onProceed }: MismatchGateProps) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const isMeter = gateKind === "INTEGRITY";
  const reasons = isMeter ? METER_REASONS : SHORT_REASONS;
  const title = isMeter ? "ตัวเลขมิเตอร์ดูไม่สมเหตุผล" : "เงินที่นับได้ น้อยกว่าที่ระบบคาดไว้";
  const sub = isMeter
    ? `${message ? message + " — " : ""}เงินที่นับได้จะถูกบันทึกตามจริง ช่วยเลือกว่ามิเตอร์ตัวไหนเพี้ยน แล้วบันทึกต่อได้เลย`
    : "ไม่เป็นไร — เกิดได้หลายสาเหตุ ช่วยเลือกว่าน่าจะเพราะอะไร แล้วบันทึกต่อได้เลย";

  const canSubmit = reason !== "";
  return (
    <div
      style={{
        background: "#FCF8EC",
        border: "1px solid #F0E2BE",
        borderRadius: 14,
        padding: 15,
        marginTop: 4,
        display: "flex",
        flexDirection: "column",
        gap: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flex: "0 0 19px", marginTop: 1 }}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#7A5510" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#8A7A4E", marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5510", marginBottom: 6 }}>สาเหตุ (ต้องเลือก)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reasons.map((r) => {
            const on = reason === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setReason(r.value)}
                className="co-tap"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                  padding: "12px 13px",
                  borderRadius: 11,
                  cursor: "pointer",
                  border: on ? "2px solid #B45309" : "1.5px solid #E8DFC4",
                  background: on ? "#FCF1E2" : "#fff",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    flex: "0 0 20px",
                    borderRadius: "50%",
                    border: on ? "6px solid #B45309" : "2px solid #D8CBA6",
                    background: "#fff",
                    transition: "border .12s",
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? "#7A5510" : "#5A6270" }}>{r.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5510", marginBottom: 6 }}>โน้ตเพิ่มเติม (ไม่บังคับ)</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={isMeter ? "อธิบายเพิ่ม เช่น มิเตอร์ล่างค้างที่ 7273 มา 3 วัน…" : "อธิบายเพิ่ม เช่น ตู้ค้าง 2 ตัวมุมซ้าย…"}
          style={{
            width: "100%",
            fontSize: 13.5,
            padding: "10px 12px",
            border: "1.5px solid #E8DFC4",
            borderRadius: 11,
            background: "#fff",
            color: "#1A1D21",
            resize: "none",
            fontFamily: "inherit",
          }}
        />
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => onConfirmShort(reason, note.trim())}
        className="co-tap"
        style={{
          width: "100%",
          padding: 13,
          borderRadius: 12,
          border: "none",
          background: canSubmit ? "#B45309" : "#EFE7D2",
          color: canSubmit ? "#fff" : "#B9A97E",
          fontSize: 14.5,
          fontWeight: 700,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {canSubmit ? "บันทึกพร้อมเหตุผล" : "เลือกสาเหตุก่อนบันทึก"}
      </button>

      <button
        type="button"
        onClick={onProceed}
        className="co-tap"
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 11,
          border: "none",
          background: "transparent",
          color: "#8A7A4E",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        กลับไปแก้ตัวเลขก่อน
      </button>
    </div>
  );
}
