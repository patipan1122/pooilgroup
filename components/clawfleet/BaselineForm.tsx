"use client";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 2D · N1 ฟอร์ม "ตั้งค่าครั้งแรก" (P0 · mobile)
// -----------------------------------------------------------------------------
// แม่บ้านไปเก็บตู้ครั้งแรก → บันทึก baseline snapshot (ทำได้ครั้งเดียวต่อตู้ · redo ต้องเจ้าของอนุมัติ):
//   - นับตุ๊กตาในตู้ตอนนี้ (stepper · เริ่ม "ว่าง" ไม่ใช่ 0) · เติมเพิ่มกี่ตัว (stepper) · เงินสด (input)
//   - 4 มิเตอร์กายภาพ "ว่างทั้งหมด" (เงินบน/เงินล่าง/ตุ๊กตาบน/ตุ๊กตาล่าง) — แต่ละตัวมีรูปของตัวเอง
//     · per-meter fallback: มิเตอร์ตัวไหนอ่านไม่ออก → เว้นว่างได้ "ถ้าแนบรูปมิเตอร์ตัวนั้น" (รูป=หลักฐาน)
//     · ห้าม pre-fill มิเตอร์ (กัน confirm-bias — แม่บ้านต้องกรอกเลขจริงที่เห็น)
//   - รูปตู้ (machine) + รายการสินค้าในตู้ (loadout · แสดงอย่างเดียว)
// submit → submitFirstBaseline({... clientKey=randomUUID}) · ถ้าตู้ตั้งแล้ว → ข้อความเป็นมิตร · ok → onDone().
// ⚪ neutral = ช่องว่าง (ยังไม่กรอก) ไม่ใช่แดง. money logic ทำที่ server — ฟอร์มแค่เก็บ+ส่ง.

import { useState } from "react";
import { submitFirstBaseline } from "@/lib/clawfleet/baseline-actions";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";

const MAX_COUNT = 100_000;

// 1 มิเตอร์ในฟอร์ม — value ว่าง (null) หรือเลข · photo url ที่ถ่ายแล้ว · phase สำหรับ PhotoCaptureButton
type MeterKey = "moneyTop" | "moneyBottom" | "dollTop" | "dollBottom";
type MeterPhase = "money_meter_top" | "money_meter_bottom" | "doll_meter_top" | "doll_meter_bottom";

const METERS: { key: MeterKey; label: string; phase: MeterPhase }[] = [
  { key: "moneyTop", label: "มิเตอร์เงิน (บน)", phase: "money_meter_top" },
  { key: "moneyBottom", label: "มิเตอร์เงิน (ล่าง)", phase: "money_meter_bottom" },
  { key: "dollTop", label: "มิเตอร์ตุ๊กตา (บน)", phase: "doll_meter_top" },
  { key: "dollBottom", label: "มิเตอร์ตุ๊กตา (ล่าง)", phase: "doll_meter_bottom" },
];

export interface BaselineFormProps {
  machine: { id: string; code: string; nickname: string | null };
  branchId: string;
  orgId: string;
  products: { id: string; name: string; imageUrl: string | null }[];
  onDone: () => void;
}

