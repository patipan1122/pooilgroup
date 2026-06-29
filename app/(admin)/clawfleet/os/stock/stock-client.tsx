"use client";

/**
 * ตู้คีบ OS — คลังสินค้า (Stock / Warehouse) · client
 * แปลจาก design ระบบตู้คีบ.dc.html บรรทัด 359–597 (overview + distribution + 2 modals).
 *  - แท็บ "ภาพรวม": flow strip → ตารางสต็อกรายสาขา (กดแถวกางดู) → คลังกลาง → สินค้าในตู้ + การโอน
 *  - แท็บ "การกระจาย": สถิติ shipment → filter chips → ตารางใบโอน → modal ตรวจรับ
 * ข้อมูลจริงจาก server (สาขาแรก) ถ้าว่าง → SAMPLE fallback เต็ม + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Info, Warehouse, Store, Monitor, ChevronRight, FileText,
  Boxes, ArrowRight, Plus,
} from "lucide-react";
import { Card, Pill, IconBox, Modal } from "@/components/clawfleet/os/kit";
import { bahtN, num, thDate } from "@/components/clawfleet/os/format";
import { transferStock, receiveStock } from "@/lib/clawfleet/stock-actions";

/* ───────────────────────── seed types (จาก server) ───────────────────────── */
export type ReceiptSeed = { items: string; date: string; status: "received" | "pending" | "diff" };
export type BranchStockSeed = {
  branchId: string;
  branch: string;
  dolls: number;
  valueCents: number;
  lowCount: number;
  receipts: ReceiptSeed[];
  hasReal: boolean;
};
/** ตัวเลือกจริงจาก DB สำหรับฟอร์มที่ต้องเขียนกลับ (โอน/ตรวจรับ) — ต้องมี UUID จริง */
export type BranchOption = { id: string; name: string };
export type ProductOption = { id: string; name: string; unitCostCents: number };

/* ───────────────────────── view models ───────────────────────── */
type BranchRow = {
  branchId: string;
  branch: string;
  dolls: number;
  valueBaht: number;
  outDay: number;
  salesDay: number;
  daysLeft: number;
  low: number;
  old: number;
  receipts: ReceiptSeed[];
};
type WarehouseItem = {
  id: string; name: string; cat: string; qty: number; recvISO: string;
  tag: "ใหม่" | "ปกติ" | "เก่า"; ageDays: number;
  dist: { branch: string; qty: number }[];
  hist: { id: string; to: string; qty: number; dateISO: string; status: ShipStatus }[];
};
type MachineProduct = { code: string; product: string; branch: string; sinceISO: string; ageDays: number };
type Transfer = { to: string; status: ShipStatus; dateISO: string; items: string };
type ShipStatus = "received" | "received_diff" | "in_transit" | "pending";
type Shipment = {
  id: string; to: string; summary: string; totSent: number; dateISO: string; status: ShipStatus;
  rows: { name: string; sent: number; recv: number | null }[];
  by?: string; at?: string; note?: string;
};

/* ───────────────────────── status tone maps ───────────────────────── */
const SHIP_TONE: Record<ShipStatus, { bg: string; color: string; label: string }> = {
  received: { bg: "#E7F4EC", color: "#15803D", label: "รับครบ · ตรงใบโอน" },
  received_diff: { bg: "#FCEDEC", color: "#B42318", label: "รับแล้ว · ไม่ตรง" },
  in_transit: { bg: "#EEF0FE", color: "#4F46E5", label: "กำลังส่ง" },
  pending: { bg: "#FCF1E2", color: "#B45309", label: "รอสาขารับ" },
};
const RECEIPT_TONE: Record<ReceiptSeed["status"], { bg: string; color: string; label: string }> = {
  received: { bg: "#E7F4EC", color: "#15803D", label: "รับครบแล้ว" },
  pending: { bg: "#FCF1E2", color: "#B45309", label: "รอตรวจรับ" },
  diff: { bg: "#FCEDEC", color: "#B42318", label: "ไม่ตรง" },
};
const AGE_TONE: Record<WarehouseItem["tag"], { bg: string; color: string }> = {
  ใหม่: { bg: "#E7F4EC", color: "#15803D" },
  ปกติ: { bg: "#F1F2F7", color: "#5A6270" },
  เก่า: { bg: "#FCEDEC", color: "#B42318" },
};

/* ───────────────────────── SAMPLE fallback (rich) ───────────────────────── */
const SAMPLE_BRANCHES: BranchRow[] = [
  { branchId: "s1", branch: "รังสิต", dolls: 168, valueBaht: 42300, outDay: 24, salesDay: 5800, daysLeft: 7, low: 3, old: 1, receipts: [
    { items: "หมีบราวน์ L ×40 · ไดโนเสาร์ ×30 · TF-2418", date: "2026-06-25", status: "received" },
    { items: "แมวชมพู ×24 · ยูนิคอร์น ×20 · TF-2411", date: "2026-06-20", status: "received" },
  ] },
  { branchId: "s2", branch: "ลาดพร้าว", dolls: 142, valueBaht: 38900, outDay: 21, salesDay: 5100, daysLeft: 9, low: 2, old: 0, receipts: [
    { items: "หมีบราวน์ M ×36 · TF-2419", date: "2026-06-24", status: "received" },
  ] },
  { branchId: "s3", branch: "บางแค", dolls: 121, valueBaht: 33100, outDay: 18, salesDay: 4400, daysLeft: 11, low: 1, old: 0, receipts: [
    { items: "แมวชมพู ×30 · ยูนิคอร์น ×24 · TF-2417", date: "2026-06-23", status: "received" },
  ] },
  { branchId: "s4", branch: "บางนา", dolls: 98, valueBaht: 27600, outDay: 15, salesDay: 3700, daysLeft: 13, low: 1, old: 2, receipts: [
    { items: "ไดโนเสาร์ ×28 · TF-2415", date: "2026-06-22", status: "pending" },
  ] },
  { branchId: "s5", branch: "นนทบุรี", dolls: 64, valueBaht: 18200, outDay: 11, salesDay: 2600, daysLeft: 4, low: 4, old: 1, receipts: [
    { items: "หมีบราวน์ L ×20 · TF-2420", date: "2026-06-26", status: "diff" },
  ] },
  { branchId: "s6", branch: "ปทุมธานี", dolls: 110, valueBaht: 30400, outDay: 17, salesDay: 4100, daysLeft: 10, low: 0, old: 0, receipts: [
    { items: "ยูนิคอร์น ×26 · TF-2414", date: "2026-06-21", status: "received" },
  ] },
  { branchId: "s7", branch: "สมุทรปราการ", dolls: 88, valueBaht: 24700, outDay: 14, salesDay: 3300, daysLeft: 8, low: 2, old: 0, receipts: [
    { items: "แมวชมพู ×22 · TF-2412", date: "2026-06-19", status: "received" },
  ] },
  { branchId: "s8", branch: "มีนบุรี", dolls: 95, valueBaht: 26100, outDay: 16, salesDay: 3900, daysLeft: 9, low: 1, old: 1, receipts: [
    { items: "หมีบราวน์ M ×30 · TF-2410", date: "2026-06-18", status: "received" },
  ] },
];

