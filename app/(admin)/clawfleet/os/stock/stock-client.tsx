"use client";

/**
 * ตู้คีบ OS — คลังสินค้า (Stock / Warehouse) · client
 * แปลจาก design ระบบตู้คีบ.dc.html บรรทัด 359–597 (overview + distribution + 2 modals).
 *  - แท็บ "ภาพรวม": flow strip → ตารางสต็อกรายสาขา (กดแถวกางดู) → คลังกลาง → สินค้าในตู้ + การโอน
 *  - แท็บ "การกระจาย": สถิติ shipment → filter chips → ตารางใบโอน → modal ตรวจรับ
 * ข้อมูลจริงจาก server (สาขาแรก) ถ้าว่าง → SAMPLE fallback เต็ม + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Info, Warehouse, Store, Monitor, ChevronRight, FileText,
  Boxes, ArrowRight, Plus, Trash2, Inbox, Check, X, Clock, ScanLine, Download,
  Undo2, Loader2,
} from "lucide-react";
import { Card, IconBox, Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN, num, thDate } from "@/components/clawfleet/os/format";
import {
  transferStock, receiveStock, submitStockCount, reviewCfStockCount, recordLoss, reviewCfLoss,
  createShipment, confirmShipmentReceived, lookupCfProductByBarcode, loadCfProductHistory,
} from "@/lib/clawfleet/stock-actions";
import { createBranchReturn } from "@/lib/clawfleet/branch-return-actions";
import {
  fetchReceivedTransfersForReturn, fetchReturnableFromTransfer,
} from "@/lib/clawfleet/branch-return-picker-actions";
import type { ReceivedTransferRow, ReturnableLine } from "@/lib/clawfleet/branch-return-queries";
import type { CfReceiptDoc, CfProductHistory } from "@/lib/clawfleet/stock-queries";
import { MachinesLoadoutTab, BranchMgmtLink, type MachineSeed, type LoadoutItemSeed } from "./machine-detail";

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

/* ── เอกสารจริงสำหรับ 3 แท็บใหม่ + การกระจาย + ยอดคลังกลางจริง (จาก page.tsx) ── */
export type DocReceiptSeed = {
  id: string; code: string; supplier: string | null;
  itemsCount: number; totalCostCents: number; createdAt: string;
};
export type DocCountSeed = {
  id: string; code: string; countedBy: string | null;
  itemsCounted: number; totalDiff: number; countedAt: string;
  // Wave 4b maker-checker: สถานะอนุมัติ + คนนับ + คนอนุมัติ
  status: string; // APPLIED | PENDING | APPROVED | REJECTED
  countedById: string;
  reviewedByName: string | null;
};
export type DocLossSeed = {
  id: string; code: string; reasonLabel: string;
  itemsCount: number; totalCostCents: number; reportedAt: string;
  // D1 maker-checker (audit 2026-07-01): สถานะอนุมัติ + คนแจ้ง + คนอนุมัติ
  status: string; // PENDING | APPROVED | REJECTED
  reportedById: string;
  reviewedByName: string | null;
};
export type WarehouseRowSeed = {
  // qty = gross (รวมของในตู้) · inMachines = ที่โหลดเข้าตู้ · net = บนชั้น (หยิบมาโหลดได้จริง)
  id: string; name: string; cat: string; qty: number; inMachines: number; net: number; recvISO: string | null;
  dist: { branchId: string; branch: string; qty: number; inMachines: number }[];
};
export type ShipmentSeed = {
  id: string; to: string; status: string; unitsCount: number; createdAt: string;
  lines: { lineId: string; name: string; sent: number; received: number | null }[];
  // แหล่งใบ: cfDelivery (กระจายภายใน · ตรวจรับที่นี่ได้) | dcTransfer (DC ส่งตรง · read-only บนหน้าแอดมิน)
  source?: "cf_delivery" | "dc_transfer";
};
/** ledger การเคลื่อนไหวสต๊อก (สำหรับดาวน์โหลด CSV · item #8) */
export type MovementSeed = {
  id: string; type: string; productName: string; qty: number;
  reason: string | null; documentType: string | null; occurredAt: string;
};

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
  // qty = gross (รวมทั้งหมด) · inMachines = ในตู้ · net = บนชั้น (พร้อมโหลด)
  id: string; name: string; cat: string; qty: number; inMachines: number; net: number; recvISO: string;
  tag: "ใหม่" | "ปกติ" | "เก่า"; ageDays: number;
  dist: { branchId: string; branch: string; qty: number; inMachines: number }[];
  hist: { id: string; to: string; qty: number; dateISO: string; status: ShipStatus }[];
};
type Transfer = { to: string; status: ShipStatus; dateISO: string; items: string };
type ShipStatus = "received" | "received_diff" | "in_transit" | "pending";

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

/* ───────────────────────── helpers ───────────────────────── */
/* NOTE: ตัด SAMPLE fallback ทั้งหมดออกแล้ว (CEO: โชว์เฉพาะข้อมูลจริง) —
 * ว่างจริง → EmptyState ภาษาไทยตรง ๆ · ไม่ผสมตัวเลขปลอมเข้าแถวจริงอีกต่อไป */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : thDate(d);
}
// ค่าประมาณ → ใช้สีจาง ไม่ใช่แดงจัด (กันตื่นตูมจากเลขที่เดา · เลขจริงดูในรายงานรายตู้)
function daysColor(d: number): string {
  if (d <= 5) return "#C2785A";
  if (d <= 8) return "#B89A6A";
  return "#8FA890";
}
function ageTag(days: number): WarehouseItem["tag"] {
  if (days <= 7) return "ใหม่";
  if (days >= 45) return "เก่า";
  return "ปกติ";
}

const TH_ITEM: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9AA1AB" };

/* ───────────────────────── main ───────────────────────── */
type StockTab = "overview" | "receipts" | "allreceipts" | "counts" | "losses" | "dist" | "machines";

/* หน้า "เลือกสาขาที่จะดู" (CEO 2026-07-28) — เปิดคลังมาต้องเลือกสาขาก่อน 1 สาขา
   แล้วสต๊อก/รับของ/นับ/การกระจาย(ใบรับ) ทั้งหมดเป็นของสาขานั้น (สลับได้ทุกเมื่อ). */
