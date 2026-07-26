"use client";

// DC · ใบสั่งซื้อจีน — workspace (client) ที่คุม 2 มุมมองในจอเดียว:
//   • "รายการ + รายละเอียด" (master-detail · ค่าเริ่มต้น): ซ้าย=ลิสต์ใบ · ขวา=รายละเอียดใบที่เลือก
//   • "บอร์ดสถานะ" (Kanban): 5 คอลัมน์ตาม flow + action หลักต่อคอลัมน์
// บนสุด: แท็บย่อย (#16) + สถิติงานค้าง + สลับมุมมอง + ปุ่ม "＋ สั่งซื้อ" (เปิดราง #6) + "รวมจ่าย" (#13).
// #6: สั่งซื้อเปิดเป็น "รางสไลด์ขวา" เหนือลิสต์ (ไม่เด้งออกจากหน้า) · #13: รวมจ่ายหลายใบในราง.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, LayoutGrid, Columns, Wallet, Table2 } from "lucide-react";
import { MasterDetailView } from "./master-detail-view";
import { KanbanBoard } from "./kanban-board";
import { TableView } from "./table-view";
import { PurchasingSubnav } from "@/components/dc/purchasing-subnav";
import { PoCreateDrawer } from "@/components/dc/po-create-drawer";
import { BulkPayDrawer } from "@/components/dc/bulk-pay-drawer";
import type { PoSupplierOption } from "@/lib/dc/po-actions";

// ── shared types (ส่งมาจาก server) ───────────────────────────
export type PoLineMini = { name: string; qty: number; unitPrice: number; imageUrl: string | null };

export type PoListItem = {
  id: string;
  poCode: string;
  title: string | null;
  status: string;
  origin: string;
  currency: string;
  supplierName: string | null;
  total: number;
  totalThb: number | null; // ยอดเป็นบาท (ไทย=ยอดตรง · จีน=แปลงด้วยเรตใบนั้น · null=ใบจีนเก่าไม่มีเรต)
  lineCount: number;
  boxCount: number;
  hasTracking: boolean; // มีกล่องที่มีเลขพัสดุแล้วหรือยัง (ไว้ derive "รอใส่ข้อมูล")
  orderedQty: number; // จำนวนสั่งรวมทั้งใบ (Σ line.qty) — ฐาน 100% ของแถบ "รับเข้าแล้ว"
  receivedQty: number; // จำนวนรับเข้าจริงรวมทั้งใบ (Σ GRN line.qtyReceived) — แถบ "รับแล้ว/สั่ง"
  date: string; // ISO
  orderedAt: string | null; // ISO — วันสั่ง
  shipMode: string | null; // "SEA" | "TRUCK" | … (วิธีขนส่งของกล่องที่มีเลขพัสดุ)
  trackingDate: string | null; // ISO — วันได้เลขพัสดุ (ฐานคำนวณวันถึง)
  etaExplicit: string | null; // ISO — ETA ที่ตั้งไว้เอง (ถ้ามี = ใช้เลย)
  lines: PoLineMini[]; // รายการสินค้าในใบ (ไว้กางดูในการ์ด)
};

export type PurchasingStats = {
  pendingTracking: number; // สั่งแล้วรอใส่ Tracking
  pendingGrn: number; // ค้างรับเข้า (GRN)
  inTransit: number; // ของระหว่างทาง
};

export type ViewMode = "detail" | "kanban" | "table";

type WarehouseOpt = { id: string; name: string };

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

// ประเมินวันถึง (นับจากวันได้เลขพัสดุ): เรือ +14–20 วัน · รถ +7–10 วัน (CEO 2026-07-09)
const ARRIVAL_DAYS: Record<string, [number, number]> = { SEA: [14, 20], TRUCK: [7, 10] };
function dm(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short" }).format(new Date(iso));
}
/** คืนข้อความ "คาดถึง …" หรือ null ถ้าประเมินไม่ได้ (ยังไม่มีเลขพัสดุ). */
export function arrivalEstimate(item: PoListItem): { label: string; mode: string | null } | null {
  if (item.etaExplicit) return { label: `คาดถึง ~${dm(item.etaExplicit)}`, mode: item.shipMode };
  if (!item.trackingDate) return null;
  const win = item.shipMode ? ARRIVAL_DAYS[item.shipMode] : null;
  if (!win) return null;
  const base = new Date(item.trackingDate);
  const from = new Date(base); from.setDate(from.getDate() + win[0]);
  const to = new Date(base); to.setDate(to.getDate() + win[1]);
  return { label: `คาดถึง ${dm(from.toISOString())}–${dm(to.toISOString())}`, mode: item.shipMode };
}
/** ป้ายวิธีขนส่งแบบสั้น (ไทย). */
export function shipModeLabel(mode: string | null): string {
  return mode === "SEA" ? "เรือ" : mode === "TRUCK" ? "รถ" : mode === "AIR" ? "เครื่องบิน" : "";
}