const SAMPLE_WAREHOUSE: WarehouseItem[] = [
  { id: "w1", name: "หมีบราวน์ ไซต์ L", cat: "ตุ๊กตาหมี", qty: 240, recvISO: "2026-06-15", tag: "ปกติ", ageDays: 13,
    dist: [{ branch: "รังสิต", qty: 40 }, { branch: "ลาดพร้าว", qty: 28 }, { branch: "บางแค", qty: 22 }, { branch: "บางนา", qty: 18 }, { branch: "นนทบุรี", qty: 12 }],
    hist: [
      { id: "TF-2418", to: "รังสิต", qty: 40, dateISO: "2026-06-25", status: "received" },
      { id: "TF-2419", to: "ลาดพร้าว", qty: 28, dateISO: "2026-06-24", status: "received" },
      { id: "TF-2420", to: "นนทบุรี", qty: 20, dateISO: "2026-06-26", status: "received_diff" },
    ] },
  { id: "w2", name: "ไดโนเสาร์เขียว", cat: "ตุ๊กตาสัตว์", qty: 96, recvISO: "2026-05-12", tag: "เก่า", ageDays: 47,
    dist: [{ branch: "รังสิต", qty: 30 }, { branch: "บางนา", qty: 28 }, { branch: "มีนบุรี", qty: 14 }],
    hist: [
      { id: "TF-2415", to: "บางนา", qty: 28, dateISO: "2026-06-22", status: "pending" },
      { id: "TF-2401", to: "รังสิต", qty: 30, dateISO: "2026-06-10", status: "received" },
    ] },
  { id: "w3", name: "แมวเหมียวชมพู", cat: "ตุ๊กตาแมว", qty: 18, recvISO: "2026-06-26", tag: "ใหม่", ageDays: 2,
    dist: [{ branch: "บางแค", qty: 30 }, { branch: "สมุทรปราการ", qty: 22 }, { branch: "รังสิต", qty: 24 }],
    hist: [
      { id: "TF-2417", to: "บางแค", qty: 30, dateISO: "2026-06-23", status: "received" },
      { id: "TF-2412", to: "สมุทรปราการ", qty: 22, dateISO: "2026-06-19", status: "received" },
    ] },
  { id: "w4", name: "ยูนิคอร์น พาสเทล", cat: "ตุ๊กตาแฟนตาซี", qty: 132, recvISO: "2026-06-20", tag: "ปกติ", ageDays: 8,
    dist: [{ branch: "ลาดพร้าว", qty: 20 }, { branch: "บางแค", qty: 24 }, { branch: "ปทุมธานี", qty: 26 }],
    hist: [
      { id: "TF-2411", to: "รังสิต", qty: 20, dateISO: "2026-06-20", status: "received" },
      { id: "TF-2414", to: "ปทุมธานี", qty: 26, dateISO: "2026-06-21", status: "received" },
    ] },
  { id: "w5", name: "หมีบราวน์ ไซต์ M", cat: "ตุ๊กตาหมี", qty: 184, recvISO: "2026-06-22", tag: "ปกติ", ageDays: 6,
    dist: [{ branch: "ลาดพร้าว", qty: 36 }, { branch: "มีนบุรี", qty: 30 }],
    hist: [
      { id: "TF-2419", to: "ลาดพร้าว", qty: 36, dateISO: "2026-06-24", status: "received" },
      { id: "TF-2410", to: "มีนบุรี", qty: 30, dateISO: "2026-06-18", status: "received" },
    ] },
  { id: "w6", name: "เพนกวินจิ๋ว", cat: "ตุ๊กตาสัตว์", qty: 54, recvISO: "2026-04-28", tag: "เก่า", ageDays: 61,
    dist: [{ branch: "บางนา", qty: 12 }, { branch: "นนทบุรี", qty: 8 }],
    hist: [{ id: "TF-2390", to: "บางนา", qty: 12, dateISO: "2026-05-30", status: "received" }] },
];

const SAMPLE_MACHINES: MachineProduct[] = [
  { code: "NB-02", product: "ไดโนเสาร์เขียว", branch: "นนทบุรี", sinceISO: "2026-05-12", ageDays: 47 },
  { code: "BN-04", product: "เพนกวินจิ๋ว", branch: "บางนา", sinceISO: "2026-04-28", ageDays: 61 },
  { code: "RS-03", product: "หมีบราวน์ L", branch: "รังสิต", sinceISO: "2026-06-15", ageDays: 13 },
  { code: "LP-01", product: "ยูนิคอร์น พาสเทล", branch: "ลาดพร้าว", sinceISO: "2026-06-20", ageDays: 8 },
  { code: "MB-02", product: "หมีบราวน์ M", branch: "มีนบุรี", sinceISO: "2026-05-18", ageDays: 41 },
];

const SAMPLE_TRANSFERS: Transfer[] = [
  { to: "นนทบุรี", status: "in_transit", dateISO: "2026-06-28", items: "หมีบราวน์ L ×20 · แมวชมพู ×12" },
  { to: "บางนา", status: "pending", dateISO: "2026-06-27", items: "ไดโนเสาร์ ×28 · เพนกวิน ×10" },
  { to: "รังสิต", status: "received", dateISO: "2026-06-25", items: "หมีบราวน์ L ×40 · ไดโนเสาร์ ×30" },
];