function BranchChooser({ realBranches }: { realBranches: BranchOption[] }) {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "4px 0" }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 4px", color: "#1A1D21" }}>เลือกสาขาที่จะดู</h2>
      <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 18px", lineHeight: 1.5 }}>
        เลือก 1 สาขา แล้ว <b>สต๊อก · รับของ · นับสต๊อก · ใบรับสินค้า</b> ทั้งหมดจะเป็นของสาขานั้น — สลับสาขาได้ทุกเมื่อจากปุ่มด้านบน
      </p>
      {realBranches.length === 0 ? (
        <div style={{ background: "#F8F9FB", border: "1px dashed #D6DAE0", borderRadius: 12, padding: 24, textAlign: "center", fontSize: 13, color: "#7A8089" }}>
          ยังไม่มีสาขาในสิทธิ์ของคุณ · ติดต่อผู้ดูแลเพื่อขอสิทธิ์ดูสาขา
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
          {realBranches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => router.push(`/clawfleet/os/stock?branch=${encodeURIComponent(b.id)}`)}
              style={{ display: "flex", alignItems: "center", gap: 11, textAlign: "left", background: "#fff", border: "1px solid #E8EAED", borderRadius: 13, padding: "14px 16px", cursor: "pointer" }}
            >
              <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 10, background: "#EEF0FE", display: "flex", alignItems: "center", justifyContent: "center", color: "#4F46E5" }}>
                <Warehouse size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "#9AA1AB" }}>ดูสต๊อก · รับของ · ใบรับ</span>
              </span>
              <ChevronRight size={16} style={{ color: "#C2C7CF", flex: "0 0 16px" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StockClient({
  branches,
  realBranches,
  products,
  receiptDocs,
  countDocs,
  lossDocs,
  warehouseRows,
  shipments,
  movements,
  receiptAllDocs,
  docBranchId,
  onHandMap,
  viewerId,
  canReviewLoss,
  asOfISO,
  machines,
  loadoutByMachine,
}: {
  branches: BranchStockSeed[];
  realBranches: BranchOption[];
  products: ProductOption[];
  receiptDocs: DocReceiptSeed[];
  countDocs: DocCountSeed[];
  lossDocs: DocLossSeed[];
  warehouseRows: WarehouseRowSeed[];
  shipments: ShipmentSeed[];
  movements: MovementSeed[];
  // แท็บ "ใบรับทุกสาขา" — ใบรับข้ามสาขา (received + รอรับ) พร้อมต้นทาง (CEO 2026-08-01)
  receiptAllDocs: CfReceiptDoc[];
  docBranchId: string | null;
  onHandMap: Record<string, number>;
  viewerId: string;
  canReviewLoss: boolean;
  // มูลค่าสต๊อก ณ วันที่ (YYYY-MM-DD) · null = ปัจจุบัน (ใช้ต้นทุนวันนี้)
  asOfISO: string | null;
  // surface-existing — รายชื่อตู้ + โหลดเอาต์ปัจจุบันต่อตู้ (สำหรับแท็บ "ไส้ในตู้")
  machines: MachineSeed[];
  loadoutByMachine: Record<string, LoadoutItemSeed[]>;
}) {
  const router = useRouter();
  const empty = branches.length === 0;

  // map seed → BranchRow (ข้อมูลจริงล้วน · ไม่มี sample proxy แล้ว)
  // ⚠️ outDay/salesDay/daysLeft = "ค่าประมาณ" (heuristic จาก dolls × อัตราเฉลี่ย) ยังไม่ใช่ velocity จริง
  // → แสดงเป็น "≈ ประมาณ" สีจาง เฉพาะสาขาที่มีตุ๊กตาจริง (dolls>0) · dolls=0 → โชว์ "—" ไม่เดาเลข
  const branchRows: BranchRow[] = useMemo(() => {
    return branches.map((b) => {
      const dolls = b.dolls;
      const outDay = dolls > 0 ? Math.max(1, Math.round(dolls * 0.15)) : 0;
      const salesDay = outDay * 230;
      return {
        branchId: b.branchId,
        branch: b.branch,
        dolls,
        valueBaht: b.valueCents > 0 ? Math.round(b.valueCents / 100) : 0,
        outDay,
        salesDay,
        daysLeft: outDay > 0 ? Math.max(1, Math.round(dolls / outDay)) : 0,
        low: b.lowCount,
        old: 0, // ไม่มี query "ของเก่า" รายสาขาจริง → ไม่เดา (0 = ไม่มีสัญญาณ)
        receipts: b.receipts,
      };
    });
  }, [branches]);

  const [tab, setTab] = useState<StockTab>("overview");

  // สาขาเริ่มต้นของฟอร์ม/เอกสาร = สาขาที่ server โหลดเอกสารจริงมา (ถ้าไม่มี → สาขาแรก)
  const defaultBranchId = docBranchId ?? realBranches[0]?.id ?? "";

  const tabs: { k: StockTab; label: string }[] = [
    { k: "overview", label: "ภาพรวม" },
    { k: "receipts", label: "รับของ" },
    { k: "allreceipts", label: "ใบรับทุกสาขา" },
    { k: "counts", label: "นับสต็อก" },
    { k: "losses", label: "ตัดของเสีย" },
    { k: "dist", label: "การกระจาย" },
    { k: "machines", label: "ไส้ในตู้" },
  ];

  // CEO 2026-07-28: ยังไม่เลือกสาขา (หลายสาขา · docBranchId=null) → โชว์หน้าเลือกสาขาก่อน
  if (!docBranchId) return <BranchChooser realBranches={realBranches} />;

  return (
    <div>
      {/* ── ตัวสลับสาขาใหญ่ตัวเดียว คุมทั้งหน้า (สต๊อก/รับของ/นับ/ใบรับ) · CEO 2026-07-28 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#5A6270" }}>กำลังดูสาขา</span>
        <select
          aria-label="เลือกสาขาที่จะดู"
          title="สลับสาขา — สต๊อก/รับของ/นับ/ใบรับ จะเปลี่ยนตามสาขานี้ทั้งหมด"
          value={docBranchId}
          onChange={(e) => router.push(`/clawfleet/os/stock?branch=${encodeURIComponent(e.target.value)}`)}
          style={{ ...FIELD_INPUT, width: "auto", minWidth: 200, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
        >
          {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {realBranches.length > 1 && (
          <button
            type="button"
            onClick={() => router.push("/clawfleet/os/stock")}
            style={{ border: "1px solid #E3E6EA", background: "#fff", borderRadius: 9, padding: "7px 13px", fontSize: 12, fontWeight: 700, color: "#4F46E5", cursor: "pointer" }}
          >
            ดูสาขาอื่น
          </button>
        )}
      </div>

      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A8089" }}>
          <Info size={15} style={{ flex: "0 0 15px", color: "#9AA1AB" }} /> ยังไม่มีข้อมูลสต็อกจริงในระบบ — เริ่มด้วยการ<b> รับสินค้าเข้าคลัง</b> ที่แท็บ “รับของ” แล้วตัวเลขจริงจะขึ้นที่นี่
        </div>
      )}

      {/* tab switcher + ลิงก์จัดการสาขา (surface-existing: หน้าเปลี่ยนชื่อ/ลบสาขาที่หายาก) */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: 4, width: "fit-content" }}>
          {tabs.map(({ k, label }) => {
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
        <span style={{ flex: 1 }} />
        <BranchMgmtLink />
      </div>

      {tab === "overview" && (
        <OverviewTab branchRows={branchRows} realBranches={realBranches} products={products} warehouseRows={warehouseRows} asOfISO={asOfISO} empty={empty} selectedBranchId={docBranchId} />
      )}
      {tab === "receipts" && (
        <ReceiptsTab docs={receiptDocs} realBranches={realBranches} products={products} defaultBranchId={defaultBranchId} />
      )}
      {tab === "allreceipts" && (
        <AllReceiptsTab docs={receiptAllDocs} />
      )}
      {tab === "counts" && (
        <CountsTab docs={countDocs} realBranches={realBranches} products={products} defaultBranchId={defaultBranchId} onHandMap={onHandMap} viewerId={viewerId} canReview={canReviewLoss} />
      )}
      {tab === "losses" && (
        <LossesTab docs={lossDocs} realBranches={realBranches} products={products} defaultBranchId={defaultBranchId} viewerId={viewerId} canReviewLoss={canReviewLoss} />
      )}
      {tab === "dist" && (
        <DistributionTab realBranches={realBranches} products={products} shipments={shipments} movements={movements} defaultBranchId={defaultBranchId} />
      )}
      {tab === "machines" && (
        <MachinesLoadoutTab machines={machines} loadoutByMachine={loadoutByMachine} />
      )}
    </div>
  );
}

/* แปลง category enum → label ไทย (สำหรับตารางคลังกลางจริง) */
const CAT_TH: Record<string, string> = {
  PLUSH: "ตุ๊กตา", TOY: "ของเล่น", UTILITY: "ของใช้", MYSTERY_BOX: "กล่องสุ่ม",
  MODEL: "โมเดล", KEYCHAIN: "พวงกุญแจ", SNACK: "ขนม", OTHER: "อื่น ๆ",
};

/* แปลง WarehouseRowSeed (จริง) → WarehouseItem (view-model ที่ modal ใช้) */
function toWarehouseItem(r: WarehouseRowSeed): WarehouseItem {
  const ageDays = r.recvISO
    ? Math.max(0, Math.round((Date.now() - new Date(r.recvISO).getTime()) / 86_400_000))
    : 0;
  return {
    id: r.id,
    name: r.name,
    cat: CAT_TH[r.cat] ?? r.cat,
    qty: r.qty,
    inMachines: r.inMachines,
    net: r.net,
    recvISO: r.recvISO ?? "",
    tag: ageTag(ageDays),
    ageDays,
    dist: r.dist,
    hist: [], // ใบกระจายจริงดูได้ในแท็บ "การกระจาย" — modal นี้โชว์การกระจายปัจจุบัน
  };
}

/* ───────────────────────── OVERVIEW ───────────────────────── */
function OverviewTab({
  branchRows,
  realBranches,
  products,
  warehouseRows,
  asOfISO,
  empty,
  selectedBranchId,
}: {
  branchRows: BranchRow[];
  realBranches: BranchOption[];
  products: ProductOption[];
  warehouseRows: WarehouseRowSeed[];
  // มูลค่าสต๊อก ณ วันที่ (YYYY-MM-DD) · null = ปัจจุบัน
  asOfISO: string | null;
  // ยังไม่มีข้อมูลจริง → ปิด date picker (as-of คิดจาก ledger จริงเท่านั้น) + โชว์ empty state
  empty: boolean;
  // CEO 2026-07-28: สาขาที่เลือกจากตัวสลับใหญ่ (คุมทั้งหน้า) → แท็บนี้เจาะดูสาขานั้นเลย (ไม่มีตัวเลือกซ้ำ)
  selectedBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [whItem, setWhItem] = useState<WarehouseItem | null>(null);
  const [asOfPending, startAsOfTransition] = useTransition();

  // ── เจาะดูสต็อกตาม "สาขาที่เลือก" จากตัวสลับใหญ่ (CEO 2026-07-28 · ยุบตัวเลือกซ้ำในแท็บทิ้ง) ──
  // viewBranchId = สาขาที่เลือกทั้งหน้า → แท็บภาพรวมโชว์คลังของสาขานั้นเลย (ไม่ต้องมี dropdown ในแท็บ)
  const viewBranchId = selectedBranchId ?? "";
  const viewBranchName = realBranches.find((b) => b.id === viewBranchId)?.name ?? null;
  const scoped = viewBranchName != null; // กำลังเจาะดูสาขาเดียว

  // วันนี้ (YYYY-MM-DD ในโซน browser) = ค่า default + เพดานบนของ date picker (ย้อนหลังเท่านั้น)
  const todayYmd = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  const isBackdated = asOfISO !== null && asOfISO !== todayYmd;

  // เปลี่ยนวันที่ → soft-nav ไป ?asof=... (คง ?branch เดิมไว้) · เลือกวันนี้/ว่าง → ถอด asof ออก
  function applyAsOf(next: string) {
    startAsOfTransition(() => {
      const params = new URLSearchParams(window.location.search);
      if (!next || next === todayYmd) params.delete("asof");
      else params.set("asof", next);
      const qs = params.toString();
      router.push(qs ? `/clawfleet/os/stock?${qs}` : "/clawfleet/os/stock");
    });
  }

  // คลังกลางจริงล้วน (ไม่มี sample fallback แล้ว) — ว่างจริง → EmptyState
  const warehouseAll: WarehouseItem[] = useMemo(
    () => warehouseRows.map(toWarehouseItem),
    [warehouseRows],
  );

  // ── ตารางสินค้าคงคลังตาม "คลังที่เลือก" ──
  // ทุกคลัง/รวม → โชว์ยอดรวมทุกสาขา (qty เดิม) · เจาะสาขา → โชว์เฉพาะ SKU ที่มีของที่สาขานั้น
  //   + แทน qty รวมด้วย "ยอดของสาขานั้น" (match ด้วย branchId → ตัวเลขจริงจาก ledger · กันสาขาชื่อซ้ำ)
  const warehouse: WarehouseItem[] = useMemo(() => {
    if (!scoped) return warehouseAll;
    const rows: WarehouseItem[] = [];
    for (const w of warehouseAll) {
      const here = w.dist.find((d) => d.branchId === viewBranchId);
      if (!here || here.qty <= 0) continue;
      // เจาะสาขา → qty/inMachines/net = ยอดของสาขานี้ · dist = เหลือแค่สาขานี้ (modal ก็โฟกัสสาขานี้)
      rows.push({ ...w, qty: here.qty, inMachines: here.inMachines, net: here.qty - here.inMachines, dist: [here] });
    }
    return rows;
  }, [scoped, warehouseAll, viewBranchId]);

  // แถวสต็อกรายสาขา — เจาะสาขา → เหลือแถวสาขานั้นแถวเดียว
  const visibleBranchRows = useMemo(
    () => (scoped ? branchRows.filter((b) => b.branchId === viewBranchId) : branchRows),
    [scoped, branchRows, viewBranchId],
  );

  const flow = [
    { title: scoped ? "คลังสาขา" : "คลังกลาง", sub: scoped ? `${viewBranchName} · ${warehouse.length} รายการ` : `รวมทุกสาขา · ${warehouse.length} รายการหลัก`, bg: "#EEF0FE", color: "#4F46E5", icon: <Warehouse size={16} /> },
    { title: "สต็อกสาขา", sub: scoped ? viewBranchName! : `${branchRows.length} สาขา`, bg: "#E7F4EC", color: "#15803D", icon: <Store size={16} /> },
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

      {/* (ตัวเลือกสาขาในแท็บถูกยุบไปที่ "ตัวสลับสาขาใหญ่" บนหัวหน้าแล้ว · CEO 2026-07-28) */}

      {/* มูลค่าสต๊อก ณ วันที่ — date picker (as-of) · คิดมูลค่าจาก ledger ย้อนหลัง
          ปิดในโหมดว่าง (empty) เพราะ as-of ต้องมี movement จริงถึงจะคิดได้ */}
      {!empty && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#5A6270" }}>มูลค่าสต๊อก ณ วันที่</span>
          <input
            type="date"
            aria-label="เลือกวันที่คิดมูลค่าสต๊อก"
            title="เลือกวันที่คิดมูลค่าสต๊อก (ย้อนหลังได้ · ค่าเริ่มต้น = วันนี้)"
            value={asOfISO ?? todayYmd}
            max={todayYmd}
            disabled={asOfPending}
            onChange={(e) => applyAsOf(e.target.value)}
            style={{ ...FIELD_INPUT, width: "auto", minWidth: 160, padding: "8px 12px", cursor: asOfPending ? "wait" : "pointer" }}
          />
          {isBackdated ? (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: "#EEF0FE", color: "#4F46E5", whiteSpace: "nowrap" }}>
              มูลค่า ณ {fmtDate(asOfISO!)}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "#9AA1AB", whiteSpace: "nowrap" }}>· ปัจจุบัน (ต้นทุนวันนี้)</span>
          )}
          {asOfPending && <span style={{ fontSize: 11, color: "#9AA1AB" }}>กำลังคิดใหม่…</span>}
        </div>
      )}

      {/* per-branch stock table */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>ภาพรวมสต็อกรายสาขา</span>
        <span style={{ fontSize: 12, color: "#9AA1AB" }}>ตุ๊กตา/มูลค่าสต็อก = ข้อมูลจริง · กดแถวเพื่อเจาะดูสาขานั้น + ใบรับสินค้า</span>
        {isBackdated && (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#4F46E5" }}>· มูลค่าคิด ณ {fmtDate(asOfISO!)}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9AA1AB", marginBottom: 12 }}>
        <span style={{ color: "#B6BBC4", fontWeight: 600 }}>≈</span>
        ช่อง “ออก/วัน · ยอดขาย/วัน · พอใช้” เป็น<b style={{ color: "#7A8089" }}>ค่าประมาณ</b> (คาดจากสต็อก ยังไม่ใช่ยอดขายจริงรายตู้) — ใช้ดูแนวโน้มคร่าว ๆ อย่าสั่งของจากเลขนี้ตรง ๆ
      </div>
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden", marginBottom: 22 }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.95fr 0.95fr 0.85fr 0.95fr 0.8fr 0.65fr 0.65fr 0.3fr", padding: "11px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>สาขา</span><span style={{ textAlign: "right" }}>ตุ๊กตาในสต็อก</span><span style={{ textAlign: "right" }}>มูลค่าสต็อก</span><span style={{ textAlign: "right" }}>ออก/วัน <span style={{ fontWeight: 500, color: "#B6BBC4" }}>≈</span></span><span style={{ textAlign: "right" }}>ยอดขาย/วัน <span style={{ fontWeight: 500, color: "#B6BBC4" }}>≈</span></span><span style={{ textAlign: "right" }}>พอใช้ <span style={{ fontWeight: 500, color: "#B6BBC4" }}>≈</span></span><span style={{ textAlign: "center" }}>ใกล้หมด</span><span style={{ textAlign: "center" }}>ของเก่า</span><span />
            </div>
            {visibleBranchRows.length === 0 ? (
              <div style={{ padding: "10px 4px" }}>
                <EmptyState
                  icon={<Store size={26} />}
                  title={scoped ? `ยังไม่มีสต็อกที่สาขา${viewBranchName}` : "ยังไม่มีสาขา"}
                  sub={scoped ? "ลองเลือก “ทุกคลัง” หรือรับสินค้าเข้าสาขานี้ก่อน" : "เพิ่มสาขาแล้วรับสินค้าเข้าคลัง ตัวเลขจริงจะขึ้นที่นี่"}
                />
              </div>
            ) : visibleBranchRows.map((b) => {
              const isOpen = open === b.branchId;
              const hasDolls = b.dolls > 0; // มีของจริง → โชว์ค่าประมาณ · ไม่มี → "—" (ไม่เดา)
              return (
                <div key={b.branchId} style={{ background: isOpen ? "#FAFBFE" : "#fff", borderBottom: "1px solid #F4F5F7" }}>
                  <div
                    className="co-rowlink"
                    onClick={() => setOpen(isOpen ? null : b.branchId)}
                    style={{ display: "grid", gridTemplateColumns: "1.1fr 0.95fr 0.95fr 0.85fr 0.95fr 0.8fr 0.65fr 0.65fr 0.3fr", padding: "14px 20px", alignItems: "center", cursor: "pointer", fontSize: 13 }}
                  >
                    <span style={{ fontWeight: 700 }}>{b.branch}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{num(b.dolls)} ตัว</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{bahtN(b.valueBaht)}</span>
                    <span className="num" style={{ textAlign: "right", color: "#9AA1AB" }}>{hasDolls ? `≈ ${num(b.outDay)} ตัว` : "—"}</span>
                    <span className="num" style={{ textAlign: "right", color: "#9AA1AB" }}>{hasDolls ? `≈ ${bahtN(b.salesDay)}` : "—"}</span>
                    <span className="num" style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: hasDolls ? daysColor(b.daysLeft) : "#C2C7CF" }}>{hasDolls ? `≈ ${b.daysLeft} วัน` : "—"}</span>
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
                            {([
                              ["ตุ๊กตาคงเหลือ", `${num(b.dolls)} ตัว`, "#1A1D21"],
                              ["มูลค่าสต็อก (ต้นทุน)", bahtN(b.valueBaht), "#1A1D21"],
                              ["เฉลี่ยตุ๊กตาออก/วัน (ประมาณ)", hasDolls ? `≈ ${num(b.outDay)} ตัว` : "—", "#9AA1AB"],
                              ["ยอดขายเฉลี่ย/วัน (ประมาณ)", hasDolls ? `≈ ${bahtN(b.salesDay)}` : "—", "#9AA1AB"],
                              ["สต็อกพอใช้อีก (ประมาณ)", hasDolls ? `≈ ${b.daysLeft} วัน` : "—", hasDolls ? daysColor(b.daysLeft) : "#9AA1AB"],
                            ] as [string, string, string][]).map(([l, v, c]) => (
                              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: "#6B7280" }}>{l}</span>
                                <span className="num" style={{ fontWeight: 600, color: c }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>ใบรับสินค้า (โอนจากคลังกลาง)</span>
                            <span style={{ fontSize: 10, color: "#9AA1AB" }}>· อัปเดตอัตโนมัติ</span>
                          </div>
                          {b.receipts.length === 0 && (
                            <div style={{ fontSize: 11.5, color: "#9AA1AB", background: "#F8F9FB", borderRadius: 9, padding: "10px 12px", marginBottom: 7 }}>ยังไม่มีใบรับสินค้าของสาขานี้</div>
                          )}
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

      {/* central warehouse table — รายสินค้า/ราย SKU · เจาะดูตามคลังที่เลือกได้ (CEO pinpoint #2) */}
      <Card
        title={scoped ? `คลังสาขา${viewBranchName} · สินค้าคงคลัง` : "คลังกลาง · สินค้าคงคลัง"}
        sub={scoped
          ? `ยอดคงคลังของสาขา${viewBranchName} รายสินค้า · กดสินค้าเพื่อดูรายละเอียด SKU`
          : "ยอดคงคลัง (ยังไม่อยู่ในตู้) รวมทุกสาขา · กดสินค้าเพื่อดูการกระจายตามสาขา"}
        pad={false}
        style={{ marginBottom: 18 }}
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 0.7fr 1fr 0.7fr 1.1fr", padding: "10px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>สินค้า</span><span>หมวด</span><span style={{ textAlign: "right" }}>บนชั้น · ในตู้</span><span style={{ textAlign: "right" }}>รับเข้าล่าสุด</span><span style={{ textAlign: "right" }}>รับมาแล้ว (วัน)</span><span style={{ textAlign: "right" }}>สถานะอายุ</span>
            </div>
            {warehouse.length === 0 ? (
              <div style={{ padding: "10px 4px" }}>
                <EmptyState
                  icon={<Warehouse size={26} />}
                  title={scoped ? `ยังไม่มีสินค้าในคลังสาขา${viewBranchName}` : "ยังไม่มีสินค้าในคลัง"}
                  sub={scoped ? "ลองเลือก “ทุกคลัง” หรือรับสินค้าเข้าสาขานี้ก่อน" : "รับสินค้าเข้าคลังที่แท็บ “รับของ” แล้วรายการสินค้าจะขึ้นที่นี่"}
                />
              </div>
            ) : warehouse.map((w) => {
              const t = AGE_TONE[w.tag];
              // "ใกล้หมด" คิดจาก net (บนชั้น) — ของที่หยิบมาโหลดตู้ได้จริง ไม่ใช่ gross ที่รวมของในตู้ไปแล้ว
              const low = w.net <= 20;
              const neg = w.net < 0; // ข้อมูล drift → net ติดลบ (โชว์ตามจริง เตือนด้วยสี ไม่ clamp)
              return (
                <div key={w.id} className="co-rowlink" onClick={() => setWhItem(w)} style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 0.7fr 1fr 0.7fr 1.1fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, cursor: "pointer" }}>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                    {w.name}
                    {low && !neg && <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "#FCEDEC", color: "#B42318" }}>ใกล้หมด</span>}
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 12 }}>{w.cat}</span>
                  {/* บนชั้น (net = รับเข้า − ที่โหลดเข้าตู้) = headline · ในตู้ = secondary (โชว์เฉพาะเมื่อ >0) */}
                  <span style={{ textAlign: "right", display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
                    <span className="num" style={{ fontWeight: 700, color: neg ? "#B42318" : low ? "#B45309" : "#1A1D21" }}>{num(w.net)}</span>
                    {w.inMachines > 0 && (
                      <span className="num" style={{ fontSize: 11, color: "#9AA1AB", fontWeight: 500 }}>ในตู้ {num(w.inMachines)}</span>
                    )}
                  </span>
                  <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{w.recvISO ? fmtDate(w.recvISO) : "—"}</span>
                  <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{w.recvISO ? `${w.ageDays} วัน` : "—"}</span>
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
          sub="ดูสินค้าที่ค้างในตู้แต่ละตู้ได้ที่แท็บ “ไส้ในตู้” (ตู้ไหนของค้างนานต้องเปลี่ยน)"
          pad={false}
        >
          {/* section นี้ยังไม่มี query "ตู้×สินค้าค้างนาน" ที่ overview → EmptyState ตรง ๆ ไม่โชว์ตัวอย่างปลอม */}
          <div style={{ padding: "10px 4px" }}>
            <EmptyState
              icon={<Monitor size={26} />}
              title="ยังไม่มีสรุปของค้างในตู้ที่หน้านี้"
              sub="ดูสินค้าปัจจุบันในแต่ละตู้ได้ที่แท็บ “ไส้ในตู้”"
            />
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <TransfersCard realBranches={realBranches} products={products} />
          <ReturnToDcCard branchId={viewBranchId} branchName={viewBranchName} products={products} />
        </div>
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

/* ───────────────────────── barcode scan input (ยิงปืน → เพิ่มบรรทัด) ─────────────────────────
 * ปืนบาร์โค้ด USB = พิมพ์โค้ด + กด Enter อัตโนมัติ. Enter → เรียก lookupCfProductByBarcode
 * → เจอ → callback(productId) (auto เพิ่ม/โฟกัสบรรทัดสินค้านั้น) · ไม่เจอ → โชว์ error ใต้ช่อง.
 */
function BarcodeScanInput({
  onHit,
  placeholder = "ยิงบาร์โค้ดหรือพิมพ์รหัส แล้วกด Enter",
}: {
  onHit: (productId: string) => void;
  placeholder?: string;
}) {
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function scan() {
    const raw = code.trim();
    if (!raw) return;
    setMsg(null);
    startTransition(async () => {
      const res = await lookupCfProductByBarcode({ barcode: raw });
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      onHit(res.data.id);
      setMsg({ ok: true, text: `เพิ่ม “${res.data.name}” แล้ว` });
      setCode(""); // ล้างช่องรอยิงตัวถัดไป
    });
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, background: "#EEF0FE", color: "#4F46E5", flex: "0 0 38px" }}>
          <ScanLine size={17} />
        </span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scan(); } }}
          placeholder={placeholder}
          inputMode="text"
          autoComplete="off"
          style={{ ...FIELD_INPUT, flex: 1 }}
        />
        <button
          type="button"
          onClick={scan}
          disabled={pending || !code.trim()}
          style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: pending || !code.trim() ? "#A5A0EC" : "#4F46E5", border: "none", padding: "0 14px", height: 38, borderRadius: 10, cursor: pending || !code.trim() ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
        >
          {pending ? "…" : "เพิ่ม"}
        </button>
      </div>
      {msg && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: msg.ok ? "#15803D" : "#B42318" }}>{msg.text}</div>
      )}
    </div>
  );
}

/* ───────────────────────── CSV download helper (item #8) ─────────────────────────
 * สร้าง CSV ฝั่ง client จากข้อมูลที่โหลดมาแล้ว (ไม่ยิง API เพิ่ม) → Blob → ดาวน์โหลด.
 * ใส่ BOM (﻿) ให้ Excel ไทยอ่าน UTF-8 ไม่เพี้ยน · escape ค่าที่มี comma/quote/newline.
 */
function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function csvDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
function CsvButton({ onClick, label = "ดาวน์โหลด CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
    >
      <Download size={13} /> {label}
    </button>
  );
}

/* ───────────────────────── transfers card (with + โอนสินค้า) ───────────────────────── */
function TransfersCard({ realBranches, products }: { realBranches: BranchOption[]; products: ProductOption[] }) {
  const router = useRouter();
  // เริ่มว่าง (ไม่มีตัวอย่างแล้ว) — ใบโอนที่เพิ่งกดจะโผล่ทันที · รีเฟรชแล้วดึงของจริงต่อ
  const [transfers, setTransfers] = useState<Transfer[]>([]);
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
      {transfers.length === 0 ? (
        <div style={{ padding: "10px 4px" }}>
          <EmptyState icon={<ArrowRight size={26} />} title="ยังไม่มีการโอนระหว่างสาขา" sub="กด “โอนสินค้า” เพื่อย้ายสต็อกจากสาขาหนึ่งไปอีกสาขา" />
        </div>
      ) : transfers.map((t, i) => {
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

/* ───────────────────────── ส่งคืนคลังกลาง (DC) — สาขาส่งคืน 2 สเต็ป ─────────────────────────
 * สเต็ป 1 (ที่นี่): สาขากด "ส่งคืน" → ตัดสต๊อกสาขาทันที + สร้างใบ PENDING → คน DC มากด "รับคืน" ทีหลัง.
 * เพิ่มรายการได้ 2 ทาง: (ก) เลือกจากสินค้าในคลังสาขา (ข) "เลือกจากใบโอน" → prefill จากใบที่รับเข้ามา.
 * idempotency: clientKey เดียวต่อการเปิด modal (retry ใช้ตัวเดิม = ไม่สร้างใบซ้ำ).
 */
type ReturnLine = { productId: string; qty: string; max?: number };

function ReturnToDcCard({ branchId, branchName, products }: {
  branchId: string; branchName: string | null; products: ProductOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clientKey, setClientKey] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([{ productId: "", qty: "" }]);
  const [note, setNote] = useState("");
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ returnCode: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const canReturn = branchId !== "" && products.length >= 1;

  function reset() {
    setLines([{ productId: "", qty: "" }]); setNote(""); setSourceCode(null); setError(null); setResult(null);
  }
  function openModal() {
    reset();
    // clientKey เดียวต่อการเปิด (retry หลัง error ใช้ตัวเดิม → createBranchReturn คืนใบเดิม ไม่ตัดสต๊อกซ้ำ)
    setClientKey(crypto.randomUUID());
    setOpen(true);
  }
  function closeModal() {
    if (pending) return;
    setOpen(false); reset();
  }

  // prefill จากใบโอน: แทนที่รายการทั้งหมดด้วยรายการของใบนั้น (cap = prefillQty ต่อบรรทัด)
  function applyFromTransfer(rows: ReturnableLine[], transferCode: string) {
    const next: ReturnLine[] = rows.map((r) => ({ productId: r.cfProductId, qty: String(r.prefillQty), max: r.prefillQty }));
    setLines(next.length > 0 ? next : [{ productId: "", qty: "" }]);
    setSourceCode(transferCode);
    setPickerOpen(false);
  }

  function submit() {
    setError(null);
    const parsed = parseLines(lines.map((l) => ({ productId: l.productId, qty: l.qty })));
    if (!parsed.ok) { setError(parsed.error); return; }
    startTransition(async () => {
      const res = await createBranchReturn({
        branchId,
        clientKey,
        lines: parsed.data.map((d) => ({ cfProductId: d.productId, qty: d.qty })),
        note: note.trim() || undefined,
        sourceTransferCode: sourceCode ?? undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      setResult({ returnCode: res.returnCode });
      router.refresh(); // สต๊อกสาขาถูกตัดแล้ว → ดึงยอดใหม่
    });
  }

  return (
    <Card
      title="ส่งคืนคลังกลาง (DC)"
      pad={false}
      right={
        <button
          type="button"
          onClick={openModal}
          disabled={!canReturn}
          style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: canReturn ? "#4F46E5" : "#A5A0EC", border: "none", padding: "7px 12px", borderRadius: 8, cursor: canReturn ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <Undo2 size={13} /> ส่งคืน DC
        </button>
      }
    >
      <div style={{ padding: "10px 4px" }}>
        <EmptyState
          icon={<Undo2 size={26} />}
          title="ส่งของคืนคลังกลาง"
          sub="สาขากด “ส่งคืน DC” → ตัดของออกจากสาขาทันที แล้วรอคลังกลางกดรับคืนเข้าสต๊อก"
        />
      </div>

      <Modal
        open={open}
        onClose={closeModal}
        title="ส่งคืนคลังกลาง (DC)"
        sub={branchName ? `จากสาขา ${branchName} · ระบบตัดสต๊อกสาขาทันที แล้วรอ DC รับคืน` : "ตัดสต๊อกสาขาทันที แล้วรอ DC รับคืน"}
        width={520}
        footer={
          result ? (
            <div style={{ display: "flex", padding: "16px 20px" }}>
              <button type="button" onClick={closeModal} style={PRIMARY_BTN(false)}>เสร็จสิ้น</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
              <button type="button" onClick={submit} disabled={!canReturn || pending} style={PRIMARY_BTN(!canReturn || pending)}>
                {pending ? "กำลังส่งคืน…" : "ยืนยันส่งคืน"}
              </button>
              <button type="button" onClick={closeModal} disabled={pending} style={CANCEL_BTN(pending)}>ยกเลิก</button>
            </div>
          )
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {result ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center", padding: "8px 0" }}>
              <span style={{ width: 46, height: 46, borderRadius: 12, background: "#E7F4EC", color: "#15803D", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={24} /></span>
              <div style={{ fontSize: 14, fontWeight: 700 }}>สร้างใบส่งคืนแล้ว</div>
              <div className="num" style={{ fontSize: 13, color: "#4F46E5", fontWeight: 700 }}>{result.returnCode}</div>
              <div style={{ fontSize: 12, color: "#7A8089" }}>รอคลังกลางรับคืน — ดูสถานะได้ที่คลังกลาง (หลังบ้าน DC)</div>
            </div>
          ) : !canReturn ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A5510", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "10px 14px" }}>
              <AlertTriangle size={15} style={{ flex: "0 0 15px" }} /> ยังส่งคืนไม่ได้ — ต้องเลือกสาขาและมีสินค้าในคลังก่อน
            </div>
          ) : (
            <>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <label style={{ ...FIELD_LABEL, marginBottom: 0, flex: 1 }}>รายการที่ส่งคืน</label>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "6px 11px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <FileText size={13} /> เลือกจากใบโอน
                  </button>
                </div>
                {sourceCode && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#4F46E5", background: "#EEF0FE", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                    <FileText size={12} /> อ้างอิงใบโอน <b className="num">{sourceCode}</b> · จำนวนสูงสุด = ที่รับมา/ที่มีบนชั้น
                  </div>
                )}
                <ReturnLineEditor products={products} lines={lines} setLines={setLines} />
              </div>
              <div>
                <label style={FIELD_LABEL}>หมายเหตุ (ไม่บังคับ)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ของเกิน / เลิกวางสาขานี้" style={FIELD_INPUT} />
              </div>
              {error && <ErrorRow msg={error} />}
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "9px 12px" }}>
                <Boxes size={14} style={{ flex: "0 0 14px", color: "#9AA1AB" }} />
                ระบบจะตัดสต๊อกสาขาทันที (ของบนชั้นไม่พอจะไม่ส่งคืน) — ยอดจะเข้าคลังกลางเมื่อ DC กด “รับคืน”
              </div>
            </>
          )}
        </div>
      </Modal>

      <FromTransferPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        branchId={branchId}
        onApply={applyFromTransfer}
      />
    </Card>
  );
}

/** line editor สำหรับส่งคืน (สินค้า + จำนวน · cap ต่อบรรทัดถ้ามาจากใบโอน) — mirror ReceiptLineEditor แต่ไม่มีต้นทุน */
function ReturnLineEditor({ products, lines, setLines }: {
  products: ProductOption[];
  lines: ReturnLine[];
  setLines: React.Dispatch<React.SetStateAction<ReturnLine[]>>;
}) {
  const setAt = (i: number, patch: Partial<ReturnLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeAt = (i: number) => setLines((prev) => (prev.length <= 1 ? [{ productId: "", qty: "" }] : prev.filter((_, j) => j !== i)));
  const add = () => setLines((prev) => [...prev, { productId: "", qty: "" }]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_84px_34px] gap-2 items-end">
          <div>
            {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>สินค้า</label>}
            <select value={l.productId} onChange={(e) => setAt(i, { productId: e.target.value })} style={FIELD_INPUT}>
              <option value="">— เลือก —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>จำนวน</label>}
            <input
              type="number" min={0} step={1} max={l.max} inputMode="numeric" value={l.qty}
              onChange={(e) => {
                // cap ที่ prefill ถ้ามาจากใบโอน (l.max) — กันคืนเกินที่รับมา/ที่มีบนชั้น
                let v = e.target.value;
                if (l.max != null && v !== "" && Number(v) > l.max) v = String(l.max);
                setAt(i, { qty: v });
              }}
              placeholder="0"
              style={FIELD_INPUT}
            />
          </div>
          <button type="button" onClick={() => removeAt(i)} disabled={lines.length <= 1} title="ลบ" style={{ height: 38, border: "1px solid #E3E6EA", borderRadius: 10, background: "#fff", color: lines.length <= 1 ? "#D4D7DC" : "#B42318", cursor: lines.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Plus size={13} /> เพิ่มรายการ
      </button>
    </div>
  );
}

/** "เลือกจากใบโอน" — list ใบโอน DC ที่รับเข้าสาขาแล้ว → เลือก 1 ใบ → prefill รายการส่งคืน */
function FromTransferPicker({ open, onClose, branchId, onApply }: {
  open: boolean; onClose: () => void; branchId: string;
  onApply: (rows: ReturnableLine[], transferCode: string) => void;
}) {
  const [list, setList] = useState<ReceivedTransferRow[] | null>(null);
  const [loadingList, startListTransition] = useTransition();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applying, startApplyTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // โหลด list เมื่อเปิด (ครั้งเดียวต่อการเปิด) · branchId เปลี่ยน = โหลดใหม่
  useEffect(() => {
    if (!open || !branchId) { setList(null); return; }
    setError(null);
    startListTransition(async () => {
      const rows = await fetchReceivedTransfersForReturn(branchId);
      setList(rows);
    });
  }, [open, branchId]);

  function pick(t: ReceivedTransferRow) {
    setApplyingId(t.transferId);
    setError(null);
    startApplyTransition(async () => {
      const rows = await fetchReturnableFromTransfer(branchId, t.transferId);
      if (rows.length === 0) { setError("ใบนี้ไม่มีสินค้าที่ส่งคืนได้ (อาจยังไม่ผูกกับสินค้าสาขา หรือของหมดแล้ว)"); setApplyingId(null); return; }
      onApply(rows, t.transferCode);
      setApplyingId(null);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="เลือกจากใบโอน" sub="ใบโอนที่คลังกลางส่งเข้าสาขานี้แล้ว — เลือก 1 ใบเพื่อดึงรายการมาส่งคืน" width={520}>
      <div style={{ padding: "16px 20px" }}>
        {loadingList && list == null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#7A8089", padding: "10px 0" }}>
            <Loader2 size={16} className="animate-spin" /> กำลังโหลดใบโอน…
          </div>
        ) : list && list.length === 0 ? (
          <EmptyState icon={<Inbox size={26} />} title="ยังไม่มีใบโอนที่รับเข้าสาขานี้" sub="เมื่อคลังกลางส่งของมาและสาขากดรับแล้ว ใบโอนจะมาโผล่ที่นี่" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && <ErrorRow msg={error} />}
            {(list ?? []).map((t) => {
              const busy = applying && applyingId === t.transferId;
              return (
                <button
                  key={t.transferId}
                  type="button"
                  onClick={() => pick(t)}
                  disabled={applying}
                  style={{ textAlign: "left", background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "12px 14px", cursor: applying ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 12 }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="num" style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "#4F46E5" }}>{t.transferCode}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#7A8089" }}>
                      {t.fromName ? `จาก ${t.fromName} · ` : ""}{num(t.itemsCount)} รายการ · {num(t.unitsCount)} ชิ้น · {fmtDate((t.confirmedAt ?? t.dispatchedAt).toISOString())}
                    </span>
                  </span>
                  {busy ? <Loader2 size={16} className="animate-spin" style={{ color: "#4F46E5" }} /> : <ChevronRight size={16} style={{ color: "#C2C7CF", flex: "0 0 16px" }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
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
      sub={item ? `${item.cat} · รับเข้าล่าสุด ${item.recvISO ? fmtDate(item.recvISO) : "—"}` : undefined}
      badge={item && <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 11px", borderRadius: 20, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>{item.tag} · {item.ageDays} วัน</span>}
    >
      {item && (
        <div style={{ padding: "16px 20px" }}>
          {/* บนชั้น (net) = headline · ในตู้ + รวมทั้งหมด (gross) = ยอดย่อยให้เห็นว่าของไม่หาย */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#9AA1AB" }}>บนชั้น (พร้อมโหลด)</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700, color: item.net < 0 ? "#B42318" : "#1A1D21" }}>{num(item.net)}</span>
            <span style={{ fontSize: 12, color: "#9AA1AB" }}>ชิ้น</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, fontSize: 12, color: "#6B7280" }}>
            <span>ในตู้ <span className="num" style={{ fontWeight: 600 }}>{num(item.inMachines)}</span></span>
            <span>รวมทั้งหมด <span className="num" style={{ fontWeight: 600 }}>{num(item.qty)}</span></span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>กระจายอยู่ที่สาขา (สต็อกสาขา)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {item.dist.length === 0 ? (
              <div style={{ fontSize: 12, color: "#9AA1AB" }}>ยังไม่มีของกระจายไปสาขา</div>
            ) : item.dist.map((d) => (
              <div key={d.branchId} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 74, flex: "0 0 74px", fontSize: 12, color: "#454B54" }}>{d.branch}</span>
                <span style={{ flex: 1, height: 8, background: "#F1F2F5", borderRadius: 6, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(d.qty / maxQty) * 100}%`, background: "#4F46E5", borderRadius: 6 }} />
                </span>
                <span className="num" style={{ width: 46, flex: "0 0 46px", textAlign: "right", fontSize: 12.5, fontWeight: 600 }}>{num(d.qty)}</span>
              </div>
            ))}
          </div>
          {item.hist.length > 0 && (
          <>
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
          </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── shared: doc-form line editor ───────────────────────── */
type FormLine = { productId: string; qty: string };

function LineEditor({
  products,
  lines,
  setLines,
  qtyLabel = "จำนวน",
}: {
  products: ProductOption[];
  lines: FormLine[];
  setLines: (fn: (prev: FormLine[]) => FormLine[]) => void;
  qtyLabel?: string;
}) {
  const setAt = (i: number, patch: Partial<FormLine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeAt = (i: number) => setLines((prev) => prev.filter((_, j) => j !== i));
  const add = () => setLines((prev) => [...prev, { productId: products[0]?.id ?? "", qty: "" }]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_96px_36px] gap-2 items-end">
          <div>
            {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>สินค้า</label>}
            <select value={l.productId} onChange={(e) => setAt(i, { productId: e.target.value })} style={FIELD_INPUT}>
              <option value="">— เลือกสินค้า —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>{qtyLabel}</label>}
            <input type="number" min={0} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setAt(i, { qty: e.target.value })} placeholder="0" style={FIELD_INPUT} />
          </div>
          <button
            type="button"
            onClick={() => removeAt(i)}
            disabled={lines.length <= 1}
            title="ลบรายการ"
            style={{ height: 38, border: "1px solid #E3E6EA", borderRadius: 10, background: "#fff", color: lines.length <= 1 ? "#D4D7DC" : "#B42318", cursor: lines.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <Plus size={13} /> เพิ่มรายการ
      </button>
    </div>
  );
}

/** line editor สำหรับ "นับสต็อก" — โชว์ "ระบบมี" + "ต่าง" สด (กันนับตาบอด · item #6)
 *  onHandMap = null → ไม่โชว์คอลัมน์เทียบ (สาขาที่เลือกไม่ตรงกับที่โหลดยอดระบบมา) */
function CountLineEditor({ products, lines, setLines, onHandMap }: {
  products: ProductOption[];
  lines: FormLine[];
  setLines: (fn: (prev: FormLine[]) => FormLine[]) => void;
  onHandMap: Record<string, number> | null;
}) {
  const setAt = (i: number, patch: Partial<FormLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeAt = (i: number) => setLines((prev) => prev.filter((_, j) => j !== i));
  const add = () => setLines((prev) => [...prev, { productId: products[0]?.id ?? "", qty: "" }]);
  const showSys = onHandMap != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((l, i) => {
        const sys = showSys && l.productId ? (onHandMap?.[l.productId] ?? 0) : null;
        const countedRaw = Number(l.qty);
        const validCount = l.qty.trim() !== "" && Number.isFinite(countedRaw) && Number.isInteger(countedRaw) && countedRaw >= 0;
        const diff = sys != null && validCount ? countedRaw - sys : null;
        const bigDiff = diff != null && Math.abs(diff) >= COUNT_DIFF_THRESHOLD;
        return (
          <div key={i} className={showSys ? "grid grid-cols-[1fr_74px_60px_70px_34px] gap-2 items-end" : "grid grid-cols-[1fr_96px_36px] gap-2 items-end"}>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>สินค้า</label>}
              <select value={l.productId} onChange={(e) => setAt(i, { productId: e.target.value })} style={FIELD_INPUT}>
                <option value="">— เลือกสินค้า —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>นับได้</label>}
              <input type="number" min={0} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setAt(i, { qty: e.target.value })} placeholder="0" style={FIELD_INPUT} />
            </div>
            {showSys && (
              <>
                <div>
                  {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>ระบบมี</label>}
                  <div className="num" style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 10px", fontSize: 13, fontWeight: 600, color: sys == null ? "#C2C7CF" : "#5A6270", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10 }}>
                    {sys == null ? "—" : num(sys)}
                  </div>
                </div>
                <div>
                  {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>ต่าง</label>}
                  <div className="num" style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 10px", fontSize: 13, fontWeight: 700, color: diff == null ? "#C2C7CF" : diff === 0 ? "#15803D" : bigDiff ? "#B42318" : "#B45309", background: bigDiff ? "#FCEDEC" : "transparent", borderRadius: 10 }}>
                    {diff == null ? "—" : diff === 0 ? "✓" : `${diff > 0 ? "+" : ""}${num(diff)}`}
                  </div>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={lines.length <= 1}
              title="ลบรายการ"
              style={{ height: 38, border: "1px solid #E3E6EA", borderRadius: 10, background: "#fff", color: lines.length <= 1 ? "#D4D7DC" : "#B42318", cursor: lines.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <Plus size={13} /> เพิ่มรายการ
      </button>
      {showSys && (
        <div style={{ fontSize: 11, color: "#9AA1AB" }}>
          “ระบบมี” = ยอดคงคลังสาขาตามบัญชี · “ต่าง” = นับได้ − ระบบมี · ต่าง ≥ {COUNT_DIFF_THRESHOLD} จะเด้งเข้าหน้าตรวจสอบอัตโนมัติ
        </div>
      )}
    </div>
  );
}

/** parse + validate form lines → {productId, qty} (qty>0) · คืน error ถ้าไม่ผ่าน */
function parseLines(lines: FormLine[]): { ok: true; data: { productId: string; qty: number }[] } | { ok: false; error: string } {
  const out: { productId: string; qty: number }[] = [];
  for (const l of lines) {
    if (!l.productId) continue;
    const n = Number(l.qty);
    if (l.qty.trim() === "") continue;
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return { ok: false, error: "จำนวนต้องเป็นเลขจำนวนเต็ม ≥ 0" };
    if (n > 0) out.push({ productId: l.productId, qty: n });
  }
  if (out.length === 0) return { ok: false, error: "เลือกสินค้าและใส่จำนวนมากกว่า 0 อย่างน้อย 1 รายการ" };
  return { ok: true, data: out };
}

const PRIMARY_BTN = (disabled: boolean): React.CSSProperties => ({
  flex: 1, border: "none", cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700,
  color: "#fff", background: disabled ? "#A5A0EC" : "#4F46E5", padding: 12, borderRadius: 10,
});
const CANCEL_BTN = (disabled: boolean): React.CSSProperties => ({
  border: "1px solid #E3E6EA", cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
  color: "#5A6270", background: "#fff", padding: "12px 18px", borderRadius: 10,
});

function ErrorRow({ msg }: { msg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#B42318", background: "#FCEDEC", borderRadius: 10, padding: "9px 12px" }}>
      <AlertTriangle size={14} style={{ flex: "0 0 14px" }} /> {msg}
    </div>
  );
}

function NeedDataBanner({ msg }: { msg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A5510", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
      <AlertTriangle size={15} style={{ flex: "0 0 15px" }} /> {msg}
    </div>
  );
}

/* ───────────────────────── RECEIPTS (รับของ) ───────────────────────── */
function ReceiptsTab({ docs, realBranches, products, defaultBranchId }: {
  docs: DocReceiptSeed[]; realBranches: BranchOption[]; products: ProductOption[]; defaultBranchId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ productId: products[0]?.id ?? "", qty: "" }]);
  // ต้นทุนต่อชิ้น (สตางค์) ต่อรายการ — เริ่มจากต้นทุนเฉลี่ยปัจจุบันของสินค้า (ห้าม 0)
  const [costs, setCosts] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const canCreate = realBranches.length >= 1 && products.length >= 1;

  function reset() {
    setBranchId(defaultBranchId); setSupplier(""); setNote("");
    setLines([{ productId: products[0]?.id ?? "", qty: "" }]); setCosts([""]); setError(null);
  }
  function setLinesWrap(fn: (prev: FormLine[]) => FormLine[]) {
    setLines((prev) => {
      const next = fn(prev);
      // sync costs array length
      setCosts((c) => next.map((_, i) => c[i] ?? ""));
      return next;
    });
  }

  // ยิงบาร์โค้ด → ถ้ามีบรรทัดของสินค้านี้อยู่แล้ว +จำนวน 1 · ถ้าไม่มีเพิ่มบรรทัดใหม่ qty=1
  function onBarcodeHit(productId: string) {
    setLinesWrap((prev) => {
      const idx = prev.findIndex((l) => l.productId === productId);
      if (idx >= 0) {
        return prev.map((l, j) => (j === idx ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
      }
      // ถ้าบรรทัดแรกยังว่าง (ไม่เลือกสินค้า) ใช้บรรทัดนั้นเลย
      const emptyIdx = prev.findIndex((l) => !l.productId);
      if (emptyIdx >= 0) {
        return prev.map((l, j) => (j === emptyIdx ? { productId, qty: "1" } : l));
      }
      return [...prev, { productId, qty: "1" }];
    });
  }

  function submit() {
    setError(null);
    const parsed = parseLines(lines);
    if (!parsed.ok) { setError(parsed.error); return; }
    const costMap = new Map(products.map((p) => [p.id, p.unitCostCents]));
    const payloadLines = parsed.data.map((d, i) => {
      const typed = Number(costs[i]);
      const cents = costs[i] && Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100) : (costMap.get(d.productId) ?? 0);
      return { productId: d.productId, quantity: d.qty, unitCostCents: cents };
    });
    startTransition(async () => {
      const res = await receiveStock({ branchId, supplierName: supplier || undefined, note: note || undefined, lines: payloadLines });
      if (!res.ok) { setError(res.error); return; }
      setAdding(false); reset(); router.refresh();
    });
  }

  return (
    <div>
      {!canCreate && <NeedDataBanner msg="ยังรับของจริงไม่ได้ — ต้องมีสาขาและสินค้าในคลังอย่างน้อยอย่างละ 1 ก่อน" />}
      <DocListCard
        title="ใบรับสินค้าเข้าคลัง"
        sub="บันทึกของที่รับเข้าคลังสาขา · ต้นทุนเฉลี่ยถ่วงน้ำหนักอัปเดตอัตโนมัติ"
        extra={docs.length > 0 ? (
          <CsvButton onClick={() => downloadCsv(
            `ใบรับสินค้า_${csvDate(new Date().toISOString())}.csv`,
            ["เลขที่", "ผู้ขาย", "รายการ", "มูลค่า(บาท)", "วันที่"],
            docs.map((d) => [d.code, d.supplier || "", d.itemsCount, Math.round(d.totalCostCents / 100), csvDate(d.createdAt)]),
          )} />
        ) : undefined}
        onAdd={canCreate ? () => { reset(); setAdding(true); } : undefined}
        addLabel="รับของเข้า"
        empty={docs.length === 0}
        emptyTitle="ยังไม่มีใบรับสินค้า"
        emptySub="กด รับของเข้า เพื่อบันทึกของที่รับเข้าคลังสาขา"
        cols="1fr 1.2fr 0.7fr 0.9fr 0.9fr"
        head={<><span>เลขที่</span><span>ผู้ขาย</span><span style={{ textAlign: "right" }}>รายการ</span><span style={{ textAlign: "right" }}>มูลค่า</span><span style={{ textAlign: "right" }}>วันที่</span></>}
      >
        {docs.map((d) => (
          <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 0.7fr 0.9fr 0.9fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
            <span className="num" style={{ fontWeight: 700, color: "#4F46E5" }}>{d.code}</span>
            <span style={{ color: "#454B54" }}>{d.supplier || "—"}</span>
            <span className="num" style={{ textAlign: "right" }}>{num(d.itemsCount)} รายการ</span>
            <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{bahtN(Math.round(d.totalCostCents / 100))}</span>
            <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{fmtDate(d.createdAt)}</span>
          </div>
        ))}
      </DocListCard>

      <Modal
        open={adding}
        onClose={() => { if (!pending) { setAdding(false); reset(); } }}
        title="รับของเข้าคลังสาขา"
        sub="เลือกสาขา + รายการสินค้า + จำนวน (ต้นทุนเว้นว่าง = ใช้ต้นทุนเฉลี่ยเดิม)"
        width={520}
        footer={
          <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
            <button type="button" onClick={submit} disabled={pending} style={PRIMARY_BTN(pending)}>{pending ? "กำลังบันทึก…" : "บันทึกรับเข้า"}</button>
            <button type="button" onClick={() => { if (!pending) { setAdding(false); reset(); } }} disabled={pending} style={CANCEL_BTN(pending)}>ยกเลิก</button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={FIELD_LABEL}>สาขาที่รับเข้า</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={FIELD_INPUT}>
              {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={FIELD_LABEL}>ผู้ขาย / ที่มา (ไม่บังคับ)</label>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="เช่น คลังกลาง บางนา" style={FIELD_INPUT} />
          </div>
          <div>
            <label style={FIELD_LABEL}>รายการรับเข้า</label>
            <BarcodeScanInput onHit={onBarcodeHit} />
            <ReceiptLineEditor products={products} lines={lines} setLines={setLinesWrap} costs={costs} setCosts={setCosts} />
          </div>
          <div>
            <label style={FIELD_LABEL}>หมายเหตุ (ไม่บังคับ)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ล็อตใหม่ มิ.ย." style={FIELD_INPUT} />
          </div>
          {error && <ErrorRow msg={error} />}
        </div>
      </Modal>
    </div>
  );
}

/** line editor พิเศษสำหรับ "รับของ" — มีช่องต้นทุนต่อชิ้น (บาท) เพิ่มจากปกติ */
function ReceiptLineEditor({ products, lines, setLines, costs, setCosts }: {
  products: ProductOption[];
  lines: FormLine[];
  setLines: (fn: (prev: FormLine[]) => FormLine[]) => void;
  costs: string[];
  setCosts: (fn: (prev: string[]) => string[]) => void;
}) {
  const setAt = (i: number, patch: Partial<FormLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setCostAt = (i: number, v: string) => setCosts((prev) => prev.map((c, j) => (j === i ? v : c)));
  const removeAt = (i: number) => { setLines((prev) => prev.filter((_, j) => j !== i)); setCosts((prev) => prev.filter((_, j) => j !== i)); };
  const add = () => { setLines((prev) => [...prev, { productId: products[0]?.id ?? "", qty: "" }]); setCosts((prev) => [...prev, ""]); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((l, i) => {
        const defCost = products.find((p) => p.id === l.productId)?.unitCostCents ?? 0;
        return (
          <div key={i} className="grid grid-cols-[1fr_70px_84px_34px] gap-2 items-end">
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>สินค้า</label>}
              <select value={l.productId} onChange={(e) => setAt(i, { productId: e.target.value })} style={FIELD_INPUT}>
                <option value="">— เลือก —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>จำนวน</label>}
              <input type="number" min={0} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setAt(i, { qty: e.target.value })} placeholder="0" style={FIELD_INPUT} />
            </div>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>ทุน/ตัว (บาท)</label>}
              <input type="number" min={0} step="0.01" inputMode="decimal" value={costs[i] ?? ""} onChange={(e) => setCostAt(i, e.target.value)} placeholder={String(Math.round(defCost / 100))} style={FIELD_INPUT} />
            </div>
            <button type="button" onClick={() => removeAt(i)} disabled={lines.length <= 1} title="ลบ" style={{ height: 38, border: "1px solid #E3E6EA", borderRadius: 10, background: "#fff", color: lines.length <= 1 ? "#D4D7DC" : "#B42318", cursor: lines.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Plus size={13} /> เพิ่มรายการ
      </button>
    </div>
  );
}

/* ───────────────────────── COUNTS (นับสต็อก) ───────────────────────── */
const COUNT_DIFF_THRESHOLD = 5; // |ต่าง| ต่อสินค้า ≥ 5 → เตือนแดง (mirror VARIANCE_ANOMALY_THRESHOLD)

/* สถานะใบนับสต๊อก → pill (Wave 4b maker-checker) · APPLIED = ปรับแล้วอัตโนมัติ (ต่ำกว่าเกณฑ์) */
function countStatusPill(status: string): { bg: string; color: string; label: string; Icon: typeof Clock } | null {
  if (status === "PENDING") return { bg: "#FCF1E2", color: "#B45309", label: "รออนุมัติ", Icon: Clock };
  if (status === "REJECTED") return { bg: "#F1F2F7", color: "#5A6270", label: "ตีกลับ", Icon: X };
  if (status === "APPROVED") return { bg: "#E7F4EC", color: "#15803D", label: "อนุมัติแล้ว", Icon: Check };
  return null; // APPLIED (ต่ำกว่าเกณฑ์ · ปรับทันที) → ไม่ต้องมี pill (ปกติ)
}

function CountsTab({ docs, realBranches, products, defaultBranchId, onHandMap, viewerId, canReview }: {
  docs: DocCountSeed[]; realBranches: BranchOption[]; products: ProductOption[]; defaultBranchId: string;
  onHandMap: Record<string, number>; // ยอด "ระบบมี" ต่อสินค้า (ของสาขาเอกสารที่ server โหลดมา)
  viewerId: string; canReview: boolean; // Wave 4b: ใครกำลังดู + มีสิทธิ์อนุมัติใบนับ (ผจก./แอดมิน)
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ productId: products[0]?.id ?? "", qty: "" }]);
  const [error, setError] = useState<string | null>(null);
  // Wave 4b · การอนุมัติ/ตีกลับต่อใบ (แยก transition จากฟอร์มสร้าง · mirror LossesTab)
  const [reviewing, setReviewing] = useState<string | null>(null); // countId ที่กำลังตัดสิน
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [reviewPending, startReview] = useTransition();
  const pendingCount = docs.filter((d) => d.status === "PENDING").length;
  const canCreate = realBranches.length >= 1 && products.length >= 1;

  function review(countId: string, decision: "approve" | "reject") {
    setReviewErr(null);
    setReviewing(countId);
    startReview(async () => {
      const res = await reviewCfStockCount({ countId, decision });
      setReviewing(null);
      if (!res.ok) { setReviewErr(res.error); return; }
      router.refresh();
    });
  }

  // ยอดระบบใช้ได้เมื่อฟอร์มนับ "สาขาเดียวกับ" สาขาเอกสารที่ server โหลด onHandMap มา
  // ถ้าเลือกนับสาขาอื่นในฟอร์ม (branchId ≠ defaultBranchId) ยอดระบบจะไม่ตรง → ซ่อนคอลัมน์ กันเข้าใจผิด
  const onHandUsable = branchId === defaultBranchId;

  function reset() { setBranchId(defaultBranchId); setNote(""); setLines([{ productId: products[0]?.id ?? "", qty: "" }]); setError(null); }

  function setLinesWrap(fn: (prev: FormLine[]) => FormLine[]) { setLines(fn); }
  // ยิงบาร์โค้ด → เพิ่มบรรทัดสินค้านั้น (นับ) · โฟกัสให้กรอกยอดนับ (ไม่ auto +1 เพราะ qty = ยอดนับจริง)
  function onBarcodeHit(productId: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === productId);
      if (idx >= 0) return prev; // มีบรรทัดสินค้านี้แล้ว — ให้ผู้ใช้กรอกยอดเอง
      const emptyIdx = prev.findIndex((l) => !l.productId);
      if (emptyIdx >= 0) return prev.map((l, j) => (j === emptyIdx ? { productId, qty: "" } : l));
      return [...prev, { productId, qty: "" }];
    });
  }

  function submit() {
    setError(null);
    // นับสต็อก: qty = ยอดที่นับได้จริง (อนุญาต 0 ได้) → ต้องเช็คเองว่ามีอย่างน้อย 1 บรรทัดมีสินค้า
    const out: { productId: string; countedQty: number }[] = [];
    for (const l of lines) {
      if (!l.productId || l.qty.trim() === "") continue;
      const n = Number(l.qty);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) { setError("จำนวนที่นับได้ต้องเป็นเลขจำนวนเต็ม ≥ 0"); return; }
      out.push({ productId: l.productId, countedQty: n });
    }
    if (out.length === 0) { setError("เลือกสินค้าและใส่จำนวนที่นับได้อย่างน้อย 1 รายการ"); return; }
    startTransition(async () => {
      const res = await submitStockCount({ branchId, note: note || undefined, lines: out });
      if (!res.ok) { setError(res.error); return; }
      setAdding(false); reset(); router.refresh();
    });
  }

  return (
    <div>
      {!canCreate && <NeedDataBanner msg="ยังนับสต็อกจริงไม่ได้ — ต้องมีสาขาและสินค้าในคลังอย่างน้อยอย่างละ 1 ก่อน" />}
      {pendingCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#B45309", background: "#FDF6EA", border: "1px solid #F0DEBB", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <Clock size={15} style={{ flex: "0 0 15px" }} />
          มีใบนับสต๊อกปรับยอดมูลค่าสูง <b>{num(pendingCount)}</b> ใบ รออนุมัติ (ยังไม่ตัดสต๊อก) · {canReview ? "ตรวจแล้วกด อนุมัติ/ตีกลับ (คุณอนุมัติใบที่ตัวเองนับไม่ได้)" : "รอผู้จัดการสาขา/แอดมินอนุมัติ"}
        </div>
      )}
      {reviewErr && <div style={{ marginBottom: 12 }}><ErrorRow msg={reviewErr} /></div>}
      <DocListCard
        title="ใบนับสต็อก"
        sub="นับของจริงในคลัง → ระบบปรับยอดให้ตรง · นับต่างมากจะเด้งเข้าหน้าตรวจสอบ · มูลค่าปรับสูงต้องมีคนที่ 2 อนุมัติก่อนตัดสต๊อก"
        extra={docs.length > 0 ? (
          <CsvButton onClick={() => downloadCsv(
            `ใบนับสต็อก_${csvDate(new Date().toISOString())}.csv`,
            ["เลขที่", "ผู้นับ", "รายการ", "ผลต่างรวม", "สถานะ", "ผู้อนุมัติ", "วันที่"],
            docs.map((d) => [
              d.code, d.countedBy || "", d.itemsCounted, d.totalDiff,
              countStatusPill(d.status)?.label ?? "ปรับแล้ว", d.reviewedByName || "", csvDate(d.countedAt),
            ]),
          )} />
        ) : undefined}
        onAdd={canCreate ? () => { reset(); setAdding(true); } : undefined}
        addLabel="นับสต็อก"
        empty={docs.length === 0}
        emptyTitle="ยังไม่มีใบนับสต็อก"
        emptySub="กด นับสต็อก เพื่อบันทึกการนับของจริงในคลัง"
        cols="0.9fr 1fr 0.6fr 0.7fr 1.3fr 0.8fr"
        head={<><span>เลขที่</span><span>ผู้นับ</span><span style={{ textAlign: "right" }}>รายการ</span><span style={{ textAlign: "right" }}>ผลต่าง</span><span>สถานะ</span><span style={{ textAlign: "right" }}>วันที่</span></>}
      >
        {docs.map((d) => {
          const pill = countStatusPill(d.status);
          const isPending = d.status === "PENDING";
          const isCounter = d.countedById === viewerId;
          // ปุ่มอนุมัติ/ตีกลับ = เฉพาะ ผจก./แอดมิน · ใบ PENDING · ไม่ใช่คนนับเอง (maker ≠ checker)
          const showReviewBtns = isPending && canReview && !isCounter;
          const rowBusy = reviewPending && reviewing === d.id;
          return (
            <div key={d.id} style={{ display: "grid", gridTemplateColumns: "0.9fr 1fr 0.6fr 0.7fr 1.3fr 0.8fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, background: isPending ? "#FFFDF8" : undefined }}>
              <span className="num" style={{ fontWeight: 700, color: "#4F46E5" }}>{d.code}</span>
              <span style={{ color: "#454B54" }}>{d.countedBy || "—"}</span>
              <span className="num" style={{ textAlign: "right" }}>{num(d.itemsCounted)} รายการ</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: d.status === "REJECTED" ? "#9AA1AB" : d.totalDiff === 0 ? "#15803D" : "#B42318", textDecoration: d.status === "REJECTED" ? "line-through" : undefined }}>{d.totalDiff > 0 ? "+" : ""}{num(d.totalDiff)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {pill && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: pill.color, background: pill.bg, borderRadius: 999, padding: "3px 9px" }}>
                    <pill.Icon size={12} /> {pill.label}
                  </span>
                )}
                {showReviewBtns && (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button type="button" onClick={() => review(d.id, "approve")} disabled={rowBusy} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600, color: "#fff", background: rowBusy ? "#9BC4A8" : "#15803D", border: "none", borderRadius: 7, padding: "4px 9px", cursor: rowBusy ? "default" : "pointer" }}>
                      <Check size={12} /> อนุมัติ
                    </button>
                    <button type="button" onClick={() => review(d.id, "reject")} disabled={rowBusy} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600, color: "#B42318", background: "#fff", border: "1px solid #E7C6C2", borderRadius: 7, padding: "4px 9px", cursor: rowBusy ? "default" : "pointer" }}>
                      <X size={12} /> ตีกลับ
                    </button>
                  </span>
                )}
                {d.status !== "PENDING" && d.status !== "APPLIED" && d.reviewedByName && (
                  <span style={{ fontSize: 11, color: "#9AA1AB" }}>โดย {d.reviewedByName}</span>
                )}
              </span>
              <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{fmtDate(d.countedAt)}</span>
            </div>
          );
        })}
      </DocListCard>

      <Modal
        open={adding}
        onClose={() => { if (!pending) { setAdding(false); reset(); } }}
        title="นับสต็อกในคลังสาขา"
        sub="ใส่จำนวนที่นับได้จริง — ระบบจะปรับยอดให้ตรง (นับเท่าเดิม = ข้าม)"
        width={500}
        footer={
          <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
            <button type="button" onClick={submit} disabled={pending} style={PRIMARY_BTN(pending)}>{pending ? "กำลังบันทึก…" : "บันทึกผลนับ"}</button>
            <button type="button" onClick={() => { if (!pending) { setAdding(false); reset(); } }} disabled={pending} style={CANCEL_BTN(pending)}>ยกเลิก</button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={FIELD_LABEL}>สาขาที่นับ</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={FIELD_INPUT}>
              {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={FIELD_LABEL}>รายการนับ (ใส่ยอดที่นับได้จริง)</label>
            {!onHandUsable && (
              <div style={{ fontSize: 11, color: "#B45309", background: "#FDF6EA", border: "1px solid #F0DEBB", borderRadius: 8, padding: "7px 10px", marginBottom: 8 }}>
                ยอด “ระบบมี” แสดงได้เฉพาะสาขาที่เปิดดูอยู่ — เลือกนับสาขาอื่นจะไม่โชว์ยอดเทียบ
              </div>
            )}
            <BarcodeScanInput onHit={onBarcodeHit} />
            <CountLineEditor
              products={products}
              lines={lines}
              setLines={setLinesWrap}
              onHandMap={onHandUsable ? onHandMap : null}
            />
          </div>
          <div>
            <label style={FIELD_LABEL}>หมายเหตุ (ไม่บังคับ)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น นับรอบสิ้นเดือน" style={FIELD_INPUT} />
          </div>
          {error && <ErrorRow msg={error} />}
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── LOSSES (ตัดของเสีย) ───────────────────────── */
const LOSS_REASONS: { k: "DAMAGE" | "THEFT" | "OBSOLETE" | "OTHER"; label: string }[] = [
  { k: "DAMAGE", label: "ชำรุด/เสียหาย" },
  { k: "THEFT", label: "สูญหาย/ถูกขโมย" },
  { k: "OBSOLETE", label: "ล้าสมัย/ตัดทิ้ง" },
  { k: "OTHER", label: "อื่น ๆ" },
];

/* สถานะใบตัดของเสีย → pill (D1 maker-checker) */
function lossStatusPill(status: string): { bg: string; color: string; label: string; Icon: typeof Clock } {
  if (status === "PENDING") return { bg: "#FCF1E2", color: "#B45309", label: "รออนุมัติ", Icon: Clock };
  if (status === "REJECTED") return { bg: "#F1F2F7", color: "#5A6270", label: "ตีกลับ", Icon: X };
  return { bg: "#E7F4EC", color: "#15803D", label: "อนุมัติแล้ว", Icon: Check };
}

function LossesTab({ docs, realBranches, products, defaultBranchId, viewerId, canReviewLoss }: {
  docs: DocLossSeed[]; realBranches: BranchOption[]; products: ProductOption[]; defaultBranchId: string;
  viewerId: string; canReviewLoss: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [reason, setReason] = useState<"DAMAGE" | "THEFT" | "OBSOLETE" | "OTHER">("DAMAGE");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ productId: products[0]?.id ?? "", qty: "" }]);
  const [error, setError] = useState<string | null>(null);
  // D1 · การอนุมัติ/ตีกลับต่อใบ (แยก transition จากฟอร์มสร้าง)
  const [reviewing, setReviewing] = useState<string | null>(null); // lossId ที่กำลังตัดสิน
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [reviewPending, startReview] = useTransition();
  const canCreate = realBranches.length >= 1 && products.length >= 1;
  const pendingCount = docs.filter((d) => d.status === "PENDING").length;

  function reset() { setBranchId(defaultBranchId); setReason("DAMAGE"); setNote(""); setLines([{ productId: products[0]?.id ?? "", qty: "" }]); setError(null); }

  // ยิงบาร์โค้ด → +จำนวน 1 ถ้ามีบรรทัดสินค้านี้แล้ว · ไม่งั้นเพิ่มบรรทัดใหม่ qty=1
  function onBarcodeHit(productId: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === productId);
      if (idx >= 0) return prev.map((l, j) => (j === idx ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
      const emptyIdx = prev.findIndex((l) => !l.productId);
      if (emptyIdx >= 0) return prev.map((l, j) => (j === emptyIdx ? { productId, qty: "1" } : l));
      return [...prev, { productId, qty: "1" }];
    });
  }

  function submit() {
    setError(null);
    const parsed = parseLines(lines);
    if (!parsed.ok) { setError(parsed.error); return; }
    startTransition(async () => {
      const res = await recordLoss({ branchId, reason, note: note || undefined, lines: parsed.data.map((d) => ({ productId: d.productId, qty: d.qty })) });
      if (!res.ok) { setError(res.error); return; }
      setAdding(false); reset(); router.refresh();
    });
  }

  function review(lossId: string, decision: "approve" | "reject") {
    setReviewErr(null);
    setReviewing(lossId);
    startReview(async () => {
      const res = await reviewCfLoss({ lossId, decision });
      setReviewing(null);
      if (!res.ok) { setReviewErr(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div>
      {!canCreate && <NeedDataBanner msg="ยังตัดของเสียจริงไม่ได้ — ต้องมีสาขาและสินค้าในคลังอย่างน้อยอย่างละ 1 ก่อน" />}
      {pendingCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#B45309", background: "#FDF6EA", border: "1px solid #F0DEBB", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <Clock size={15} style={{ flex: "0 0 15px" }} />
          มีใบตัดของเสียมูลค่าสูง <b>{num(pendingCount)}</b> ใบ รออนุมัติ · {canReviewLoss ? "ตรวจแล้วกด อนุมัติ/ตีกลับ (คุณอนุมัติใบที่ตัวเองแจ้งไม่ได้)" : "รอผู้จัดการสาขา/แอดมินอนุมัติ"}
        </div>
      )}
      {reviewErr && <div style={{ marginBottom: 12 }}><ErrorRow msg={reviewErr} /></div>}
      <DocListCard
        title="ใบตัดของเสีย / ของหาย"
        sub="ตัดของชำรุด/สูญหาย/ตัดทิ้งออกจากคลัง · มูลค่าสูงต้องมีคนที่ 2 อนุมัติก่อนตัดสต๊อก"
        extra={docs.length > 0 ? (
          <CsvButton onClick={() => downloadCsv(
            `ใบตัดของเสีย_${csvDate(new Date().toISOString())}.csv`,
            ["เลขที่", "สาเหตุ", "รายการ", "มูลค่า(บาท)", "สถานะ", "ผู้อนุมัติ", "วันที่"],
            docs.map((d) => [
              d.code, d.reasonLabel, d.itemsCount, Math.round(d.totalCostCents / 100),
              lossStatusPill(d.status).label, d.reviewedByName || "", csvDate(d.reportedAt),
            ]),
          )} />
        ) : undefined}
        onAdd={canCreate ? () => { reset(); setAdding(true); } : undefined}
        addLabel="ตัดของเสีย"
        empty={docs.length === 0}
        emptyTitle="ยังไม่มีใบตัดของเสีย"
        emptySub="กด ตัดของเสีย เพื่อบันทึกของชำรุด/สูญหาย/ตัดทิ้ง"
        cols="0.9fr 1fr 0.6fr 0.8fr 1.3fr 0.8fr"
        head={<><span>เลขที่</span><span>สาเหตุ</span><span style={{ textAlign: "right" }}>รายการ</span><span style={{ textAlign: "right" }}>มูลค่า</span><span>สถานะ</span><span style={{ textAlign: "right" }}>วันที่</span></>}
      >
        {docs.map((d) => {
          const pill = lossStatusPill(d.status);
          const isPending = d.status === "PENDING";
          const isReporter = d.reportedById === viewerId;
          // ปุ่มอนุมัติ/ตีกลับ = เฉพาะ ผจก./แอดมิน · ใบ PENDING · ไม่ใช่คนแจ้งเอง (maker ≠ checker)
          const showReviewBtns = isPending && canReviewLoss && !isReporter;
          const rowBusy = reviewPending && reviewing === d.id;
          return (
            <div key={d.id} style={{ display: "grid", gridTemplateColumns: "0.9fr 1fr 0.6fr 0.8fr 1.3fr 0.8fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, background: isPending ? "#FFFDF8" : undefined }}>
              <span className="num" style={{ fontWeight: 700, color: "#4F46E5" }}>{d.code}</span>
              <span style={{ color: "#454B54" }}>{d.reasonLabel}</span>
              <span className="num" style={{ textAlign: "right" }}>{num(d.itemsCount)}</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 600, color: d.status === "REJECTED" ? "#9AA1AB" : "#B42318", textDecoration: d.status === "REJECTED" ? "line-through" : undefined }}>{bahtN(Math.round(d.totalCostCents / 100))}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: pill.color, background: pill.bg, borderRadius: 999, padding: "3px 9px" }}>
                  <pill.Icon size={12} /> {pill.label}
                </span>
                {showReviewBtns && (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button type="button" onClick={() => review(d.id, "approve")} disabled={rowBusy} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600, color: "#fff", background: rowBusy ? "#9BC4A8" : "#15803D", border: "none", borderRadius: 7, padding: "4px 9px", cursor: rowBusy ? "default" : "pointer" }}>
                      <Check size={12} /> อนุมัติ
                    </button>
                    <button type="button" onClick={() => review(d.id, "reject")} disabled={rowBusy} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600, color: "#B42318", background: "#fff", border: "1px solid #E7C6C2", borderRadius: 7, padding: "4px 9px", cursor: rowBusy ? "default" : "pointer" }}>
                      <X size={12} /> ตีกลับ
                    </button>
                  </span>
                )}
                {d.status !== "PENDING" && d.reviewedByName && (
                  <span style={{ fontSize: 11, color: "#9AA1AB" }}>โดย {d.reviewedByName}</span>
                )}
              </span>
              <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{fmtDate(d.reportedAt)}</span>
            </div>
          );
        })}
      </DocListCard>

      <Modal
        open={adding}
        onClose={() => { if (!pending) { setAdding(false); reset(); } }}
        title="ตัดของเสีย / ของหาย"
        sub="เลือกสาเหตุ + รายการ + จำนวน · ตัดออกจากคลังตามต้นทุนเฉลี่ยปัจจุบัน · มูลค่าเกิน ฿500 จะเข้าสถานะ รออนุมัติ (ยังไม่ตัดสต๊อกจนกว่าคนที่ 2 อนุมัติ)"
        width={500}
        footer={
          <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
            <button type="button" onClick={submit} disabled={pending} style={{ ...PRIMARY_BTN(pending), background: pending ? "#E3B9B4" : "#B42318" }}>{pending ? "กำลังบันทึก…" : "ยืนยันตัดของเสีย"}</button>
            <button type="button" onClick={() => { if (!pending) { setAdding(false); reset(); } }} disabled={pending} style={CANCEL_BTN(pending)}>ยกเลิก</button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={FIELD_LABEL}>สาขา</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={FIELD_INPUT}>
                {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label style={FIELD_LABEL}>สาเหตุ</label>
              <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} style={FIELD_INPUT}>
                {LOSS_REASONS.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={FIELD_LABEL}>รายการที่ตัด</label>
            <BarcodeScanInput onHit={onBarcodeHit} />
            <LineEditor products={products} lines={lines} setLines={setLines} qtyLabel="จำนวน" />
          </div>
          <div>
            <label style={FIELD_LABEL}>หมายเหตุ (ไม่บังคับ)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น น้ำท่วมโกดัง" style={FIELD_INPUT} />
          </div>
          {error && <ErrorRow msg={error} />}
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── shared doc-list card ───────────────────────── */
function DocListCard({
  title, sub, onAdd, addLabel, empty, emptyTitle, emptySub, cols, head, children, extra,
}: {
  title: string; sub: string; onAdd?: () => void; addLabel: string;
  empty: boolean; emptyTitle: string; emptySub: string;
  cols: string; head: React.ReactNode; children: React.ReactNode;
  extra?: React.ReactNode; // ปุ่มเสริม (เช่น ดาวน์โหลด CSV) วางซ้ายปุ่มเพิ่ม
}) {
  return (
    <Card
      title={title}
      sub={sub}
      pad={false}
      right={(onAdd || extra) && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {extra}
          {onAdd && (
            <button type="button" onClick={onAdd} style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "#4F46E5", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Plus size={13} /> {addLabel}
            </button>
          )}
        </div>
      )}
    >
      {empty ? (
        <div style={{ padding: "10px 4px" }}>
          <EmptyState icon={<Inbox size={26} />} title={emptyTitle} sub={emptySub} />
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 620 }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, padding: "10px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>{head}</div>
            {children}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────── DISTRIBUTION ───────────────────────── */
// DB status (CfDeliveryStatus) → UI tone. รับแล้ว = DELIVERED · ยังไม่รับ = SCHEDULED/IN_TRANSIT
type DistFilter = "all" | "pending" | "received" | "cancelled";

type ShipVM = {
  id: string;
  to: string;
  dbStatus: string; // SCHEDULED | IN_TRANSIT | DELIVERED | CANCELLED
  unitsCount: number;
  createdAt: string;
  lines: { lineId: string; name: string; sent: number; received: number | null }[];
  isReceived: boolean;
  hasDiff: boolean;
  source: "cf_delivery" | "dc_transfer";
};

function shipTone(s: ShipVM): { bg: string; color: string; label: string } {
  if (s.dbStatus === "CANCELLED") return { bg: "#F1F2F7", color: "#5A6270", label: "ยกเลิก" };
  if (s.dbStatus === "DELIVERED") {
    return s.hasDiff
      ? { bg: "#FCEDEC", color: "#B42318", label: "รับแล้ว · ไม่ตรง" }
      : { bg: "#E7F4EC", color: "#15803D", label: "รับครบ · ตรงใบ" };
  }
  if (s.dbStatus === "IN_TRANSIT") return { bg: "#EEF0FE", color: "#4F46E5", label: "กำลังส่ง" };
  return { bg: "#FCF1E2", color: "#B45309", label: "รอสาขารับ" };
}

function toShipVM(s: ShipmentSeed): ShipVM {
  const isReceived = s.status === "DELIVERED";
  const hasDiff = isReceived && s.lines.some((l) => l.received != null && l.received !== l.sent);
  return {
    id: s.id, to: s.to, dbStatus: s.status, unitsCount: s.unitsCount, createdAt: s.createdAt,
    lines: s.lines, isReceived, hasDiff, source: s.source ?? "cf_delivery",
  };
}

// ประเภท movement (enum DB) → ป้ายไทยอ่านง่ายใน CSV
const MOVE_TYPE_TH: Record<string, string> = {
  RECEIPT_IN: "รับเข้า", COUNT_ADJUST: "ปรับยอดนับ", LOSS_ADJUST: "ตัดของเสีย",
  TRANSFER_OUT: "โอนออก", TRANSFER_IN: "โอนเข้า", WITHDRAW: "เบิก/ตัดจ่าย",
  LOAD_TO_MACHINE: "เติมเข้าตู้",
};

/* ───────────────────────── ใบรับทุกสาขา (CEO 2026-08-01) ─────────────────────────
   ดูใบรับสินค้า "ทุกสาขาที่ user เห็น" รวมกัน (received + รอรับ) + บอกส่งมาจากไหน
   + กดดูแยกรายสาขา + คลิกสินค้าในใบ → ดูประวัติการเคลื่อนไหวเต็ม (โหลดสด · scoped).
   READ-ONLY — ไม่มีปุ่มเขียน DB บนแท็บนี้. */
const RCPT_TONE: Record<"received" | "pending", { bg: string; color: string; label: string }> = {
  received: { bg: "#E7F4EC", color: "#15803D", label: "รับแล้ว" },
  pending: { bg: "#FCF1E2", color: "#B45309", label: "รอรับ" },
};
const RCPT_GRID = "0.85fr 1fr 1.3fr 1.1fr 0.55fr 0.55fr 0.85fr 0.32fr";
const ELLIPSIS: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function AllReceiptsTab({ docs }: { docs: CfReceiptDoc[] }) {
  const [branchFilter, setBranchFilter] = useState<string>("all"); // "all" | branchId
  const [statusFilter, setStatusFilter] = useState<"all" | "received" | "pending">("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [histProduct, setHistProduct] = useState<{ id: string; name: string } | null>(null);

  // รายชื่อสาขาที่ปรากฏในข้อมูล (สำหรับ dropdown "กดดูแยกรายสาขา")
  const branchesInData = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) m.set(d.branchId, d.branchName);
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [docs]);

  const stats = useMemo(() => ({
    total: docs.length,
    received: docs.filter((d) => d.status === "received").length,
    pending: docs.filter((d) => d.status === "pending").length,
  }), [docs]);

  const filtered = docs.filter((d) => {
    if (branchFilter !== "all" && d.branchId !== branchFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    return true;
  });

  const statusChips: { k: "all" | "received" | "pending"; label: string; n: number }[] = [
    { k: "all", label: "ทั้งหมด", n: stats.total },
    { k: "received", label: "รับแล้ว", n: stats.received },
    { k: "pending", label: "รอรับ", n: stats.pending },
  ];

  return (
    <div>
      {/* info banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
        <Info size={15} style={{ flex: "0 0 15px", color: "#9AA1AB" }} />
        ใบรับสินค้าทุกสาขาที่คุณดูแล · <b>รับแล้ว</b> = ของเข้าคลังเรียบร้อย · <b>รอรับ</b> = กำลังส่งมา ยังไม่กดรับ · กดที่ใบเพื่อดูรายการ แล้วกดสินค้าเพื่อดูประวัติการเคลื่อนไหว
      </div>

      {/* stat tiles */}
      <div className="grid grid-cols-3 gap-3.5 mb-[18px]">
        {[
          { label: "ทั้งหมด", n: stats.total, c: "#4F46E5" },
          { label: "รับแล้ว", n: stats.received, c: "#15803D" },
          { label: "รอรับ (กำลังส่งมา)", n: stats.pending, c: "#B45309" },
        ].map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 13, padding: "15px 17px" }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 8 }}>{s.label}</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 700, color: s.c }}>{s.n}</div>
          </div>
        ))}
      </div>

      {/* filters: สาขา + สถานะ */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select
          aria-label="กรองสาขาที่รับ"
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          style={{ ...FIELD_INPUT, width: "auto", minWidth: 180, padding: "8px 12px", fontWeight: 600, cursor: "pointer" }}
        >
          <option value="all">ทุกสาขา</option>
          {branchesInData.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {statusChips.map((c) => {
          const active = statusFilter === c.k;
          return (
            <button
              key={c.k}
              type="button"
              onClick={() => setStatusFilter(c.k)}
              style={{
                border: active ? "1px solid #4F46E5" : "1px solid #E3E6EA", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                padding: "7px 14px", borderRadius: 20, background: active ? "#4F46E5" : "#fff", color: active ? "#fff" : "#6B7280", transition: "all .15s",
              }}
            >
              {c.label} <span className="num" style={{ opacity: 0.75 }}>{c.n}</span>
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#9AA1AB" }}>{filtered.length} ใบ</span>
      </div>

      {/* table */}
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: "grid", gridTemplateColumns: RCPT_GRID, padding: "11px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>วันที่</span><span>เลขใบ</span><span>ส่งมาจาก</span><span>สาขาที่รับ</span>
              <span style={{ textAlign: "right" }}>รายการ</span><span style={{ textAlign: "right" }}>ชิ้น</span>
              <span style={{ textAlign: "center" }}>สถานะ</span><span />
            </div>
            {filtered.length === 0 ? (
              <EmptyState icon={<Inbox size={26} />} title="ยังไม่มีใบรับในเงื่อนไขนี้" sub="ลองเปลี่ยนตัวกรองสาขา/สถานะด้านบน" />
            ) : filtered.map((d) => {
              const key = `${d.status}-${d.kind}-${d.id}`;
              const open = expandedKey === key;
              const tone = RCPT_TONE[d.status];
              return (
                <div key={key}>
                  <div
                    className="co-rowlink"
                    onClick={() => setExpandedKey(open ? null : key)}
                    style={{ display: "grid", gridTemplateColumns: RCPT_GRID, padding: "14px 20px", alignItems: "center", cursor: "pointer", borderBottom: "1px solid #F4F5F7", fontSize: 13, background: open ? "#FAFAFE" : undefined }}
                  >
                    <span className="num" style={{ fontSize: 12, color: "#6B7280" }}>{fmtDate(d.dateISO)}</span>
                    <span className="num" style={{ fontWeight: 700, color: "#4F46E5", fontSize: 11.5, ...ELLIPSIS }}>{d.docCode}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ ...ELLIPSIS }}>{d.fromName ?? "—"}</span>
                      {d.kind === "dc_transfer" && (
                        <span style={{ flex: "0 0 auto", fontSize: 9.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap" }}>DC</span>
                      )}
                    </span>
                    <span style={{ fontWeight: 600, ...ELLIPSIS }}>{d.branchName}</span>
                    <span className="num" style={{ textAlign: "right", color: "#6B7280" }}>{num(d.itemsCount)}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{num(d.unitsCount)}</span>
                    <span style={{ textAlign: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: tone.bg, color: tone.color, whiteSpace: "nowrap" }}>{tone.label}</span>
                    </span>
                    <span style={{ textAlign: "right", color: "#C2C7CF", display: "flex", justifyContent: "flex-end" }}>
                      <ChevronRight size={16} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                    </span>
                  </div>
                  {open && (
                    <div style={{ padding: "8px 20px 16px", borderBottom: "1px solid #F4F5F7", background: "#FAFAFE" }}>
                      {(d.senderName || d.totalCostCents != null || d.photoCount > 0 || d.note) && (
                        <div style={{ fontSize: 11.5, color: "#7A8089", marginBottom: 9, display: "flex", gap: 14, flexWrap: "wrap" }}>
                          {d.senderName && <span>โดย {d.senderName}</span>}
                          {d.totalCostCents != null && <span>มูลค่า {bahtN(Math.round(d.totalCostCents / 100))}</span>}
                          {d.photoCount > 0 && <span>{d.photoCount} รูป</span>}
                          {d.note && <span>“{d.note}”</span>}
                        </div>
                      )}
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#9AA1AB", marginBottom: 7 }}>
                        รายการในใบ · กดสินค้าเพื่อดูประวัติการเคลื่อนไหว
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {d.lines.map((l, i) => (
                          <button
                            key={`${l.productId}-${i}`}
                            type="button"
                            disabled={!l.isCfProduct}
                            onClick={() => l.isCfProduct && setHistProduct({ id: l.productId, name: l.productName })}
                            style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: "#fff", border: "1px solid #ECEEF1", borderRadius: 8, padding: "8px 12px", cursor: l.isCfProduct ? "pointer" : "default", opacity: l.isCfProduct ? 1 : 0.6 }}
                          >
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, ...ELLIPSIS }}>{l.productName}</span>
                            <span className="num" style={{ fontSize: 12.5, fontWeight: 700, flex: "0 0 auto" }}>×{num(l.qty)}</span>
                            {l.isCfProduct ? (
                              <span style={{ flex: "0 0 auto", fontSize: 10.5, color: "#4F46E5", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                                <Clock size={12} /> ประวัติ
                              </span>
                            ) : (
                              <span style={{ flex: "0 0 auto", fontSize: 10, color: "#9AA1AB" }}>ยังไม่รับเข้าคลัง</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {histProduct && <ProductHistoryModal key={histProduct.id} product={histProduct} onClose={() => setHistProduct(null)} />}
    </div>
  );
}

/* ประวัติการเคลื่อนไหวของสินค้า 1 ตัว — โหลดสดผ่าน server action (scoped org+สาขาที่ user เห็น) */
function ProductHistoryModal({ product, onClose }: { product: { id: string; name: string }; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CfProductHistory | null>(null);
  const [err, setErr] = useState(false);

  // โหลดครั้งเดียวตอน mount — modal ถูก key ด้วย product.id ให้ remount ใหม่ทุกครั้งที่เปลี่ยนสินค้า
  //   (initial state loading=true/err=false มาจาก useState → ไม่ต้อง setState ตรง ๆ ใน effect body)
  useEffect(() => {
    let alive = true;
    loadCfProductHistory(product.id)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setErr(true); setLoading(false); } });
    return () => { alive = false; };
  }, [product.id]);

  return (
    <Modal open onClose={onClose} width={560} title={product.name} sub="ประวัติการเคลื่อนไหวในคลัง (ทุกสาขาที่คุณดูแล)">
      <div style={{ padding: "16px 20px" }}>
        {loading ? (
          <div style={{ fontSize: 13, color: "#9AA1AB", padding: "24px 0", textAlign: "center" }}>กำลังโหลด…</div>
        ) : err ? (
          <div style={{ fontSize: 13, color: "#B42318", padding: "24px 0", textAlign: "center" }}>โหลดประวัติไม่สำเร็จ · ลองปิดแล้วเปิดใหม่</div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState icon={<Inbox size={24} />} title="ยังไม่มีการเคลื่อนไหว" sub="สินค้านี้ยังไม่มีบันทึกเข้า-ออกในคลังของสาขาที่คุณดูแล" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.rows.map((r) => {
              const isIn = r.qty >= 0;
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#F8F9FB", borderRadius: 9 }}>
                  <span style={{ flex: "0 0 auto", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 6, background: isIn ? "#E7F4EC" : "#FCEDEC", color: isIn ? "#15803D" : "#B42318" }}>{r.typeLabel}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#6B7280", ...ELLIPSIS }}>
                    {r.branchName}{r.machineCode ? ` · ${r.machineCode}` : ""}
                  </span>
                  <span className="num" style={{ flex: "0 0 auto", fontSize: 12, color: "#9AA1AB" }}>{fmtDate(r.occurredAt)}</span>
                  <span className="num" style={{ flex: "0 0 56px", textAlign: "right", fontWeight: 700, fontSize: 13, color: isIn ? "#15803D" : "#B42318" }}>{isIn ? `+${num(r.qty)}` : num(r.qty)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DistributionTab({ realBranches, products, shipments: shipmentSeeds, movements, defaultBranchId }: {
  realBranches: BranchOption[];
  products: ProductOption[];
  shipments: ShipmentSeed[];
  movements: MovementSeed[];
  defaultBranchId: string;
}) {
  const router = useRouter();
  const hasReal = shipmentSeeds.length > 0;
  // ข้อมูลจริงล้วน (ไม่มี sample fallback แล้ว) — ว่างจริง → EmptyState ในตารางด้านล่าง
  const ships: ShipVM[] = useMemo(
    () => shipmentSeeds.map(toShipVM),
    [shipmentSeeds],
  );

  const [filter, setFilter] = useState<DistFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const detail = ships.find((s) => s.id === detailId) ?? null;
  const canCreate = realBranches.length >= 1 && products.length >= 1;

  const stats = useMemo(() => {
    const pending = ships.filter((s) => !s.isReceived && s.dbStatus !== "CANCELLED").length;
    const received = ships.filter((s) => s.isReceived && !s.hasDiff).length;
    const diff = ships.filter((s) => s.isReceived && s.hasDiff).length;
    const cancelled = ships.filter((s) => s.dbStatus === "CANCELLED").length;
    return [
      { label: "รอสาขารับ", n: pending, c: "#B45309" },
      { label: "รับครบ · ตรง", n: received, c: "#15803D" },
      { label: "รับแล้ว · ไม่ตรง", n: diff, c: "#B42318" },
      { label: "ยกเลิก", n: cancelled, c: "#5A6270" },
    ];
  }, [ships]);

  const filtered = ships.filter((s) => {
    if (filter === "all") return true;
    if (filter === "pending") return !s.isReceived && s.dbStatus !== "CANCELLED";
    if (filter === "received") return s.isReceived;
    return s.dbStatus === "CANCELLED";
  });

  const chips: { k: DistFilter; label: string }[] = [
    { k: "all", label: "ทั้งหมด" },
    { k: "pending", label: "รอสาขารับ" },
    { k: "received", label: "รับแล้ว" },
    { k: "cancelled", label: "ยกเลิก" },
  ];

  return (
    <div>
      {!hasReal && (
        <NeedDataBanner msg="ยังไม่มีใบกระจาย — กด “สร้างใบกระจาย” เพื่อส่งของจากคลังกลางไปสาขา" />
      )}

      {/* info banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
        <Info size={15} style={{ flex: "0 0 15px", color: "#9AA1AB" }} />
        คลังกลางสร้างใบกระจาย → สาขา → สาขากด “ตรวจรับ” ยืนยันของครบตรงกับใบ · รับแล้วล็อกไม่ให้รับซ้ำ
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

      {/* toolbar: filter chips + create */}
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
        <span style={{ flex: 1 }} />
        {movements.length > 0 && (
          <CsvButton
            label="ledger สต๊อก (CSV)"
            onClick={() => downloadCsv(
              `ledger_สต๊อก_${csvDate(new Date().toISOString())}.csv`,
              ["วันที่", "ประเภท", "สินค้า", "จำนวน", "เอกสาร", "หมายเหตุ"],
              movements.map((m) => [
                csvDate(m.occurredAt),
                MOVE_TYPE_TH[m.type] ?? m.type,
                m.productName,
                m.qty,
                m.documentType || "",
                m.reason || "",
              ]),
            )}
          />
        )}
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "#4F46E5", border: "none", padding: "8px 14px", borderRadius: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Plus size={14} /> สร้างใบกระจาย
          </button>
        )}
      </div>

      {/* shipment list */}
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 700 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 1.8fr 0.6fr 0.9fr 1.1fr 0.4fr", padding: "11px 20px", ...TH_ITEM, borderBottom: "1px solid #F4F5F7" }}>
              <span>ใบกระจาย</span><span>ปลายทาง</span><span>รายการ</span><span style={{ textAlign: "right" }}>รวม</span><span style={{ textAlign: "right" }}>วันที่สร้าง</span><span style={{ textAlign: "center" }}>สถานะ</span><span />
            </div>
            {filtered.length === 0 ? (
              <EmptyState icon={<Inbox size={26} />} title="ไม่มีใบกระจายในสถานะนี้" sub="ลองเปลี่ยนตัวกรองด้านบน หรือสร้างใบกระจายใหม่" />
            ) : filtered.map((sp) => {
              const tn = shipTone(sp);
              const summary = sp.lines.map((l) => `${l.name} ×${l.sent}`).join(" · ");
              return (
                <div key={sp.id} className="co-rowlink" onClick={() => setDetailId(sp.id)} style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 1.8fr 0.6fr 0.9fr 1.1fr 0.4fr", padding: "14px 20px", alignItems: "center", cursor: "pointer", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
                  <span className="num" style={{ fontWeight: 700, color: "#4F46E5", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hasReal ? `${sp.source === "dc_transfer" ? "DC" : "DLV"}-${sp.id.slice(0, 6).toUpperCase()}` : sp.id}</span>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sp.to}</span>
                    {sp.source === "dc_transfer" && (
                      <span style={{ flex: "0 0 auto", fontSize: 9.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap" }}>จาก DC</span>
                    )}
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{num(sp.unitsCount)}</span>
                  <span className="num" style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{fmtDate(sp.createdAt)}</span>
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

      {/* create-shipment modal */}
      <CreateShipmentModal
        open={creating}
        onClose={() => setCreating(false)}
        realBranches={realBranches}
        products={products}
        defaultBranchId={defaultBranchId}
        onDone={() => { setCreating(false); router.refresh(); }}
      />

      {/* shipment detail / confirm-receive modal */}
      {detail && (
        <ShipmentDetailModal
          key={detail.id}
          ship={detail}
          isSample={!hasReal}
          onClose={() => setDetailId(null)}
          onDone={() => { setDetailId(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── create-shipment modal ───────────────────────── */
function CreateShipmentModal({ open, onClose, realBranches, products, defaultBranchId, onDone }: {
  open: boolean;
  onClose: () => void;
  realBranches: BranchOption[];
  products: ProductOption[];
  defaultBranchId: string;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [fromLocation, setFromLocation] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ productId: products[0]?.id ?? "", qty: "" }]);
  // ราคาขาย (บาท) + ราคาทุน (บาท) ต่อรายการ — parallel arrays (แอดมินส่วนกลางต้องระบุ · บังคับ > 0)
  const [salePrices, setSalePrices] = useState<string[]>([""]);
  const [costs, setCosts] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setBranchId(defaultBranchId); setFromLocation(""); setNote("");
    setLines([{ productId: products[0]?.id ?? "", qty: "" }]); setSalePrices([""]); setCosts([""]); setError(null);
  }
  // sync ความยาว salePrices/costs ให้ตรงกับ lines เสมอ
  function setLinesWrap(fn: (prev: FormLine[]) => FormLine[]) {
    setLines((prev) => {
      const next = fn(prev);
      setSalePrices((s) => next.map((_, i) => s[i] ?? ""));
      setCosts((c) => next.map((_, i) => c[i] ?? ""));
      return next;
    });
  }

  function submit() {
    setError(null);
    if (!branchId) { setError("เลือกสาขาปลายทางก่อน"); return; }
    const parsed = parseLines(lines);
    if (!parsed.ok) { setError(parsed.error); return; }
    // แอดมินส่วนกลางส่งของ = ต้องระบุราคาขาย + ราคาทุนทุกรายการ (บังคับ > 0) → เช็คก่อนส่ง
    const payloadLines: { productId: string; qty: number; salePriceBaht: number; unitCostCents: number }[] = [];
    for (let i = 0; i < parsed.data.length; i++) {
      const d = parsed.data[i];
      const idx = lines.findIndex((l) => l.productId === d.productId);
      const saleRaw = idx >= 0 ? salePrices[idx] : "";
      const costRaw = idx >= 0 ? costs[idx] : "";
      const sale = Number(saleRaw);
      const cost = Number(costRaw);
      const pname = products.find((p) => p.id === d.productId)?.name ?? "สินค้า";
      if (!saleRaw || !Number.isFinite(sale) || sale <= 0) { setError(`ระบุราคาขายของ "${pname}" (บาท) มากกว่า 0`); return; }
      if (!costRaw || !Number.isFinite(cost) || cost <= 0) { setError(`ระบุราคาทุนของ "${pname}" (บาท) มากกว่า 0`); return; }
      payloadLines.push({
        productId: d.productId,
        qty: d.qty,
        salePriceBaht: Math.round(sale),
        unitCostCents: Math.round(cost * 100),
      });
    }
    startTransition(async () => {
      const res = await createShipment({
        branchId,
        fromLocation: fromLocation || undefined,
        note: note || undefined,
        lines: payloadLines,
      });
      if (!res.ok) { setError(res.error); return; }
      reset(); onDone();
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) { reset(); onClose(); } }}
      title="สร้างใบกระจายสินค้า"
      sub="คลังกลาง → สาขา · เลือกปลายทาง + รายการสินค้า + จำนวน + ราคาขาย/ราคาทุน"
      width={560}
      footer={
        <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
          <button type="button" onClick={submit} disabled={pending} style={PRIMARY_BTN(pending)}>{pending ? "กำลังสร้าง…" : "สร้างใบกระจาย"}</button>
          <button type="button" onClick={() => { if (!pending) { reset(); onClose(); } }} disabled={pending} style={CANCEL_BTN(pending)}>ยกเลิก</button>
        </div>
      }
    >
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={FIELD_LABEL}>สาขาปลายทาง</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={FIELD_INPUT}>
            {realBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label style={FIELD_LABEL}>ต้นทาง (ไม่บังคับ)</label>
          <input value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} placeholder="คลังกลาง บางนา" style={FIELD_INPUT} />
        </div>
        <div>
          <label style={FIELD_LABEL}>รายการสินค้า · ราคาขาย/ราคาทุน (บังคับกรอกทั้งคู่)</label>
          <ShipmentLineEditor
            products={products}
            lines={lines}
            setLines={setLinesWrap}
            salePrices={salePrices}
            setSalePrices={setSalePrices}
            costs={costs}
            setCosts={setCosts}
          />
        </div>
        <div>
          <label style={FIELD_LABEL}>หมายเหตุ (ไม่บังคับ)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น รอบส่งประจำสัปดาห์" style={FIELD_INPUT} />
        </div>
        {error && <ErrorRow msg={error} />}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#7A8089", background: "#F8F9FB", border: "1px solid #EDEFF2", borderRadius: 10, padding: "9px 12px" }}>
          <Boxes size={14} style={{ flex: "0 0 14px", color: "#9AA1AB" }} />
          ใบกระจายเริ่มที่สถานะ “รอสาขารับ” — สต็อกสาขายังไม่เพิ่มจนกว่าสาขาจะกดตรวจรับ · ตอนรับ ระบบจะใช้ราคาทุนตั้งต้นทุนเฉลี่ย และราคาขายตั้งราคาขายเริ่มต้นของสินค้า
        </div>
      </div>
    </Modal>
  );
}

/** line editor สำหรับ "ใบกระจาย" — มีช่องราคาขาย (บาท) + ราคาทุน (บาท) ต่อรายการ (บังคับ > 0) */
function ShipmentLineEditor({ products, lines, setLines, salePrices, setSalePrices, costs, setCosts }: {
  products: ProductOption[];
  lines: FormLine[];
  setLines: (fn: (prev: FormLine[]) => FormLine[]) => void;
  salePrices: string[];
  setSalePrices: (fn: (prev: string[]) => string[]) => void;
  costs: string[];
  setCosts: (fn: (prev: string[]) => string[]) => void;
}) {
  const setAt = (i: number, patch: Partial<FormLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setSaleAt = (i: number, v: string) => setSalePrices((prev) => prev.map((s, j) => (j === i ? v : s)));
  const setCostAt = (i: number, v: string) => setCosts((prev) => prev.map((c, j) => (j === i ? v : c)));
  const removeAt = (i: number) => {
    setLines((prev) => prev.filter((_, j) => j !== i));
    setSalePrices((prev) => prev.filter((_, j) => j !== i));
    setCosts((prev) => prev.filter((_, j) => j !== i));
  };
  const add = () => {
    setLines((prev) => [...prev, { productId: products[0]?.id ?? "", qty: "" }]);
    setSalePrices((prev) => [...prev, ""]);
    setCosts((prev) => [...prev, ""]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((l, i) => {
        const defCost = products.find((p) => p.id === l.productId)?.unitCostCents ?? 0;
        return (
          <div key={i} className="grid grid-cols-[1fr_58px_82px_82px_34px] gap-2 items-end">
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>สินค้า</label>}
              <select
                value={l.productId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setAt(i, { productId: pid });
                  // item #7 · prefill ราคาทุนเป็น "ค่าจริง" (ต้นทุนเฉลี่ยเดิมของสินค้า · บาท)
                  // เฉพาะเมื่อช่องทุนยังว่าง — ผู้ใช้แก้ทับได้ (ไม่ทับค่าที่พิมพ์เอง)
                  const pc = products.find((p) => p.id === pid)?.unitCostCents ?? 0;
                  if (pc > 0 && (costs[i] ?? "").trim() === "") setCostAt(i, String(Math.round(pc / 100)));
                }}
                style={FIELD_INPUT}
              >
                <option value="">— เลือก —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>ส่ง</label>}
              <input type="number" min={0} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setAt(i, { qty: e.target.value })} placeholder="0" style={FIELD_INPUT} />
            </div>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>ขาย (บาท)</label>}
              <input type="number" min={0} step={1} inputMode="numeric" value={salePrices[i] ?? ""} onChange={(e) => setSaleAt(i, e.target.value)} placeholder="10" style={FIELD_INPUT} />
            </div>
            <div>
              {i === 0 && <label style={{ ...FIELD_LABEL, marginBottom: 4 }}>ทุน (บาท)</label>}
              <input type="number" min={0} step="0.01" inputMode="decimal" value={costs[i] ?? ""} onChange={(e) => setCostAt(i, e.target.value)} placeholder={defCost > 0 ? String(Math.round(defCost / 100)) : "0"} style={FIELD_INPUT} />
            </div>
            <button type="button" onClick={() => removeAt(i)} disabled={lines.length <= 1} title="ลบ" style={{ height: 38, border: "1px solid #E3E6EA", borderRadius: 10, background: "#fff", color: lines.length <= 1 ? "#D4D7DC" : "#B42318", cursor: lines.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Plus size={13} /> เพิ่มรายการ
      </button>
    </div>
  );
}

/* ───────────────────────── shipment detail + confirm-receive ───────────────────────── */
function ShipmentDetailModal({ ship, isSample, onClose, onDone }: {
  ship: ShipVM;
  isSample: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // จำนวนที่รับจริงต่อบรรทัด (เริ่มจากจำนวนส่ง)
  const [recvQty, setRecvQty] = useState<string[]>(() => ship.lines.map((l) => String(l.sent)));
  const tn = shipTone(ship);
  // ยืนยันได้เฉพาะ: ใบจริง (ไม่ใช่ sample) · ยังไม่รับ · ไม่ยกเลิก · ไม่ใช่ใบ DC ส่งตรง
  //   (ใบ DC = dcTransfer → รับด้วย confirmTransfer สิทธิ์ DC floor · ทำในแอปพนักงาน/หน้า DC · หน้านี้ดูอย่างเดียว)
  const isDc = ship.source === "dc_transfer";
  const canConfirm = !isSample && !ship.isReceived && ship.dbStatus !== "CANCELLED" && !isDc;

  function setQtyAt(i: number, v: string) {
    setRecvQty((prev) => prev.map((x, j) => (j === i ? v : x)));
  }

  function confirm() {
    setError(null);
    const receivedLines = ship.lines.map((l, i) => {
      const n = Math.trunc(Number(recvQty[i]));
      return { lineId: l.lineId, receivedQty: Number.isFinite(n) && n >= 0 ? n : 0 };
    });
    startTransition(async () => {
      const res = await confirmShipmentReceived({ deliveryId: ship.id, receivedLines });
      if (!res.ok) { setError(res.error); return; }
      onDone();
    });
  }

  return (
    <Modal
      open
      onClose={() => { if (!pending) onClose(); }}
      width={600}
      title={<span className="num" style={{ color: "#4F46E5" }}>{isSample ? ship.id : `${isDc ? "DC" : "DLV"}-${ship.id.slice(0, 6).toUpperCase()}`}</span>}
      sub={`${isDc ? "DC (คลังกลาง)" : "คลังกลาง"} → สาขา${ship.to} · สร้าง ${fmtDate(ship.createdAt)}`}
      badge={<span style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: tn.bg, color: tn.color, whiteSpace: "nowrap" }}>{tn.label}</span>}
      footer={canConfirm ? (
        <div style={{ display: "flex", gap: 10, padding: "16px 20px" }}>
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            style={{ flex: 1, border: "none", cursor: pending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "#fff", background: pending ? "#84C39E" : "#15803D", padding: 12, borderRadius: 10 }}
          >
            {pending ? "กำลังบันทึก…" : "ยืนยันตรวจรับเข้าสต็อก"}
          </button>
        </div>
      ) : undefined}
    >
      <div style={{ padding: "6px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.9fr 0.9fr", padding: "9px 20px", fontSize: 10.5, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
          <span>รายการสินค้า</span><span style={{ textAlign: "right" }}>ส่ง</span><span style={{ textAlign: "right" }}>{canConfirm ? "รับจริง" : "รับแล้ว"}</span><span style={{ textAlign: "right" }}>ผลตรวจ</span>
        </div>
        {ship.lines.map((ir, i) => {
          const recvShown = ship.isReceived ? ir.received : null;
          const diff = recvShown == null ? null : recvShown - ir.sent;
          const diffStr = diff == null ? (canConfirm ? "รอรับ" : "—") : diff === 0 ? "✓ ตรง" : `${diff > 0 ? "+" : ""}${diff}`;
          const diffColor = diff == null ? "#9AA1AB" : diff === 0 ? "#15803D" : "#B42318";
          return (
            <div key={ir.lineId} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.9fr 0.9fr", padding: "12px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{ir.name}</span>
              <span className="num" style={{ textAlign: "right" }}>{num(ir.sent)}</span>
              <span style={{ textAlign: "right" }}>
                {canConfirm ? (
                  <input type="number" min={0} step={1} inputMode="numeric" value={recvQty[i] ?? ""} onChange={(e) => setQtyAt(i, e.target.value)} style={{ ...FIELD_INPUT, width: 76, textAlign: "right", padding: "6px 8px" }} />
                ) : (
                  <span className="num" style={{ fontWeight: 700, color: recvShown == null ? "#9AA1AB" : "#1A1D21" }}>{recvShown == null ? "—" : num(recvShown)}</span>
                )}
              </span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: diffColor }}>{diffStr}</span>
            </div>
          );
        })}

        {canConfirm && (
          <div style={{ margin: "12px 20px 4px", fontSize: 11.5, color: "#7A8089" }}>
            ปรับจำนวน “รับจริง” ให้ตรงกับของที่นับได้ แล้วกดยืนยัน — ระบบจะเพิ่มเข้าสต็อกสาขาและล็อกใบนี้ (รับซ้ำไม่ได้)
          </div>
        )}
        {ship.isReceived && (
          <div style={{ margin: "12px 20px", background: ship.hasDiff ? "#FCEDEC" : "#E7F4EC", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: ship.hasDiff ? "#B42318" : "#15803D" }}>
            {ship.hasDiff ? "⚠ รับไม่ตรงใบ — บันทึกตามจำนวนที่รับจริงแล้ว" : "✓ รับครบตรงใบแล้ว · เข้าสต็อกสาขาเรียบร้อย"}
          </div>
        )}
        {isSample && !ship.isReceived && (
          <div style={{ margin: "12px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7A5510", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "10px 14px" }}>
            <AlertTriangle size={14} style={{ flex: "0 0 14px" }} />
            นี่คือใบตัวอย่าง — ตรวจรับจริงได้เมื่อสร้างใบกระจายจริง
          </div>
        )}
        {isDc && !ship.isReceived && (
          <div style={{ margin: "12px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#4F46E5", background: "#EEF0FE", border: "1px solid #DADBF8", borderRadius: 10, padding: "10px 14px" }}>
            <AlertTriangle size={14} style={{ flex: "0 0 14px" }} />
            ใบนี้มาจาก DC (คลังกลาง) — รับเข้าสต็อกทำในแอปพนักงานสาขา หรือหน้า DC (สิทธิ์รับโอน) · หน้านี้ดูอย่างเดียว
          </div>
        )}
        {error && <div style={{ margin: "8px 20px 12px" }}><ErrorRow msg={error} /></div>}
      </div>
    </Modal>
  );
}
