"use client";

// DC · ใบสั่งซื้อจีน — workspace (client) ที่คุม 2 มุมมองในจอเดียว:
//   • "รายการ + รายละเอียด" (master-detail · ค่าเริ่มต้น): ซ้าย=ลิสต์ใบ · ขวา=รายละเอียดใบที่เลือก
//   • "บอร์ดสถานะ" (Kanban): 5 คอลัมน์ตาม flow + action หลักต่อคอลัมน์
// บนสุด: แท็บย่อย (#16) + สถิติงานค้าง + สลับมุมมอง + ปุ่ม "＋ สั่งซื้อ" (เปิดราง #6) + "รวมจ่าย" (#13).
// #6: สั่งซื้อเปิดเป็น "รางสไลด์ขวา" เหนือลิสต์ (ไม่เด้งออกจากหน้า) · #13: รวมจ่ายหลายใบในราง.

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, LayoutGrid, Columns, Wallet, Table2, Search, X, CalendarDays } from "lucide-react";
import { MasterDetailView } from "./master-detail-view";
import { KanbanBoard } from "./kanban-board";
import { TableView } from "./table-view";
import { PurchasingSubnav } from "@/components/dc/purchasing-subnav";
import { PoCreateDrawer } from "@/components/dc/po-create-drawer";
import { BulkPayDrawer } from "@/components/dc/bulk-pay-drawer";
import type { PoSupplierOption } from "@/lib/dc/po-actions";

// ── shared types (ส่งมาจาก server) ───────────────────────────
export type PoLineMini = { name: string; sku: string | null; qty: number; unitPrice: number; imageUrl: string | null };

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
  docCount: number; // จำนวนเอกสารแนบในใบ (Part B) — โชว์ป้ายคลิปหนีบบนการ์ด
  date: string; // ISO
  orderedAt: string | null; // ISO — วันสั่ง
  shipMode: string | null; // "SEA" | "TRUCK" | … (วิธีขนส่งของกล่องที่มีเลขพัสดุ)
  trackingDate: string | null; // ISO — วันได้เลขพัสดุ (ฐานคำนวณวันถึง)
  etaExplicit: string | null; // ISO — ETA ที่ตั้งไว้เอง (ถ้ามี = ใช้เลย)
  lines: PoLineMini[]; // รายการสินค้าในใบ (ไว้กางดูในการ์ด)
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

// ── ตัวกรอง "งานค้าง/สถานะ" แบบกลุ่มงาน (bucket) — ตรงกับ "งานค้างวันนี้" ที่ CEO ปัก ──
//   รอใส่ Tracking · ระหว่างทาง · รับเข้า GRN · เสร็จแล้ว · ยกเลิก · แบบร่าง
export type PoBucket = "tracking" | "transit" | "grn" | "done" | "cancelled" | "draft";

/** จัดใบเข้ากลุ่มงานเดียว (จาก status + มีเลขพัสดุหรือยัง). */
export function poBucket(item: PoListItem): PoBucket {
  const s = item.status;
  if (s === "CANCELLED") return "cancelled";
  if (s === "RECEIVED") return "done";
  if (s === "DRAFT" || s === "PENDING_APPROVAL" || s === "APPROVED") return "draft";
  if ((s === "ORDERED" || s === "SHIPPED") && !item.hasTracking) return "tracking";
  if (s === "ARRIVED_TH" || s === "AT_WAREHOUSE" || s === "READY_TO_RECEIVE" || s === "PARTIAL") return "grn";
  // มีเลขพัสดุแล้วแต่ยังไม่ถึงโกดัง (SHIPPED/ORDERED+tracking) = กำลังขนส่ง
  return "transit";
}

export const BUCKET_LABEL: Record<PoBucket, string> = {
  tracking: "รอใส่ Tracking",
  transit: "ระหว่างทาง",
  grn: "รับเข้า (GRN)",
  done: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
  draft: "แบบร่าง",
};

// ลำดับแสดงชิป — งานค้าง/กำลังวิ่งก่อน · เสร็จ/ยกเลิกไว้ท้าย
export const BUCKET_ORDER: PoBucket[] = ["tracking", "transit", "grn", "draft", "done", "cancelled"];

/** อันดับเรียง: ใบที่ยังไม่จบอยู่บน · เสร็จแล้วรองลงมา · ยกเลิกล่างสุด (CEO: "ของเก่า/จบแล้วลงล่าง"). */
function bucketRank(item: PoListItem): number {
  const b = poBucket(item);
  if (b === "cancelled") return 2;
  if (b === "done") return 1;
  return 0;
}

