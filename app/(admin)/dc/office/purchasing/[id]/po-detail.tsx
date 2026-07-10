"use client";

// DC · รายละเอียดใบสั่งซื้อ (client) — เลย์เอาต์ลีน 2 คอลัมน์ (Pinpoint #3–#12e · 2026-06-29):
//   ซ้าย:  หัวใบ (+ ปุ่มแก้ผู้ขาย/เรต #3) · ไทม์ไลน์ 6 ขั้น · ปุ่มดำเนินการขั้นต่อไป
//   ขวา:   "ต้นทุน & การจ่ายเงิน" (#8 รวมที่เดียว) + ส่งออก CSV/พิมพ์ (#9)
//   ล่าง:  แท็บ/collapsible — รายการสินค้า · กล่อง/พัสดุ · รับเข้าคลัง · เทียบ PO↔ใบรับ (#12e) · ประวัติแก้ไข (#3)
//
// ค่าขนส่งจีน-ไทย = บาทเท่านั้น (#5 ไม่มี ¥) · prefill จาก freightOwedSatang (CBM×เรต อัตโนมัติ · #4).
// Flow: ORDERED → SHIPPED → ARRIVED_TH → AT_WAREHOUSE → READY_TO_RECEIVE → RECEIVED (PARTIAL ระหว่าง).
//   ของถึงโกดัง (ARRIVED_TH→AT_WAREHOUSE) ไม่มีด่านจ่าย.
//   "พร้อมรับเข้า" (#6): บันทึกจ่ายค่าขนส่งจีน-ไทย (ใบจีน) → markReadyToReceive (ไม่สร้าง GRN · ไม่ตัดสต๊อก).
//   รับเข้าคลังจริง (receivePo) = ปุ่มแยกใน "รับเข้าคลัง" (READY_TO_RECEIVE/AT_WAREHOUSE/PARTIAL).
// ทุก action ผ่าน useTransition + (onChanged ?? router.refresh) + ภาษาไทย + busy-lock + แสดง error.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ImageIcon, Package, Plus, Pencil, Trash2, Truck, Ship, X, Check, CircleDollarSign, Download, ImageDown, FileDown, History, ChevronDown, RotateCcw, Zap } from "lucide-react";
import {
  markOrdered,
  markArrivedTh,
  markAtWarehouse,
  markReadyToReceive,
  revertPoStatus,
  cancelPo,
  receivePo,
  recordPoPayment,
  deletePoPayment,
  setPoTracking,
  updatePo,
  getPoAuditHistory,
  getPoReceivingSummary,
  listSuppliersForPo,
  type PoActionResult,
  type PoPaymentData,
  type PoAuditEntry,
  type PoReceiveSummary,
} from "@/lib/dc/po-actions";
import { addBox, updateBox, removeBox, setBoxContents, type BoxActionResult } from "@/lib/dc/box-actions";
import { retryTrcloud } from "@/lib/dc/grn-actions";
import type { PoFulfillment, PoFulfillmentLine } from "@/lib/dc/po-fulfillment";
import { PO_STATUS_LABEL, PO_STATUS_TONE, PO_ORIGIN_LABEL, PO_FLOW_CORE } from "@/lib/dc/nav";
import { Dialog } from "@/components/ui/dialog";
import { DcDeleteButton } from "@/app/(admin)/dc/_components/dc-delete-button";

// ── types (props จาก server) ──────────────────────────────────
export type PoLineData = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unitPriceCny: number; // ราคา/หน่วยในสกุลของใบ
  unitPriceThb: number | null;
  photoR2Key: string | null;
  // รูปสินค้าจากคลัง (DcProduct.imageR2Path) — ใช้โชว์ thumbnail ตอนรับเข้า
  imageR2Path: string | null;
  note: string | null;
};

export type BoxContentData = {
  id: string;
  productId: string;
  name: string;
  qty: number;
};

export type BoxData = {
  id: string;
  shipmentCode: string;
  trackingNo: string | null;
  mode: "TRUCK" | "SEA" | string;
  status: string;
  cbmTotal: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  note: string | null;
  contents: BoxContentData[];
};

export type PoDetailData = {
  id: string;
  poCode: string;
  status: string;
  origin: string;
  currency: string;
  fxRate: number | null;
  note: string | null;
  supplierName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  createdAt: string;
  lines: PoLineData[];
  boxes: BoxData[];
};

type WarehouseOption = { id: string; name: string };

