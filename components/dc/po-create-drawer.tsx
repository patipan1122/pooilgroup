"use client";

// DC · #6 — รางสไลด์ "สร้างใบสั่งซื้อ" จากขวา เหนือลิสต์จัดซื้อ (ไม่เด้งออกจากหน้า)
// CEO: "สั่งซื้อ ควรอยู่หน้าเดิม ไม่เต็มจอ" → เปิดเป็น panel ขวา · ลิสต์ข้างหลังยังเห็นราง ๆ (backdrop soft).
// ใช้ <PoCreateForm variant="drawer"> (ฟอร์มเดียวกับหน้า /new) → บันทึกเสร็จ ปิดราง + refresh list.
//
// fx: china = เรตวันนี้จาก server (chinaFxRate/Date) · thai = ไม่มีเรต → สลับ origin ทำในรางได้เลย (ไม่ต้องเปลี่ยน URL).

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PoCreateForm } from "@/app/(admin)/dc/office/purchasing/new/po-create-form";
import type { PoSupplierOption } from "@/lib/dc/po-actions";

type Origin = "CHINA" | "THAI";
type WarehouseOpt = { id: string; name: string };

export function PoCreateDrawer({
  open,
  onClose,
  onSaved,
  warehouses,
  suppliers,
  chinaFxRate,
  chinaFxDate,
}: {
  open: boolean;
  onClose: () => void;
  /** บันทึกสำเร็จ → ปิด + refresh list (parent) */
  onSaved: (poId: string) => void;
  warehouses: WarehouseOpt[];
  suppliers: PoSupplierOption[];
  chinaFxRate: number | null;
  chinaFxDate: string | null;
}) {
  const [origin, setOrigin] = useState<Origin>("CHINA");

  // ปิดด้วย Esc + ล็อก scroll พื้นหลังตอนเปิด
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  // china → เรตวันนี้ · thai → ไม่มีเรต (form จะซ่อนช่องเรตเอง)
  const isChina = origin === "CHINA";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70 }} aria-modal="true" role="dialog">
      {/* backdrop soft (CEO #14 — เห็นลิสต์ข้างหลังราง ๆ) */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(24,28,40,.20)" }}
      />

      {/* panel ขวา — มือถือเต็มจอ · จอกว้าง 560px */}
      <aside className="dc-create-drawer" style={panel} onClick={(e) => e.stopPropagation()}>
        <style>{`@keyframes dcDrawerIn { from { transform: translateX(24px); opacity: .4; } to { transform: translateX(0); opacity: 1; } }`}</style>
        <header style={head}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--dc-ink, #1c2533)" }}>
              สร้างใบสั่งซื้อ
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--dc-muted, #5b6676)" }}>
              {isChina ? "สั่งจากจีน · ราคาหยวน แปลงเป็นบาทอัตโนมัติ" : "ซื้อในไทย · ราคาบาท"}
            </p>
          </div>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="ปิด">
            <X size={20} />
          </button>
        </header>

        <div style={body}>
          <PoCreateForm
            origin={origin}
            warehouses={warehouses}
            suppliers={suppliers}
            initialFxRate={isChina ? chinaFxRate : null}
            fxDate={isChina ? chinaFxDate : null}
            variant="drawer"
            onOriginChange={setOrigin}
            onSaved={onSaved}
            onCancel={onClose}
          />
        </div>
      </aside>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  height: "100%",
  width: "min(560px, 100vw)",
  background: "var(--dc-bg, #faf7f1)",
  borderLeft: "1px solid var(--dc-line, #e7ebf2)",
  boxShadow: "-12px 0 40px rgba(20,30,60,.16)",
  display: "flex",
  flexDirection: "column",
  animation: "dcDrawerIn .18s ease-out",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 18px",
  borderBottom: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  flex: "0 0 auto",
};

const closeBtn: React.CSSProperties = {
  flex: "0 0 auto",
  height: 36,
  width: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  color: "var(--dc-muted, #5b6676)",
  cursor: "pointer",
};

const body: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "16px 18px 28px",
  WebkitOverflowScrolling: "touch",
};
