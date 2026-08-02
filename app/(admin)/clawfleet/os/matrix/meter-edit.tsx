"use client";

/**
 * MeterEditModal — ฟอร์มแก้เลขมิเตอร์/เงิน 1 รายการ (ใช้ใน popup รายช่องของเมทริกซ์).
 * routing ตามชนิด: รอบเก็บ (COLLECTION) → adminEditCollectionEvent ·
 *                  ยอดตั้งต้น (INITIAL/baseline) → adminEditBaselineEvent (cascade รอบเก็บครั้งแรก).
 * เลข "ดิจิตอล" = เลขที่ใช้คิดเงินจริง · "เฟือง" = ตัวเทียบกันโกง (ไม่กระทบเงิน).
 * ระบบ (server) คำนวณยอดใหม่ + ต่อเลขให้รอบถัดไป + เก็บ audit ว่าใครแก้ — client แค่ส่งเลข.
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/clawfleet/os/kit";
import { adminEditCollectionEvent, adminEditBaselineEvent } from "@/lib/clawfleet/actions";
import type { RawReadingRow } from "@/lib/clawfleet/raw-readings-queries";

export function MeterEditModal({
  row,
  onClose,
  onSaved,
}: {
  /** รายการที่จะแก้ (null = ปิด). ต้อง key={row.eventId} ที่ parent ให้ remount ค่าใหม่ทุกครั้ง */
  row: RawReadingRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isInit = row?.kind === "INITIAL";
  const [cash, setCash] = useState(row ? String(row.cashBaht) : "");
  const [coinDigital, setCoinDigital] = useState(row ? String(row.coinDigital) : "");
  const [coinGear, setCoinGear] = useState(row && row.coinGear != null ? String(row.coinGear) : "");
  const [dollDigital, setDollDigital] = useState(row && row.dollDigital != null ? String(row.dollDigital) : "");
  const [dollGear, setDollGear] = useState(row && row.dollGear != null ? String(row.dollGear) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!row) return;
    setBusy(true);
    setErr(null);
    const payload = {
      eventId: row.eventId,
      cashCents: Math.round((Number(cash) || 0) * 100),
      coinMeterAfter: Math.round(Number(coinDigital) || 0),
      dollMeterAfter: dollDigital === "" ? null : Math.round(Number(dollDigital) || 0),
      coinMeterTop: coinGear === "" ? null : Math.round(Number(coinGear) || 0),
      dollMeterTop: dollGear === "" ? null : Math.round(Number(dollGear) || 0),
    };
    try {
      const res = isInit
        ? await adminEditBaselineEvent(payload)
        : await adminEditCollectionEvent(payload);
      if (!res.ok) {
        setErr(res.error || "แก้ไม่สำเร็จ");
        setBusy(false);
        return;
      }
      setBusy(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "แก้ไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <Modal
      open={row != null}
      onClose={() => (busy ? undefined : onClose())}
      title={row ? `แก้เลข — ตู้ ${row.machineCode}${isInit ? " · ยอดตั้งต้น" : ""}` : ""}
      sub={row ? `${row.dateLabel} ${row.timeLabel} น. · กรอกโดย ${row.collectedByName}` : undefined}
      width={520}
      footer={
        row ? (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
            {err && <span style={{ flex: 1, fontSize: 12, color: "#B42318" }}>{err}</span>}
            <button onClick={onClose} disabled={busy} style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 9, background: "#fff", color: "#5A6270", border: "1px solid #D8DBE1" }}>
              ยกเลิก
            </button>
            <button onClick={save} disabled={busy} style={{ cursor: busy ? "wait" : "pointer", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 9, background: "#4F46E5", color: "#fff", border: "none", opacity: busy ? 0.7 : 1 }}>
              {busy ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
            </button>
          </div>
        ) : undefined
      }
    >
      {row && (
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: isInit ? "#FEF3E7" : "#FFFBEB", border: `1px solid ${isInit ? "#F6D9AE" : "#FDE9B5"}`, borderRadius: 9, padding: "9px 12px", fontSize: 11.5, color: "#7A5510", lineHeight: 1.5 }}>
            <AlertTriangle size={14} style={{ flex: "0 0 14px", marginTop: 1 }} />
            {isInit ? (
              <span>
                นี่คือ <b>ยอดตั้งต้น</b> (ตั้งค่าตู้ครั้งแรก) — แก้เลข <b>ดิจิตอล</b> แล้วระบบจะปรับ{" "}
                <b>รอบเก็บครั้งแรก</b> ให้อัตโนมัติ (ส่วนต่าง = เก็บครั้งแรก − ตั้งต้น) + คำนวณเงินใหม่ + เก็บประวัติว่าใครแก้ ·
                รอบเก็บถัด ๆ ไปไม่ขยับ (นับต่อจากรอบก่อนหน้า)
              </span>
            ) : (
              <span>
                เลข <b>ดิจิตอล</b> คือเลขที่ใช้คิดเงินจริง · เลข <b>เฟือง</b> เป็นตัวเทียบกันโกง (ควรขยับเท่าดิจิตอล) ·
                ระบบจะคำนวณยอดใหม่ + ต่อเลขให้รอบถัดไปอัตโนมัติ + เก็บประวัติว่าใครแก้
              </span>
            )}
          </div>

          <EditField label="เงินสดที่นับได้ (บาท)" value={cash} onChange={setCash} accent="#15803D" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <EditField label="มิเตอร์เหรียญ · ดิจิตอล" hint="ใช้คิดเงิน" value={coinDigital} onChange={setCoinDigital} />
            <EditField label="มิเตอร์เหรียญ · เฟือง" hint="ตัวเทียบ" value={coinGear} onChange={setCoinGear} muted />
            <EditField label="มิเตอร์ตุ๊กตา · ดิจิตอล" hint="ใช้คิดตุ๊กตาออก" value={dollDigital} onChange={setDollDigital} />
            <EditField label="มิเตอร์ตุ๊กตา · เฟือง" hint="ตัวเทียบ" value={dollGear} onChange={setDollGear} muted />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function EditField({
  label,
  hint,
  value,
  onChange,
  accent = "#1A1D21",
  muted = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  accent?: string;
  muted?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#5A6270", marginBottom: 5 }}>
        {label}
        {hint && <span style={{ fontSize: 9.5, fontWeight: 500, color: "#9AA1AB" }}>({hint})</span>}
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        style={{
          width: "100%",
          fontSize: 15,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          padding: "9px 12px",
          borderRadius: 9,
          border: "1px solid #D8DBE1",
          background: muted ? "#FAFBFC" : "#fff",
          color: accent,
        }}
      />
    </label>
  );
}
