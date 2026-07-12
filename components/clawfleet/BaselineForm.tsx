"use client";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 2D · N1 ฟอร์ม "ตั้งค่าครั้งแรก" (P0 · mobile)
// -----------------------------------------------------------------------------
// แม่บ้านไปเก็บตู้ครั้งแรก → บันทึก baseline snapshot (ทำได้ครั้งเดียวต่อตู้ · redo ต้องเจ้าของอนุมัติ):
//   - นับตุ๊กตาในตู้ตอนนี้ (พิมพ์เลขได้ + −/+ · เริ่ม "ว่าง" ไม่ใช่ 0) · เติมเพิ่มกี่ตัว · เงินสด (input)
//   - 4 มิเตอร์กายภาพ "ว่างทั้งหมด" (เงินบน/เงินล่าง/ตุ๊กตาบน/ตุ๊กตาล่าง) — แต่ละตัวมีรูปของตัวเอง (รูป optional)
//     · gate = อย่างน้อย 1 หน้าปัดต่อคู่ (เงิน บน-หรือ-ล่าง · ตุ๊กตา บน-หรือ-ล่าง) ให้ตรงกับ server (top ?? bottom)
//       → ตู้ที่หน้าปัดล่างเสีย/อ่านไม่ออก ยังตั้ง baseline ได้จากตัวบน
//     · ห้าม pre-fill มิเตอร์ (กัน confirm-bias — แม่บ้านต้องกรอกเลขจริงที่เห็น)
//   - รูปตู้ (machine) + รายการสินค้าในตู้ (loadout · แสดง) + เพิ่มสินค้าใหม่ตอนตั้งค่า (AddProductPanel)
//   - ตั้งชื่อเล่นตู้ได้ตั้งแต่หน้านี้ (✎ ที่หัวข้อ → renameMachineNickname · reflect ทันทีไม่ต้อง reload)
// submit → submitFirstBaseline({... clientKey=randomUUID}) · ถ้าตู้ตั้งแล้ว → ข้อความเป็นมิตร · ok → onDone().
// ⚪ neutral = ช่องว่าง (ยังไม่กรอก) ไม่ใช่แดง. money logic ทำที่ server — ฟอร์มแค่เก็บ+ส่ง.

import { useState, useTransition } from "react";
import { submitFirstBaseline } from "@/lib/clawfleet/baseline-actions";
import { addSetupProductWithDolls } from "@/lib/clawfleet/product-setup-actions";
import { renameMachineNickname } from "@/lib/clawfleet/actions";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";

const MAX_COUNT = 100_000;