// ── format helpers ────────────────────────────────────────────
function fmt(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
function tone(status: string): string {
  return PO_STATUS_TONE[status] ?? "draft";
}
/** ปริมาตร m³ จากขนาด ซม. (สดในฟอร์ม) */
function liveCbm(l: number, w: number, h: number): number | null {
  if (!(l > 0) || !(w > 0) || !(h > 0)) return null;
  return (l * w * h) / 1_000_000;
}

const numOrNull = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ── ลำดับสถานะตามจริง (ไว้เทียบ ≥ ARRIVED_TH ฯลฯ) ──────────────
// #6 — เพิ่ม READY_TO_RECEIVE คั่นระหว่าง AT_WAREHOUSE กับ RECEIVED (พร้อมรับเข้า · ยังไม่ตัดสต๊อก)
// PARTIAL ถือว่าอยู่ระหว่าง READY_TO_RECEIVE กับ RECEIVED (รับบางส่วน)
const STATUS_RANK: Record<string, number> = {
  DRAFT: 0,
  PENDING_APPROVAL: 1,
  APPROVED: 2,
  ORDERED: 3,
  SHIPPED: 4,
  ARRIVED_TH: 5,
  AT_WAREHOUSE: 6,
  READY_TO_RECEIVE: 7,
  PARTIAL: 7.5,
  RECEIVED: 8,
  CANCELLED: -1,
};
function statusRank(s: string): number {
  return STATUS_RANK[s] ?? 0;
}
/** สถานะปัจจุบันถึง/เลย target หรือยัง (ไม่นับ CANCELLED) */
function statusAtLeast(current: string, target: string): boolean {
  if (current === "CANCELLED") return false;
  return statusRank(current) >= statusRank(target);
}

/** ยอดเงินจาก satang (×100) → ตัวเลขจริงในสกุลนั้น */
function fromSatang(amountSatang: number): number {
  return amountSatang / 100;
}
function payCurSym(cur: string): string {
  return cur === "CNY" ? "¥" : "฿";
}

// ── main ──────────────────────────────────────────────────────
export function PoDetail({
  data,
  payments,
  goodsPaid,
  thaiFreightPaid,
  warehouses,
  canManage,
  canDelete = false,
  r2PublicUrl,
  onChanged,
  freightOwedSatang,
  freightRatesConfigured,
  fulfillment,
}: {
  data: PoDetailData;
  payments: PoPaymentData[];
  goodsPaid: boolean;
  thaiFreightPaid: boolean;
  warehouses: WarehouseOption[];
  canManage: boolean;
  // super_admin เท่านั้น — โชว์ปุ่ม "ลบใบสั่งซื้อ" (hard-delete + คืนสต๊อก). default false = ซ่อน.
  canDelete?: boolean;
  r2PublicUrl: string;
  onChanged?: () => void;
  // หลักฐานการกระจายสินค้า (โอน/เบิกจากใบนี้ · เหลือในใบ · สต๊อกจริง) — read-only
  // optional: call site เดิมยังไม่ส่งมา → undefined = ไม่แสดง section
  fulfillment?: PoFulfillment | null;
  // #4/#13 — ระบบบันทึกยอดค่าขนส่งไว้แล้ว → เอามา prefill ช่องจ่าย (แก้ได้)
  // optional: call site ที่ยังไม่ส่งมา (ของเดิม) จะ undefined → ฟอร์ม fallback ว่าง
  // goodsOwedSatang ยังรับได้ (ด่าน "ค่าของ" ถูกตัดออกแล้ว · ไม่ใช้ใน UI · กัน caller เดิมพัง)
  goodsOwedSatang?: number;
  freightOwedSatang?: number;
  // #4 — false = ยังไม่ตั้งเรตค่าขนส่งต่อคิว → freightOwed มาจากยอดเดิม/0 (เตือนให้ไปตั้งเรต)
  // optional: call site เดิมยังไม่ส่งมา → undefined = ไม่เตือน (ถือว่าตั้งแล้ว/ไม่ทราบ)
  freightRatesConfigured?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isChina = data.origin !== "THAI" && data.currency !== "THB";
  const s = isChina ? "¥" : "฿";

  const totalNative = data.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCny, 0);
  const totalThb = isChina && data.fxRate != null ? totalNative * data.fxRate : null;
  const totalCbm = data.boxes.reduce((sum, b) => sum + (b.cbmTotal ?? 0), 0);

  // หลัง action สำเร็จ: ถ้า inline master-detail ส่ง onChanged มา → ใช้ refetch ของมัน
  // ถ้าไม่ส่งมา (หน้า standalone /[id]) → router.refresh() ตามเดิม
  const refresh = () => (onChanged ? onChanged() : router.refresh());

  function run(action: () => Promise<PoActionResult | BoxActionResult>, confirmMsg?: string, after?: () => void) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        after?.();
        refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function photoUrl(key: string): string {
    if (/^https?:\/\//.test(key)) return key;
    return r2PublicUrl ? `${r2PublicUrl}/${key}` : key;
  }

  const status = data.status;
  // ตัวเลือกสินค้าในใบ (ไว้เลือกใส่กล่อง)
  const poProducts = useMemo(
    () => data.lines.map((l) => ({ id: l.productId, name: l.name, sku: l.sku, unit: l.unit })),
    [data.lines],
  );

  // "รอใส่ข้อมูล" — Pinpoint: ของสั่งทำ สั่งแล้ว/ได้เลขแล้ว แต่ยังไม่มีกล่องที่มีเลขพัสดุ
  const awaitingTracking =
    (status === "ORDERED" || status === "SHIPPED") &&
    (data.boxes.length === 0 || data.boxes.every((b) => !b.trackingNo));

  // ค่าขนส่งจีน-ไทย ล่าสุด (THAI_FREIGHT) — ไว้โชว์ "จ่ายแล้ว" + ใช้ใน block ต้นทุน&จ่าย
  // #4/#8: ด่าน "ค่าของ" (GOODS) ถูกตัดออกแล้ว → ค่าของมาจากราคาสินค้า (อ้างอิง) ไม่ใช่ payment stage
  const freightPayment = payments.find((p) => p.kind === "THAI_FREIGHT") ?? null;
  const freightPayments = payments.filter((p) => p.kind === "THAI_FREIGHT");

  // ── ขั้นต่อไป (Pinpoint #2/#3): กดเปิดป๊อปอัปเลื่อนสถานะ + กรอกข้อมูลที่ขั้นนั้นต้องใช้ ──
  const [advanceOpen, setAdvanceOpen] = useState(false);
  // นับครั้งที่ "รับเข้าคลัง" สำเร็จ → เด้งให้ตาราง "เทียบ PO↔ใบรับ" โหลดข้อมูลใหม่ (แก้ค้างเลข 0)
  const [receiveVersion, setReceiveVersion] = useState(0);
  // #3 — แก้ผู้ขาย/เรต (Dialog)
  const [editOpen, setEditOpen] = useState(false);
  const NEXT_ACTION_LABEL: Record<string, string> = {
    // #10 — ไม่มีด่านอนุมัติแล้ว · ใบใหม่เป็น ORDERED ทันที
    // ใบเก่าที่ยัง DRAFT/รออนุมัติ/อนุมัติ → ปุ่มเดียว "ยืนยันสั่งซื้อ" (markOrdered)
    DRAFT: "ยืนยันสั่งซื้อ",
    PENDING_APPROVAL: "ยืนยันสั่งซื้อ",
    APPROVED: "ยืนยันสั่งซื้อ",
    ORDERED: "ใส่เลข Tracking",
    SHIPPED: "ถึงไทยแล้ว",
    ARRIVED_TH: "ถึงโกดังแล้ว",
    // #6 — ที่โกดังแล้ว: ปุ่มไม่รับเข้าอัตโนมัติ · "จ่ายค่าขนส่ง + พร้อมรับเข้า" (markReadyToReceive)
    AT_WAREHOUSE: "พร้อมรับเข้า",
    // #6 — พร้อมรับเข้าแล้ว → รับเข้าคลังจริง (เปิดฟอร์ม receivePo)
    READY_TO_RECEIVE: "รับเข้าคลัง",
    PARTIAL: "รับส่วนที่เหลือ",
  };
  const nextLabel = NEXT_ACTION_LABEL[status] ?? null;
  const showAdvance = canManage && !!nextLabel;
  // ปุ่ม "ย้อนกลับ 1 ขั้น" (กดผิด) — เฉพาะช่วงขนส่งที่ปลอดภัย (ไม่แตะเงิน/สต๊อก) · ห้ามย้อนหลังรับเข้า
  const REVERT_PREV_LABEL: Record<string, string> = {
    SHIPPED: "สั่งแล้ว",
    ARRIVED_TH: "ได้เลข Tracking",
    AT_WAREHOUSE: "ถึงไทยแล้ว",
    READY_TO_RECEIVE: "ถึงโกดังแล้ว",
  };
  const revertLabel = REVERT_PREV_LABEL[status] ?? null;
  const showRevert = canManage && !!revertLabel;
  // #6 — ขั้น "รับเข้าคลังจริง" (READY_TO_RECEIVE/PARTIAL) ให้ปุ่มขั้นถัดไปเลื่อนไปฟอร์มรับเข้าด้านล่าง
  //   แทนการเปิด AdvanceModal (เพราะ receivePo อยู่ใน ReceiveSection แล้ว)
  const advanceScrollsToReceive = status === "READY_TO_RECEIVE" || status === "PARTIAL";
  const handleAdvanceClick = () => {
    if (advanceScrollsToReceive) {
      document.getElementById("dc-receive-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setAdvanceOpen(true);
    }
  };

  const canReceive = ["ORDERED", "SHIPPED", "ARRIVED_TH", "AT_WAREHOUSE", "READY_TO_RECEIVE", "PARTIAL"].includes(status);

  return (
    <div className="dc-po-detail" style={{ display: "grid", gap: 16 }}>
      {/* #7 — สไตล์เฉพาะหน้านี้ (scoped) — 2 คอลัมน์ → คอลัมน์เดียวบนมือถือ + หมุน chevron ตอนกาง + กฎพิมพ์ (#9) */}
      <style>{`
        @media (max-width: 920px) {
          .dc-po-detail .dc-po-grid { grid-template-columns: 1fr !important; }
        }
        .dc-po-detail details[open] > summary .dc-collapse-chevron { transform: rotate(180deg); }
        .dc-po-detail details > summary { transition: none; }
        .dc-po-detail details > summary::-webkit-details-marker { display: none; }
        @media print {
          .dc-po-detail .dc-po-grid { grid-template-columns: 1fr 1fr !important; }
          .dc-po-detail details { break-inside: avoid; }
          .dc-po-detail details > div { display: block !important; }
        }
      `}</style>
      {error && (
        <div className="dc-card" style={{ background: "#fdeaea", borderColor: "#f3c7c2", color: "#b8362a", fontWeight: 600, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* #7 — เลย์เอาต์ลีน 2 คอลัมน์ (มือถือ = คอลัมน์เดียว) */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          alignItems: "start",
        }}
        className="dc-po-grid"
      >
        {/* ── ซ้าย: หัวใบ + ไทม์ไลน์ + ปุ่มขั้นต่อไป ── */}
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {/* 1) หัวใบ (+ ปุ่มแก้ผู้ขาย/เรต #3) */}
          <div className="dc-card" style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className={`dc-st dc-st--${tone(status)}`}>{PO_STATUS_LABEL[status] ?? status}</span>
                  <span className={`dc-st dc-st--${isChina ? "ship" : "ok"}`} style={{ fontSize: 11 }}>
                    {PO_ORIGIN_LABEL[data.origin] ?? data.origin}
                  </span>
                  {awaitingTracking && (
                    <span
                      style={{ fontSize: 11.5, fontWeight: 700, color: "#92660a", background: "#fef9e7", border: "1px solid #f4d77e", borderRadius: 999, padding: "3px 10px" }}
                      title="ของสั่งทำ — รอผู้ขายแจ้งเลขพัสดุ/ขนาดกล่อง"
                    >
                      รอใส่เลขพัสดุ/ขนาดกล่อง
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: "#52525b", display: "grid", gap: 2, marginTop: 2 }}>
                  <div>ผู้ขาย: <b style={{ color: "#18181b" }}>{data.supplierName ?? "—"}</b></div>
                  <div>คลังปลายทาง: {data.warehouseName ?? "ยังไม่ระบุ"}</div>
                  {isChina && <div>เรตวันสั่ง: {data.fxRate != null ? `1 ¥ = ฿${fmt(data.fxRate, 4)}` : "ยังไม่ใส่เรต"}</div>}
                  {data.note && <div>โน้ต: {data.note}</div>}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "#71717a" }}>ยอดรวมทั้งใบ</div>
                  <div style={{ fontWeight: 800, fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{s}{fmt(totalNative)}</div>
                  {totalThb != null && <div style={{ fontSize: 12.5, color: "#71717a" }}>≈ ฿{fmt(totalThb)}</div>}
                  {totalCbm > 0 && <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>ปริมาตรรวม ~{fmt(totalCbm, 4)} m³</div>}
                </div>
                {/* #3 — แก้ผู้ขาย/เรต (server ล็อกเองถ้าจ่ายแล้ว/รับแล้ว) */}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="dc-chip"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    title="แก้ผู้ขาย / เรต"
                  >
                    <Pencil size={13} /> แก้ผู้ขาย/เรต
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#71717a", borderTop: "1px solid var(--dc-line, #f0f0f2)", paddingTop: 12, fontVariantNumeric: "tabular-nums" }}>
              <div>สร้างโดย: {data.createdBy ?? "—"} · {fmtDateTime(data.createdAt)}</div>
              {data.orderedAt && <div>สั่งเมื่อ: {fmtDateTime(data.orderedAt)}</div>}
            </div>
          </div>

          {/* 0) ไทม์ไลน์ 6 ขั้น + badge รอใส่ข้อมูล */}
          <Timeline status={status} isChina={isChina} awaitingTracking={awaitingTracking} />

          {/* ปุ่มเลื่อนขั้นถัดไป (Pinpoint #2/#3/#6) */}
          {(showAdvance || showRevert) && (
            <div style={{ display: "grid", gap: 8 }}>
              {showAdvance && (
                <button
                  type="button"
                  onClick={handleAdvanceClick}
                  disabled={pending}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", padding: "13px 16px", borderRadius: 12, border: "none", cursor: "pointer",
                    background: "var(--color-brand-600, #1c5fc4)", color: "#fff", fontSize: 15, fontWeight: 700,
                    fontFamily: "inherit", boxShadow: "0 2px 8px rgba(28,95,196,.25)",
                  }}
                >
                  <Zap size={17} aria-hidden /> ดำเนินการขั้นต่อไป: {nextLabel} →
                </button>
              )}
              {/* ย้อนกลับ 1 ขั้น (กดผิด) — ปุ่มรอง เล็ก · ยืนยันก่อนย้อน · server กันย้อนหลังรับเข้าอยู่แล้ว */}
              {showRevert && (
                <button
                  type="button"
                  onClick={() => run(() => revertPoStatus(data.id), `ย้อนสถานะกลับไป “${revertLabel}” ?\n(ใช้ตอนกดผิด — ไม่กระทบเงิน/สต๊อก)`)}
                  disabled={pending}
                  title="กดผิด? ย้อนสถานะกลับ 1 ขั้น"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    justifySelf: "center", padding: "7px 14px", borderRadius: 9, cursor: "pointer",
                    background: "transparent", border: "1px solid var(--dc-line, #e4e4e7)",
                    color: "#71717a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
                  }}
                >
                  <RotateCcw size={13} aria-hidden /> ย้อนกลับ: {revertLabel}
                </button>
              )}
            </div>
          )}
          {status === "RECEIVED" && <div style={{ fontSize: 13.5, color: "#167a41", fontWeight: 600 }}>รับสินค้าเข้าคลังครบแล้ว ✓</div>}
          {status === "CANCELLED" && <div style={{ fontSize: 13.5, color: "#b8362a", fontWeight: 600 }}>ใบนี้ถูกยกเลิก</div>}

          {/* ยกเลิกใบ + ลบใบ — จัดเรียงเป็นแถวเดียว (ลบ = super_admin เท่านั้น) */}
          {((canManage && (status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED")) || canDelete) && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {/* ยกเลิกใบ — ทำได้เฉพาะก่อนสั่ง (ร่าง/รออนุมัติ/อนุมัติ) · ไม่ใช่ปุ่มซ้ำกับ advance */}
              {canManage && (status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED") && (
                <button
                  type="button"
                  className="dc-btn-xl dc-btn-xl--danger"
                  style={{ ...btnSmall }}
                  disabled={pending}
                  onClick={() => run(() => cancelPo(data.id), "ยืนยันยกเลิกใบสั่งซื้อนี้?")}
                >
                  ยกเลิกใบ
                </button>
              )}
              {/* ลบใบสั่งซื้อ (hard-delete + คืนสต๊อก/TRCloud) — super_admin เท่านั้น */}
              {canDelete && (
                <DcDeleteButton docType="po" docId={data.id} docCode={data.poCode} label="🗑️ ลบใบสั่งซื้อ" onDeleted={refresh} />
              )}
            </div>
          )}

          {/* #3 — ประวัติการแก้ผู้ขาย/เรต (collapsible · โหลดสดจาก action) */}
          {canManage && <AuditHistory poId={data.id} />}
        </div>

        {/* ── ขวา: ต้นทุน & การจ่ายเงิน (#8 รวมที่เดียว) + CSV/พิมพ์ (#9) ── */}
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <CostAndPayment
            data={data}
            isChina={isChina}
            sym={s}
            totalNative={totalNative}
            totalThb={totalThb}
            freightPayment={freightPayment}
            freightPayments={freightPayments}
            freightOwedSatang={freightOwedSatang}
            freightRatesConfigured={freightRatesConfigured}
            status={status}
            thaiFreightPaid={thaiFreightPaid}
            canManage={canManage}
            pending={pending}
            run={run}
          />
        </div>
      </div>

      <AdvanceModal
        open={advanceOpen}
        onClose={() => setAdvanceOpen(false)}
        data={data}
        status={status}
        isChina={isChina}
        goodsPaid={goodsPaid}
        thaiFreightPaid={thaiFreightPaid}
        awaitingTracking={awaitingTracking}
        defaultWarehouseId={data.warehouseId}
        freightOwedSatang={freightOwedSatang}
        freightRatesConfigured={freightRatesConfigured}
        onDone={() => { setAdvanceOpen(false); refresh(); }}
      />

      {/* #3 — Dialog แก้ผู้ขาย/เรต */}
      <EditPoDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        data={data}
        isChina={isChina}
        onDone={() => { setEditOpen(false); refresh(); }}
      />

      {/* #7 — เนื้อหายาว ๆ ยุบเป็น collapsible เพื่อให้พอดีจอ ไม่ต้อง scroll ยาว */}
      <CollapseCard title="รายการสินค้า" sub={`${data.lines.length} รายการ · ของที่สั่งในใบนี้`} defaultOpen>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>รูป</th>
                <th style={cellHead}>สินค้า</th>
                <th style={{ ...cellHead, textAlign: "right" }}>จำนวน</th>
                <th style={{ ...cellHead, textAlign: "right" }}>ราคา/หน่วย</th>
                <th style={{ ...cellHead, textAlign: "right" }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    {l.photoR2Key ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl(l.photoR2Key)} alt={l.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--dc-line, #e4e4e7)" }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 8, border: "1px dashed var(--dc-line, #d4d4d8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#c4c4cc" }}>
                        <ImageIcon size={16} />
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{l.sku}</div>
                    {l.note && <div style={{ fontSize: 12, color: "#a1a1aa" }}>{l.note}</div>}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.qty} {l.unit}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {s}{fmt(l.unitPriceCny)}
                    {isChina && l.unitPriceThb != null && <div style={{ fontSize: 12, color: "#a1a1aa" }}>฿{fmt(l.unitPriceThb)}</div>}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{s}{fmt(l.qty * l.unitPriceCny)}</td>
                </tr>
              ))}
              {data.lines.length === 0 && (
                <tr><td style={{ ...cell, color: "#a1a1aa" }} colSpan={5}>ยังไม่มีรายการสินค้า</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--dc-line, #e4e4e7)", background: "#fafafa" }}>
                <td style={cell} colSpan={4}><b>รวมทั้งใบ</b></td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{s}{fmt(totalNative)}</div>
                  {totalThb != null && <div style={{ fontSize: 12, color: "#71717a" }}>≈ ฿{fmt(totalThb)}</div>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CollapseCard>

      {/* 3) กล่อง/พัสดุ — collapsible */}
      <CollapseCard
        title="กล่อง / พัสดุ"
        sub={`${data.boxes.length} กล่อง · เลขพัสดุ · รถ/เรือ · CBM`}
        defaultOpen={data.boxes.length > 0}
      >
        <BoxesSection
          poId={data.id}
          boxes={data.boxes}
          products={poProducts}
          canManage={canManage}
          pending={pending}
          run={run}
          sealed={status === "RECEIVED"}
        />
      </CollapseCard>

      {/* 7) รับเข้าคลัง — เปิดเมื่อยังไม่รับครบ */}
      {canReceive && (
        <div id="dc-receive-section">
          <CollapseCard
            title="รับเข้าคลัง"
            sub="นับของจริง → ตัดสต๊อก → ปิดใบ (GRN)"
            defaultOpen={status === "READY_TO_RECEIVE" || status === "AT_WAREHOUSE" || status === "PARTIAL"}
          >
            <ReceiveSection
              poId={data.id}
              lines={data.lines}
              warehouses={warehouses}
              defaultWarehouseId={data.warehouseId}
              atWarehouse={status === "READY_TO_RECEIVE" || status === "AT_WAREHOUSE"}
              r2PublicUrl={r2PublicUrl}
              onReceived={() => { setReceiveVersion((v) => v + 1); refresh(); }}
            />
          </CollapseCard>
        </div>
      )}

      {/* #12e — เทียบใบสั่งซื้อ vs ใบรับ (collapsible · โหลดสดจาก action · refreshKey เด้งโหลดใหม่หลังรับเข้า) */}
      <ReceivingCompare poId={data.id} status={status} refreshKey={receiveVersion} />

      {/* หลักฐานการกระจายสินค้า — โอน/เบิกจากใบนี้ · เหลือในใบ · สต๊อกจริง (read-only) */}
      {fulfillment && fulfillment.lines.length > 0 && (
        <FulfillmentLedger fulfillment={fulfillment} r2PublicUrl={r2PublicUrl} />
      )}
    </div>
  );
}

// ── หลักฐานการกระจายสินค้า (read-only) ──────────────────────────
// เชื่อมโยง: สั่ง → รับเข้า → โอน/เบิกที่อ้างใบนี้ → เหลือในใบ · + สต๊อกจริงในคลังตอนนี้
//   เหลือในใบ = รับเข้า − (โอน/เบิกที่อ้างใบนี้) · คงเหลือจริง = ยอดสต๊อกในคลังตอนนี้ (ทุกคลัง)
//   ไม่มี mutation — แสดงอย่างเดียว (reuse รูปแบบ thumbnail จาก ReceiveSection)
function FulfillmentLedger({ fulfillment, r2PublicUrl }: { fulfillment: PoFulfillment; r2PublicUrl: string }) {
  // รูปสินค้า (imageR2Path) → public URL (แนวเดียวกับ receiveImgUrl ของ ReceiveSection)
  function imgUrl(l: PoFulfillmentLine): string | null {
    const key = l.imageR2Path;
    if (!key) return null;
    if (/^https?:\/\//.test(key)) return key;
    return r2PublicUrl ? `${r2PublicUrl}/${key}` : null;
  }
  const t = fulfillment.totals;

  return (
    <details className="dc-card" open style={{ display: "block" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 750, color: "#18181b" }}>การกระจายสินค้า — โอน/เบิก จากใบนี้</div>
          <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>สั่ง / รับเข้า / โอน-เบิกที่อ้างใบนี้ / เหลือในใบ / สต๊อกจริง</div>
        </div>
        <ChevronDown size={18} className="dc-collapse-chevron" style={{ color: "#a1a1aa", flex: "0 0 auto" }} />
      </summary>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>รูป</th>
                <th style={cellHead}>สินค้า</th>
                <th style={{ ...cellHead, textAlign: "right" }}>สั่ง</th>
                <th style={{ ...cellHead, textAlign: "right" }}>รับเข้า</th>
                <th style={{ ...cellHead, textAlign: "right" }}>โอน/เบิกแล้ว</th>
                <th style={{ ...cellHead, textAlign: "right" }}>เหลือในใบ</th>
                <th style={{ ...cellHead, textAlign: "right" }}>คงเหลือจริง</th>
              </tr>
            </thead>
            <tbody>
              {fulfillment.lines.map((l) => {
                const url = imgUrl(l);
                // เหลือในใบ: > 0 = ยังไม่ได้กระจายหมด (ส้ม) · ≤ 0 = กระจายครบ/เกิน (เทา)
                const remainColor = l.remaining > 0 ? "#b06a0a" : "#71717a";
                return (
                  <tr key={l.productId} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                    <td style={cell}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={l.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--dc-line, #e4e4e7)" }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 8, border: "1px dashed var(--dc-line, #d4d4d8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#c4c4cc" }}>
                          <ImageIcon size={16} />
                        </div>
                      )}
                    </td>
                    <td style={cell}>
                      <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{l.sku}</div>
                    </td>
                    <td style={{ ...cell, textAlign: "right", color: "#71717a", fontVariantNumeric: "tabular-nums" }}>{l.ordered} {l.unit}</td>
                    <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.received}</td>
                    <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.movedOut}</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: remainColor }}>{l.remaining} {l.unit}</td>
                    <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#18181b" }}>{l.onHand} {l.unit}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--dc-line, #e4e4e7)", background: "#fafafa", fontVariantNumeric: "tabular-nums" }}>
                <td style={cell} colSpan={2}><b>รวมทั้งใบ</b></td>
                <td style={{ ...cell, textAlign: "right", color: "#71717a" }}>{t.ordered}</td>
                <td style={{ ...cell, textAlign: "right" }}>{t.received}</td>
                <td style={{ ...cell, textAlign: "right" }}>{t.movedOut}</td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 800, color: t.remaining > 0 ? "#b06a0a" : "#71717a" }}>{t.remaining}</td>
                <td style={{ ...cell, textAlign: "right" }}>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "#a1a1aa", padding: "0 2px" }}>
          เหลือในใบ = รับเข้า − (โอน/เบิกที่อ้างใบนี้) · คงเหลือจริง = ยอดสต๊อกในคลังตอนนี้
        </div>
      </div>
    </details>
  );
}

