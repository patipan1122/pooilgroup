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
  product: { id: string; name: string; imageUrl: string | null };
  /** จำนวนที่นับได้ · null = ยังไม่นับ (โชว์ placeholder ไม่ใช่ 0) */
  value: number | null;
  onChange: (n: number) => void;
  /** บริบทสำหรับ PhotoCaptureButton (อัปรูปขึ้น R2) */
  orgId?: string;
  machineCode?: string;
  eventScopeId?: string;
  /** url รูปที่ถ่ายแล้ว (ถ้ามี) + callback เมื่อได้ url จริง */
  photoUrl?: string;
  onPhoto?: (url: string) => void;
}

export function ProductCountCard({
  product,
  value,
  onChange,
  orgId = "",
  machineCode = "",
  eventScopeId = "",
  photoUrl = "",
  onPhoto,
}: ProductCountCardProps) {
  const counted = value != null;
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
        <ProductThumb imageUrl={product.imageUrl} name={product.name} />
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
          <div style={{ marginTop: 3, fontSize: 11.5, color: counted ? "#5A6270" : "#9AA1AB", fontWeight: 500 }}>
            {counted ? "นับได้แล้ว" : "ยังไม่นับ"}
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

      {/* แนบรูปหลักฐานการนับ */}
      <PhotoCaptureButton
        label="ถ่ายรูปตอนนับ (ถ่ายได้-ข้ามได้)"
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
function ProductThumb({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        style={{ width: 56, height: 56, flex: "0 0 56px", borderRadius: 12, objectFit: "cover", background: "#F1F2F7" }}
      />
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