const SAMPLE_SHIPMENTS: Shipment[] = [
  { id: "TF-2420", to: "นนทบุรี", summary: "หมีบราวน์ L ×20 · แมวชมพู ×12", totSent: 32, dateISO: "2026-06-26", status: "received_diff",
    rows: [{ name: "หมีบราวน์ ไซต์ L", sent: 20, recv: 18 }, { name: "แมวเหมียวชมพู", sent: 12, recv: 12 }],
    by: "สมหญิง (สาขานนทบุรี)", at: "27 มิ.ย. 14:20", note: "หมีบราวน์ขาด 2 ตัว — กล่องชำรุดระหว่างขนส่ง แนบรูปแล้ว" },
  { id: "TF-2419", to: "ลาดพร้าว", summary: "หมีบราวน์ M ×36", totSent: 36, dateISO: "2026-06-24", status: "received",
    rows: [{ name: "หมีบราวน์ ไซต์ M", sent: 36, recv: 36 }], by: "วิชัย (สาขาลาดพร้าว)", at: "24 มิ.ย. 16:05" },
  { id: "TF-2418", to: "รังสิต", summary: "หมีบราวน์ L ×40 · ไดโนเสาร์ ×30", totSent: 70, dateISO: "2026-06-25", status: "received",
    rows: [{ name: "หมีบราวน์ ไซต์ L", sent: 40, recv: 40 }, { name: "ไดโนเสาร์เขียว", sent: 30, recv: 30 }], by: "ประภา (สาขารังสิต)", at: "25 มิ.ย. 10:42" },
  { id: "TF-2417", to: "บางแค", summary: "แมวชมพู ×30 · ยูนิคอร์น ×24", totSent: 54, dateISO: "2026-06-23", status: "in_transit",
    rows: [{ name: "แมวเหมียวชมพู", sent: 30, recv: null }, { name: "ยูนิคอร์น พาสเทล", sent: 24, recv: null }] },
  { id: "TF-2415", to: "บางนา", summary: "ไดโนเสาร์ ×28", totSent: 28, dateISO: "2026-06-22", status: "pending",
    rows: [{ name: "ไดโนเสาร์เขียว", sent: 28, recv: null }] },
  { id: "TF-2414", to: "ปทุมธานี", summary: "ยูนิคอร์น ×26", totSent: 26, dateISO: "2026-06-21", status: "received",
    rows: [{ name: "ยูนิคอร์น พาสเทล", sent: 26, recv: 26 }], by: "อนงค์ (สาขาปทุมธานี)", at: "21 มิ.ย. 18:30" },
];

/* ───────────────────────── helpers ───────────────────────── */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : thDate(d);
}
function daysColor(d: number): string {
  if (d <= 5) return "#B42318";
  if (d <= 8) return "#B45309";
  return "#15803D";
}
function ageTag(days: number): WarehouseItem["tag"] {
  if (days <= 7) return "ใหม่";
  if (days >= 45) return "เก่า";
  return "ปกติ";
}

const TH_ITEM: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9AA1AB" };

/* ───────────────────────── main ───────────────────────── */
export function StockClient({
  branches,
  realBranches,
  products,
}: {
  branches: BranchStockSeed[];
  realBranches: BranchOption[];
  products: ProductOption[];
}) {
  const empty = branches.length === 0;

  // map seed → BranchRow (เติมตัวเลขที่ query ไม่มีจาก sample เป็น proxy)
  const branchRows: BranchRow[] = useMemo(() => {
    if (empty) return SAMPLE_BRANCHES;
    return branches.map((b, i) => {
      const fallback = SAMPLE_BRANCHES[i % SAMPLE_BRANCHES.length];
      const dolls = b.dolls || fallback.dolls;
      const outDay = Math.max(1, Math.round(dolls * 0.15));
      const salesDay = outDay * 230;
      return {
        branchId: b.branchId,
        branch: b.branch,
        dolls,
        valueBaht: b.valueCents > 0 ? Math.round(b.valueCents / 100) : fallback.valueBaht,
        outDay,
        salesDay,
        daysLeft: Math.max(1, Math.round(dolls / outDay)),
        low: b.lowCount || fallback.low,
        old: fallback.old,
        receipts: b.receipts.length > 0 ? b.receipts : fallback.receipts,
      };
    });
  }, [branches, empty]);

  const [tab, setTab] = useState<"overview" | "dist">("overview");

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีข้อมูลสต็อกจริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (จะเปลี่ยนเป็นข้อมูลจริงเมื่อเริ่มรับสินค้าเข้าคลัง)
        </div>
      )}

      {/* tab switcher */}
      <div style={{ display: "inline-flex", background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: 4, marginBottom: 18 }}>
        {([["overview", "ภาพรวม"], ["dist", "การกระจาย"]] as const).map(([k, label]) => {
          const active = tab === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 9,
                background: active ? "#4F46E5" : "transparent", color: active ? "#fff" : "#6B7280", transition: "all .15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === "overview"
        ? <OverviewTab branchRows={branchRows} realBranches={realBranches} products={products} />
        : <DistributionTab realBranches={realBranches} products={products} />}
    </div>
  );
}