/** ค้นหาแบบ token: ตรงทุกคำใน เลขใบ/ชื่อใบ/ผู้ขาย/ชื่อสินค้า/SKU (ไม่สนตัวพิมพ์). */
function matchSearch(item: PoListItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    item.poCode,
    item.title ?? "",
    item.supplierName ?? "",
    ...item.lines.flatMap((l) => [l.name, l.sku ?? ""]),
  ]
    .join("   ")
    .toLowerCase();
  // ทุกคำที่พิมพ์ต้องเจอ (AND) → ค้นหลายคำได้
  return needle.split(/\s+/).every((tok) => hay.includes(tok));
}

export function PurchasingWorkspace({
  items,
  canManage,
  canDelete = false,
  r2PublicUrl,
  warehouses,
  suppliers,
  chinaFxRate,
  chinaFxDate,
}: {
  items: PoListItem[];
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

  // ── ตัวกรอง/ค้นหา (ฝั่งจอ — ใบทั้งหมดโหลดมาครบแล้ว) ──
  const [bucket, setBucket] = useState<PoBucket | "ALL">("ALL"); // กลุ่มงาน (รอใส่ Tracking/ระหว่างทาง/…)
  const [q, setQ] = useState(""); // ค้นหา เลขใบ/ชื่อใบ/ผู้ขาย/สินค้า/SKU
  const [from, setFrom] = useState(""); // วันสั่ง จาก (YYYY-MM-DD)
  const [to, setTo] = useState(""); // วันสั่ง ถึง (YYYY-MM-DD)

  // นับจำนวนใบในแต่ละกลุ่มงาน (โชว์บนชิป)
  const bucketCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) {
      const b = poBucket(it);
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [items]);

  // กรอง (กลุ่มงาน → ค้นหา → ช่วงวันสั่ง) แล้วเรียง: ยังไม่จบบน · เสร็จ/ยกเลิกลงล่าง · ในกลุ่มใหม่สุดก่อน
  const visible = useMemo(() => {
    const fromT = from ? new Date(from + "T00:00:00").getTime() : null;
    const toT = to ? new Date(to + "T23:59:59").getTime() : null;
    return items
      .filter((it) => (bucket === "ALL" ? true : poBucket(it) === bucket))
      .filter((it) => matchSearch(it, q))
      .filter((it) => {
        if (fromT == null && toT == null) return true;
        const t = new Date(it.orderedAt ?? it.date).getTime();
        if (fromT != null && t < fromT) return false;
        if (toT != null && t > toT) return false;
        return true;
      })
      .sort((a, b) => bucketRank(a) - bucketRank(b) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [items, bucket, q, from, to]);

  const hasFilter = bucket !== "ALL" || q.trim() !== "" || from !== "" || to !== "";
  const clearFilters = () => { setBucket("ALL"); setQ(""); setFrom(""); setTo(""); };

  return (
    <div className="dc-pur">
      {/* #16 แท็บย่อย: ใบสั่งซื้อ / ผู้ขาย / ขนส่ง */}
      <PurchasingSubnav active="po" />

      {/* แถวบน: ค้นหา + สลับมุมมอง + ปุ่มจ่าย/สั่งซื้อ */}
      <div className="dc-pur-bar">
        <SearchBox value={q} onChange={setQ} />
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

      {/* แถวกรอง: ชิปกลุ่มงาน (กดกรองได้) + ช่วงวันสั่ง (#Pinpoint 1+2) */}
      <FilterBar
        bucket={bucket}
        onBucket={setBucket}
        counts={bucketCounts}
        total={items.length}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        hasFilter={hasFilter}
        onClear={clearFilters}
        showing={visible.length}
      />

      {items.length === 0 ? (
        <div className="dc-card dc-pur-empty">
          ยังไม่มีใบสั่งซื้อ — กด “＋ สั่งซื้อ” เพื่อสร้างใบแรก
        </div>
      ) : visible.length === 0 ? (
        <div className="dc-card dc-pur-empty">
          ไม่พบใบที่ตรงกับตัวกรอง —{" "}
          <button type="button" onClick={clearFilters} style={{ background: "none", border: 0, color: "#1d4ed8", fontWeight: 700, cursor: "pointer", padding: 0 }}>
            ล้างตัวกรอง
          </button>
        </div>
      ) : view === "detail" ? (
        <MasterDetailView items={visible} canManage={canManage} canDelete={canDelete} r2PublicUrl={r2PublicUrl} />
      ) : view === "table" ? (
        <TableView items={visible} />
      ) : (
        <KanbanBoard items={visible} />
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

// ── ช่องค้นหา (เลขใบ / ชื่อใบ / ผู้ขาย / ชื่อสินค้า / SKU) ──────
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={searchWrap}>
      <Search size={16} aria-hidden style={{ color: "var(--dc-muted,#5b6676)", flex: "0 0 auto" }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ค้นหา เลขใบ · ชื่อใบ · ผู้ขาย · ชื่อสินค้า · SKU"
        aria-label="ค้นหาใบสั่งซื้อ"
        style={searchInput}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="ล้างคำค้น" style={searchClear}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

// ── แถวกรอง: ชิปกลุ่มงาน (กดกรอง) + ช่วงวันสั่ง + ล้างตัวกรอง ──
function FilterBar({
  bucket,
  onBucket,
  counts,
  total,
  from,
  to,
  onFrom,
  onTo,
  hasFilter,
  onClear,
  showing,
}: {
  bucket: PoBucket | "ALL";
  onBucket: (b: PoBucket | "ALL") => void;
  counts: Record<string, number>;
  total: number;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  hasFilter: boolean;
  onClear: () => void;
  showing: number;
}) {
  return (
    <div style={filterBar}>
      {/* ชิปกลุ่มงาน — กดเพื่อกรอง (Pinpoint #1: "เพิ่ม filter พวกรอนำส่ง") */}
      <div className="dc-chips" role="tablist" aria-label="กรองตามกลุ่มงาน" style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          role="tab"
          aria-selected={bucket === "ALL"}
          className={`dc-chip${bucket === "ALL" ? " is-active" : ""}`}
          onClick={() => onBucket("ALL")}
        >
          ทั้งหมด <span style={{ opacity: 0.7 }}>· {total}</span>
        </button>
        {BUCKET_ORDER.map((b) =>
          counts[b] ? (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={bucket === b}
              className={`dc-chip${bucket === b ? " is-active" : ""}`}
              onClick={() => onBucket(b)}
            >
              {BUCKET_LABEL[b]} <span style={{ opacity: 0.7 }}>· {counts[b]}</span>
            </button>
          ) : null,
        )}
      </div>

      {/* ช่วงวันสั่ง (Pinpoint #2: "อยากเลือกวันที่ได้") */}
      <div style={dateWrap}>
        <CalendarDays size={15} aria-hidden style={{ color: "var(--dc-muted,#5b6676)", flex: "0 0 auto" }} />
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} aria-label="วันสั่ง จาก" style={dateInput} />
        <span style={{ color: "var(--dc-muted,#5b6676)", fontSize: 13 }}>–</span>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} aria-label="วันสั่ง ถึง" style={dateInput} />
      </div>

      {hasFilter && (
        <button type="button" onClick={onClear} style={clearBtn} title="ล้างตัวกรองทั้งหมด">
          <X size={14} /> ล้าง ({showing})
        </button>
      )}
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

// ── styles: ค้นหา + แถวกรอง (แน่น · reuse dc-chip · RULE L งบพื้นที่) ──
const searchWrap: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxWidth: 460,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minHeight: 40,
  padding: "0 12px",
  background: "var(--dc-surface,#fff)",
  border: "1px solid var(--dc-line,#e7ebf2)",
  borderRadius: 10,
};
const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  fontSize: 14,
  color: "var(--dc-ink,#1c2533)",
};
const searchClear: React.CSSProperties = {
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: 0,
  background: "none",
  color: "var(--dc-muted,#5b6676)",
  cursor: "pointer",
  padding: 2,
};
const filterBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  margin: "10px 0 12px",
};
const dateWrap: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 38,
  padding: "0 10px",
  background: "var(--dc-surface,#fff)",
  border: "1px solid var(--dc-line,#e7ebf2)",
  borderRadius: 10,
  flex: "0 0 auto",
};
const dateInput: React.CSSProperties = {
  border: 0,
  outline: "none",
  background: "transparent",
  fontSize: 13,
  color: "var(--dc-ink,#1c2533)",
  fontVariantNumeric: "tabular-nums",
};
const clearBtn: React.CSSProperties = {
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 38,
  padding: "0 12px",
  background: "none",
  border: "1px solid var(--dc-line,#e7ebf2)",
  borderRadius: 10,
  color: "var(--dc-muted,#5b6676)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