// ── section wrapper ───────────────────────────────────────────
function Section({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="dc-card" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 750, color: "#18181b" }}>{title}</div>
          {sub && <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}


// ── ป๊อปอัปเลื่อนสถานะ (Pinpoint #2/#3/#6) ───────────────────────────
// กดขั้นถัดไป → ป๊อปอัปขึ้น → กรอกข้อมูลที่ขั้นนั้นต้องใช้ (น้อยสุด) → ยืนยัน → เลื่อนสถานะ.
// #5 ค่าขนส่งจีน-ไทย = บาทเท่านั้น (ไม่มี ¥) · #4 ตัดด่าน "ค่าของ" ออก · #6 AT_WAREHOUSE → markReadyToReceive (ไม่รับเข้าอัตโนมัติ).
function AdvanceModal({
  open, onClose, data, status, isChina, thaiFreightPaid, freightOwedSatang, freightRatesConfigured, onDone,
}: {
  open: boolean; onClose: () => void; data: PoDetailData; status: string;
  isChina: boolean; goodsPaid: boolean; thaiFreightPaid: boolean; awaitingTracking: boolean;
  defaultWarehouseId: string | null; freightOwedSatang?: number; freightRatesConfigured?: boolean; onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  // #11/#12 — ช่องกรอกเลข Tracking จริง (ตอน ORDERED) + โหมดขนส่ง
  const [trackingNo, setTrackingNo] = useState("");
  const [trackMode, setTrackMode] = useState<"TRUCK" | "SEA">("SEA");

  type Res = { ok: boolean; error?: string };
  const done = (r: Res) => { if (r.ok) onDone(); else setErr(r.error ?? "ทำรายการไม่สำเร็จ"); };
  const exec = (fn: () => Promise<Res>) => start(async () => { setErr(null); done(await fn()); });
  // #5 — บันทึกจ่าย "ค่าขนส่งจีน-ไทย" (THB เท่านั้น) แล้วค่อยเลื่อนสถานะ (markReadyToReceive)
  const payFreightThen = (advance: () => Promise<Res>) =>
    start(async () => {
      setErr(null);
      const amt = Math.round((parseFloat(amount) || 0) * 100);
      if (amt <= 0) { setErr("กรอกจำนวนเงินค่าขนส่งที่จ่ายจริง"); return; }
      const p = await recordPoPayment({ poId: data.id, kind: "THAI_FREIGHT", amountSatang: amt, currency: "THB", paidAt });
      if (!p.ok) { setErr(p.error); return; }
      done(await advance());
    });

  // #11/#12 — กรอกเลข Tracking จริง → setPoTracking (บันทึกลงกล่อง + ดัน ORDERED→SHIPPED)
  const submitTracking = () =>
    start(async () => {
      setErr(null);
      const t = trackingNo.trim();
      if (!t) { setErr("กรุณากรอกเลข Tracking / เลขพัสดุ"); return; }
      done(await setPoTracking({ poId: data.id, trackingNo: t, mode: trackMode }));
    });

  // #4 — prefill ช่องยอดค่าขนส่งจีน-ไทย (CBM×เรต อัตโนมัติ · แก้ได้) เฉพาะตอน AT_WAREHOUSE
  const owedSatangForStage = status === "AT_WAREHOUSE" ? freightOwedSatang : undefined;
  useEffect(() => {
    if (open) {
      // prefill ยอดที่ระบบคิดให้ (แก้ได้) ตอนเปิดป๊อปอัป — sync ตาม controlled prop "open"
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (owedSatangForStage != null && owedSatangForStage > 0) setAmount(String(owedSatangForStage / 100));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount(""); setErr(null); setTrackingNo("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, owedSatangForStage]);

  const inp: React.CSSProperties = { border: "1px solid #d4d4d8", borderRadius: 8, padding: "8px 11px", fontSize: 14, fontFamily: "inherit", outline: "none", background: "#fff", color: "#18181b" };
  const chipStyle = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 8, border: `1px solid ${on ? "#1c5fc4" : "#d4d4d8"}`, background: on ? "#1c5fc4" : "#fff", color: on ? "#fff" : "#52525b", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit" });
  const primary: React.CSSProperties = { width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#1c5fc4", color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit" };
  const pStyle: React.CSSProperties = { margin: "0 0 4px", fontSize: 14, color: "#3f3f46", lineHeight: 1.5 };

  // #4/#5 — ฟิลด์จ่าย "ค่าขนส่งจีน-ไทย" = บาทเท่านั้น (ไม่มีปุ่มสกุล ¥) + เตือนถ้ายังไม่ตั้งเรต
  const freightPayFields = (
    <div style={{ display: "grid", gap: 8, padding: 12, background: "#fef9e7", border: "1px solid #f4d77e", borderRadius: 10 }}>
      <div style={{ fontSize: 12.5, color: "#92660a", fontWeight: 700 }}>ค่าขนส่งจีน-ไทย (บาท) — ต้องบันทึกจ่ายก่อน จึงจะกด “พร้อมรับเข้า” ได้</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 130 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#71717a", fontSize: 14 }}>฿</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="จำนวนเงิน" style={{ ...inp, width: "100%", paddingLeft: 24 }} />
        </div>
        <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={inp} />
      </div>
      {freightOwedSatang != null && freightOwedSatang > 0 && (
        <div style={{ fontSize: 12, color: "#3f6f50", fontWeight: 600 }}>ระบบคิดให้อัตโนมัติ (CBM × เรต) ฿{fmt(freightOwedSatang / 100)} — แก้ได้</div>
      )}
      {freightRatesConfigured === false && (
        <div style={{ fontSize: 11.5, color: "#92660a" }}>
          ยังไม่ได้ตั้งเรตค่าขนส่งต่อคิว — ไปตั้งที่{" "}
          <Link href="/dc/office/settings" style={{ color: "#1c5fc4", fontWeight: 700, textDecoration: "underline" }}>ตั้งค่า → เรตค่าขนส่ง</Link>
        </div>
      )}
    </div>
  );

  // #10 — ไม่มีด่านอนุมัติแล้ว · ใบเก่าที่ยัง DRAFT/รออนุมัติ/อนุมัติ → ปุ่มเดียว "ยืนยันสั่งซื้อ" (markOrdered)
  let body: React.ReactNode = null;
  if (status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED") body = (
    <><p style={pStyle}>ยืนยันว่าสั่งซื้อกับผู้ขายแล้ว → สถานะ “สั่งแล้ว”</p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markOrdered(data.id))}>ยืนยันสั่งซื้อ</button></>
  );
  // #11/#12 — ORDERED → กรอกเลข Tracking จริงในป๊อปอัป (text input + รถ/เรือ + ยืนยัน) → setPoTracking → SHIPPED
  else if (status === "ORDERED") body = (
    <><p style={pStyle}>ผู้ขายแจ้งเลขพัสดุแล้ว — กรอกเลขด้านล่าง ระบบจะบันทึกให้แล้วเลื่อนสถานะเป็น “ได้เลข Tracking” ให้อัตโนมัติ</p>
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ display: "grid", gap: 5, fontSize: 12.5, fontWeight: 600, color: "#52525b" }}>
        เลข Tracking / เลขพัสดุ
        <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="เช่น SF1234567890" autoFocus style={{ ...inp, width: "100%" }} />
      </label>
      <div style={{ display: "grid", gap: 5 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#52525b" }}>วิธีขนส่ง (ไม่บังคับ)</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setTrackMode("TRUCK")} style={chipStyle(trackMode === "TRUCK")}>🚚 รถ</button>
          <button type="button" onClick={() => setTrackMode("SEA")} style={chipStyle(trackMode === "SEA")}>🚢 เรือ</button>
        </div>
      </div>
    </div>
    <button type="button" style={primary} disabled={pending} onClick={submitTracking}>บันทึกเลข Tracking</button></>
  );
  else if (status === "SHIPPED") body = (
    <><p style={pStyle}>ของถึงไทยแล้ว → สถานะ “ถึงไทยแล้ว”</p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markArrivedTh(data.id))}>ยืนยันถึงไทยแล้ว</button></>
  );
  // #4 — ARRIVED_TH → AT_WAREHOUSE = "ของถึงโกดัง" เฉย ๆ ไม่มีด่านจ่าย (ด่านค่าของถูกตัดออก)
  else if (status === "ARRIVED_TH") body = (
    <><p style={pStyle}>ของถึงโกดังแล้ว → สถานะ “ถึงโกดังแล้ว” (ยังไม่ต้องจ่ายเงินขั้นนี้)</p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markAtWarehouse(data.id))}>ยืนยันถึงโกดังแล้ว</button></>
  );
  // #6 — AT_WAREHOUSE → "พร้อมรับเข้า" (markReadyToReceive) · ไม่รับเข้า/ตัดสต๊อกอัตโนมัติ
  //   ใบจีนต้องบันทึกจ่ายค่าขนส่งจีน-ไทย (THAI_FREIGHT · บาท) ก่อน
  else if (status === "AT_WAREHOUSE") body = (
    <><p style={pStyle}>ของถึงโกดังแล้ว + จ่ายค่าขนส่งแล้ว → ทำให้ใบ “พร้อมรับเข้า” (ยังไม่ตัดสต๊อก · รับเข้าจริงทำที่ฟอร์มรับเข้าคลัง)</p>
    {isChina && !thaiFreightPaid ? (
      <>{freightPayFields}
      <button type="button" style={primary} disabled={pending} onClick={() => payFreightThen(() => markReadyToReceive(data.id))}>
        บันทึกจ่ายค่าขนส่ง + พร้อมรับเข้า
      </button></>
    ) : (
      <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markReadyToReceive(data.id))}>
        ทำให้พร้อมรับเข้า
      </button>
    )}
    <p style={{ ...pStyle, fontSize: 12, color: "#71717a", marginTop: 6 }}>หลังจาก “พร้อมรับเข้า” แล้ว ค่อยกดรับเข้าคลังจริง (นับของ/ตัดสต๊อก) ที่ฟอร์ม “รับเข้าคลัง” ด้านล่าง</p></>
  );

  return (
    <Dialog open={open} onClose={onClose} title="ดำเนินการขั้นต่อไป" backdrop="soft" className="sm:max-w-lg">
      <div style={{ display: "grid", gap: 12 }}>
        {err && <div style={{ background: "#fdeaea", border: "1px solid #f3c7c2", color: "#b8362a", borderRadius: 8, padding: "9px 12px", fontSize: 13.5, fontWeight: 600 }}>{err}</div>}
        {body}
      </div>
    </Dialog>
  );
}