/* ───────────────────────── OVERVIEW ───────────────────────── */
function OverviewTab({
  branchRows,
  realBranches,
  products,
}: {
  branchRows: BranchRow[];
  realBranches: BranchOption[];
  products: ProductOption[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [whItem, setWhItem] = useState<WarehouseItem | null>(null);
  const machineWarn = SAMPLE_MACHINES.filter((m) => m.ageDays >= 40).length;

  const flow = [
    { title: "คลังกลาง", sub: "1 แห่ง · 6 รายการหลัก", bg: "#EEF0FE", color: "#4F46E5", icon: <Warehouse size={16} /> },
    { title: "สต็อกสาขา", sub: `${branchRows.length} สาขา`, bg: "#E7F4EC", color: "#15803D", icon: <Store size={16} /> },
    { title: "ในตู้คีบ", sub: "หมุนเวียน FIFO", bg: "#FCF1E2", color: "#B45309", icon: <Monitor size={16} /> },
  ];

  return (
    <div>
      {/* stock-flow strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "16px 20px", marginBottom: 18, overflowX: "auto" }}>
        {flow.map((sf, i) => (
          <div key={sf.title} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: sf.bg, borderRadius: 11, padding: "11px 16px", whiteSpace: "nowrap" }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: sf.color }}>{sf.icon}</span>
              <div><div style={{ fontSize: 13, fontWeight: 700 }}>{sf.title}</div><div style={{ fontSize: 11, color: "#6B7280" }}>{sf.sub}</div></div>
            </div>
            {i < flow.length - 1 && <span style={{ color: "#C2C7CF", fontSize: 18 }}>→</span>}
          </div>
        ))}
      </div>

      {/* info banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "10px 14px", marginBottom: 18 }}>
        <Info size={15} style={{ flex: "0 0 15px", color: "#9AA1AB" }} />
        หลังบ้านดูแลคลังกลาง · พนักงานสาขาดูแลสต็อกสาขา — ทุกชิ้นมีวันรับเข้า เพื่อหมุนเวียนของเก่าออกก่อน (FIFO) และเช็คอายุสินค้า
      </div>

      {/* per-branch stock table */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>ภาพรวมสต็อกรายสาขา</span>
        <span style={{ fontSize: 12, color: "#9AA1AB" }}>ตุ๊กตา/มูลค่าสต็อก · เฉลี่ยออก-ขายต่อวัน · พอใช้กี่วัน — กดแถวเพื่อเจาะดูสาขานั้น + ใบรับสินค้า</span>
      </div>
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden", marginBottom: 22 }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.95fr 0.95fr 0.85fr 0.95fr 0.8fr 0.65fr 0.65fr 0.3fr", padding: "11px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>สาขา</span><span style={{ textAlign: "right" }}>ตุ๊กตาในสต็อก</span><span style={{ textAlign: "right" }}>มูลค่าสต็อก</span><span style={{ textAlign: "right" }}>ออก/วัน</span><span style={{ textAlign: "right" }}>ยอดขาย/วัน</span><span style={{ textAlign: "right" }}>พอใช้</span><span style={{ textAlign: "center" }}>ใกล้หมด</span><span style={{ textAlign: "center" }}>ของเก่า</span><span />
            </div>
            {branchRows.map((b) => {
              const isOpen = open === b.branchId;
              return (
                <div key={b.branchId} style={{ background: isOpen ? "#FAFBFE" : "#fff", borderBottom: "1px solid #F4F5F7" }}>
                  <div
                    className="co-rowh"
                    onClick={() => setOpen(isOpen ? null : b.branchId)}
                    style={{ display: "grid", gridTemplateColumns: "1.1fr 0.95fr 0.95fr 0.85fr 0.95fr 0.8fr 0.65fr 0.65fr 0.3fr", padding: "14px 20px", alignItems: "center", cursor: "pointer", fontSize: 13 }}
                  >
                    <span style={{ fontWeight: 700 }}>{b.branch}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{num(b.dolls)} ตัว</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{bahtN(b.valueBaht)}</span>
                    <span className="num" style={{ textAlign: "right" }}>{num(b.outDay)} ตัว</span>
                    <span className="num" style={{ textAlign: "right" }}>{bahtN(b.salesDay)}</span>
                    <span className="num" style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: daysColor(b.daysLeft) }}>{b.daysLeft} วัน</span>
                    <span className="num" style={{ textAlign: "center", fontWeight: 700, color: b.low > 0 ? "#B42318" : "#C2C7CF" }}>{b.low > 0 ? b.low : "—"}</span>
                    <span className="num" style={{ textAlign: "center", fontWeight: 700, color: b.old > 0 ? "#B45309" : "#C2C7CF" }}>{b.old > 0 ? b.old : "—"}</span>
                    <span style={{ textAlign: "right", color: "#C2C7CF", display: "flex", justifyContent: "flex-end" }}>
                      <ChevronRight size={16} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                    </span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "2px 20px 18px" }}>
                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-4" style={{ borderTop: "1px dashed #E2E5EA", paddingTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 9 }}>สรุปสต็อกสาขา{b.branch}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            {[
                              ["ตุ๊กตาคงเหลือ", `${num(b.dolls)} ตัว`, "#1A1D21"],
                              ["มูลค่าสต็อก (ต้นทุน)", bahtN(b.valueBaht), "#1A1D21"],
                              ["เฉลี่ยตุ๊กตาออก/วัน", `${num(b.outDay)} ตัว`, "#1A1D21"],
                              ["ยอดขายเฉลี่ย/วัน", bahtN(b.salesDay), "#1A1D21"],
                              ["สต็อกพอใช้อีก", `${b.daysLeft} วัน`, daysColor(b.daysLeft)],
                            ].map(([l, v, c]) => (
                              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: "#6B7280" }}>{l}</span>
                                <span className="num" style={{ fontWeight: l === "สต็อกพอใช้อีก" ? 700 : 600, color: c }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>ใบรับสินค้า (โอนจากคลังกลาง)</span>
                            <span style={{ fontSize: 10, color: "#9AA1AB" }}>· sync ผ่าน API</span>
                          </div>
                          {b.receipts.map((rc, i) => {
                            const rt = RECEIPT_TONE[rc.status];
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F8F9FB", borderRadius: 9, padding: "9px 12px", marginBottom: 7 }}>
                                <IconBox bg="#fff" color="#6B7280" size={30}><FileText size={15} /></IconBox>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rc.items}</div>
                                  <div className="num" style={{ fontSize: 10.5, color: "#9AA1AB" }}>{fmtDate(rc.date)}</div>
                                </div>
                                <span className="num" style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: rt.bg, color: rt.color, whiteSpace: "nowrap" }}>{rt.label}</span>
                              </div>
                            );
                          })}
                          <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 4 }}>พนักงานสาขากด “ตรวจรับ” เพื่อยืนยันของครบตรงกับใบโอน (แนบรูปได้)</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* central warehouse table */}
      <Card
        title="คลังกลาง · สินค้าคงคลัง"
        sub="กดสินค้าเพื่อดูรายละเอียด · กระจายตามสาขา · ประวัติรับเข้า"
        pad={false}
        style={{ marginBottom: 18 }}
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 0.7fr 1fr 0.7fr 1.1fr", padding: "10px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>สินค้า</span><span>หมวด</span><span style={{ textAlign: "right" }}>คงเหลือ</span><span style={{ textAlign: "right" }}>รับเข้าเมื่อ</span><span style={{ textAlign: "right" }}>อายุ</span><span style={{ textAlign: "right" }}>อายุสินค้า</span>
            </div>
            {SAMPLE_WAREHOUSE.map((w) => {
              const t = AGE_TONE[w.tag];
              const low = w.qty <= 20;
              return (
                <div key={w.id} className="co-rowh" onClick={() => setWhItem(w)} style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 0.7fr 1fr 0.7fr 1.1fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, cursor: "pointer" }}>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                    {w.name}
                    {low && <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "#FCEDEC", color: "#B42318" }}>ใกล้หมด</span>}
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 12 }}>{w.cat}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 700, color: low ? "#B42318" : "#1A1D21" }}>{num(w.qty)}</span>
                  <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{fmtDate(w.recvISO)}</span>
                  <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{w.ageDays} วัน</span>
                  <span style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, background: t.bg, color: t.color }}>{w.tag}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* machine rotation + transfers */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-[18px]">
        <Card
          title="สินค้าในตู้ · ควรหมุนเวียน"
          pad={false}
          right={<Pill tone="red">{machineWarn} ตู้ต้องเปลี่ยน</Pill>}
        >
          {SAMPLE_MACHINES.map((m) => {
            const tone = m.ageDays >= 45 ? AGE_TONE["เก่า"] : m.ageDays >= 30 ? { bg: "#FCF1E2", color: "#B45309" } : AGE_TONE["ปกติ"];
            return (
              <div key={m.code} className="co-rowh" style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 20px", borderBottom: "1px solid #F4F5F7" }}>
                <IconBox bg="#F1F2F7" color="#4F46E5" size={38} radius={10}><span className="num" style={{ fontSize: 10.5, fontWeight: 700 }}>{m.code}</span></IconBox>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.product} <span style={{ fontWeight: 400, color: "#9AA1AB", fontSize: 11.5 }}>· {m.branch}</span></div>
                  <div style={{ fontSize: 11, color: "#9AA1AB" }}>ตั้งแต่ {fmtDate(m.sinceISO)} · {m.ageDays >= 45 ? "เกินกำหนดหมุนเวียน" : m.ageDays >= 30 ? "ใกล้ครบกำหนด" : "อยู่ในเกณฑ์"}</div>
                </div>
                <span className="num" style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, background: tone.bg, color: tone.color, whiteSpace: "nowrap" }}>{m.ageDays} วัน</span>
              </div>
            );
          })}
        </Card>

        <TransfersCard realBranches={realBranches} products={products} />
      </div>

      {/* warehouse item detail modal */}
      <WarehouseItemModal item={whItem} onClose={() => setWhItem(null)} />
    </div>
  );
}

