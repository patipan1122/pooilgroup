"use client";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 2D · N3 การ์ดนับสต๊อกรายสินค้า (mobile)
// -----------------------------------------------------------------------------
// การ์ดใหญ่ 1 ใบต่อ 1 สินค้า สำหรับหน้านับสต๊อกมือถือ (แม่บ้านนับของในคลังสาขา):
//   - รูปสินค้าใหญ่ + ชื่อ (รูปไม่มี → placeholder · ยังนับได้)
//   - stepper +/− (ไม่เด้ง numeric keyboard · แตะนิ้วโป้งง่าย · big tap target)
//   - ค่าเริ่ม "ว่าง" (value=null → placeholder ไม่ใช่ 0 · กัน confirm-bias นับตาบอด)
//   - ช่องแนบรูป (PhotoCaptureButton phase="stock_count") เป็นหลักฐานการนับ
// ⚪ gray = neutral (ยังไม่นับ) · ไม่ใช่แดง (memory: incomplete ≠ ผิด). money logic ทำที่ server.

import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import { num } from "@/components/clawfleet/os/format";

const MAX_COUNT = 100_000;

export interface ProductCountCardProps {
  // sku/defaultPriceCoins optional (บาง call site เก่ายังไม่ส่ง) — DISPLAY เท่านั้น (item 9)
  product: { id: string; name: string; imageUrl: string | null; sku?: string; defaultPriceCoins?: number };
  /** จำนวนที่นับได้ · null = ยังไม่นับ (โชว์ placeholder ไม่ใช่ 0) */
  value: number | null;
  onChange: (n: number) => void;
  /** ระบบว่ามีเท่าไร (คงคลังสาขาตาม ledger) — DISPLAY hint เทียบตอนนับ · undefined = ไม่โชว์.
   *  ★ server คิดส่วนต่างจริงตอนส่ง (money-safe) — เลขนี้แค่ช่วยไม่ให้นับตาบอด ไม่ใช่เลขที่ตัดยอด. */
  expected?: number;
  /** บริบทสำหรับ PhotoCaptureButton (อัปรูปขึ้น R2) */
  orgId?: string;
  machineCode?: string;
  eventScopeId?: string;
  /** url รูปที่ถ่ายแล้ว (ถ้ามี) + callback เมื่อได้ url จริง */
  photoUrl?: string;
  onPhoto?: (url: string) => void;
  /** CEO 2026-07-18 · แตะรูปสินค้า → ดูขยาย (parent เปิด lightbox) */
  onImageTap?: (url: string, name: string) => void;
}