// ── 0) ไทม์ไลน์ 5 ขั้น ─────────────────────────────────────────
// map: ORDERED→1 · SHIPPED→2 · ARRIVED_TH→3 · AT_WAREHOUSE→4 · RECEIVED→5
// ก่อนสั่ง (DRAFT/PENDING_APPROVAL/APPROVED) → โชว์โน้ต "ก่อนสั่ง" เหนือไทม์ไลน์ (ทุกขั้นยังเป็นสีเทา)
// PARTIAL → ระหว่างขั้น 4-5 (รับบางส่วน) · CANCELLED → ริบบิ้น "ยกเลิกแล้ว"
// #6 — เพิ่มขั้น "พร้อมรับเข้า" (READY_TO_RECEIVE) ระหว่าง "ถึงโกดังแล้ว" กับ "รับแล้ว"
//   ของถึงโกดัง (ARRIVED_TH→AT_WAREHOUSE) ไม่มีด่านจ่าย · จ่าย "ค่าขนส่งจีน-ไทย" ตอนทำให้พร้อมรับเข้า
const TIMELINE_STEPS: { key: string; label: string; hint?: string }[] = [
  { key: "ORDERED", label: "สั่งแล้ว" },
  { key: "SHIPPED", label: "ได้เลข Tracking" },
  { key: "ARRIVED_TH", label: "ถึงไทยแล้ว" },
  { key: "AT_WAREHOUSE", label: "ถึงโกดังแล้ว" },
  { key: "READY_TO_RECEIVE", label: "พร้อมรับเข้า", hint: "· จ่ายค่าขนส่งจีน-ไทย" },
  { key: "RECEIVED", label: "รับแล้ว" },
];

// #15 — current step ของไทม์ไลน์ ต้อง map กับสถานะจริงแบบ index-based บน PO_FLOW_CORE
// (source of truth ใน nav.ts) ไม่พึ่ง STATUS_RANK ที่ยังพ่วง DRAFT/PENDING/APPROVED → กัน index เลื่อน
//   ORDERED→0 · SHIPPED→1 · ARRIVED_TH→2 · AT_WAREHOUSE→3 · READY_TO_RECEIVE→4 · RECEIVED→5
//   PARTIAL → ถือว่าอยู่ที่ READY_TO_RECEIVE (รับบางส่วน) · CLOSED → RECEIVED
function flowIndexOf(status: string): number {
  if (status === "PARTIAL") return PO_FLOW_CORE.indexOf("READY_TO_RECEIVE");
  if (status === "CLOSED") return PO_FLOW_CORE.indexOf("RECEIVED");
  return PO_FLOW_CORE.indexOf(status); // -1 ถ้า pre-order/cancelled
}