/* ───────────────────────── form field styles ───────────────────────── */
const FIELD_LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5A6270", marginBottom: 6, display: "block" };
const FIELD_INPUT: React.CSSProperties = {
  width: "100%", fontSize: 13, padding: "10px 12px", borderRadius: 10,
  border: "1px solid #E3E6EA", background: "#fff", color: "#1A1D21", outline: "none",
};

/* ───────────────────────── transfers card (with + โอนสินค้า) ───────────────────────── */
function TransfersCard({ realBranches, products }: { realBranches: BranchOption[]; products: ProductOption[] }) {
  const router = useRouter();
  const [transfers, setTransfers] = useState<Transfer[]>(SAMPLE_TRANSFERS);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  // ฟอร์มต้องใช้ id จริง → ใช้ได้ก็ต่อเมื่อมีสาขาจริง ≥2 + สินค้าจริง ≥1
  const canTransfer = realBranches.length >= 2 && products.length >= 1;

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setFromId(""); setToId(""); setProductId(""); setQty(""); setError(null);
  }
  function openModal() {
    resetForm();
    if (canTransfer) {
      // เดาค่าเริ่มต้นที่สมเหตุสมผล: ต้นทาง=สาขาแรก ปลายทาง=สาขาที่สอง สินค้า=ตัวแรก
      setFromId(realBranches[0]!.id);
      setToId(realBranches[1]!.id);
      setProductId(products[0]!.id);
    }
    setAdding(true);
  }

  function submitTransfer() {
    setError(null);
    const n = Number(qty);
    if (!fromId || !toId || !productId) { setError("เลือกสาขาต้นทาง · ปลายทาง · สินค้าให้ครบ"); return; }
    if (fromId === toId) { setError("สาขาต้นทางและปลายทางต้องต่างกัน"); return; }
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) { setError("จำนวนต้องเป็นจำนวนเต็มมากกว่า 0"); return; }

    startTransition(async () => {
      const res = await transferStock({ fromBranchId: fromId, toBranchId: toId, productId, qty: n });
      if (!res.ok) { setError(res.error); return; }
      // โชว์ใบโอนใหม่ขึ้นหัวลิสต์ทันที (ของจริงเขียน DB แล้ว · refresh ดึงสต็อกใหม่)
      const toName = realBranches.find((b) => b.id === toId)?.name ?? "สาขา";
      const pName = products.find((p) => p.id === productId)?.name ?? "สินค้า";
      setTransfers((prev) => [
        { to: toName, status: "in_transit", dateISO: new Date().toISOString(), items: `${pName} ×${n}` },
        ...prev,
      ]);
      setAdding(false);
      resetForm();
      router.refresh();
    });
  }

  return (
    <Card
      title="การโอนเข้าสต็อกสาขา"
      pad={false}
      right={
        <button
          type="button"
          onClick={openModal}
          style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "#4F46E5", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <Plus size={13} /> โอนสินค้า
        </button>
      }
    >
      {transfers.map((t, i) => {
        const tn = SHIP_TONE[t.status];
        return (
          <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid #F4F5F7" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowRight size={14} /> สาขา{t.to}</span>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tn.bg, color: tn.color }}>{tn.label}</span>
              <span style={{ flex: 1 }} />
              <span className="num" style={{ fontSize: 11, color: "#9AA1AB" }}>{fmtDate(t.dateISO)}</span>
            </div>
            <div style={{ fontSize: 12, color: "#6B7280" }}>{t.items}</div>
          </div>
        );
      })}

      <Modal
        open={adding}
        onClose={() => { if (!pending) { setAdding(false); resetForm(); } }}
        title="โอนสินค้าระหว่างสาขา"
        sub="ตัดสต็อกต้นทาง → เพิ่มสต็อกปลายทาง · เลือกสินค้าและจำนวนแล้วยืนยัน"
        width={460}
        footer={
          <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
            <button
              type="button"
              onClick={submitTransfer}
              disabled={!canTransfer || pending}
              style={{ flex: 1, border: "none", cursor: !canTransfer || pending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "#fff", background: !canTransfer || pending ? "#A5A0EC" : "#4F46E5", padding: 12, borderRadius: 10 }}
            >
              {pending ? "กำลังโอน…" : "ยืนยันโอน"}
            </button>
            <button type="button" onClick={() => { if (!pending) { setAdding(false); resetForm(); } }} disabled={pending} style={{ border: "1px solid #E3E6EA", cursor: pending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: "#5A6270", background: "#fff", padding: "12px 18px", borderRadius: 10 }}>ยกเลิก</button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px" }}>
          {!canTransfer ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A5510", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "10px 14px" }}>
              <AlertTriangle size={15} style={{ flex: "0 0 15px" }} />
              ยังโอนจริงไม่ได้ — ต้องมีอย่างน้อย <b>2 สาขา</b> และ <b>สินค้าในคลัง 1 รายการ</b> ก่อน (เพิ่มสาขา/รับสินค้าเข้าคลังก่อน)
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={FIELD_LABEL}>จากสาขา (ต้นทาง)</label>
                  <select value={fromId} onChange={(e) => setFromId(e.target.value)} style={FIELD_INPUT}>
                    {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={FIELD_LABEL}>ไปสาขา (ปลายทาง)</label>
                  <select value={toId} onChange={(e) => setToId(e.target.value)} style={FIELD_INPUT}>
                    {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={FIELD_LABEL}>สินค้า</label>
                <select value={productId} onChange={(e) => setProductId(e.target.value)} style={FIELD_INPUT}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={FIELD_LABEL}>จำนวน (ตัว)</label>
                <input type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="เช่น 20" style={FIELD_INPUT} />
              </div>
              {error && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#B42318", background: "#FCEDEC", borderRadius: 10, padding: "9px 12px" }}>
                  <AlertTriangle size={14} style={{ flex: "0 0 14px" }} /> {error}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "9px 12px" }}>
                <Boxes size={14} style={{ flex: "0 0 14px", color: "#9AA1AB" }} />
                ระบบจะตัดสต็อกต้นทางและเพิ่มปลายทางทันที (บันทึกในบัญชีคลัง) — ถ้าต้นทางของไม่พอจะแจ้งเตือนและไม่โอน
              </div>
            </div>
          )}
        </div>
      </Modal>
    </Card>
  );
}