export function ProductCountCard({
  product,
  value,
  onChange,
  expected,
  orgId = "",
  machineCode = "",
  eventScopeId = "",
  photoUrl = "",
  onPhoto,
  onImageTap,
}: ProductCountCardProps) {
  const counted = value != null;
  // เทียบกับ "ระบบว่ามี" — โชว์เฉพาะเมื่อรู้ค่า expected (undefined = ไม่โชว์ · call site เก่าไม่พัง).
  //   ส่วนต่าง = นับได้ − ระบบว่ามี (เขียว = ตรง · เหลือง = เกิน · แดง = ขาด). DISPLAY hint เท่านั้น.
  const hasExpected = expected != null;
  // narrow ชัด (TS strict ไม่ไหลผ่าน const boolean) — ต่างสด = นับได้ − ระบบว่ามี
  const diff = expected != null && value != null ? value - expected : null;
  const diffColor = diff == null ? "#9AA1AB" : diff === 0 ? "#15803D" : diff > 0 ? "#B45309" : "#B42318";
  const diffBg = diff == null ? "#F1F2F7" : diff === 0 ? "#EFFAF3" : diff > 0 ? "#FCF1E2" : "#FDECEA";
  const diffBorder = diff == null ? "#E3E6EA" : diff === 0 ? "#C8E9D3" : diff > 0 ? "#F0DDBE" : "#F5CFC9";
  const diffText = diff == null ? "" : diff === 0 ? "ตรงพอดี" : `${diff > 0 ? "+" : ""}${num(diff)}`;
  // item 9 · ราคาขาย = coins/เล่น × 10 (1 coin ≈ 10 บาท) — DISPLAY เท่านั้น (ไม่ให้แก้ที่นี่)
  const priceCoins = product.defaultPriceCoins;
  const priceBaht = priceCoins != null ? priceCoins * 10 : null;
  // stepper: กดครั้งแรกจากว่าง → เริ่มที่ 0 (แล้ว +1) · กันติดลบ · กันเกิน cap
  const step = (delta: number) => {
    const base = value ?? 0;
    const next = Math.max(0, Math.min(MAX_COUNT, base + delta));
    onChange(next);
  };

  return (
    <div
      className="co-card"
      style={{ padding: 13, display: "flex", flexDirection: "column", gap: 12 }}
    >
      {/* หัวการ์ด: รูป + ชื่อ + ตัวเลขที่นับ */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ProductThumb imageUrl={product.imageUrl} name={product.name} onZoom={onImageTap} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 700,
              color: "#1A1D21",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {product.name}
          </div>
          <div style={{ marginTop: 3, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            {/* item 9 · ราคาขาย (ตั้งขายเท่าไร) — pill สีเขียว · DISPLAY เท่านั้น */}
            {priceBaht != null && (
              <span className="num" style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, color: "#15803D", background: "#EFFAF3", border: "1px solid #C8E9D3", borderRadius: 20, padding: "1px 8px" }}>
                ราคาขาย ฿{priceBaht}
              </span>
            )}
            {product.sku && (
              <span className="num" style={{ fontSize: 11, color: "#9AA1AB", fontWeight: 600 }}>{product.sku}</span>
            )}
            <span style={{ fontSize: 11.5, color: counted ? "#5A6270" : "#9AA1AB", fontWeight: 500 }}>
              {counted ? "นับได้แล้ว" : "ยังไม่นับ"}
            </span>
            {/* ★ "ระบบว่ามี" — เทียบตอนนับ (ไม่นับตาบอด) · pill เทากลาง · DISPLAY เท่านั้น */}
            {hasExpected && (
              <span className="num" style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, color: "#5A6270", background: "#F1F2F7", border: "1px solid #E3E6EA", borderRadius: 20, padding: "1px 8px" }}>
                ระบบว่ามี {num(expected!)}
              </span>
            )}
            {/* ★ ส่วนต่างสด (นับได้ − ระบบว่ามี) — เขียวตรง · เหลืองเกิน · แดงขาด · server คิดจริงตอนส่ง */}
            {diff != null && (
              <span className="num" style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, color: diffColor, background: diffBg, border: `1px solid ${diffBorder}`, borderRadius: 20, padding: "1px 8px" }}>
                ต่าง {diffText}
              </span>
            )}
          </div>
        </div>
        {/* ตัวเลขที่นับ — ว่าง = "—" เทา (neutral) · มีค่า = เข้ม */}
        <div
          className="num"
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.5px",
            minWidth: 46,
            textAlign: "right",
            color: counted ? "#1A1D21" : "#C4C9D0",
          }}
        >
          {counted ? num(value) : "—"}
        </div>
      </div>

      {/* stepper +/− (big tap · ไม่มี numeric keyboard) */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
        <StepBtn ariaLabel="ลดจำนวน" disabled={(value ?? 0) <= 0} onClick={() => step(-1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </StepBtn>
        <div
          className="co-tap"
          onClick={() => step(0)}
          style={{
            flex: 1,
            minHeight: 52,
            borderRadius: 12,
            background: counted ? "#EEF0FE" : "#F1F2F7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {counted ? (
            <span className="num" style={{ fontSize: 20, fontWeight: 700, color: "#4F46E5" }}>
              {num(value)} <span style={{ fontSize: 12, fontWeight: 600, color: "#6D5CE8" }}>ตัว</span>
            </span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#9AA1AB" }}>แตะ + เพื่อเริ่มนับ</span>
          )}
        </div>
        <StepBtn ariaLabel="เพิ่มจำนวน" onClick={() => step(1)} primary>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </StepBtn>
      </div>

      {/* แนบรูปหลักฐานการนับ — slim บรรทัดเดียว (เดิมกล่อง 88px ต่อทุก SKU = หน้ายาว 7 จอ) */}
      <PhotoCaptureButton slim
        label={photoUrl ? "รูปตอนนับ ✓" : "ถ่ายรูปตอนนับ (ข้ามได้)"}
        value={photoUrl}
        onChange={(url) => onPhoto?.(url)}
        orgId={orgId}
        machineCode={machineCode}
        eventScopeId={eventScopeId}
        phase="stock_count"
      />
    </div>
  );
}

/* ── รูปสินค้า (มี → แสดง · null → placeholder กล่อง) ─────────────────────── */
function ProductThumb({ imageUrl, name, onZoom }: { imageUrl: string | null; name: string; onZoom?: (url: string, name: string) => void }) {
  if (imageUrl) {
    // CEO 2026-07-18 · แตะรูปสินค้า → ดูขยาย (มี onZoom)
    return (
      <button type="button" onClick={onZoom ? () => onZoom(imageUrl, name) : undefined} className={onZoom ? "co-tap" : undefined}
        style={{ width: 56, height: 56, flex: "0 0 56px", borderRadius: 12, overflow: "hidden", border: "none", padding: 0, background: "#F1F2F7", cursor: onZoom ? "zoom-in" : "default" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </button>
    );
  }
  return (
    <div
      style={{
        width: 56,
        height: 56,
        flex: "0 0 56px",
        borderRadius: 12,
        background: "#F1F2F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#A9AEB8",
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.6" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    </div>
  );
}

/* ── ปุ่ม stepper (52px tap target นิ้วโป้ง) ─────────────────────────────── */
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
        width: 56,
        height: 52,
        flex: "0 0 56px",
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