// สินค้าใหม่ที่เพิ่งเพิ่มตอนตั้งค่าตู้ครั้งแรก (server สร้าง product + บันทึกยอด "ในตู้" ให้แล้ว)
type AddedProduct = { id: string; name: string; sku: string; qty: number; imageUrl: string | null };

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

  // ชื่อเล่นตู้ (แก้ได้ตั้งแต่หน้านี้) — sheet เปิด/ปิด + ชื่อปัจจุบัน (reflect หลัง rename โดยไม่ต้อง reload)
  const [nickname, setNickname] = useState<string | null>(machine.nickname);
  const [nickSheet, setNickSheet] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // N1b · สินค้าใหม่ที่เพิ่มตอนตั้งค่าครั้งแรก (server บันทึก product + ยอดในตู้ ทันทีที่กด "เพิ่ม")
  const [addedProducts, setAddedProducts] = useState<AddedProduct[]>([]);

  // scope id เดียวต่อการเปิดฟอร์ม (ให้ PhotoCaptureButton จัด queue รูปแยกจากตู้/รอบอื่น)
  const [scopeId] = useState(() => `baseline-${machine.id}`);

  const setMeter = (key: MeterKey, raw: string) => {
    // รับเฉพาะตัวเลข (ว่างได้) — ไม่เด้ง error ระหว่างพิมพ์
    const cleaned = raw.replace(/[^\d]/g, "");
    setMeterVals((m) => ({ ...m, [key]: cleaned }));
  };
  const setMeterPhoto = (key: MeterKey, url: string) => {
    setMeterPhotos((m) => ({ ...m, [key]: url }));
  };

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
    // เลขมิเตอร์ = anchor · ต้องมีอย่างน้อย 1 หน้าปัดต่อคู่ (เงิน บน/ล่าง · ตุ๊กตา บน/ล่าง)
    // ให้ตรงกับ server + คณิต (top ?? bottom) · ตู้ที่หน้าปัดล่างเสียยังตั้งได้จากตัวบน
    const moneyMeterFilled = meterVals.moneyTop.trim() !== "" || meterVals.moneyBottom.trim() !== "";
    const dollMeterFilled = meterVals.dollTop.trim() !== "" || meterVals.dollBottom.trim() !== "";
    if (!moneyMeterFilled) {
      setError("มิเตอร์เงิน ยังไม่ได้กรอกเลข — กรอกอย่างน้อย 1 หน้าปัด (บนหรือล่าง)");
      return;
    }
    if (!dollMeterFilled) {
      setError("มิเตอร์ตุ๊กตา ยังไม่ได้กรอกเลข — กรอกอย่างน้อย 1 หน้าปัด (บนหรือล่าง)");
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#3F3AC0", flex: 1, minWidth: 0 }}>
              ตั้งค่าครั้งแรก · ทำได้ครั้งเดียว
            </div>
            {/* ✎ ตั้งชื่อเล่นตู้ ตั้งแต่หน้านี้ */}
            <button
              type="button"
              onClick={() => setNickSheet(true)}
              className="co-tap"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 9,
                border: "1px solid #C7C3F0", background: "#fff",
                color: "#4F46E5", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              {nickname ? "แก้ชื่อ" : "ตั้งชื่อ"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#5A54C8", marginTop: 3, lineHeight: 1.45 }}>
            ตู้ {machine.code}{nickname ? ` · ${nickname}` : ""} — บันทึกยอดตั้งต้น (ตุ๊กตา · เงิน · มิเตอร์) เพื่อเริ่มนับรอบต่อไป.
            แก้ไขทีหลังต้อง<b> เจ้าของอนุมัติ</b>.
          </div>
        </div>
      </div>

      {/* นับตุ๊กตาในตู้ตอนนี้ (พิมพ์เลขได้ + −/+ · ว่าง) */}
      <Section title="ตุ๊กตาในตู้ตอนนี้" hint="นับที่เห็นจริงในตู้ (ยังไม่เติม) · พิมพ์เลขได้เลย">
        <CountField value={dollCount} onChange={setDollCount} placeholder="นับแล้วพิมพ์เลข" />
      </Section>

      {/* เติมเพิ่ม (พิมพ์เลขได้ + −/+ · ว่าง) */}
      <Section title="เติมตุ๊กตาเพิ่ม" hint="ใส่เพิ่มเข้าไปกี่ตัว (ไม่เติม = ข้ามได้)">
        <CountField value={dollsAdded} onChange={setDollsAdded} placeholder="พิมพ์จำนวนที่เติม" />
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

      {/* สินค้าในตู้ (loadout · แสดงอย่างเดียว) + สินค้าใหม่ที่เพิ่งเพิ่ม */}
      <Section title="สินค้าในตู้นี้" hint="รายการที่บันทึกเป็นของตั้งต้น">
        {(products.length > 0 || addedProducts.length > 0) && (
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
            {/* สินค้าใหม่ที่เพิ่งเพิ่ม (บันทึกในตู้แล้ว) — badge จำนวน + "ใหม่" */}
            {addedProducts.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 9, objectFit: "cover", background: "#F1F2F7" }} />
                ) : (
                  <div style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 9, background: "#F1F2F7", display: "flex", alignItems: "center", justifyContent: "center", color: "#A9AEB8" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="m21 15-5-5L5 21" /></svg>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1A1D21" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#9AA1AB" }}>{p.sku} · {p.qty.toLocaleString("th-TH")} ตัวในตู้</div>
                </div>
                <span className="co-pill" style={{ background: "#E7F4EC", color: "#15803D" }}>ใหม่ · บันทึกแล้ว</span>
              </div>
            ))}
          </div>
        )}

          {/* ＋ เพิ่มสินค้าใหม่ (ตุ๊กตาเก่าที่อยู่ในตู้อยู่แล้ว) — เฉพาะตอนตั้งค่าครั้งแรก */}
          <AddProductPanel
            machine={machine}
            branchId={branchId}
            orgId={orgId}
            scopeId={scopeId}
            onAdded={(p) => setAddedProducts((cur) => [...cur, p])}
          />
        </Section>

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

      {/* sheet ตั้งชื่อเล่น (inline · reuse renameMachineNickname) */}
      {nickSheet && (
        <NicknameSheet
          machineId={machine.id}
          machineCode={machine.code}
          initial={nickname ?? ""}
          onClose={() => setNickSheet(false)}
          onSaved={(name) => {
            setNickname(name.trim().length > 0 ? name.trim() : null);
            setNickSheet(false);
          }}
        />
      )}
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

