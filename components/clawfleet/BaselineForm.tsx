"use client";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 2D · N1 ฟอร์ม "ตั้งค่าครั้งแรก" (P0 · mobile)
// -----------------------------------------------------------------------------
// แม่บ้านไปเก็บตู้ครั้งแรก → บันทึก baseline snapshot (ทำได้ครั้งเดียวต่อตู้ · redo ต้องเจ้าของอนุมัติ):
//   - ตุ๊กตา "ในตู้ตอนนี้" = รายการต่อ SKU (ยอดรวมระบบคิดให้) · เติมเพิ่มกี่ตัว · เงินสด (input)
//   - 4 มิเตอร์กายภาพ "ว่างทั้งหมด" (เงินบน/เงินล่าง/ตุ๊กตาบน/ตุ๊กตาล่าง) — แต่ละตัวมีรูปของตัวเอง (รูป optional)
//     · gate = อย่างน้อย 1 หน้าปัดต่อคู่ (เงิน บน-หรือ-ล่าง · ตุ๊กตา บน-หรือ-ล่าง) ให้ตรงกับ server (top ?? bottom)
//     · ห้าม pre-fill มิเตอร์ (กัน confirm-bias — แม่บ้านต้องกรอกเลขจริงที่เห็น)
//   - รูปตู้ (machine) + รายการสินค้าในตู้ (loadout) — เพิ่ม SKU ผ่าน sheet เดียว (จากคลัง / เพิ่มใหม่)
//   - ตั้งชื่อเล่นตู้ได้ตั้งแต่หน้านี้ (✎ ที่หัวข้อ → renameMachineNickname · reflect ทันทีไม่ต้อง reload)
// submit → submitFirstBaseline({... clientKey=randomUUID}) · ถ้าตู้ตั้งแล้ว → ข้อความเป็นมิตร · ok → onDone().
// ⚪ neutral = ช่องว่าง (ยังไม่กรอก) ไม่ใช่แดง. money logic ทำที่ server — ฟอร์มแค่เก็บ+ส่ง.
//
// 🎨 LeanUX 2026-07-14 (CEO — ย่อหน้าให้สั้น·ใช้ง่าย):
//   1) มิเตอร์ = 1 การ์ด แต่ละตัวย่อเหลือ [ช่องเลข] + ไอคอนกล้องเล็ก (compact) บรรทัดเดียว (เดิมปุ่มถ่ายรูปกล่องใหญ่ 88px)
//   2) เพิ่มสินค้าในตู้ = ปุ่มเล็กปุ่มเดียว → bottom-sheet รวม 2 แท็บ (เลือกจากคลัง / เพิ่มใหม่) — ไม่มีฟอร์มยาวค้างในหน้า
//   3) "ตุ๊กตาในตู้ตอนนี้" = การ์ดสรุปเลขรวม + กดขยายดูรายการ SKU (หุบไว้เป็น default)

import { useState, useTransition } from "react";
import { submitFirstBaseline } from "@/lib/clawfleet/baseline-actions";
import {
  addSetupProductWithDolls,
  addExistingProductDollsAtSetup,
} from "@/lib/clawfleet/product-setup-actions";
import { renameMachineNickname } from "@/lib/clawfleet/actions";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";

const MAX_COUNT = 100_000;

