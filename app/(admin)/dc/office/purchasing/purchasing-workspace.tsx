"use client";

// DC · ใบสั่งซื้อจีน — workspace (client) ที่คุม 2 มุมมองในจอเดียว:
//   • "รายการ + รายละเอียด" (master-detail · ค่าเริ่มต้น): ซ้าย=ลิสต์ใบ · ขวา=รายละเอียดใบที่เลือก
//   • "บอร์ดสถานะ" (Kanban): 5 คอลัมน์ตาม flow + action หลักต่อคอลัมน์
// บนสุด: สถิติ "งานค้างวันนี้" + ปุ่มสลับมุมมอง + ปุ่ม "＋ สั่งซื้อ" (จีน ¥ / ไทย ฿).
// อ่านอย่างเดียวฝั่งลิสต์ — action ทั้งหมดอยู่ในแผงรายละเอียด (<PoDetail>) หรือหน้า /[id].

import { useState } from "react";
import Link from "next/link";
import { Plus, LayoutGrid, Columns } from "lucide-react";
import { MasterDetailView } from "./master-detail-view";
import { KanbanBoard } from "./kanban-board";

// ── shared types (ส่งมาจาก server) ───────────────────────────
export type PoListItem = {
  id: string;
  poCode: string;
  status: string;
  origin: string;
  currency: string;
  supplierName: string | null;
  total: number;
  lineCount: number;
  boxCount: number;
  hasTracking: boolean; // มีกล่องที่มีเลขพัสดุแล้วหรือยัง (ไว้ derive "รอใส่ข้อมูล")
  date: string; // ISO
};

export type PurchasingStats = {
  pendingTracking: number; // สั่งแล้วรอใส่ Tracking
  pendingGrn: number; // ค้างรับเข้า (GRN)
  inTransit: number; // ของระหว่างทาง
};

export type ViewMode = "detail" | "kanban";

// ── shared helpers (ใช้ร่วมกับ master-detail + kanban) ────────
export function fmtMoney(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(iso));
}
/** สัญลักษณ์เงินตาม origin: จีน=¥ · ไทย=฿ (fallback ดูจาก currency). */
export function moneySym(item: { origin: string; currency: string }): string {
  if (item.origin === "THAI" || item.currency === "THB") return "฿";
  return "¥";
}
/** "รอใส่ข้อมูล" = ใบที่สั่งแล้ว/ได้เลขแล้ว แต่ยังไม่มีกล่องที่มีเลขพัสดุ (รอกรอก Tracking). */
export function needsInput(item: PoListItem): boolean {
  return (item.status === "ORDERED" || item.status === "SHIPPED") && !item.hasTracking;
}

export function PurchasingWorkspace({
  items,
  stats,
  canManage,
  r2PublicUrl,
}: {
  items: PoListItem[];
  stats: PurchasingStats;
  canManage: boolean;
  r2PublicUrl: string;
}) {
  const [view, setView] = useState<ViewMode>("detail");

  return (
    <div className="dc-pur">
      {/* แถวบน: สถิติงานค้าง + สลับมุมมอง + ปุ่มสั่งซื้อ */}
      <div className="dc-pur-bar">
        <StatStrip stats={stats} />
        <div className="dc-pur-bar__right">
          <ViewToggle view={view} onChange={setView} />
          {canManage && <NewPoButton />}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="dc-card dc-pur-empty">
          ยังไม่มีใบสั่งซื้อ — กด “＋ สั่งซื้อ” เพื่อสร้างใบแรก
        </div>
      ) : view === "detail" ? (
        <MasterDetailView items={items} canManage={canManage} r2PublicUrl={r2PublicUrl} />
      ) : (
        <KanbanBoard items={items} />
      )}
    </div>
  );
}

// ── สถิติ "งานค้างวันนี้" ───────────────────────────────────
function StatStrip({ stats }: { stats: PurchasingStats }) {
  return (
    <div className="dc-pur-stats" aria-label="งานค้างวันนี้">
      <span className="dc-pur-stats__label">งานค้างวันนี้</span>
      <span className="dc-pur-stat">
        <b>{stats.pendingTracking}</b> ใบสั่งแล้วรอใส่ Tracking
      </span>
      <span className="dc-pur-stats__dot" aria-hidden>·</span>
      <span className="dc-pur-stat">
        <b>{stats.pendingGrn}</b> ใบรับเข้า (GRN)
      </span>
      <span className="dc-pur-stats__dot" aria-hidden>·</span>
      <span className="dc-pur-stat">
        <b>{stats.inTransit}</b> ของระหว่างทางถึงวันนี้
      </span>
    </div>
  );
}

// ── สลับมุมมอง: บอร์ดสถานะ ⇄ รายการ + รายละเอียด ─────────────
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="dc-mode-switch dc-pur-toggle" role="tablist" aria-label="สลับมุมมอง">
      <button
        type="button"
        role="tab"
        aria-selected={view === "kanban"}
        className={`dc-mode-pill${view === "kanban" ? " is-active" : ""}`}
        onClick={() => onChange("kanban")}
      >
        <LayoutGrid size={15} /> บอร์ดสถานะ
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "detail"}
        className={`dc-mode-pill${view === "detail" ? " is-active" : ""}`}
        onClick={() => onChange("detail")}
      >
        <Columns size={15} /> รายการ + รายละเอียด
      </button>
    </div>
  );
}

// ── ปุ่มสั่งซื้อ + เลือกจีน/ไทย ───────────────────────────────
function NewPoButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="dc-pur-new">
      <button
        type="button"
        className="dc-btn-xl dc-pur-new__btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus size={18} /> สั่งซื้อ
      </button>
      {open && (
        <>
          <div className="dc-pur-new__scrim" onClick={() => setOpen(false)} />
          <div role="menu" className="dc-pur-new__menu">
            <Link
              href="/dc/office/purchasing/new?origin=china"
              role="menuitem"
              className="dc-pur-new__item"
              onClick={() => setOpen(false)}
            >
              <span className="dc-pur-new__flag">🇨🇳</span>
              <span>
                <b>สั่งจากจีน</b>
                <br />
                <span className="dc-pur-new__hint">ราคาเป็นหยวน (¥) · มีกล่อง/CBM</span>
              </span>
            </Link>
            <Link
              href="/dc/office/purchasing/new?origin=thai"
              role="menuitem"
              className="dc-pur-new__item"
              onClick={() => setOpen(false)}
            >
              <span className="dc-pur-new__flag">🇹🇭</span>
              <span>
                <b>ซื้อในไทย</b>
                <br />
                <span className="dc-pur-new__hint">ราคาเป็นบาท (฿)</span>
              </span>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