function Timeline({ status, isChina, awaitingTracking }: { status: string; isChina: boolean; awaitingTracking: boolean }) {
  const preOrder = status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED";
  const cancelled = status === "CANCELLED";
  const partial = status === "PARTIAL";
  // index ของขั้นปัจจุบันใน PO_FLOW_CORE (0..4) — ตรงกับ TIMELINE_STEPS แบบ 1:1
  const currentIndex = flowIndexOf(status);

  if (cancelled) {
    return (
      <div
        className="dc-card"
        style={{
          background: "#fdeaea",
          borderColor: "#f3c7c2",
          color: "#b8362a",
          fontWeight: 700,
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <X size={16} /> ใบสั่งซื้อนี้ถูกยกเลิกแล้ว
      </div>
    );
  }

  return (
    <div className="dc-card" style={{ display: "grid", gap: 10 }}>
      {preOrder && (
        <div style={{ fontSize: 12.5, color: "#92660a", fontWeight: 600, background: "#fef9e7", border: "1px solid #f4d77e", borderRadius: 8, padding: "5px 10px", justifySelf: "start" }}>
          ก่อนสั่ง — กด “ยืนยันสั่งซื้อ” เมื่อสั่งกับผู้ขายแล้ว
        </div>
      )}
      {partial && (
        <div style={{ fontSize: 12.5, color: "#1c5fc4", fontWeight: 600, justifySelf: "start" }}>
          รับบางส่วน — ระหว่าง “ถึงโกดังแล้ว” กับ “รับแล้ว”
        </div>
      )}
      {awaitingTracking && (
        <div style={{ fontSize: 12.5, color: "#92660a", fontWeight: 600, justifySelf: "start" }}>
          รอใส่ข้อมูล — ของสั่งทำ ยังไม่มีเลขพัสดุ/ขนาดกล่อง
        </div>
      )}

      {/* แถวขั้น — มือถือ: scroll แนวนอน */}
      <div style={{ overflowX: "auto", paddingBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 0, minWidth: 520 }}>
          {TIMELINE_STEPS.map((step, i) => {
            // i = index ของขั้นนี้ใน flow (ตรง 1:1 กับ PO_FLOW_CORE) → เทียบกับ currentIndex ตรง ๆ
            // ขั้นที่อยู่ก่อนขั้นปัจจุบัน = ทำเสร็จแล้ว (filled) · ขั้นปัจจุบัน = current (ไฮไลต์)
            const done = !preOrder && currentIndex >= 0 && i < currentIndex;
            const current = !preOrder && i === currentIndex;
            const fill = done ? "#1c8a4e" : current ? "#fff" : "#f1f1f4";
            const ring = current ? "#1c5fc4" : done ? "#1c8a4e" : "#e4e4e7";
            const numColor = done ? "#fff" : current ? "#1c5fc4" : "#a1a1aa";
            // เส้นเชื่อมไปขั้นถัดไป
            const connectorDone = !preOrder && currentIndex >= 0 && i < currentIndex;
            return (
              <div key={step.key} style={{ display: "flex", alignItems: "flex-start", flex: 1, minWidth: 96 }}>
                <div style={{ display: "grid", justifyItems: "center", gap: 5, flex: "0 0 auto", width: 96 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: fill,
                      border: `2px solid ${ring}`,
                      boxShadow: current ? "0 0 0 4px rgba(28,95,196,0.14)" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 800,
                      color: numColor,
                    }}
                  >
                    {done ? <Check size={16} /> : i + 1}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: current ? 700 : 600, color: current ? "#18181b" : done ? "#3f6f50" : "#a1a1aa", textAlign: "center", lineHeight: 1.25 }}>
                    {step.label}
                  </div>
                  {isChina && step.hint && (
                    <div style={{ fontSize: 10.5, color: "#b08400", textAlign: "center", lineHeight: 1.2 }}>{step.hint}</div>
                  )}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, marginTop: 16, background: connectorDone ? "#1c8a4e" : "#e4e4e7", minWidth: 12 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── #8 ต้นทุน & การจ่ายเงิน (รวมที่เดียว) + #9 ส่งออก CSV/พิมพ์ + #4 ค่าขนส่งจีน-ไทย ──────────
// รวม CostSummary + PaymentSection ที่เคยซ้ำกัน 3 ที่ → ตารางเดียว:
//   ค่าของ (จากราคาสินค้า · อ้างอิง) / ค่าขนส่งจีน-ไทย (prefill freightOwed · จ่าย THB) / Landed
//   แถวค่าขนส่งโชว์ inline "จ่ายแล้ว ฿X · วันที่" หรือปุ่ม "บันทึกจ่าย"
//   ประวัติการจ่าย → collapsible (ไม่โชว์ซ้ำ 3 ที่)
function CostAndPayment({
  data,
  isChina,
  sym,
  totalNative,
  totalThb,
  freightPayment,
  freightPayments,
  freightOwedSatang,
  freightRatesConfigured,
  status,
  thaiFreightPaid,
  canManage,
  pending,
  run,
}: {
  data: PoDetailData;
  isChina: boolean;
  sym: string;
  totalNative: number;
  totalThb: number | null;
  freightPayment: PoPaymentData | null;
  freightPayments: PoPaymentData[];
  freightOwedSatang?: number;
  freightRatesConfigured?: boolean;
  status: string;
  thaiFreightPaid: boolean;
  canManage: boolean;
  pending: boolean;
  run: (action: () => Promise<PoActionResult | BoxActionResult>, confirmMsg?: string, after?: () => void) => void;
}) {
  // ฟอร์มจ่ายค่าขนส่งจีน-ไทย (เปิด/ปิด inline ในแถว) — บาทเท่านั้น (#5)
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [localErr, setLocalErr] = useState<string | null>(null);

  // เปิดฟอร์มจ่ายได้ตั้งแต่ "ถึงไทยแล้ว" (CEO 2026-07-09: บางเจ้าจ่ายตอนของถึงไทย บางเจ้าตอนถึงโกดัง)
  //   — prefill จาก freightOwed (#4) · server (recordPoPayment) ไม่ล็อกสถานะอยู่แล้ว
  const canPayFreight = isChina && canManage && statusAtLeast(status, "ARRIVED_TH");
  // prefill ตอนกดเปิดฟอร์ม (ใน handler ไม่ใช่ effect → กัน set-state-in-effect)
  function openPayForm() {
    if (freightOwedSatang != null && freightOwedSatang > 0 && !amount) setAmount(String(freightOwedSatang / 100));
    setPayOpen(true);
  }

  // ค่าของ (อ้างอิงจากราคาสินค้า) เป็นบาท · ค่าขนส่งจีน-ไทย จาก payment ถ้ามี ไม่งั้น freightOwed (ประมาณ)
  const goodsThb = isChina ? totalThb : totalNative;
  const freightPaidThb = freightPayment ? fromSatang(freightPayment.amountSatang) : null;
  const freightEstThb = freightOwedSatang != null && freightOwedSatang > 0 ? freightOwedSatang / 100 : null;
  const landedEstimate =
    goodsThb != null ? goodsThb + (freightPaidThb ?? freightEstThb ?? 0) : null;

  function submitFreightPay() {
    setLocalErr(null);
    const amt = numOrNull(amount);
    if (amt == null) { setLocalErr("กรุณาระบุยอดค่าขนส่งที่จ่าย"); return; }
    run(
      () => recordPoPayment({ poId: data.id, kind: "THAI_FREIGHT", amountSatang: Math.round(amt * 100), currency: "THB", paidAt: new Date(paidAt + "T00:00:00").toISOString() }),
      undefined,
      () => { setAmount(""); setPayOpen(false); },
    );
  }

  // #9 — ส่งออก CSV (UTF-8 BOM ให้ Excel อ่านไทยได้) · ต่อใบ
  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: (string | number | null)[][] = [];
    rows.push(["ใบสั่งซื้อ", data.poCode]);
    rows.push(["ผู้ขาย", data.supplierName ?? ""]);
    rows.push(["จุดเริ่ม", isChina ? "จีน" : "ไทย"]);
    if (isChina) rows.push(["เรต ฿/¥", data.fxRate != null ? data.fxRate : ""]);
    rows.push([]);
    rows.push(["สินค้า", "SKU", "จำนวน", "หน่วย", "ราคา/หน่วย", "รวม"]);
    for (const l of data.lines) {
      rows.push([l.name, l.sku, l.qty, l.unit, l.unitPriceCny, l.qty * l.unitPriceCny]);
    }
    rows.push([]);
    rows.push(["ค่าของ (บาท · อ้างอิง)", goodsThb != null ? goodsThb.toFixed(2) : ""]);
    rows.push(["ค่าขนส่งจีน-ไทย (บาท)", (freightPaidThb ?? freightEstThb ?? 0).toFixed(2)]);
    rows.push(["ต้นทุน Landed (ประมาณ · บาท)", landedEstimate != null ? landedEstimate.toFixed(2) : ""]);
    rows.push([]);
    rows.push(["การจ่ายเงิน", "ยอด", "สกุล", "วันที่"]);
    for (const p of freightPayments) {
      rows.push(["ค่าขนส่งจีน-ไทย", fromSatang(p.amountSatang).toFixed(2), p.currency, fmtDateTime(p.paidAt)]);
    }
    const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PO-${data.poCode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Section
      title="ต้นทุน & การจ่ายเงิน"
      sub="ค่าของ (อ้างอิงราคาสินค้า) · ค่าขนส่งจีน-ไทย (บาท) · Landed"
      action={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={exportCsv} className="dc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 5 }} title="ส่งออก CSV (เปิดใน Excel)">
            <Download size={13} /> CSV
          </button>
          {/* 🖼️ ดาวน์โหลดรูป (ส่งลงไลน์) — ลิงก์ไป route /image (attachment PNG) */}
          <a href={`/dc/office/purchasing/${data.id}/image`} download className="dc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }} title="บันทึกใบนี้เป็นรูป (ส่งลงไลน์ได้)">
            <ImageDown size={13} /> รูป
          </a>
          {/* 📄 ดาวน์โหลด PDF — เปิดหน้าเอกสาร (AutoPrint เด้ง print → Save as PDF) */}
          <a href={`/dc/office/purchasing/${data.id}/print`} target="_blank" rel="noopener noreferrer" className="dc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }} title="เปิดหน้าเอกสาร → บันทึกเป็น PDF">
            <FileDown size={13} /> PDF
          </a>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 0, fontSize: 14 }}>
        <CostRow label="ค่าของ (จากราคาสินค้า · อ้างอิง)" value={`${sym}${fmt(totalNative)}`} strong />
        {isChina && (
          <CostRow label="เรต ฿/¥" value={data.fxRate != null ? `1 ¥ = ฿${fmt(data.fxRate, 4)}` : "ยังไม่ใส่เรต"} muted={data.fxRate == null} />
        )}
        {isChina && totalThb != null && <CostRow label="ค่าของ (บาท)" value={`฿${fmt(totalThb)}`} />}

        {/* แถวค่าขนส่งจีน-ไทย — inline "จ่ายแล้ว" หรือปุ่ม "บันทึกจ่าย" (#8) */}
        <div style={{ display: "grid", gap: 8, padding: "10px 2px", borderBottom: "1px solid var(--dc-line, #f4f4f6)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ color: "#52525b", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <CircleDollarSign size={15} /> ค่าขนส่งจีน-ไทย (บาท)
            </div>
            {freightPayment ? (
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#167a41", display: "inline-flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
                <Check size={14} /> จ่ายแล้ว ฿{fmt(freightPaidThb ?? 0)} · {fmtDateTime(freightPayment.paidAt)}
              </span>
            ) : freightEstThb != null ? (
              <span style={{ fontVariantNumeric: "tabular-nums", color: "#a1a1aa", fontWeight: 600 }}>~฿{fmt(freightEstThb)} (ประมาณ)</span>
            ) : (
              <span style={{ color: "#a1a1aa", fontWeight: 600 }}>{statusAtLeast(status, "ARRIVED_TH") ? "รอกรอก" : "รอกรอก (เมื่อถึงไทย)"}</span>
            )}
          </div>

          {/* ปุ่ม/ฟอร์มบันทึกจ่าย (ยังไม่จ่าย + ใบจีน + ≥ ถึงโกดัง) */}
          {isChina && !thaiFreightPaid && canPayFreight && (
            payOpen ? (
              <div style={{ display: "grid", gap: 8, padding: 12, background: "#fef9e7", border: "1px solid #f4d77e", borderRadius: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                  <label style={{ ...lbl, flex: "1 1 130px", minWidth: 120 }}>
                    ยอดค่าขนส่ง (บาท)
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={inp} />
                  </label>
                  <label style={{ ...lbl, flex: "0 0 auto" }}>
                    วันที่จ่าย
                    <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={{ ...inp, width: 160 }} />
                  </label>
                  <button type="button" onClick={submitFreightPay} className="dc-btn-xl" style={btnSmall} disabled={pending}>บันทึกจ่าย</button>
                  <button type="button" onClick={() => { setPayOpen(false); setLocalErr(null); }} className="dc-btn-xl dc-btn-xl--ghost" style={btnSmall} disabled={pending}>ยกเลิก</button>
                </div>
                {freightOwedSatang != null && freightOwedSatang > 0 && (
                  <div style={{ fontSize: 12, color: "#3f6f50", fontWeight: 600 }}>ระบบคิดให้อัตโนมัติ (CBM × เรต) ฿{fmt(freightOwedSatang / 100)} — แก้ได้</div>
                )}
                {freightRatesConfigured === false && (
                  <div style={{ fontSize: 11.5, color: "#92660a" }}>
                    ยังไม่ได้ตั้งเรตค่าขนส่งต่อคิว — ไปตั้งที่{" "}
                    <Link href="/dc/office/settings" style={{ color: "#1c5fc4", fontWeight: 700, textDecoration: "underline" }}>ตั้งค่า → เรตค่าขนส่ง</Link>
                  </div>
                )}
                {localErr && <div style={{ color: "#b8362a", fontSize: 13, fontWeight: 600 }}>{localErr}</div>}
              </div>
            ) : (
              <button type="button" onClick={openPayForm} className="dc-btn-xl dc-btn-xl--ghost" style={{ ...btnSmall, justifySelf: "start" }} disabled={pending}>
                บันทึกจ่ายค่าขนส่งจีน-ไทย
              </button>
            )
          )}
        </div>

        <div style={{ borderTop: "2px solid var(--dc-line, #e4e4e7)", marginTop: 4 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 2px 2px" }}>
          <div style={{ fontWeight: 750, color: "#18181b" }}>
            ต้นทุน Landed <span style={{ fontSize: 11.5, fontWeight: 600, color: "#a1a1aa" }}>(ประมาณ)</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums", color: landedEstimate != null ? "#18181b" : "#a1a1aa" }}>
            {landedEstimate != null ? `฿${fmt(landedEstimate)}` : "—"}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "#a1a1aa", padding: "2px 2px 0" }}>
          * ประมาณจากค่าของ + ค่าขนส่งจีน-ไทย — ตัวเลขจริงคิดตอนรับเข้าคลัง
        </div>

        {/* ประวัติการจ่าย → collapsible (#8 ไม่โชว์ซ้ำ) */}
        {freightPayments.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, color: "#71717a", fontWeight: 600, listStyle: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <ChevronDown size={13} /> ประวัติการจ่าย ({freightPayments.length})
            </summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {freightPayments.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                  <span>ค่าขนส่งจีน-ไทย · {fmtDateTime(p.paidAt)}{p.note ? ` · ${p.note}` : ""}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, color: "#18181b" }}>{payCurSym(p.currency)}{fmt(fromSatang(p.amountSatang))}</span>
                    {canManage && (
                      <button type="button" onClick={() => run(() => deletePoPayment(p.id), "ยืนยันลบรายการจ่ายเงินนี้?")} disabled={pending} style={{ ...iconBtn, width: 28, height: 28, color: "#b8362a" }} title="ลบรายการจ่าย">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Section>
  );
}

function CostRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 2px", borderBottom: "1px solid var(--dc-line, #f4f4f6)" }}>
      <div style={{ color: "#52525b", fontWeight: strong ? 650 : 500 }}>{label}</div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: strong ? 750 : 600, color: muted ? "#a1a1aa" : "#18181b" }}>{value}</div>
    </div>
  );
}

// ── #7 การ์ดยุบได้ (collapsible) — ใช้ <details> เพื่อยุบเนื้อหายาว ๆ ให้พอดีจอ ───────────
function CollapseCard({
  title,
  sub,
  defaultOpen,
  children,
}: {
  title: string;
  sub?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="dc-card" open={defaultOpen} style={{ display: "block" }}>
      <summary
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 750, color: "#18181b" }}>{title}</div>
          {sub && <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>{sub}</div>}
        </div>
        <ChevronDown size={18} className="dc-collapse-chevron" style={{ color: "#a1a1aa", flex: "0 0 auto" }} />
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}

// ── #3 Dialog แก้ผู้ขาย / เรต (audit log อยู่ที่ updatePo ฝั่ง server) ─────────────────────
function EditPoDialog({
  open,
  onClose,
  data,
  isChina,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  data: PoDetailData;
  isChina: boolean;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState<string>("");
  const [fxRate, setFxRate] = useState<string>(data.fxRate != null ? String(data.fxRate) : "");

  // โหลด dropdown ผู้ขาย + sync supplierId กับใบปัจจุบัน (จับคู่ตามชื่อ เพราะ data ไม่มี supplierId)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) { setErr(null); return; }
    let alive = true;
    listSuppliersForPo().then((rows) => {
      if (!alive) return;
      setSuppliers(rows);
      const match = rows.find((r) => r.name === data.supplierName);
      setSupplierId(match?.id ?? "");
    });
    // sync เรตตามใบที่เปิด (controlled prop "open")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFxRate(data.fxRate != null ? String(data.fxRate) : "");
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    setErr(null);
    const fx = isChina ? numOrNull(fxRate) : null;
    start(async () => {
      const res = await updatePo(data.id, {
        supplierId: supplierId || null,
        fxRate: fx,
      });
      if (res.ok) onDone();
      else setErr(res.error);
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="แก้ผู้ขาย / เรต" backdrop="soft" className="sm:max-w-md">
      <div style={{ display: "grid", gap: 12 }}>
        {err && <div style={{ background: "#fdeaea", border: "1px solid #f3c7c2", color: "#b8362a", borderRadius: 8, padding: "9px 12px", fontSize: 13.5, fontWeight: 600 }}>{err}</div>}
        <label style={lbl}>
          ผู้ขาย
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={inp}>
            <option value="">— ไม่ระบุ —</option>
            {suppliers.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        </label>
        {isChina && (
          <label style={lbl}>
            เรต ฿/¥ (1 หยวน = ฿ ?)
            <input value={fxRate} onChange={(e) => setFxRate(e.target.value)} inputMode="decimal" placeholder="เช่น 4.95" style={inp} />
          </label>
        )}
        <div style={{ fontSize: 11.5, color: "#92660a" }}>
          แก้ได้ก่อนจ่ายเงิน/ก่อนรับเข้าเท่านั้น — หลังจากนั้นระบบล็อก (กันยอดบัญชีเพี้ยน)
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className="dc-btn-xl dc-btn-xl--ghost" style={btnSmall} disabled={pending}>ยกเลิก</button>
          <button type="button" onClick={submit} className="dc-btn-xl" style={btnSmall} disabled={pending}>บันทึก</button>
        </div>
      </div>
    </Dialog>
  );
}

// ── #3 ประวัติการแก้ผู้ขาย/เรต (collapsible · โหลดสดจาก getPoAuditHistory) ──────────────
function AuditHistory({ poId }: { poId: string }) {
  const [entries, setEntries] = useState<PoAuditEntry[] | null>(null);
  const [supplierName, setSupplierName] = useState<Map<string, string>>(new Map());
  const [loading, startLoad] = useTransition();

  function load() {
    if (entries != null) return; // โหลดครั้งเดียวตอนกางครั้งแรก
    startLoad(async () => {
      const [rows, sups] = await Promise.all([getPoAuditHistory(poId), listSuppliersForPo()]);
      setSupplierName(new Map(sups.map((s) => [s.id, s.name])));
      setEntries(rows);
    });
  }

  const supName = (id: unknown): string => {
    if (typeof id !== "string" || !id) return "—";
    return supplierName.get(id) ?? id;
  };
  const fxStr = (v: unknown): string => (typeof v === "number" ? fmt(v, 4) : v == null ? "—" : String(v));

  return (
    <details className="dc-card" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) load(); }} style={{ display: "block" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: "#52525b" }}>
        <History size={15} /> ประวัติการแก้ไข (ผู้ขาย/เรต)
      </summary>
      <div style={{ marginTop: 10 }}>
        {loading && <div style={{ fontSize: 13, color: "#a1a1aa" }}>กำลังโหลด…</div>}
        {entries != null && entries.length === 0 && <div style={{ fontSize: 13, color: "#a1a1aa" }}>ยังไม่มีการแก้ไข</div>}
        {entries != null && entries.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {entries.map((e) => {
              const oldS = supName(e.diff?.old?.supplierId);
              const newS = supName(e.diff?.new?.supplierId);
              const oldFx = fxStr(e.diff?.old?.fxRate);
              const newFx = fxStr(e.diff?.new?.fxRate);
              return (
                <div key={e.id} style={{ fontSize: 12.5, color: "#52525b", lineHeight: 1.5, borderLeft: "2px solid var(--dc-line, #e4e4e7)", paddingLeft: 10 }}>
                  <div>ผู้ขาย: <b style={{ color: "#18181b" }}>{oldS}</b> → <b style={{ color: "#18181b" }}>{newS}</b> · เรต: {oldFx} → {newFx}</div>
                  <div style={{ fontSize: 11.5, color: "#a1a1aa" }}>โดย {e.userName ?? "—"} · {fmtDateTime(e.createdAt)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

// ── #12e เทียบใบสั่งซื้อ vs ใบรับ (collapsible · โหลดสดจาก getPoReceivingSummary) ──────────
function ReceivingCompare({ poId, status, refreshKey }: { poId: string; status: string; refreshKey: number }) {
  const [summary, setSummary] = useState<PoReceiveSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, startLoad] = useTransition();

  // โชว์ก็ต่อเมื่อใบเดินมาถึงช่วงรับเข้าแล้ว (มี GRN ได้)
  const relevant = statusAtLeast(status, "AT_WAREHOUSE") || status === "PARTIAL" || status === "RECEIVED";

  // โหลดตอน mount + โหลดใหม่ทุกครั้งที่ refreshKey เปลี่ยน (หลังกดรับเข้า) → แก้ปัญหา "รับสะสม" ค้างเลข 0
  //   (เดิม fetch-once แล้ว guard loaded ไม่ยอมโหลดซ้ำ · router.refresh ไม่ remount client → ค้างภาพเก่า)
  useEffect(() => {
    if (!relevant) return;
    let alive = true;
    startLoad(async () => {
      const s = await getPoReceivingSummary(poId);
      if (!alive) return;
      setSummary(s);
      setLoaded(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, refreshKey, relevant]);

  if (!relevant) return null;

  return (
    <details className="dc-card" open style={{ display: "block" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 750, color: "#18181b" }}>เทียบใบสั่งซื้อ vs ใบรับ</div>
          <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>สั่ง / รับสะสม / คงค้าง ต่อสินค้า + ใบรับ (GRN)</div>
        </div>
        <ChevronDown size={18} className="dc-collapse-chevron" style={{ color: "#a1a1aa", flex: "0 0 auto" }} />
      </summary>
      <div style={{ marginTop: 12 }}>
        {loading && <div style={{ fontSize: 13, color: "#a1a1aa" }}>กำลังโหลด…</div>}
        {loaded && !summary && <div style={{ fontSize: 13, color: "#a1a1aa" }}>ยังไม่มีข้อมูลการรับเข้า</div>}
        {summary && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                    <th style={cellHead}>สินค้า</th>
                    <th style={{ ...cellHead, textAlign: "right" }}>สั่ง</th>
                    <th style={{ ...cellHead, textAlign: "right" }}>รับสะสม</th>
                    <th style={{ ...cellHead, textAlign: "right" }}>คงค้าง</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.products.map((p) => {
                    // คงค้าง > 0 = ส้ม · เกิน (remaining < 0) = แดง · ครบ = เทา
                    const over = p.remaining < 0;
                    const short = p.remaining > 0;
                    const color = over ? "#b8362a" : short ? "#b06a0a" : "#167a41";
                    return (
                      <tr key={p.productId} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                        <td style={cell}>
                          <div style={{ fontWeight: 600, color: "#18181b" }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "#a1a1aa" }}>{p.sku}</div>
                        </td>
                        <td style={{ ...cell, textAlign: "right", color: "#71717a", fontVariantNumeric: "tabular-nums" }}>{p.ordered} {p.unit}</td>
                        <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.received}</td>
                        <td style={{ ...cell, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color }}>
                          {over ? `เกิน ${Math.abs(p.remaining)}` : p.remaining}
                        </td>
                      </tr>
                    );
                  })}
                  {summary.products.length === 0 && (
                    <tr><td style={{ ...cell, color: "#a1a1aa" }} colSpan={4}>ไม่มีรายการ</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontSize: 12.5, color: "#71717a", fontWeight: 600, marginBottom: 6 }}>ใบรับ (GRN)</div>
              {summary.grns.length === 0 ? (
                <div style={{ fontSize: 13, color: "#a1a1aa" }}>ยังไม่มีใบรับ</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {summary.grns.map((g) => (
                    <Link
                      key={g.grnId}
                      href={`/dc/office/receipts/${g.grnId}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: "#1c5fc4", textDecoration: "none", padding: "6px 10px", border: "1px solid var(--dc-line, #e4e4e7)", borderRadius: 8, fontVariantNumeric: "tabular-nums" }}
                    >
                      <span style={{ fontWeight: 600 }}>{g.grnCode}</span>
                      <span style={{ color: "#71717a" }}>{fmtDateTime(g.receivedAt)} · รับ {g.totalReceived}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

// ── 3) กล่อง/พัสดุ ─────────────────────────────────────────────
function BoxesSection({
  poId,
  boxes,
  products,
  canManage,
  pending,
  run,
  sealed,
}: {
  poId: string;
  boxes: BoxData[];
  products: { id: string; name: string; sku: string; unit: string }[];
  canManage: boolean;
  pending: boolean;
  run: (action: () => Promise<PoActionResult | BoxActionResult>, confirmMsg?: string, after?: () => void) => void;
  sealed: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Section
      title="กล่อง / พัสดุ"
      sub="ใส่ตอนผู้ขายแจ้งกลับมา — เลขพัสดุ · รถ/เรือ · ขนาด→CBM · ของในแต่ละกล่อง"
      action={
        canManage && !sealed && !adding ? (
          <button type="button" className="dc-btn-xl dc-btn-xl--ghost" style={btnSmall} onClick={() => setAdding(true)}>
            <Plus size={16} /> เพิ่มกล่อง
          </button>
        ) : null
      }
    >
      {adding && (
        <BoxForm
          products={products}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={(payload) =>
            run(() => addBox({ poId, ...payload }), undefined, () => setAdding(false))
          }
        />
      )}

      {boxes.length === 0 && !adding ? (
        <div style={{ fontSize: 13.5, color: "#a1a1aa", padding: "8px 2px" }}>ยังไม่มีกล่อง/พัสดุ — กด “เพิ่มกล่อง” เมื่อผู้ขายแจ้งเลขพัสดุ</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {boxes.map((b, i) =>
            editingId === b.id ? (
              <BoxForm
                key={b.id}
                products={products}
                pending={pending}
                initial={b}
                onCancel={() => setEditingId(null)}
                onSubmit={(payload) =>
                  // แก้กล่อง: อัปเดต meta + ตั้งของในกล่องใหม่ทั้งหมด
                  run(
                    async () => {
                      const up = await updateBox(b.id, {
                        trackingNo: payload.trackingNo,
                        mode: payload.mode,
                        lengthCm: payload.lengthCm,
                        widthCm: payload.widthCm,
                        heightCm: payload.heightCm,
                        note: payload.note,
                      });
                      if (!up.ok) return up;
                      // ตั้งของในกล่องใหม่ทั้งหมด (replace = atomic ฝั่ง server)
                      return setBoxContents(b.id, payload.contents);
                    },
                    undefined,
                    () => setEditingId(null),
                  )
                }
              />
            ) : (
              <BoxRow
                key={b.id}
                box={b}
                index={i + 1}
                canManage={canManage}
                sealed={sealed}
                pending={pending}
                onEdit={() => setEditingId(b.id)}
                onRemove={() => run(() => removeBox(b.id), "ยืนยันลบกล่อง/พัสดุนี้?")}
              />
            ),
          )}
        </div>
      )}
    </Section>
  );
}

function BoxRow({
  box,
  index,
  canManage,
  sealed,
  pending,
  onEdit,
  onRemove,
}: {
  box: BoxData;
  index: number;
  canManage: boolean;
  sealed: boolean;
  pending: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const isTruck = box.mode === "TRUCK";
  const dims = box.lengthCm != null && box.widthCm != null && box.heightCm != null
    ? `${box.lengthCm}×${box.widthCm}×${box.heightCm} ซม.`
    : "ยังไม่ใส่ขนาด";
  return (
    <div style={{ border: "1px solid var(--dc-line, #e4e4e7)", borderRadius: 12, padding: "12px 14px", background: "#fcfcfd" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: "#18181b", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Package size={15} /> กล่อง {index}
            </span>
            <span className={`dc-st dc-st--${isTruck ? "ok" : "ship"}`} style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {isTruck ? <Truck size={12} /> : <Ship size={12} />} {isTruck ? "รถ" : "เรือ"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#71717a", fontVariantNumeric: "tabular-nums" }}>
            เลขพัสดุ: {box.trackingNo ? <b style={{ color: "#27272a" }}>{box.trackingNo}</b> : "—"} · {dims}
            {box.cbmTotal != null && <> · {fmt(box.cbmTotal, 4)} m³</>}
          </div>
          {box.note && <div style={{ fontSize: 12.5, color: "#a1a1aa" }}>โน้ต: {box.note}</div>}
        </div>
        {canManage && !sealed && (
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={onEdit} disabled={pending} style={iconBtn} title="แก้ไขกล่อง">
              <Pencil size={15} />
            </button>
            <button type="button" onClick={onRemove} disabled={pending} style={{ ...iconBtn, color: "#b8362a" }} title="ลบกล่อง">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* ของในกล่อง */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--dc-line, #e8e8ec)" }}>
        <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 6 }}>ของในกล่อง</div>
        {box.contents.length === 0 ? (
          <div style={{ fontSize: 13, color: "#c4c4cc" }}>— ยังไม่ระบุ —</div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {box.contents.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: "#27272a" }}>{c.name}</span>
                <span style={{ color: "#71717a" }}>× {c.qty}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// payload ของฟอร์มกล่อง
type BoxFormPayload = {
  trackingNo: string | null;
  mode: "TRUCK" | "SEA";
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  note: string | null;
  contents: { productId: string; qty: number }[];
};

function BoxForm({
  products,
  pending,
  initial,
  onCancel,
  onSubmit,
}: {
  products: { id: string; name: string; sku: string; unit: string }[];
  pending: boolean;
  initial?: BoxData;
  onCancel: () => void;
  onSubmit: (payload: BoxFormPayload) => void;
}) {
  const [trackingNo, setTrackingNo] = useState(initial?.trackingNo ?? "");
  const [mode, setMode] = useState<"TRUCK" | "SEA">((initial?.mode as "TRUCK" | "SEA") ?? "SEA");
  const [len, setLen] = useState(initial?.lengthCm != null ? String(initial.lengthCm) : "");
  const [wid, setWid] = useState(initial?.widthCm != null ? String(initial.widthCm) : "");
  const [hei, setHei] = useState(initial?.heightCm != null ? String(initial.heightCm) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [contents, setContents] = useState<{ productId: string; qty: number }[]>(
    initial?.contents.map((c) => ({ productId: c.productId, qty: c.qty })) ?? [],
  );
  const [localErr, setLocalErr] = useState<string | null>(null);

  const cbm = liveCbm(numOrNull(len) ?? 0, numOrNull(wid) ?? 0, numOrNull(hei) ?? 0);

  function addContentRow() {
    const firstFree = products.find((p) => !contents.some((c) => c.productId === p.id));
    if (!firstFree) return;
    setContents((cs) => [...cs, { productId: firstFree.id, qty: 1 }]);
  }
  function setContent(i: number, patch: Partial<{ productId: string; qty: number }>) {
    setContents((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeContent(i: number) {
    setContents((cs) => cs.filter((_, idx) => idx !== i));
  }

  function submit() {
    setLocalErr(null);
    const clean = contents.filter((c) => c.productId && c.qty > 0);
    if (clean.length === 0) {
      setLocalErr("กรุณาเลือกของในกล่องอย่างน้อย 1 รายการ");
      return;
    }
    onSubmit({
      trackingNo: trackingNo.trim() || null,
      mode,
      lengthCm: numOrNull(len),
      widthCm: numOrNull(wid),
      heightCm: numOrNull(hei),
      note: note.trim() || null,
      contents: clean,
    });
  }

  const hasMoreProducts = contents.length < products.length;

  return (
    <div style={{ border: "1.5px solid var(--color-brand-200, #c9d8f0)", borderRadius: 12, padding: 14, background: "#f7faff", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 14, color: "#18181b" }}>{initial ? "แก้ไขกล่อง" : "เพิ่มกล่องใหม่"}</b>
        <button type="button" onClick={onCancel} style={iconBtn} title="ปิด"><X size={16} /></button>
      </div>

      {/* แถว: เลขพัสดุ + วิธีขนส่ง */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <label style={lbl}>
          เลขพัสดุ (Tracking)
          <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="เช่น SF123456789" style={inp} />
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setMode("TRUCK")} className={`dc-chip${mode === "TRUCK" ? " is-active" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Truck size={14} /> รถ
          </button>
          <button type="button" onClick={() => setMode("SEA")} className={`dc-chip${mode === "SEA" ? " is-active" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Ship size={14} /> เรือ
          </button>
        </div>
      </div>

      {/* แถว: ขนาด → CBM สด */}
      <div>
        <div style={{ ...lblText, marginBottom: 4 }}>ขนาดกล่อง (ซม.)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input value={len} onChange={(e) => setLen(e.target.value)} placeholder="ยาว" inputMode="decimal" style={{ ...inp, width: 80 }} />
          <span style={{ color: "#a1a1aa" }}>×</span>
          <input value={wid} onChange={(e) => setWid(e.target.value)} placeholder="กว้าง" inputMode="decimal" style={{ ...inp, width: 80 }} />
          <span style={{ color: "#a1a1aa" }}>×</span>
          <input value={hei} onChange={(e) => setHei(e.target.value)} placeholder="สูง" inputMode="decimal" style={{ ...inp, width: 80 }} />
          <span style={{ fontSize: 13, color: cbm != null ? "#167a41" : "#a1a1aa", fontWeight: 600, marginLeft: 4, fontVariantNumeric: "tabular-nums" }}>
            = {cbm != null ? `${fmt(cbm, 4)} m³` : "— m³"}
          </span>
        </div>
      </div>

      {/* ของในกล่อง */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={lblText}>ของในกล่อง</div>
          {hasMoreProducts && (
            <button type="button" onClick={addContentRow} className="dc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Plus size={13} /> เพิ่มสินค้า
            </button>
          )}
        </div>
        {products.length === 0 ? (
          <div style={{ fontSize: 13, color: "#a1a1aa" }}>ใบนี้ยังไม่มีสินค้า — เพิ่มสินค้าในใบก่อน</div>
        ) : contents.length === 0 ? (
          <div style={{ fontSize: 13, color: "#a1a1aa" }}>ยังไม่ได้เลือกของ — กด “เพิ่มสินค้า”</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {contents.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 8, alignItems: "center" }}>
                <select value={c.productId} onChange={(e) => setContent(i, { productId: e.target.value })} style={inp}>
                  {products.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={p.id !== c.productId && contents.some((x) => x.productId === p.id)}
                    >
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
                <input
                  value={String(c.qty)}
                  onChange={(e) => setContent(i, { qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                  inputMode="numeric"
                  placeholder="จำนวน"
                  style={inp}
                />
                <button type="button" onClick={() => removeContent(i)} style={{ ...iconBtn, color: "#b8362a" }} title="เอาออก"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label style={lbl}>
        โน้ต (ไม่บังคับ)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เปราะ ระวังแตก" style={inp} />
      </label>

      {localErr && <div style={{ color: "#b8362a", fontSize: 13, fontWeight: 600 }}>{localErr}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} className="dc-btn-xl dc-btn-xl--ghost" style={btnSmall} disabled={pending}>ยกเลิก</button>
        <button type="button" onClick={submit} className="dc-btn-xl" style={btnSmall} disabled={pending}>
          {initial ? "บันทึกกล่อง" : "เพิ่มกล่อง"}
        </button>
      </div>
    </div>
  );
}

// ── 5) รับเข้าคลัง ─────────────────────────────────────────────
function ReceiveSection({
  poId,
  lines,
  warehouses,
  defaultWarehouseId,
  atWarehouse,
  r2PublicUrl,
  onReceived,
}: {
  poId: string;
  lines: PoLineData[];
  warehouses: WarehouseOption[];
  defaultWarehouseId: string | null;
  atWarehouse: boolean;
  r2PublicUrl: string;
  // เรียกหลังรับเข้าสำเร็จ → พ่อ (PoDetail) refetch bundle + เด้งตาราง "เทียบ" ให้โหลดใหม่
  onReceived?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // หลังรับเข้าสำเร็จแต่ TRCloud ยังไม่เข้า → เก็บ grnId ไว้ให้กด "ส่งซ้ำ"
  const [trcloudPending, setTrcloudPending] = useState<{ grnId: string; reason?: string } | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(
    defaultWarehouseId ?? warehouses[0]?.id ?? "",
  );
  const [note, setNote] = useState("");
  // จำนวนรับ/เสียหายต่อบรรทัด — ตั้งต้นรับเต็มจำนวนที่สั่ง
  //   dmgTouched = ผู้ใช้แก้ช่อง "เสียหาย" เองแล้วหรือยัง → ถ้าแก้เองแล้วห้าม auto-fill ทับ
  const [recv, setRecv] = useState<Record<string, { rec: number; dmg: number; dmgTouched: boolean }>>(
    () => Object.fromEntries(lines.map((l) => [l.id, { rec: l.qty, dmg: 0, dmgTouched: false }])),
  );

  function setLine(id: string, patch: Partial<{ rec: number; dmg: number; dmgTouched: boolean }>) {
    setRecv((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }

  // รูปสินค้า (imageR2Path) หรือ fallback รูปในบรรทัด PO (photoR2Key) → public URL
  function receiveImgUrl(l: PoLineData): string | null {
    const key = l.imageR2Path ?? l.photoR2Key;
    if (!key) return null;
    if (/^https?:\/\//.test(key)) return key;
    return r2PublicUrl ? `${r2PublicUrl}/${key}` : null;
  }

  // เปลี่ยน "รับจริง": ถ้ารับน้อยกว่าสั่ง → เติม "เสียหาย" อัตโนมัติ = สั่ง − รับ (ยังไม่แตะถ้าผู้ใช้แก้เอง)
  function onRecvChange(l: PoLineData, rec: number) {
    setRecv((r) => {
      const cur = r[l.id];
      const shortfall = Math.max(0, l.qty - rec);
      // เติมค่าอัตโนมัติเฉพาะบรรทัดที่ผู้ใช้ยังไม่แก้ช่องเสียหายเอง (dmgTouched = false)
      const nextDmg = cur?.dmgTouched ? (cur.dmg ?? 0) : shortfall;
      return { ...r, [l.id]: { ...cur, rec, dmg: nextDmg } };
    });
  }

  function submit() {
    if (pending) return; // busy-lock: กันกดรัว/กดซ้ำ → ไม่สร้าง GRN ซ้ำ (สต๊อก/TRCloud เด้ง 2 เท่า)
    setError(null);
    setTrcloudPending(null);
    if (!warehouseId) {
      setError("กรุณาเลือกคลังปลายทาง");
      return;
    }
    const payloadLines = lines
      .map((l) => ({
        productId: l.productId,
        qtyReceived: Math.max(0, Math.trunc(recv[l.id]?.rec ?? 0)),
        qtyDamaged: Math.max(0, Math.trunc(recv[l.id]?.dmg ?? 0)),
      }))
      .filter((l) => l.qtyReceived > 0 || l.qtyDamaged > 0);
    if (payloadLines.length === 0) {
      setError("กรุณาระบุจำนวนที่รับเข้าอย่างน้อย 1 รายการ");
      return;
    }
    startTransition(async () => {
      const res = await receivePo({ poId, warehouseId, note: note.trim() || null, lines: payloadLines });
      if (res.ok) {
        setOpen(false);
        // ลงคลังสำเร็จ แต่ TRCloud (บัญชี) ยังไม่เข้า → โชว์แถบเหลือง + ปุ่มส่งซ้ำ (ไม่ใช่เขียวลอย ๆ)
        if (!res.trcloudPosted && res.grnId) {
          setTrcloudPending({ grnId: res.grnId, reason: res.trcloudReason });
        }
        // แจ้งพ่อให้ refetch (สถานะ + ตาราง "เทียบ") ถ้ามี · ไม่มี (หน้า standalone) → router.refresh
        if (onReceived) onReceived();
        else router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function retry() {
    if (!trcloudPending) return;
    setError(null);
    startTransition(async () => {
      const res = await retryTrcloud(trcloudPending.grnId);
      if ("posted" in res && res.ok && res.posted) {
        setTrcloudPending(null);
        router.refresh();
      } else {
        const reason = "reason" in res ? res.reason : res.error;
        setTrcloudPending({ grnId: trcloudPending.grnId, reason });
      }
    });
  }

  return (
    <Section
      title="รับเข้าคลัง"
      sub={atWarehouse ? "ของถึงโกดังแล้ว — แกะนับแล้วยืนยันรับเข้า" : "รับเข้าได้เมื่อของมาถึง (หน้าบ้านทำได้ด้วย)"}
      action={
        !open ? (
          <button type="button" className="dc-btn-xl dc-btn-xl--ghost" style={btnSmall} onClick={() => setOpen(true)}>
            รับสินค้าเข้าคลัง
          </button>
        ) : null
      }
    >
      {trcloudPending && (
        <div
          style={{
            background: "#fef9e7",
            border: "1px solid #f4d77e",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13.5, color: "#92660a", fontWeight: 600 }}>
            ลงคลังแล้ว · บัญชี (TRCloud) ยังไม่เข้า — กดส่งซ้ำ
            {trcloudPending.reason && (
              <div style={{ fontSize: 12, fontWeight: 500, color: "#a9810f", marginTop: 2 }}>
                เหตุผล: {trcloudPending.reason}
              </div>
            )}
          </div>
          <button type="button" className="dc-btn-xl" style={btnSmall} disabled={pending} onClick={retry}>
            ส่งซ้ำเข้า TRCloud
          </button>
        </div>
      )}

      {!open ? (
        <div style={{ fontSize: 13.5, color: "#71717a" }}>
          กด “รับสินค้าเข้าคลัง” เพื่อนับของจริงต่อรายการ แล้วยืนยัน — ระบบจะคิดต้นทุนนำเข้า ตัดสต๊อก และปิดใบเป็น “รับสินค้าแล้ว”.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <label style={lbl}>
            คลังปลายทาง
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={inp}>
              <option value="" disabled>— เลือกคลัง —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                  <th style={cellHead}>รูป</th>
                  <th style={cellHead}>สินค้า</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>สั่ง</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>รับจริง</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>เสียหาย</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const imgUrl = receiveImgUrl(l);
                  return (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                    <td style={cell}>
                      {imgUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgUrl} alt={l.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--dc-line, #e4e4e7)" }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 8, border: "1px dashed var(--dc-line, #d4d4d8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#c4c4cc" }}>
                          <ImageIcon size={16} />
                        </div>
                      )}
                    </td>
                    <td style={cell}>
                      <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: "#a1a1aa" }}>{l.sku}</div>
                    </td>
                    <td style={{ ...cell, textAlign: "right", color: "#71717a", fontVariantNumeric: "tabular-nums" }}>{l.qty} {l.unit}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <input
                        value={String(recv[l.id]?.rec ?? 0)}
                        onChange={(e) => onRecvChange(l, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                        inputMode="numeric"
                        style={{ ...inp, width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <input
                        value={String(recv[l.id]?.dmg ?? 0)}
                        onChange={(e) => setLine(l.id, { dmg: Math.max(0, Math.trunc(Number(e.target.value) || 0)), dmgTouched: true })}
                        inputMode="numeric"
                        style={{ ...inp, width: 80, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr><td style={{ ...cell, color: "#a1a1aa" }} colSpan={5}>ใบนี้ไม่มีรายการสินค้า</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <label style={lbl}>
            หมายเหตุ (ไม่บังคับ)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น กล่อง 2 บุบเล็กน้อย" style={inp} />
          </label>

          {error && <div style={{ color: "#b8362a", fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setOpen(false)} className="dc-btn-xl dc-btn-xl--ghost" style={btnSmall} disabled={pending}>ยกเลิก</button>
            <button type="button" onClick={submit} className="dc-btn-xl" style={btnSmall} disabled={pending}>
              ยืนยันรับเข้าคลัง
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ── shared styles ─────────────────────────────────────────────
const cellHead: React.CSSProperties = { padding: "10px 12px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" };
const cell: React.CSSProperties = { padding: "11px 12px", verticalAlign: "middle" };
const btnSmall: React.CSSProperties = { width: "auto", minHeight: 40, padding: "0 16px", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 };
const inp: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 11px",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #d4d4d8)",
  background: "#fff",
  fontSize: 14,
  color: "#18181b",
  outline: "none",
};
const lblText: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#52525b" };
const lbl: React.CSSProperties = { display: "grid", gap: 5, fontSize: 12.5, fontWeight: 600, color: "#52525b" };
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 9,
  border: "1px solid var(--dc-line, #e4e4e7)",
  background: "#fff",
  color: "#52525b",
  cursor: "pointer",
};