/* ── CountField — ช่องนับ "พิมพ์เลขได้" + ปุ่ม −/+ (mirror staff-app-client CountField).
 * value=null → ช่องว่าง + placeholder (ไม่โชว์ 0 หลอกว่ากรอกแล้ว). onChange รับ number|null.
 * พิมพ์ "120" ตรง ๆ ได้ · strip อักขระที่ไม่ใช่ตัวเลข · −/+ ปรับทีละ 1 (ต่ำสุด 0). */
function CountField({
  value,
  onChange,
  placeholder = "นับแล้วพิมพ์เลข",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  const cur = value == null ? 0 : value;
  const nudge = (delta: number) => onChange(Math.max(0, Math.min(MAX_COUNT, cur + delta)));
  const btnStyle = {
    width: 54, height: 54, flex: "0 0 54px", borderRadius: 12, border: "1.5px solid #E3E6EA",
    background: "#F6F7FA", fontSize: 24, fontWeight: 700, color: "#454B54",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <button type="button" aria-label="ลด" onClick={() => nudge(-1)} className="co-tap" style={btnStyle}>−</button>
      {/* type=text + inputMode=numeric → คีย์บอร์ดตัวเลข + พิมพ์ "120" ได้ตรง ๆ · ว่าง = null */}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value == null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : Math.min(MAX_COUNT, Number(raw)));
        }}
        className="num"
        style={{
          flex: 1, minWidth: 0, textAlign: "center", fontSize: 22, fontWeight: 700,
          padding: "13px 10px", border: "1.5px solid #E3E6EA", borderRadius: 12, background: "#fff",
        }}
      />
      <button type="button" aria-label="เพิ่ม" onClick={() => nudge(1)} className="co-tap"
        style={{ ...btnStyle, border: "none", background: "#4F46E5", color: "#fff" }}>+</button>
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

/* ── N1b · เพิ่มสินค้าใหม่ตอนตั้งค่าครั้งแรก (ตุ๊กตาเก่าในตู้) ────────────────
   compact inline sheet: ชื่อ + SKU + รูป + จำนวน (stepper) → addSetupProductWithDolls.
   server สร้าง product + บันทึกยอด "ในตู้" ทันที (idempotent · clientKey ใหม่ทุกครั้งที่กด). */