export function BaselineForm({ machine, branchId, orgId, products, onDone }: BaselineFormProps) {
  // ค่าตุ๊กตา/เงิน — เริ่ม "ว่าง" (null) เสมอ (ไม่ใช่ 0)
  const [dollCount, setDollCount] = useState<number | null>(null);
  const [dollsAdded, setDollsAdded] = useState<number | null>(null);
  const [cash, setCash] = useState<string>(""); // บาท (string เพื่อให้ช่องว่างได้จริง)

  // 4 มิเตอร์ + รูปของแต่ละตัว — ว่างหมด (ห้าม pre-fill)
  const [meterVals, setMeterVals] = useState<Record<MeterKey, string>>({
    moneyTop: "", moneyBottom: "", dollTop: "", dollBottom: "",
  });
  const [meterPhotos, setMeterPhotos] = useState<Record<MeterKey, string>>({
    moneyTop: "", moneyBottom: "", dollTop: "", dollBottom: "",
  });
  const [machinePhoto, setMachinePhoto] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // scope id เดียวต่อการเปิดฟอร์ม (ให้ PhotoCaptureButton จัด queue รูปแยกจากตู้/รอบอื่น)
  const [scopeId] = useState(() => `baseline-${machine.id}`);

  const stepDoll = (setter: (n: number | null) => void, cur: number | null, delta: number) => {
    const next = Math.max(0, Math.min(MAX_COUNT, (cur ?? 0) + delta));
    setter(next);
  };

  const setMeter = (key: MeterKey, raw: string) => {
    // รับเฉพาะตัวเลข (ว่างได้) — ไม่เด้ง error ระหว่างพิมพ์
    const cleaned = raw.replace(/[^\d]/g, "");
    setMeterVals((m) => ({ ...m, [key]: cleaned }));
  };
  const setMeterPhoto = (key: MeterKey, url: string) => {
    setMeterPhotos((m) => ({ ...m, [key]: url }));
  };

  // มิเตอร์ตัวไหน "ว่าง + ไม่มีรูป" = ยังไม่ครบ (ต้องเลข หรือ รูป อย่างใดอย่างหนึ่ง)
  const meterIncomplete = METERS.filter(
    (m) => meterVals[m.key].trim() === "" && !meterPhotos[m.key],
  );

  const parseMeter = (key: MeterKey): number | null => {
    const v = meterVals[key].trim();
    return v === "" ? null : Number(v);
  };

  async function handleSubmit() {
    setError(null);
    if (dollCount == null) {
      setError("กรุณานับตุ๊กตาในตู้ตอนนี้ก่อน");
      return;
    }
    if (meterIncomplete.length > 0) {
      setError(`${meterIncomplete[0].label} ยังว่าง — กรอกเลข หรือถ่ายรูปแทน`);
      return;
    }
    const cashBaht = cash.trim() === "" ? 0 : Number(cash);
    if (Number.isNaN(cashBaht) || cashBaht < 0) {
      setError("จำนวนเงินไม่ถูกต้อง");
      return;
    }

    setBusy(true);
    try {
      const res = await submitFirstBaseline({
        machineId: machine.id,
        dollCountNow: dollCount,
        dollsAdded: dollsAdded ?? 0,
        cashCents: Math.round(cashBaht * 100),
        meterMoneyTop: parseMeter("moneyTop"),
        meterMoneyBottom: parseMeter("moneyBottom"),
        meterDollTop: parseMeter("dollTop"),
        meterDollBottom: parseMeter("dollBottom"),
        photoMachineUrl: machinePhoto || undefined,
        photoMoneyMeterTopUrl: meterPhotos.moneyTop || undefined,
        photoMoneyMeterBottomUrl: meterPhotos.moneyBottom || undefined,
        photoDollMeterTopUrl: meterPhotos.dollTop || undefined,
        photoDollMeterBottomUrl: meterPhotos.dollBottom || undefined,
        loadout: products.map((p) => ({ productId: p.id, qty: 1 })),
        clientKey: crypto.randomUUID(),
      });

      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError("บันทึกไม่สำเร็จ · ลองอีกครั้ง");
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      {/* header — ทำได้ครั้งเดียว */}
      <div
        style={{
          background: "#EEF0FE",
          border: "1px solid #D9DBFB",
          borderRadius: 14,
          padding: "14px 16px",
          display: "flex",
          gap: 11,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" style={{ flex: "0 0 20px", marginTop: 1 }}>
          <path d="M12 2 4 5v6c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V5z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#3F3AC0" }}>ตั้งค่าครั้งแรก · ทำได้ครั้งเดียว</div>
          <div style={{ fontSize: 12, color: "#5A54C8", marginTop: 2, lineHeight: 1.45 }}>
            ตู้ {machine.code}{machine.nickname ? ` · ${machine.nickname}` : ""} — บันทึกยอดตั้งต้น (ตุ๊กตา · เงิน · มิเตอร์) เพื่อเริ่มนับรอบต่อไป.
            แก้ไขทีหลังต้อง<b> เจ้าของอนุมัติ</b>.
          </div>
        </div>
      </div>

      {/* นับตุ๊กตาในตู้ตอนนี้ (stepper · ว่าง) */}
      <Section title="ตุ๊กตาในตู้ตอนนี้" hint="นับที่เห็นจริงในตู้ (ยังไม่เติม)">
        <Stepper value={dollCount} unit="ตัว" placeholder="นับแล้วแตะ +"
          onDec={() => stepDoll(setDollCount, dollCount, -1)} onInc={() => stepDoll(setDollCount, dollCount, 1)} />
      </Section>

      {/* เติมเพิ่ม (stepper · ว่าง) */}
      <Section title="เติมตุ๊กตาเพิ่ม" hint="ใส่เพิ่มเข้าไปกี่ตัว (ไม่เติม = ข้ามได้)">
        <Stepper value={dollsAdded} unit="ตัว" placeholder="แตะ + ถ้ามีเติม"
          onDec={() => stepDoll(setDollsAdded, dollsAdded, -1)} onInc={() => stepDoll(setDollsAdded, dollsAdded, 1)} />
      </Section>

      {/* เงินสด */}
      <Section title="เงินสดในตู้ (บาท)" hint="นับเงินในตู้ตอนตั้งต้น">
        <input
          value={cash}
          onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="นับเงินแล้วกรอก"
          className="co-input num"
          style={{ fontSize: 18, fontWeight: 700 }}
        />
      </Section>

      {/* 4 มิเตอร์กายภาพ — ว่างหมด + รูปต่อตัว */}
      <div className="co-card" style={{ padding: 15, display: "flex", flexDirection: "column", gap: 13 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21" }}>อ่านมิเตอร์ 4 ตัว</div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2, lineHeight: 1.4 }}>
            กรอกเลขที่เห็นจริง · <b>อ่านไม่ได้? ถ่ายรูปแทน</b> (รูปเป็นหลักฐานได้)
          </div>
        </div>
        {METERS.map((m) => {
          const filled = meterVals[m.key].trim() !== "";
          const hasPhoto = !!meterPhotos[m.key];
          const done = filled || hasPhoto;
          return (
            <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#454B54", flex: 1 }}>{m.label}</span>
                <span
                  className="co-pill"
                  style={{ background: done ? "#E7F4EC" : "#F1F2F7", color: done ? "#15803D" : "#9AA1AB" }}
                >
                  {filled ? "กรอกแล้ว" : hasPhoto ? "มีรูป" : "ยังว่าง"}
                </span>
              </div>
              <input
                value={meterVals[m.key]}
                onChange={(e) => setMeter(m.key, e.target.value)}
                inputMode="numeric"
                placeholder="อ่านเลขมิเตอร์"
                className="co-input num"
                style={{ fontSize: 16, fontWeight: 600 }}
              />
              <PhotoCaptureButton
                label="อ่านไม่ได้? ถ่ายรูปแทน"
                value={meterPhotos[m.key]}
                onChange={(url) => setMeterPhoto(m.key, url)}
                orgId={orgId}
                machineCode={machine.code}
                eventScopeId={scopeId}
                phase={m.phase}
              />
            </div>
          );
        })}
      </div>

      {/* รูปตู้ */}
      <Section title="รูปตู้" hint="ถ่ายรูปหน้าตู้ไว้เป็นหลักฐานตั้งต้น">
        <PhotoCaptureButton
          label="ถ่ายรูปตู้"
          value={machinePhoto}
          onChange={setMachinePhoto}
          orgId={orgId}
          machineCode={machine.code}
          eventScopeId={scopeId}
          phase="machine"
        />
      </Section>

      {/* สินค้าในตู้ (loadout · แสดงอย่างเดียว) */}
      {products.length > 0 && (
        <Section title="สินค้าในตู้นี้" hint="รายการที่บันทึกเป็นของตั้งต้น">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {products.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 9, objectFit: "cover", background: "#F1F2F7" }} />
                ) : (
                  <div style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 9, background: "#F1F2F7", display: "flex", alignItems: "center", justifyContent: "center", color: "#A9AEB8" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="m21 15-5-5L5 21" /></svg>
                  </div>
                )}
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1A1D21" }}>{p.name}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {error && (
        <div
          style={{
            background: "#FCF1E2",
            border: "1px solid #F0E2BE",
            borderRadius: 11,
            padding: "11px 13px",
            fontSize: 12.5,
            color: "#B45309",
            fontWeight: 600,
            display: "flex",
            gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "0 0 16px", marginTop: 1 }}>
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={handleSubmit}
        className="co-tap"
        style={{
          width: "100%",
          padding: 15,
          borderRadius: 13,
          border: "none",
          background: busy ? "#B9BCF0" : "#4F46E5",
          color: "#fff",
          fontSize: 15.5,
          fontWeight: 700,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "กำลังบันทึก…" : "บันทึกการตั้งค่าครั้งแรก"}
      </button>
    </div>
  );
}

/* ── section wrapper (หัวข้อ + hint + เนื้อ) ─────────────────────────────── */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="co-card" style={{ padding: 15, display: "flex", flexDirection: "column", gap: 11 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21" }}>{title}</div>
        {hint && <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── stepper +/− (ค่าเริ่มว่าง → placeholder · big tap นิ้วโป้ง) ──────────── */
function Stepper({
  value,
  unit,
  placeholder,
  onDec,
  onInc,
}: {
  value: number | null;
  unit: string;
  placeholder: string;
  onDec: () => void;
  onInc: () => void;
}) {
  const has = value != null;
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
      <StepBtn ariaLabel="ลด" disabled={(value ?? 0) <= 0} onClick={onDec}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M5 12h14" /></svg>
      </StepBtn>
      <div
        style={{
          flex: 1,
          minHeight: 54,
          borderRadius: 12,
          background: has ? "#EEF0FE" : "#F1F2F7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {has ? (
          <span className="num" style={{ fontSize: 22, fontWeight: 700, color: "#4F46E5" }}>
            {value!.toLocaleString("th-TH")} <span style={{ fontSize: 13, fontWeight: 600, color: "#6D5CE8" }}>{unit}</span>
          </span>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 600, color: "#9AA1AB" }}>{placeholder}</span>
        )}
      </div>
      <StepBtn ariaLabel="เพิ่ม" onClick={onInc} primary>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </StepBtn>
    </div>
  );
}

function StepBtn({
  children,
  onClick,
  disabled = false,
  primary = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="co-tap"
      style={{
        width: 58,
        height: 54,
        flex: "0 0 58px",
        borderRadius: 12,
        border: primary ? "none" : "1.5px solid #E3E6EA",
        background: disabled ? "#F4F5F7" : primary ? "#4F46E5" : "#fff",
        color: disabled ? "#C4C9D0" : primary ? "#fff" : "#5A6270",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