export function PurchasingWorkspace({
  items,
  stats,
  canManage,
  canDelete = false,
  r2PublicUrl,
  warehouses,
  suppliers,
  chinaFxRate,
  chinaFxDate,
}: {
  items: PoListItem[];
  stats: PurchasingStats;
  canManage: boolean;
  // super_admin เท่านั้น — โชว์ปุ่มลบใบสั่งซื้อในแผงรายละเอียด
  canDelete?: boolean;
  r2PublicUrl: string;
  warehouses: WarehouseOpt[];
  suppliers: PoSupplierOption[];
  chinaFxRate: number | null;
  chinaFxDate: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("detail");
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkPayOpen, setBulkPayOpen] = useState(false);

  return (
    <div className="dc-pur">
      {/* #16 แท็บย่อย: ใบสั่งซื้อ / ผู้ขาย / ขนส่ง */}
      <PurchasingSubnav active="po" />

      {/* แถวบน: สถิติงานค้าง + สลับมุมมอง + ปุ่มจ่าย/สั่งซื้อ */}
      <div className="dc-pur-bar">
        <StatStrip stats={stats} />
        <div className="dc-pur-bar__right">
          <ViewToggle view={view} onChange={setView} />
          {canManage && (
            <>
              <button type="button" className="dc-btn-xl dc-btn-xl--ghost" onClick={() => setBulkPayOpen(true)} style={bulkPayBtn}>
                <Wallet size={17} /> รวมจ่ายหลายใบ
              </button>
              <button type="button" className="dc-btn-xl dc-pur-new__btn" onClick={() => setCreateOpen(true)}>
                <Plus size={18} /> สั่งซื้อ
              </button>
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="dc-card dc-pur-empty">
          ยังไม่มีใบสั่งซื้อ — กด “＋ สั่งซื้อ” เพื่อสร้างใบแรก
        </div>
      ) : view === "detail" ? (
        <MasterDetailView items={items} canManage={canManage} canDelete={canDelete} r2PublicUrl={r2PublicUrl} />
      ) : view === "table" ? (
        <TableView items={items} />
      ) : (
        <KanbanBoard items={items} />
      )}

      {/* #6 รางสร้างใบสั่งซื้อ (สไลด์ขวา · ไม่เด้งออกจากหน้า) */}
      {canManage && (
        <PoCreateDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          warehouses={warehouses}
          suppliers={suppliers}
          chinaFxRate={chinaFxRate}
          chinaFxDate={chinaFxDate}
          onSaved={(poId) => {
            setCreateOpen(false);
            // ไปดูใบที่เพิ่งสร้าง (เปิดรายละเอียด) + refresh list
            router.push(`/dc/office/purchasing/${poId}`);
            router.refresh();
          }}
        />
      )}

      {/* #13 รางรวมจ่ายหลายใบ */}
      {canManage && (
        <BulkPayDrawer
          open={bulkPayOpen}
          onClose={() => setBulkPayOpen(false)}
          onPaid={() => router.refresh()}
        />
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
        <b>{stats.pendingTracking}</b> รอใส่ Tracking
      </span>
      <span className="dc-pur-stats__dot" aria-hidden>·</span>
      <span className="dc-pur-stat">
        <b>{stats.pendingGrn}</b> รับเข้า (GRN)
      </span>
      <span className="dc-pur-stats__dot" aria-hidden>·</span>
      <span className="dc-pur-stat">
        <b>{stats.inTransit}</b> ระหว่างทาง
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
        <LayoutGrid size={15} /> บอร์ด
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "detail"}
        className={`dc-mode-pill${view === "detail" ? " is-active" : ""}`}
        onClick={() => onChange("detail")}
      >
        <Columns size={15} /> รายการ
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "table"}
        className={`dc-mode-pill${view === "table" ? " is-active" : ""}`}
        onClick={() => onChange("table")}
      >
        <Table2 size={15} /> ตาราง
      </button>
    </div>
  );
}

const bulkPayBtn: React.CSSProperties = {
  width: "auto",
  minHeight: 44,
  padding: "0 16px",
  fontSize: 14.5,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};