/* ───────────────────────── warehouse item detail modal ───────────────────────── */
function WarehouseItemModal({ item, onClose }: { item: WarehouseItem | null; onClose: () => void }) {
  const maxQty = item ? Math.max(1, ...item.dist.map((d) => d.qty)) : 1;
  const t = item ? AGE_TONE[item.tag] : AGE_TONE["ปกติ"];
  return (
    <Modal
      open={item != null}
      onClose={onClose}
      width={560}
      title={item?.name ?? ""}
      sub={item ? `${item.cat} · รับเข้าคลังกลาง ${fmtDate(item.recvISO)}` : undefined}
      badge={item && <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 11px", borderRadius: 20, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>{item.tag} · {item.ageDays} วัน</span>}
    >
      {item && (
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: "#9AA1AB" }}>คงเหลือในคลังกลาง</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{num(item.qty)}</span>
            <span style={{ fontSize: 12, color: "#9AA1AB" }}>ชิ้น</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>กระจายอยู่ที่สาขา (สต็อกสาขา)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {item.dist.map((d) => (
              <div key={d.branch} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 74, flex: "0 0 74px", fontSize: 12, color: "#454B54" }}>{d.branch}</span>
                <span style={{ flex: 1, height: 8, background: "#F1F2F5", borderRadius: 6, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(d.qty / maxQty) * 100}%`, background: "#4F46E5", borderRadius: 6 }} />
                </span>
                <span className="num" style={{ width: 46, flex: "0 0 46px", textAlign: "right", fontSize: 12.5, fontWeight: 600 }}>{num(d.qty)}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>ประวัติการกระจายสินค้านี้</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {item.hist.map((h) => {
              const hs = SHIP_TONE[h.status];
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F8F9FB", borderRadius: 9, padding: "9px 12px", flexWrap: "wrap" }}>
                  <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5" }}>{h.id}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>→ {h.to}</span>
                  <span className="num" style={{ fontSize: 12, color: "#6B7280" }}>{num(h.qty)} ตัว</span>
                  <span style={{ flex: 1 }} />
                  <span className="num" style={{ fontSize: 11, color: "#9AA1AB" }}>{fmtDate(h.dateISO)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: hs.bg, color: hs.color }}>{hs.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── DISTRIBUTION ───────────────────────── */
type ShipFilter = "all" | "in_transit" | "pending" | "received" | "received_diff";

function DistributionTab({ realBranches, products }: { realBranches: BranchOption[]; products: ProductOption[] }) {
  const router = useRouter();
  const [shipments, setShipments] = useState<Shipment[]>(SAMPLE_SHIPMENTS);
  const [filter, setFilter] = useState<ShipFilter>("all");
  const [detail, setDetail] = useState<Shipment | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const canReceive = realBranches.length >= 1 && products.length >= 1;

  const stats = useMemo(() => {
    const by = (s: ShipStatus) => shipments.filter((x) => x.status === s).length;
    return [
      { label: "กำลังส่ง", n: by("in_transit"), c: "#4F46E5" },
      { label: "รอสาขารับ", n: by("pending"), c: "#B45309" },
      { label: "รับครบ · ตรง", n: by("received"), c: "#15803D" },
      { label: "รับแล้ว · ไม่ตรง", n: by("received_diff"), c: "#B42318" },
    ];
  }, [shipments]);

  const filtered = filter === "all" ? shipments : shipments.filter((s) => s.status === filter);

  const chips: { k: ShipFilter; label: string }[] = [
    { k: "all", label: "ทั้งหมด" },
    { k: "in_transit", label: "กำลังส่ง" },
    { k: "pending", label: "รอสาขารับ" },
    { k: "received", label: "รับครบ" },
    { k: "received_diff", label: "ไม่ตรง" },
  ];

  // ตรวจรับจริง — บันทึกของที่รับเข้าคลังสาขาเป็นรายการรับเข้า (receiveStock)
  //   branchId = สาขาที่รับ (เลือกใน modal) · แต่ละแถวจับคู่กับสินค้าจริง + จำนวนที่รับจริง
  //   diff (รับไม่ครบ) = รับเข้าตามจำนวนจริง → สถานะ received_diff เพื่อให้เห็นว่าต่างจากใบโอน
  function doReceive(
    shipment: Shipment,
    branchId: string,
    lines: { productId: string; quantity: number; productName: string }[],
    isDiff: boolean,
  ) {
    setConfirmError(null);
    const payloadLines = lines.filter((l) => l.productId && l.quantity > 0);
    if (!branchId) { setConfirmError("เลือกสาขาที่รับสินค้าก่อน"); return; }
    if (payloadLines.length === 0) { setConfirmError("จับคู่สินค้าและใส่จำนวนที่รับจริงอย่างน้อย 1 รายการ"); return; }

    // ต้นทุนต่อชิ้น = ต้นทุนเฉลี่ยปัจจุบันของสินค้า (ห้ามส่ง 0 → จะดึงต้นทุนเฉลี่ยถ่วงน้ำหนักให้เพี้ยน)
    const costMap = new Map(products.map((p) => [p.id, p.unitCostCents]));
    startTransition(async () => {
      const res = await receiveStock({
        branchId,
        note: `ตรวจรับใบโอน ${shipment.id}${isDiff ? " · รับไม่ตรงใบโอน" : ""}`,
        lines: payloadLines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCostCents: costMap.get(l.productId) ?? 0 })),
      });
      if (!res.ok) { setConfirmError(res.error); return; }
      // อัปเดต UI ให้สะท้อนผลที่บันทึกแล้ว (DB เขียนจริงผ่าน receiveStock)
      const recvMap = new Map(payloadLines.map((l) => [l.productName, l.quantity]));
      setShipments((prev) => prev.map((s) =>
        s.id === shipment.id
          ? {
              ...s,
              status: isDiff ? "received_diff" : "received",
              rows: s.rows.map((r) => ({ ...r, recv: recvMap.get(r.name) ?? r.sent })),
              by: "คุณ (ยืนยันรับ)",
              at: "เมื่อสักครู่",
              note: isDiff ? "รับไม่ตรงใบโอน — บันทึกตามจำนวนที่รับจริง" : undefined,
            }
          : s,
      ));
      setDetail(null);
      setConfirmError(null);
      router.refresh();
    });
  }

  return (
    <div>
      {/* info banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
        <Info size={15} style={{ flex: "0 0 15px", color: "#9AA1AB" }} />
        คลังกลางส่งสินค้าให้สาขา → ติดตามว่าใบไหนกำลังส่ง / สาขายังไม่รับ / รับแล้วตรง-ไม่ตรง · กดใบโอนเพื่อตรวจรับและดูประวัติย้อนหลัง
      </div>

      {/* shipment stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-[18px]">
        {stats.map((ss) => (
          <div key={ss.label} style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 13, padding: "15px 17px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: ss.c }} />
              <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{ss.label}</span>
            </div>
            <div className="num" style={{ fontSize: 26, fontWeight: 700, color: ss.c }}>{ss.n}</div>
          </div>
        ))}
      </div>

      {/* filter chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {chips.map((c) => {
          const active = filter === c.k;
          return (
            <button
              key={c.k}
              type="button"
              onClick={() => setFilter(c.k)}
              style={{
                border: active ? "1px solid #4F46E5" : "1px solid #E3E6EA", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                padding: "7px 14px", borderRadius: 20, background: active ? "#4F46E5" : "#fff", color: active ? "#fff" : "#6B7280", transition: "all .15s",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* shipment list */}
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 0.9fr 1.8fr 0.7fr 0.9fr 1.1fr 0.4fr", padding: "11px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>เลขที่ใบโอน</span><span>ปลายทาง</span><span>รายการ</span><span style={{ textAlign: "right" }}>รวม</span><span style={{ textAlign: "right" }}>วันที่ส่ง</span><span style={{ textAlign: "center" }}>สถานะ</span><span />
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "#9AA1AB", fontSize: 13 }}>ไม่มีใบโอนในสถานะนี้</div>
            ) : filtered.map((sp) => {
              const tn = SHIP_TONE[sp.status];
              return (
                <div key={sp.id} className="co-rowh" onClick={() => setDetail(sp)} style={{ display: "grid", gridTemplateColumns: "1fr 0.9fr 1.8fr 0.7fr 0.9fr 1.1fr 0.4fr", padding: "14px 20px", alignItems: "center", cursor: "pointer", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
                  <span className="num" style={{ fontWeight: 700, color: "#4F46E5" }}>{sp.id}</span>
                  <span style={{ fontWeight: 600 }}>{sp.to}</span>
                  <span style={{ color: "#6B7280", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sp.summary}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{num(sp.totSent)}</span>
                  <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{fmtDate(sp.dateISO)}</span>
                  <span style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: tn.bg, color: tn.color, whiteSpace: "nowrap" }}>{tn.label}</span>
                  </span>
                  <span style={{ textAlign: "right", color: "#C2C7CF", display: "flex", justifyContent: "flex-end" }}><ChevronRight size={16} /></span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* shipment detail modal */}
      <ShipmentDetailModal
        shipment={detail}
        onClose={() => { if (!pending) { setDetail(null); setConfirmError(null); } }}
        realBranches={realBranches}
        products={products}
        canReceive={canReceive}
        pending={pending}
        error={confirmError}
        onReceive={doReceive}
      />
    </div>
  );
}

/* ───────────────────────── shipment detail modal ───────────────────────── */
type ReceiveLine = { productId: string; quantity: number; productName: string };

function ShipmentDetailModal(props: {
  shipment: Shipment | null;
  onClose: () => void;
  realBranches: BranchOption[];
  products: ProductOption[];
  canReceive: boolean;
  pending: boolean;
  error: string | null;
  onReceive: (shipment: Shipment, branchId: string, lines: ReceiveLine[], isDiff: boolean) => void;
}) {
  if (!props.shipment) return null;
  return <ShipmentDetailModalInner {...props} shipment={props.shipment} />;
}

function ShipmentDetailModalInner({
  shipment, onClose, realBranches, products, canReceive, pending, error, onReceive,
}: {
  shipment: Shipment;
  onClose: () => void;
  realBranches: BranchOption[];
  products: ProductOption[];
  canReceive: boolean;
  pending: boolean;
  error: string | null;
  onReceive: (shipment: Shipment, branchId: string, lines: ReceiveLine[], isDiff: boolean) => void;
}) {
  const tn = SHIP_TONE[shipment.status];
  const canConfirm = shipment.status === "in_transit" || shipment.status === "pending";

  // ฟอร์มตรวจรับ: เลือกสาขาที่รับ + จับคู่แต่ละแถวกับสินค้าจริง + จำนวนรับจริง
  const [branchId, setBranchId] = useState(realBranches[0]?.id ?? "");
  // จับคู่สินค้าอัตโนมัติด้วยชื่อ (ถ้าชื่อไม่ตรง = ว่าง → ให้ผู้ใช้เลือก)
  const [rowProduct, setRowProduct] = useState<string[]>(() =>
    shipment.rows.map((r) => products.find((p) => p.name === r.name)?.id ?? products[0]?.id ?? ""),
  );
  const [rowQty, setRowQty] = useState<string[]>(() => shipment.rows.map((r) => String(r.sent)));

  function setProductAt(i: number, v: string) {
    setRowProduct((prev) => prev.map((x, j) => (j === i ? v : x)));
  }
  function setQtyAt(i: number, v: string) {
    setRowQty((prev) => prev.map((x, j) => (j === i ? v : x)));
  }

  function buildLines(useSent: boolean): ReceiveLine[] {
    return shipment.rows.map((r, i) => {
      const q = useSent ? r.sent : Math.trunc(Number(rowQty[i]));
      return {
        productId: rowProduct[i] ?? "",
        quantity: Number.isFinite(q) && q > 0 ? q : 0,
        productName: r.name,
      };
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title={<span className="num" style={{ color: "#4F46E5" }}>{shipment.id}</span>}
      sub={`คลังกลาง → สาขา${shipment.to} · ส่ง ${fmtDate(shipment.dateISO)}`}
      badge={<span style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: tn.bg, color: tn.color, whiteSpace: "nowrap" }}>{tn.label}</span>}
      footer={canConfirm && canReceive ? (
        <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => onReceive(shipment, branchId, buildLines(true), false)}
            style={{ flex: 1, border: "none", cursor: pending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "#fff", background: pending ? "#84C39E" : "#15803D", padding: 12, borderRadius: 10 }}
          >
            {pending ? "กำลังบันทึก…" : "ยืนยันรับครบ · ตรงใบโอน"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onReceive(shipment, branchId, buildLines(false), true)}
            style={{ border: "1px solid #E3B9B4", cursor: pending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "#B42318", background: "#fff", padding: "12px 18px", borderRadius: 10 }}
          >
            บันทึกรับไม่ตรง
          </button>
        </div>
      ) : undefined}
    >
      <div style={{ padding: "6px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.9fr", padding: "9px 20px", fontSize: 10.5, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
          <span>รายการสินค้า</span><span style={{ textAlign: "right" }}>ส่ง</span><span style={{ textAlign: "right" }}>รับจริง</span><span style={{ textAlign: "right" }}>ผลตรวจ</span>
        </div>
        {shipment.rows.map((ir, i) => {
          const diff = ir.recv == null ? null : ir.recv - ir.sent;
          const recvColor = diff == null ? "#9AA1AB" : diff === 0 ? "#15803D" : "#B42318";
          const diffStr = diff == null ? "รอรับ" : diff === 0 ? "✓ ตรง" : `${diff > 0 ? "+" : ""}${diff}`;
          const diffColor = diff == null ? "#9AA1AB" : diff === 0 ? "#15803D" : "#B42318";
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.9fr", padding: "12px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{ir.name}</span>
              <span className="num" style={{ textAlign: "right" }}>{num(ir.sent)}</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: recvColor }}>{ir.recv == null ? "—" : num(ir.recv)}</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: diffColor }}>{diffStr}</span>
            </div>
          );
        })}

        {/* ── ฟอร์มตรวจรับจริง (เฉพาะใบที่ยังรอรับ + มีข้อมูลจริง) ── */}
        {canConfirm && canReceive && (
          <div style={{ margin: "14px 20px 4px", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>ตรวจรับเข้าคลังสาขา</div>
            <div style={{ marginBottom: 12 }}>
              <label style={FIELD_LABEL}>สาขาที่รับสินค้า</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={FIELD_INPUT}>
                {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11.5, color: "#7A8089", marginBottom: 8 }}>จับคู่แต่ละรายการกับสินค้าในคลัง แล้วใส่จำนวนที่รับจริง</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {shipment.rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_88px] gap-2 items-end">
                  <div>
                    <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>{r.name} <span style={{ color: "#9AA1AB", fontWeight: 400 }}>(ส่ง {r.sent})</span></label>
                    <select value={rowProduct[i] ?? ""} onChange={(e) => setProductAt(i, e.target.value)} style={FIELD_INPUT}>
                      <option value="">— เลือกสินค้า —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>รับจริง</label>
                    <input type="number" min={0} step={1} inputMode="numeric" value={rowQty[i] ?? ""} onChange={(e) => setQtyAt(i, e.target.value)} style={FIELD_INPUT} />
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#B42318", background: "#FCEDEC", borderRadius: 10, padding: "9px 12px", marginTop: 10 }}>
                <AlertTriangle size={14} style={{ flex: "0 0 14px" }} /> {error}
              </div>
            )}
          </div>
        )}
        {canConfirm && !canReceive && (
          <div style={{ margin: "12px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A5510", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "10px 14px" }}>
            <AlertTriangle size={14} style={{ flex: "0 0 14px" }} />
            ยังตรวจรับจริงไม่ได้ — ต้องมีสาขาและสินค้าในคลังอย่างน้อยอย่างละ 1 ก่อน
          </div>
        )}

        {shipment.by && (
          <div style={{ margin: "12px 20px 4px", background: "#F8F9FB", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: "#454B54" }}>
            ตรวจรับโดย <b>{shipment.by}</b>{shipment.at ? ` · ${shipment.at}` : ""}
          </div>
        )}
        {shipment.note && (
          <div style={{ margin: "8px 20px 12px", background: "#FCEDEC", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: "#B42318" }}>⚠ {shipment.note}</div>
        )}
      </div>
    </Modal>
  );
}
