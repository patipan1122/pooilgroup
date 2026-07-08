"use client";

// ClawFleet · ตู้คีบ OS — bigfeature WAVE 2D · R4 ตัวเลือกสินค้าเติมจากคลังสาขา (mobile)
// -----------------------------------------------------------------------------
// เดิม refill ใช้ dropdown บาง ๆ ไม่มีรูป · ไม่ผูกคลังสาขา → แม่บ้านเดาสินค้าเอง.
// R4: เลือกสินค้าที่จะเติม "จากของที่มีในคลังสาขาจริง" · การ์ดมีรูป + ยอดคงคลัง.
//   - เลือก 1 ใบ → onPick(productId) (ตั้งสินค้าที่จะเติม)
//   - คงคลัง 0/ใกล้หมด → เตือน (⚠️ amber) แต่ "ไม่บล็อก" ที่นี่ — server เป็นคนกันเกินคลังจริง
//     (memory: warn-not-block ในหน้า UI · guard อยู่ที่ action)
// ⚪ neutral = ปกติ · amber = ใกล้หมด · red สงวนไว้ (ไม่ใช้ที่นี่). ภาษาดีไซน์เดิม (co-card/tokens).

import { num } from "@/components/clawfleet/os/format";

const LOW_STOCK_THRESHOLD = 8; // ต่ำกว่านี้ = เตือน "ใกล้หมด" (ตรงกับ CF_REORDER_LEVEL)

export interface BranchStockPickerProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  warehouse: number; // คงคลังสาขา (ไม่รวมในตู้)
}

export interface BranchStockPickerProps {
  products: BranchStockPickerProduct[];
  /** productId ที่เลือกอยู่ · null = ยังไม่เลือก */
  value: string | null;
  onPick: (productId: string) => void;
}

export function BranchStockPicker({ products, value, onPick }: BranchStockPickerProps) {
  if (products.length === 0) {
    return (
      <div
        className="co-card"
        style={{ padding: "28px 20px", textAlign: "center", color: "#9AA1AB", fontSize: 13 }}
      >
        <div style={{ marginBottom: 8, opacity: 0.6, display: "flex", justifyContent: "center" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" />
            <path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M10 12h4" />
          </svg>
        </div>
        <div style={{ fontWeight: 700, color: "#5A6270" }}>คลังสาขานี้ยังไม่มีสินค้า</div>
        <div style={{ fontSize: 12, marginTop: 3 }}>รับสินค้าเข้าคลังก่อน แล้วค่อยเติมเข้าตู้</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {products.map((p) => {
        const selected = value === p.id;
        const empty = p.warehouse <= 0;
        const low = !empty && p.warehouse <= LOW_STOCK_THRESHOLD;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="co-tap co-lift"
            style={{
              textAlign: "left",
              padding: 11,
              borderRadius: 14,
              cursor: "pointer",
              background: "#fff",
              border: selected ? "2px solid #4F46E5" : "1.5px solid #E8EAED",
              boxShadow: selected ? "0 0 0 3px rgba(79,70,229,0.10)" : "none",
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            <div style={{ position: "relative" }}>
              <PickerThumb imageUrl={p.imageUrl} name={p.name} />
              {selected && (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "#4F46E5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1A1D21",
                lineHeight: 1.25,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                minHeight: 32,
              }}
            >
              {p.name}
            </div>
            {/* ยอดคงคลัง — 0/ใกล้หมด = amber เตือน (ไม่บล็อก) · ปกติ = neutral */}
            <span
              className="co-pill num"
              style={{
                alignSelf: "flex-start",
                background: empty ? "#FCEDEC" : low ? "#FCF1E2" : "#F1F2F7",
                color: empty ? "#B42318" : low ? "#B45309" : "#5A6270",
              }}
            >
              {empty ? "คลังหมด" : `คลัง ${num(p.warehouse)}${low ? " · ใกล้หมด" : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── รูปสินค้าในการ์ด picker (มี → แสดง · null → placeholder) ─────────────── */
function PickerThumb({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 10, objectFit: "cover", background: "#F1F2F7", display: "block" }}
      />
    );
  }
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 10,
        background: "#F1F2F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#A9AEB8",
      }}
    >
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.6" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    </div>
  );
}