// สินค้าที่บันทึกว่า "อยู่ในตู้" ตอนตั้งค่าครั้งแรก (มีในทะเบียนแล้ว หรือเพิ่งเพิ่มใหม่ — server persist ยอดต่อ SKU ให้แล้ว)
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
  // ตุ๊กตา "ในตู้ตอนนี้" = รายการต่อ SKU (persist ทันทีต่อ SKU) · ยอดรวม = ผลบวก (ระบบคิดให้)
  const [inMachine, setInMachine] = useState<AddedProduct[]>([]);
  const [dollsAdded, setDollsAdded] = useState<number | null>(null);
  const [cash, setCash] = useState<string>(""); // บาท (string เพื่อให้ช่องว่างได้จริง)
  // ดีไซน์ใหม่ · ราคาขายตุ๊กตา "ต่อตู้" (ราคาเดียว · บาท) — ตั้งตอนตั้งค่าครั้งแรก (display/reference)
  const [machinePrice, setMachinePrice] = useState<string>("");

  // 4 มิเตอร์ + รูปของแต่ละตัว — ว่างหมด (ห้าม pre-fill)
  const [meterVals, setMeterVals] = useState<Record<MeterKey, string>>({
    moneyTop: "", moneyBottom: "", dollTop: "", dollBottom: "",
  });
  const [meterPhotos, setMeterPhotos] = useState<Record<MeterKey, string>>({
    moneyTop: "", moneyBottom: "", dollTop: "", dollBottom: "",
  });
  const [machinePhoto, setMachinePhoto] = useState<string>("");

  // ชื่อเล่นตู้ (แก้ได้ตั้งแต่หน้านี้)
  const [nickname, setNickname] = useState<string | null>(machine.nickname);
  const [nickSheet, setNickSheet] = useState(false);

  // sheet เพิ่มสินค้า + toggle ขยายรายการ SKU
  const [addSheet, setAddSheet] = useState(false);
  const [showList, setShowList] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ยอดรวมตุ๊กตา "ในตู้ตอนนี้" = ผลบวกทุก SKU (ระบบคิดให้ · ตรงกับที่ server บันทึกต่อ SKU)
  const totalInMachine = inMachine.reduce((s, p) => s + p.qty, 0);
  // id สินค้าที่ "อยู่ในตู้" แล้ว (กันเลือกซ้ำใน picker)
  const inMachineIds = new Set<string>(inMachine.map((p) => p.id));

  // scope id เดียวต่อการเปิดฟอร์ม (ให้ PhotoCaptureButton จัด queue รูปแยกจากตู้/รอบอื่น)
  const [scopeId] = useState(() => `baseline-${machine.id}`);

  const setMeter = (key: MeterKey, raw: string) => {
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
    // ตุ๊กตาในตู้ = ผลรวมต่อ SKU (totalInMachine) · ตู้ว่างจริง (0) ก็ตั้งได้ · มิเตอร์คือด่านหลัก
    // เลขมิเตอร์ = anchor · ต้องมีอย่างน้อย 1 หน้าปัดต่อคู่ ให้ตรงกับ server + คณิต (top ?? bottom)
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
        dollCountNow: totalInMachine,
        dollsAdded: dollsAdded ?? 0,
        cashCents: Math.round(cashBaht * 100),
        sellPriceCents: machinePrice.trim() === "" ? undefined : Math.round(Number(machinePrice) * 100),
        meterMoneyTop: parseMeter("moneyTop"),
        meterMoneyBottom: parseMeter("moneyBottom"),
        meterDollTop: parseMeter("dollTop"),
        meterDollBottom: parseMeter("dollBottom"),
        photoMachineUrl: machinePhoto || undefined,
        photoMoneyMeterTopUrl: meterPhotos.moneyTop || undefined,
        photoMoneyMeterBottomUrl: meterPhotos.moneyBottom || undefined,
        photoDollMeterTopUrl: meterPhotos.dollTop || undefined,
        photoDollMeterBottomUrl: meterPhotos.dollBottom || undefined,
        // per-SKU ถูก persist แล้วผ่าน addSetup/addExisting (sheet) → ไม่ส่งซ้ำ
        loadout: [],
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
      {/* header — ทำได้ครั้งเดียว + ✎ ตั้งชื่อเล่น */}
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

      {/* ── ราคาขายของตู้นี้ (ราคาเดียวต่อตู้) — ดีไซน์ใหม่ ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EEF0FE", border: "1px solid #DADBF8", borderRadius: 12, padding: "11px 14px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3730B0" }}>ราคาขายของตู้นี้</div>
          <div style={{ fontSize: 10.5, color: "#7C7FC4" }}>ตั้งราคาเดียวต่อตู้ (ตุ๊กตาทุกแบบในตู้นี้ราคาเท่ากัน)</div>
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#4F46E5" }}>฿</span>
        <input value={machinePrice} onChange={(e) => setMachinePrice(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0" className="num"
          style={{ width: 82, fontSize: 16, fontWeight: 700, textAlign: "right", padding: "7px 10px", border: "1.5px solid #C4C8FA", borderRadius: 9, color: "#4F46E5", background: "#fff", flex: "0 0 82px" }} />
      </div>

      {/* ── ตุ๊กตาในตู้ตอนนี้ — ยอดรวม (ระบบคิดให้) + กดขยายดูรายการ SKU + ปุ่มเล็กเพิ่มสินค้า → sheet ── */}
      <div className="co-card" style={{ padding: 15, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21" }}>ตุ๊กตาในตู้ตอนนี้</div>
            <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>ยอดรวมทุก SKU (ระบบคิดให้)</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: totalInMachine > 0 ? "#1A1D21" : "#C1C5CC", lineHeight: 1 }}>
              {totalInMachine.toLocaleString("th-TH")}
            </span>
            <span style={{ fontSize: 12.5, color: "#9AA1AB", fontWeight: 600 }}>ตัว</span>
          </div>
        </div>

        {/* กดขยายดูรายการ SKU (หุบไว้ default) — โชว์ปุ่มเฉพาะเมื่อมีของในตู้ */}
        {inMachine.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowList((v) => !v)}
              className="co-tap"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                width: "100%", padding: "8px 0", borderRadius: 10, cursor: "pointer",
                border: "1px solid #ECEDF3", background: "#F8F9FC",
                color: "#4F46E5", fontSize: 12.5, fontWeight: 700,
              }}
            >
              {showList ? "ซ่อนรายการ" : `ดูรายการ (${inMachine.length} ชนิด)`}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: showList ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {showList && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {inMachine.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ProductThumb imageUrl={p.imageUrl} name={p.name} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1A1D21", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#9AA1AB" }}>{[p.sku, machinePrice ? `ขาย ฿${machinePrice}` : null].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21" }}>
                      {p.qty.toLocaleString("th-TH")} <span style={{ fontSize: 11.5, fontWeight: 600, color: "#9AA1AB" }}>ตัว</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {totalInMachine === 0 && (
          <div style={{ fontSize: 12, color: "#9AA1AB", lineHeight: 1.4 }}>
            ยังไม่ได้ระบุสินค้า — แตะปุ่มด้านล่างเพื่อเพิ่ม (ตู้ว่างจริงข้ามได้)
          </div>
        )}

        {/* ปุ่มเล็กปุ่มเดียว → เปิด sheet (จากคลัง / เพิ่มใหม่) */}
        <button
          type="button"
          onClick={() => setAddSheet(true)}
          className="co-tap"
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 12,
            border: "1.5px dashed #C7CBF5", background: "#F7F8FF",
            color: "#4F46E5", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          เพิ่มสินค้าในตู้
        </button>
      </div>

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

      {/* ── 4 มิเตอร์ — 1 การ์ด · แต่ละตัวย่อ [ช่องเลข] + ไอคอนกล้องเล็ก บรรทัดเดียว ── */}
      <div className="co-card" style={{ padding: 15, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21" }}>อ่านมิเตอร์ 4 ตัว</div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2, lineHeight: 1.4 }}>
            กรอกเลขที่เห็นจริง · <b>อ่านไม่ได้? แตะกล้อง 📷 ถ่ายรูปแทน</b>
          </div>
        </div>
        {METERS.map((m) => {
          const filled = meterVals[m.key].trim() !== "";
          const hasPhoto = !!meterPhotos[m.key];
          const done = filled || hasPhoto;
          return (
            <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#454B54", flex: 1 }}>{m.label}</span>
                <span
                  className="co-pill"
                  style={{ background: done ? "#E7F4EC" : "#F1F2F7", color: done ? "#15803D" : "#9AA1AB" }}
                >
                  {filled ? "กรอกแล้ว" : hasPhoto ? "มีรูป" : "ยังว่าง"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  value={meterVals[m.key]}
                  onChange={(e) => setMeter(m.key, e.target.value)}
                  inputMode="numeric"
                  placeholder="อ่านเลขมิเตอร์"
                  className="co-input num"
                  style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}
                />
                <PhotoCaptureButton
                  compact
                  label={`ถ่ายรูป ${m.label}`}
                  value={meterPhotos[m.key]}
                  onChange={(url) => setMeterPhoto(m.key, url)}
                  orgId={orgId}
                  machineCode={machine.code}
                  eventScopeId={scopeId}
                  phase={m.phase}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* รูปตู้ — compact (ข้อความ + ไอคอนกล้องเล็ก) */}
      <div className="co-card" style={{ padding: 15, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21" }}>รูปตู้ (ไม่บังคับ)</div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>
            {machinePhoto ? "ถ่ายแล้ว · แตะเพื่อถ่ายใหม่" : "ถ่ายหน้าตู้ไว้เป็นหลักฐานตั้งต้น"}
          </div>
        </div>
        <PhotoCaptureButton
          compact
          label="ถ่ายรูปตู้"
          value={machinePhoto}
          onChange={setMachinePhoto}
          orgId={orgId}
          machineCode={machine.code}
          eventScopeId={scopeId}
          phase="machine"
        />
      </div>

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

      {/* sheet เพิ่มสินค้าในตู้ (จากคลัง / เพิ่มใหม่) — persist ต่อ SKU ทันที */}
      {addSheet && (
        <AddProductSheet
          machine={machine}
          branchId={branchId}
          orgId={orgId}
          scopeId={scopeId}
          existingProducts={products.filter((p) => !inMachineIds.has(p.id))}
          onSaved={(p) => {
            setInMachine((cur) => [...cur, p]);
            setShowList(true);
          }}
          onClose={() => setAddSheet(false)}
        />
      )}

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

/* ── CountField — ช่องนับ "พิมพ์เลขได้" + ปุ่ม −/+ (mirror staff-app-client CountField). */
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

/* thumbnail สินค้า (รูป หรือ placeholder icon) */
function ProductThumb({ imageUrl, name, size = 38 }: { imageUrl: string | null; name: string; size?: number }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt={name} style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 9, objectFit: "cover", background: "#F1F2F7" }} />
    );
  }
  return (
    <div style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 9, background: "#F1F2F7", display: "flex", alignItems: "center", justifyContent: "center", color: "#A9AEB8" }}>
      <svg width={size * 0.47} height={size * 0.47} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="m21 15-5-5L5 21" /></svg>
    </div>
  );
}

/* ── AddProductSheet — bottom-sheet เพิ่มสินค้าในตู้ (LeanUX 2026-07-14) ────────────
   รวม 2 ทางเดิม (เลือกจากคลัง / เพิ่มใหม่) เป็นชีทเดียว สลับด้วยแท็บ:
     · จากคลัง → addExistingProductDollsAtSetup (เลือก SKU ที่มีในทะเบียน + จำนวน)
     · เพิ่มใหม่ → addSetupProductWithDolls (ชื่อ + SKU + รูป + จำนวน · server สร้าง product ให้)
   persist ต่อ SKU ทันทีที่บันทึก (idempotent · clientKey ใหม่ทุกครั้ง) → onSaved(p) แล้วรีเซ็ตฟอร์ม
   (ค้างชีทไว้ให้เพิ่มตัวถัดไปเร็ว) · picker อัปเดตเองเพราะ parent กรองตัวที่เข้าตู้แล้วออก. */
function AddProductSheet({
  machine,
  branchId,
  orgId,
  scopeId,
  existingProducts,
  onSaved,
  onClose,
}: {
  machine: { id: string; code: string };
  branchId: string;
  orgId: string;
  scopeId: string;
  existingProducts: { id: string; name: string; imageUrl: string | null }[];
  onSaved: (p: AddedProduct) => void;
  onClose: () => void;
}) {
  // แท็บเริ่มต้น: มีของในคลังให้เลือก → "จากคลัง" · ไม่มี → "เพิ่มใหม่"
  const [tab, setTab] = useState<"existing" | "new">(existingProducts.length > 0 ? "existing" : "new");

  // จากคลัง
  const [selId, setSelId] = useState<string>("");
  const [exQty, setExQty] = useState<number | null>(null);
  // เพิ่มใหม่
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [photo, setPhoto] = useState("");
  const [newQty, setNewQty] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const sel = existingProducts.find((p) => p.id === selId) ?? null;

  function resetExisting() { setSelId(""); setExQty(null); }
  function resetNew() { setName(""); setSku(""); setPhoto(""); setNewQty(null); }

  async function saveExisting() {
    setError(null);
    if (!sel) { setError("เลือกสินค้าก่อน"); return; }
    if (exQty == null || exQty <= 0) { setError("ใส่จำนวนตุ๊กตาในตู้ (มากกว่า 0)"); return; }
    setBusy(true);
    try {
      const res = await addExistingProductDollsAtSetup({
        machineId: machine.id,
        branchId,
        productId: sel.id,
        qty: exQty,
        clientKey: crypto.randomUUID(),
      });
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      onSaved({ id: sel.id, name: sel.name, sku: "", qty: exQty, imageUrl: sel.imageUrl });
      setFlash(`เพิ่ม “${sel.name}” แล้ว`);
      resetExisting();
    } catch {
      setError("บันทึกไม่สำเร็จ · ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  async function addNew() {
    setError(null);
    if (name.trim() === "") { setError("กรอกชื่อสินค้าก่อน"); return; }
    if (sku.trim() === "") { setError("กรอกรหัส SKU ก่อน"); return; }
    if (newQty == null || newQty <= 0) { setError("ใส่จำนวนตุ๊กตาในตู้ (มากกว่า 0)"); return; }
    setBusy(true);
    try {
      const res = await addSetupProductWithDolls({
        machineId: machine.id,
        branchId,
        name: name.trim(),
        sku: sku.trim(),
        imageUrl: photo || undefined,
        qty: newQty,
        clientKey: crypto.randomUUID(),
      });
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      onSaved({ id: res.data.productId, name: name.trim(), sku: sku.trim(), qty: newQty, imageUrl: photo || null });
      setFlash(`เพิ่ม “${name.trim()}” แล้ว`);
      resetNew();
    } catch {
      setError("เพิ่มสินค้าไม่สำเร็จ · ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (key: "existing" | "new", text: string) => {
    const on = tab === key;
    return (
      <button
        type="button"
        onClick={() => { setTab(key); setError(null); }}
        className="co-tap"
        style={{
          flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer",
          background: on ? "#fff" : "transparent",
          color: on ? "#4F46E5" : "#6B7280",
          fontSize: 13, fontWeight: 700,
          boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
        }}
      >
        {text}
      </button>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`เพิ่มสินค้าในตู้ ${machine.code}`}
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
    >
      <button type="button" aria-label="ปิด" onClick={() => { if (!busy) onClose(); }}
        style={{ position: "absolute", inset: 0, background: "rgba(15,18,26,0.42)", border: "none", cursor: busy ? "default" : "pointer" }} />
      <div style={{ position: "relative", background: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 18px 22px", boxShadow: "0 -8px 30px rgba(0,0,0,0.18)", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "#E3E6EA", margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>เพิ่มสินค้าในตู้</div>
            <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ตู้ <span className="num">{machine.code}</span> · เพิ่มได้หลายชนิด</div>
          </div>
          <button type="button" aria-label="ปิด" onClick={() => { if (!busy) onClose(); }} className="co-tap"
            style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* แท็บสลับ */}
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 11, background: "#F1F2F7", marginBottom: 14 }}>
          {tabBtn("existing", "เลือกจากคลัง")}
          {tabBtn("new", "เพิ่มใหม่")}
        </div>

        {flash && (
          <div style={{ marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: "#15803D", background: "#E7F4EC", border: "1px solid #B7E3C6", borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            {flash} · เพิ่มตัวถัดไปได้เลย
          </div>
        )}

        {tab === "existing" ? (
          existingProducts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#9AA1AB", textAlign: "center", padding: "18px 0", lineHeight: 1.5 }}>
              ไม่มีสินค้าในคลังให้เลือกแล้ว<br />(เพิ่มใหม่ได้ที่แท็บ “เพิ่มใหม่”)
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                {existingProducts.map((p) => {
                  const on = p.id === selId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelId(p.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: on ? "1.5px solid #4F46E5" : "1.5px solid #ECEDF6", background: on ? "#EEF0FF" : "#fff", cursor: "pointer", textAlign: "left" }}
                    >
                      <ProductThumb imageUrl={p.imageUrl} name={p.name} size={34} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "#1A1D21", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      {on && <span style={{ color: "#4F46E5", fontWeight: 800 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#454B54", marginBottom: 7 }}>มีในตู้กี่ตัว</div>
                <Stepper value={exQty} unit="ตัว" placeholder="นับแล้วแตะ +"
                  onDec={() => setExQty((c) => Math.max(0, (c ?? 0) - 1))}
                  onInc={() => setExQty((c) => Math.min(MAX_COUNT, (c ?? 0) + 1))} />
              </div>
              {error && <div style={{ fontSize: 12, color: "#B45309", fontWeight: 600 }}>{error}</div>}
              <button type="button" disabled={busy} onClick={saveExisting} className="co-tap"
                style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: busy ? "#B9BCF0" : "#4F46E5", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
                {busy ? "กำลังบันทึก…" : "บันทึกในตู้"}
              </button>
            </div>
          )
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "#454B54" }}>
                {photo ? "ถ่ายรูปตุ๊กตาแล้ว · แตะเพื่อถ่ายใหม่" : "ถ่ายรูปตุ๊กตา (ไม่บังคับ)"}
              </span>
              <PhotoCaptureButton
                compact
                label="ถ่ายรูปตุ๊กตา"
                value={photo}
                onChange={setPhoto}
                orgId={orgId}
                machineCode={machine.code}
                eventScopeId={`${scopeId}-newprod`}
                phase="product_setup"
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#454B54", marginBottom: 7 }}>มีในตู้กี่ตัว</div>
              <Stepper value={newQty} unit="ตัว" placeholder="นับแล้วแตะ +"
                onDec={() => setNewQty((c) => Math.max(0, (c ?? 0) - 1))}
                onInc={() => setNewQty((c) => Math.min(MAX_COUNT, (c ?? 0) + 1))} />
            </div>
            {error && <div style={{ fontSize: 12, color: "#B45309", fontWeight: 600 }}>{error}</div>}
            <button type="button" disabled={busy} onClick={addNew} className="co-tap"
              style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: busy ? "#B9BCF0" : "#4F46E5", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
              {busy ? "กำลังเพิ่ม…" : "＋ เพิ่มสินค้า + บันทึกในตู้"}
            </button>
          </div>
        )}

        {/* ปุ่มปิด/เสร็จ */}
        <button type="button" onClick={() => { if (!busy) onClose(); }} className="co-tap"
          style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12, border: "1.5px solid #E3E6EA", background: "#fff", color: "#5A6270", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          เสร็จแล้ว
        </button>
      </div>
    </div>
  );
}

/* ── NicknameSheet — bottom-sheet ตั้งชื่อเล่นตู้ (mirror staff-app-client NicknameSheet). */
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