function AddProductPanel({
  machine,
  branchId,
  orgId,
  scopeId,
  onAdded,
}: {
  machine: { id: string; code: string };
  branchId: string;
  orgId: string;
  scopeId: string;
  onAdded: (p: AddedProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [photo, setPhoto] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(""); setSku(""); setPhoto(""); setQty(null); setError(null);
  }

  const stepQty = (delta: number) =>
    setQty((cur) => Math.max(0, Math.min(MAX_COUNT, (cur ?? 0) + delta)));

  async function handleAdd() {
    setError(null);
    if (name.trim() === "") { setError("กรอกชื่อสินค้าก่อน"); return; }
    if (sku.trim() === "") { setError("กรอกรหัส SKU ก่อน"); return; }
    if (qty == null || qty <= 0) { setError("ใส่จำนวนตุ๊กตาในตู้ (มากกว่า 0)"); return; }

    setBusy(true);
    try {
      const res = await addSetupProductWithDolls({
        machineId: machine.id,
        branchId,
        name: name.trim(),
        sku: sku.trim(),
        imageUrl: photo || undefined,
        qty,
        clientKey: crypto.randomUUID(), // UUID ใหม่ต่อการกด 1 ครั้ง → idempotency (double-tap ปลอดภัย)
      });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      onAdded({ id: res.data.productId, name: name.trim(), sku: sku.trim(), qty, imageUrl: photo || null });
      reset();
      setOpen(false);
    } catch {
      setError("เพิ่มสินค้าไม่สำเร็จ · ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="co-tap"
        style={{
          marginTop: 4,
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1.5px dashed #C7CBF5",
          background: "#F7F8FF",
          color: "#4F46E5",
          fontSize: 13.5,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        เพิ่มสินค้าใหม่ (ตุ๊กตาในตู้)
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 4,
        border: "1.5px solid #D9DBFB",
        background: "#FAFBFF",
        borderRadius: 13,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#3F3AC0" }}>เพิ่มสินค้าใหม่</span>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false); }}
          style={{ background: "none", border: "none", color: "#9AA1AB", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          ยกเลิก
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ชื่อสินค้า (เช่น หมีบราวน์ L)"
        className="co-input"
        style={{ fontSize: 15, fontWeight: 600 }}
        maxLength={200}
      />
      <input
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        placeholder="รหัส SKU (เช่น BROWN-L)"
        className="co-input"
        style={{ fontSize: 15, fontWeight: 600 }}
        maxLength={80}
      />

      <PhotoCaptureButton
        label="ถ่ายรูปตุ๊กตา"
        value={photo}
        onChange={setPhoto}
        orgId={orgId}
        machineCode={machine.code}
        eventScopeId={`${scopeId}-newprod`}
        phase="product_setup"
      />

      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#454B54", marginBottom: 7 }}>มีในตู้กี่ตัว</div>
        <Stepper value={qty} unit="ตัว" placeholder="นับแล้วแตะ +"
          onDec={() => stepQty(-1)} onInc={() => stepQty(1)} />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#B45309", fontWeight: 600 }}>{error}</div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={handleAdd}
        className="co-tap"
        style={{
          width: "100%",
          padding: 13,
          borderRadius: 12,
          border: "none",
          background: busy ? "#B9BCF0" : "#4F46E5",
          color: "#fff",
          fontSize: 14.5,
          fontWeight: 700,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "กำลังเพิ่ม…" : "＋ เพิ่มสินค้า + บันทึกในตู้"}
      </button>
    </div>
  );
}

/* ── NicknameSheet — bottom-sheet ตั้งชื่อเล่นตู้ (mirror staff-app-client NicknameSheet).
 * บันทึก → renameMachineNickname({machineId,nickname}) ใน startTransition · {ok:false} โชว์ error ·
 * สำเร็จ → onSaved(name) (parent อัปเดตชื่อในหัวข้อเอง · ไม่ต้อง reload). ว่าง = ล้างชื่อเล่น (server รับ ""). */
function NicknameSheet({
  machineId,
  machineCode,
  initial,
  onClose,
  onSaved,
}: {
  machineId: string;
  machineCode: string;
  initial: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await renameMachineNickname({ machineId, nickname: name.trim() });
        if (!res.ok) {
          setError(res.error || "ตั้งชื่อไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        onSaved(name);
      } catch {
        setError("ตั้งชื่อไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ตั้งชื่อเล่นตู้ ${machineCode}`}
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
    >
      <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }}
        style={{ position: "absolute", inset: 0, background: "rgba(15,18,26,0.42)", border: "none", cursor: pending ? "default" : "pointer" }} />
      <div style={{ position: "relative", background: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 18px 22px", boxShadow: "0 -8px 30px rgba(0,0,0,0.18)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "#E3E6EA", margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#EEF0FE", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>ตั้งชื่อเล่นตู้</div>
            <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ตู้ <span className="num">{machineCode}</span></div>
          </div>
          <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }} className="co-tap"
            style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <label style={{ fontSize: 12.5, fontWeight: 600, color: "#454B54", display: "block", marginBottom: 6 }}>
          ชื่อเล่น (จำง่าย — เว้นว่างเพื่อล้างชื่อ)
        </label>
        <input type="text" value={name} maxLength={60} placeholder="เช่น ตู้หน้าประตู, ตู้คิตตี้"
          onChange={(e) => setName(e.target.value)} autoFocus
          style={{ width: "100%", fontSize: 16, fontWeight: 600, padding: "12px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />

        {error && (
          <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "#B45309", background: "#FCF1E2", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 12px" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button type="button" onClick={() => { if (!pending) onClose(); }} className="co-tap"
            style={{ flex: 1, padding: 13, borderRadius: 12, border: "1.5px solid #E3E6EA", background: "#fff", color: "#5A6270", fontSize: 14.5, fontWeight: 700, cursor: pending ? "default" : "pointer" }}>
            ยกเลิก
          </button>
          <button type="button" onClick={save} disabled={pending} className="co-tap"
            style={{ flex: 2, padding: 13, borderRadius: 12, border: "none", background: pending ? "#B9BCF0" : "#4F46E5", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: pending ? "wait" : "pointer" }}>
            {pending ? "กำลังบันทึก…" : "บันทึกชื่อ"}
          </button>
        </div>
      </div>
    </div>
  );
}
