"use client";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 2D · N5 ด่านเงินไม่ตรง (mobile)
// -----------------------------------------------------------------------------
// โผล่ "หลัง" submit แล้ว server คืน needsReason (verdict=SHORT · คำนวณที่ server ไม่ใช่ client):
//   - SHORT (เงินขาด) → บังคับเลือก "เหตุผล" (ตุ๊กตาค้าง / เครื่องเสีย / อื่น) + โน้ต (ไม่บังคับ)
//       · ปุ่มบันทึก DISABLED จนกว่าจะเลือกเหตุผล → onConfirmShort(reason, note)
//       · โทน neutral/amber "เป็นกลาง" — ไม่ใช่แดงกล่าวหา (memory: ห้ามทำแม่บ้านซื่อรู้สึกผิด)
//       · "ไม่บล็อกแข็ง" — แค่ต้องระบุเหตุผลก่อนบันทึกผ่าน (signal ไม่ใช่ข้อหา)
//   - OVER (เงินเกิน) → ผ่านเงียบ ๆ โชว์โน้ตเล็ก "เกิน — บันทึกไว้" → onProceed()
//   - null (รอบแรก/ไม่มีอะไรเทียบ) หรือ OK → ไม่แสดงอะไร (คืน null)
// ⚪/amber tokens เท่านั้น · ไม่มีภาษาดีไซน์ใหม่.

import { useState } from "react";

// เหตุผลเงินขาด — value ที่ส่งเข้า onConfirmShort(reason)
const SHORT_REASONS: { value: string; label: string }[] = [
  { value: "ตุ๊กตาค้าง", label: "ตุ๊กตาค้างในราง (ยังไม่ตก)" },
  { value: "เครื่องเสีย", label: "เครื่อง/มิเตอร์เสีย อ่านเพี้ยน" },
  { value: "อื่น", label: "อื่น ๆ (ระบุในโน้ต)" },
];

export interface MismatchGateProps {
  verdict: "OK" | "SHORT" | "OVER" | null;
  onConfirmShort: (reason: string, note: string) => void;
  onProceed: () => void;
}

export function MismatchGate({ verdict, onConfirmShort, onProceed }: MismatchGateProps) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // รอบแรก (null) หรือ ตรง (OK) → ไม่มีด่าน
  if (verdict == null || verdict === "OK") return null;

  // เงินเกิน → ผ่านเงียบ ๆ (แค่บันทึกไว้ · ไม่ทำให้ตกใจ)
  if (verdict === "OVER") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          background: "#F2FAF5",
          border: "1px solid #CDE9D7",
          borderRadius: 12,
          padding: "12px 14px",
          marginTop: 4,
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2.2" style={{ flex: "0 0 17px", marginTop: 1 }}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: "#15803D", fontWeight: 600, lineHeight: 1.4 }}>
            เงินเกินเล็กน้อย — บันทึกไว้แล้ว ไม่ต้องกังวล
          </div>
          <button
            type="button"
            onClick={onProceed}
            className="co-tap"
            style={{
              marginTop: 10,
              width: "100%",
              padding: 12,
              borderRadius: 11,
              border: "none",
              background: "#15803D",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            บันทึกและไปต่อ
          </button>
        </div>
      </div>
    );
  }

  // SHORT — เงินขาด · ต้องเลือกเหตุผลก่อนบันทึก (โทนเป็นกลาง amber ไม่กล่าวหา)
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
          <div style={{ fontSize: 14, fontWeight: 700, color: "#7A5510" }}>เงินที่นับได้ น้อยกว่าที่ระบบคาดไว้</div>
          <div style={{ fontSize: 12, color: "#8A7A4E", marginTop: 2, lineHeight: 1.45 }}>
            ไม่เป็นไร — เกิดได้หลายสาเหตุ ช่วยเลือกว่าน่าจะเพราะอะไร แล้วบันทึกต่อได้เลย
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5510", marginBottom: 6 }}>สาเหตุ (ต้องเลือก)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SHORT_REASONS.map((r) => {
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
          placeholder="อธิบายเพิ่ม เช่น ตู้ค้าง 2 ตัวมุมซ้าย…"
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
    </div>
  );
}
