"use client";

// DC · รายละเอียดใบสั่งซื้อ (client):
//   0) ไทม์ไลน์ 5 ขั้น (สั่งแล้ว→Tracking→ถึงไทย→ถึงโกดัง→รับแล้ว) + badge "รอใส่ข้อมูล"
//   1) หัวใบ: poCode · ผู้ขาย · จุดเริ่ม (จีน/ไทย) · สถานะ · เรต (จีน) · ยอดรวม
//   2) รายการสินค้า (read-only) — แก้ตอนร่างที่หน้า new/list
//   3) กล่อง/พัสดุ: เพิ่ม/แก้/ลบ · เลขพัสดุ · รถ/เรือ · L×W×H → CBM สด · ของในกล่อง
//   4) สรุปต้นทุน (ยอดของ · เรต · ค่าขนส่งจีน-ไทย · ค่าขนส่งในไทย · Landed) — ตัวเลขจริง/placeholder
//   5) การจ่ายเงิน (จีนเท่านั้น): ด่านค่าของ (GOODS) + ค่าขนส่งในไทย (THAI_FREIGHT) → ปลดล็อกสถานะ
//   6) สถานะ: ปุ่มเดินสถานะตามสถานะปัจจุบัน (submit/approve/markOrdered/.../cancel)
//   7) รับเข้าคลัง: ฟอร์มรับต่อบรรทัด (รับจริง/เสียหาย) + เลือกคลัง + หมายเหตุ → receivePo
//
// ทุก action ผ่าน useTransition + (onChanged ?? router.refresh) + ภาษาไทย + busy-lock + แสดง error.
// Flow ล็อก: DRAFT → PENDING_APPROVAL → APPROVED → ORDERED → SHIPPED →
//            ARRIVED_TH → AT_WAREHOUSE → RECEIVED. ยกเลิกได้จาก ร่าง/รออนุมัติ/อนุมัติ.
// ด่านจ่ายเงิน (server บังคับ): markAtWarehouse ต้องมี GOODS payment · receivePo ต้องมี THAI_FREIGHT payment.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Package, Plus, Pencil, Trash2, Truck, Ship, X, Check, CircleDollarSign } from "lucide-react";
import {
  submitPo,
  approvePo,
  markOrdered,
  markShipped,
  markArrivedTh,
  markAtWarehouse,
  cancelPo,
  receivePo,
  recordPoPayment,
  deletePoPayment,
  type PoActionResult,
  type PoPaymentData,
} from "@/lib/dc/po-actions";
import { addBox, updateBox, removeBox, setBoxContents, type BoxActionResult } from "@/lib/dc/box-actions";
import { retryTrcloud } from "@/lib/dc/grn-actions";
import { PO_STATUS_LABEL, PO_STATUS_TONE, PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import { Dialog } from "@/components/ui/dialog";

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
// PARTIAL ถือว่าอยู่ระหว่าง AT_WAREHOUSE กับ RECEIVED (รับบางส่วน)
const STATUS_RANK: Record<string, number> = {
  DRAFT: 0,
  PENDING_APPROVAL: 1,
  APPROVED: 2,
  ORDERED: 3,
  SHIPPED: 4,
  ARRIVED_TH: 5,
  AT_WAREHOUSE: 6,
  PARTIAL: 6.5,
  RECEIVED: 7,
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
  r2PublicUrl,
  onChanged,
}: {
  data: PoDetailData;
  payments: PoPaymentData[];
  goodsPaid: boolean;
  thaiFreightPaid: boolean;
  warehouses: WarehouseOption[];
  canManage: boolean;
  r2PublicUrl: string;
  onChanged?: () => void;
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

  // ยอด GOODS / THAI_FREIGHT ล่าสุด (ไว้โชว์ "จ่ายแล้ว" + ใช้ใน cost panel)
  const goodsPayment = payments.find((p) => p.kind === "GOODS") ?? null;
  const thaiFreightPayment = payments.find((p) => p.kind === "THAI_FREIGHT") ?? null;

  // ── ขั้นต่อไป (Pinpoint #2/#3): กดเปิดป๊อปอัปเลื่อนสถานะ + กรอกข้อมูลที่ขั้นนั้นต้องใช้ ──
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const NEXT_ACTION_LABEL: Record<string, string> = {
    DRAFT: "ส่งขออนุมัติ",
    PENDING_APPROVAL: "อนุมัติใบสั่งซื้อ",
    APPROVED: "ยืนยันสั่งกับผู้ขาย",
    ORDERED: "ได้เลข Tracking",
    SHIPPED: "ถึงไทยแล้ว",
    ARRIVED_TH: "ถึงโกดังแล้ว",
    AT_WAREHOUSE: "รับเข้าคลัง",
    PARTIAL: "รับส่วนที่เหลือ",
  };
  const nextLabel = NEXT_ACTION_LABEL[status] ?? null;
  const showAdvance = canManage && !!nextLabel;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && (
        <div className="dc-card" style={{ background: "#fdeaea", borderColor: "#f3c7c2", color: "#b8362a", fontWeight: 600, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* 0) ไทม์ไลน์ 5 ขั้น + badge รอใส่ข้อมูล */}
      <Timeline status={status} isChina={isChina} awaitingTracking={awaitingTracking} />

      {/* ปุ่มเลื่อนขั้นถัดไป (Pinpoint #2/#3) — กดแล้วป๊อปอัปขึ้น กรอกข้อมูลที่ขั้นนั้นต้องใช้ */}
      {showAdvance && (
        <button
          type="button"
          onClick={() => setAdvanceOpen(true)}
          disabled={pending}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "13px 16px", borderRadius: 12, border: "none", cursor: "pointer",
            background: "var(--color-brand-600, #1c5fc4)", color: "#fff", fontSize: 15, fontWeight: 700,
            fontFamily: "inherit", boxShadow: "0 2px 8px rgba(28,95,196,.25)",
          }}
        >
          ⚡ ดำเนินการขั้นต่อไป: {nextLabel} →
        </button>
      )}

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
        onDone={() => { setAdvanceOpen(false); refresh(); }}
      />

      {/* 1) หัวใบ */}
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
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: "#92660a",
                    background: "#fef9e7",
                    border: "1px solid #f4d77e",
                    borderRadius: 999,
                    padding: "3px 10px",
                  }}
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

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "#71717a" }}>ยอดรวมทั้งใบ</div>
            <div style={{ fontWeight: 800, fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{s}{fmt(totalNative)}</div>
            {totalThb != null && <div style={{ fontSize: 12.5, color: "#71717a" }}>≈ ฿{fmt(totalThb)}</div>}
            {totalCbm > 0 && <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>ปริมาตรรวม ~{fmt(totalCbm, 4)} m³</div>}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#71717a", borderTop: "1px solid var(--dc-line, #f0f0f2)", paddingTop: 12, fontVariantNumeric: "tabular-nums" }}>
          <div>สร้างโดย: {data.createdBy ?? "—"} · {fmtDateTime(data.createdAt)}</div>
          {data.approvedBy && <div>อนุมัติโดย: <b style={{ color: "#18181b" }}>{data.approvedBy}</b> · {fmtDateTime(data.approvedAt)}</div>}
          {data.orderedAt && <div>สั่งเมื่อ: {fmtDateTime(data.orderedAt)}</div>}
        </div>
      </div>

      {/* 2) รายการสินค้า */}
      <Section title="รายการสินค้า" sub="ของที่สั่งในใบนี้ (แก้ไขได้ตอนยังเป็นร่าง)">
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
      </Section>

      {/* 3) กล่อง/พัสดุ */}
      <BoxesSection
        poId={data.id}
        boxes={data.boxes}
        products={poProducts}
        canManage={canManage}
        pending={pending}
        run={run}
        sealed={status === "RECEIVED"}
      />

      {/* 4) สรุปต้นทุน */}
      <CostSummary
        status={status}
        isChina={isChina}
        sym={s}
        totalNative={totalNative}
        fxRate={data.fxRate}
        totalThb={totalThb}
        goodsPayment={goodsPayment}
        thaiFreightPayment={thaiFreightPayment}
      />

      {/* 5) การจ่ายเงิน — จีนเท่านั้น (ด่านปลดล็อกสถานะ) */}
      {isChina && (
        <PaymentSection
          poId={data.id}
          status={status}
          payments={payments}
          goodsPaid={goodsPaid}
          thaiFreightPaid={thaiFreightPaid}
          goodsPayment={goodsPayment}
          thaiFreightPayment={thaiFreightPayment}
          canManage={canManage}
          pending={pending}
          run={run}
        />
      )}

      {/* 6) สถานะ — ปุ่มเดินสถานะตามสถานะปัจจุบัน */}
      <Section title="สถานะใบสั่งซื้อ" sub="เดินสถานะตามจริง — ปุ่มจะโชว์เฉพาะขั้นที่ทำได้ตอนนี้">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className={`dc-st dc-st--${tone(status)}`} style={{ fontSize: 14, padding: "5px 14px" }}>
            {PO_STATUS_LABEL[status] ?? status}
          </span>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "DRAFT" && (
              <AdvanceBtn label="ส่งขออนุมัติ" onClick={() => run(() => submitPo(data.id))} pending={pending} />
            )}
            {status === "PENDING_APPROVAL" && canManage && (
              <AdvanceBtn label="อนุมัติ" onClick={() => run(() => approvePo(data.id), "ยืนยันอนุมัติใบสั่งซื้อนี้? (เป็นการอนุมัติเงินออก)")} pending={pending} />
            )}
            {status === "APPROVED" && (
              <AdvanceBtn label="สั่งกับผู้ขายแล้ว" onClick={() => run(() => markOrdered(data.id), "ยืนยันว่าได้สั่งซื้อกับผู้ขายแล้ว?")} pending={pending} />
            )}
            {status === "ORDERED" && (
              <AdvanceBtn label="ได้เลข Tracking" onClick={() => run(() => markShipped(data.id))} pending={pending} />
            )}
            {status === "SHIPPED" && (
              <AdvanceBtn label="ถึงไทยแล้ว" onClick={() => run(() => markArrivedTh(data.id))} pending={pending} />
            )}
            {status === "ARRIVED_TH" && (
              <AdvanceBtn label="ถึงโกดังแล้ว" onClick={() => run(() => markAtWarehouse(data.id))} pending={pending} />
            )}
            {(status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED") && (
              <button
                type="button"
                className="dc-btn-xl dc-btn-xl--danger"
                style={btnSmall}
                disabled={pending}
                onClick={() => run(() => cancelPo(data.id), "ยืนยันยกเลิกใบสั่งซื้อนี้?")}
              >
                ยกเลิกใบ
              </button>
            )}
            {status === "RECEIVED" && <span style={{ fontSize: 13.5, color: "#167a41" }}>รับสินค้าเข้าคลังครบแล้ว ✓</span>}
            {status === "CANCELLED" && <span style={{ fontSize: 13.5, color: "#b8362a" }}>ใบนี้ถูกยกเลิก</span>}
          </div>
        </div>
      </Section>

      {/* 5) รับเข้าคลัง — เปิดเมื่อยังไม่รับครบ (ถึงโกดัง/ระหว่างทาง/สั่งแล้ว/รับบางส่วน) */}
      {["ORDERED", "SHIPPED", "ARRIVED_TH", "AT_WAREHOUSE", "PARTIAL"].includes(status) && (
        <ReceiveSection
          poId={data.id}
          lines={data.lines}
          warehouses={warehouses}
          defaultWarehouseId={data.warehouseId}
          atWarehouse={status === "AT_WAREHOUSE"}
        />
      )}
    </div>
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

function AdvanceBtn({ label, onClick, pending }: { label: string; onClick: () => void; pending: boolean }) {
  return (
    <button type="button" className="dc-btn-xl" style={btnSmall} disabled={pending} onClick={onClick}>
      {label}
    </button>
  );
}

// ── ป๊อปอัปเลื่อนสถานะ (Pinpoint #2/#3) ───────────────────────────
// กดขั้นถัดไป → ป๊อปอัปขึ้น → กรอกข้อมูลที่ขั้นนั้นต้องใช้ (น้อยสุด) → ยืนยัน → เลื่อนสถานะ.
// reuse action เดิม (submitPo/.../receivePo/recordPoPayment) — ไม่แตะ section/ฟอร์มเดิม (fallback).
function AdvanceModal({
  open, onClose, data, status, isChina, goodsPaid, thaiFreightPaid, awaitingTracking, defaultWarehouseId, onDone,
}: {
  open: boolean; onClose: () => void; data: PoDetailData; status: string;
  isChina: boolean; goodsPaid: boolean; thaiFreightPaid: boolean; awaitingTracking: boolean;
  defaultWarehouseId: string | null; onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"CNY" | "THB">(isChina ? "CNY" : "THB");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));

  type Res = { ok: boolean; error?: string };
  const done = (r: Res) => { if (r.ok) onDone(); else setErr(r.error ?? "ทำรายการไม่สำเร็จ"); };
  const exec = (fn: () => Promise<Res>) => start(async () => { setErr(null); done(await fn()); });
  const payThen = (kind: "GOODS" | "THAI_FREIGHT", advance: () => Promise<Res>) =>
    start(async () => {
      setErr(null);
      const amt = Math.round((parseFloat(amount) || 0) * 100);
      if (amt <= 0) { setErr("กรอกจำนวนเงินที่จ่ายจริง"); return; }
      const p = await recordPoPayment({ poId: data.id, kind, amountSatang: amt, currency, paidAt });
      if (!p.ok) { setErr(p.error); return; }
      done(await advance());
    });
  const receivePoCall = () =>
    receivePo({
      poId: data.id,
      warehouseId: defaultWarehouseId ?? "",
      note: null,
      lines: data.lines.map((l) => ({ productId: l.productId, qtyReceived: l.qty, qtyDamaged: 0 })),
    });
  const doReceive = () => {
    if (!defaultWarehouseId) { setErr("ใบนี้ยังไม่ผูกคลัง — ปิดป๊อปอัปแล้วใช้ฟอร์ม “รับเข้าคลัง” ด้านล่างเพื่อเลือกคลัง"); return; }
    if (isChina && !thaiFreightPaid) payThen("THAI_FREIGHT", receivePoCall);
    else exec(receivePoCall);
  };

  const inp: React.CSSProperties = { border: "1px solid #d4d4d8", borderRadius: 8, padding: "8px 11px", fontSize: 14, fontFamily: "inherit", outline: "none", background: "#fff", color: "#18181b" };
  const chipStyle = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 8, border: `1px solid ${on ? "#1c5fc4" : "#d4d4d8"}`, background: on ? "#1c5fc4" : "#fff", color: on ? "#fff" : "#52525b", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit" });
  const primary: React.CSSProperties = { width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#1c5fc4", color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit" };
  const pStyle: React.CSSProperties = { margin: "0 0 4px", fontSize: 14, color: "#3f3f46", lineHeight: 1.5 };
  const warn: React.CSSProperties = { fontSize: 12.5, color: "#92660a", fontWeight: 600, background: "#fef9e7", border: "1px solid #f4d77e", borderRadius: 8, padding: "7px 10px" };

  const payFields = (label: string) => (
    <div style={{ display: "grid", gap: 8, padding: 12, background: "#fef9e7", border: "1px solid #f4d77e", borderRadius: 10 }}>
      <div style={{ fontSize: 12.5, color: "#92660a", fontWeight: 700 }}>{label} — ต้องบันทึกจ่ายก่อนถึงจะเลื่อนสถานะได้</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="จำนวนเงิน" style={{ ...inp, flex: 1, minWidth: 110 }} />
        {isChina && (["CNY", "THB"] as const).map((c) => (
          <button key={c} type="button" onClick={() => setCurrency(c)} style={chipStyle(currency === c)}>{c === "CNY" ? "¥ หยวน" : "฿ บาท"}</button>
        ))}
        <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={inp} />
      </div>
    </div>
  );

  let body: React.ReactNode = null;
  if (status === "DRAFT") body = (
    <><p style={pStyle}>ส่งใบนี้ขออนุมัติ — ผู้มีสิทธิ์จะกดอนุมัติให้เงินออก</p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => submitPo(data.id))}>ส่งขออนุมัติ</button></>
  );
  else if (status === "PENDING_APPROVAL") body = (
    <><p style={pStyle}>อนุมัติใบสั่งซื้อนี้ — <b>เป็นการอนุมัติให้เงินออก</b></p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => approvePo(data.id))}>อนุมัติ</button></>
  );
  else if (status === "APPROVED") body = (
    <><p style={pStyle}>ยืนยันว่าได้สั่งซื้อกับผู้ขายแล้ว → สถานะ “สั่งแล้ว”</p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markOrdered(data.id))}>ยืนยันสั่งแล้ว</button></>
  );
  else if (status === "ORDERED") body = (
    <><p style={pStyle}>ของออกจากจีนแล้ว มีเลขพัสดุ → สถานะ “ได้เลข Tracking”</p>
    {awaitingTracking && <div style={warn}>⚠️ ยังไม่มีกล่องที่มีเลขพัสดุ — เพิ่มกล่อง+เลขพัสดุที่ส่วน “กล่อง/พัสดุ” ด้านล่างก่อน</div>}
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markShipped(data.id))}>ยืนยันได้เลข Tracking</button></>
  );
  else if (status === "SHIPPED") body = (
    <><p style={pStyle}>ของถึงไทยแล้ว → สถานะ “ถึงไทยแล้ว”</p>
    <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markArrivedTh(data.id))}>ยืนยันถึงไทยแล้ว</button></>
  );
  else if (status === "ARRIVED_TH") body = (
    <><p style={pStyle}>ของถึงโกดังแล้ว → สถานะ “ถึงโกดังแล้ว”</p>
    {isChina && !goodsPaid ? (
      <>{payFields("ค่าของ (จ่ายผู้ขายจีน)")}
      <button type="button" style={primary} disabled={pending} onClick={() => payThen("GOODS", () => markAtWarehouse(data.id))}>บันทึกจ่ายค่าของ + ถึงโกดังแล้ว</button></>
    ) : (
      <button type="button" style={primary} disabled={pending} onClick={() => exec(() => markAtWarehouse(data.id))}>ยืนยันถึงโกดังแล้ว</button>
    )}</>
  );
  else if (status === "AT_WAREHOUSE" || status === "PARTIAL") body = (
    <><p style={pStyle}>รับของเข้าคลัง → ตัดเข้าสต๊อก (สถานะ “รับแล้ว”)</p>
    {isChina && !thaiFreightPaid && payFields("ค่าขนส่งในไทย")}
    <button type="button" style={primary} disabled={pending} onClick={doReceive}>รับเข้าครบทุกชิ้น</button>
    <p style={{ ...pStyle, fontSize: 12, color: "#71717a", marginTop: 6 }}>ต้องการรับบางส่วน / ใส่ของเสียหาย → ปิดป๊อปอัปแล้วใช้ฟอร์ม “รับเข้าคลัง” ด้านล่าง</p></>
  );

  return (
    <Dialog open={open} onClose={onClose} title="ดำเนินการขั้นต่อไป">
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
const TIMELINE_STEPS: { key: string; label: string; hint?: string }[] = [
  { key: "ORDERED", label: "สั่งแล้ว" },
  { key: "SHIPPED", label: "ได้เลข Tracking" },
  { key: "ARRIVED_TH", label: "ถึงไทยแล้ว", hint: "· จ่ายค่าของ" },
  { key: "AT_WAREHOUSE", label: "ถึงโกดังแล้ว", hint: "· จ่ายค่าขนส่งไทย" },
  { key: "RECEIVED", label: "รับแล้ว" },
];

function Timeline({ status, isChina, awaitingTracking }: { status: string; isChina: boolean; awaitingTracking: boolean }) {
  const preOrder = status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED";
  const cancelled = status === "CANCELLED";
  const partial = status === "PARTIAL";
  const currentRank = statusRank(status); // 3..7

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
          ก่อนสั่ง — รออนุมัติ/สั่งกับผู้ขาย
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
            const rank = statusRank(step.key);
            // ขั้นที่ทำเสร็จแล้ว (rank < current หรือ partial ครอบขั้น 4) = filled
            const done = !preOrder && (rank < currentRank || (partial && rank <= statusRank("AT_WAREHOUSE")));
            const current = !preOrder && rank === currentRank;
            const fill = done ? "#1c8a4e" : current ? "#fff" : "#f1f1f4";
            const ring = current ? "#1c5fc4" : done ? "#1c8a4e" : "#e4e4e7";
            const numColor = done ? "#fff" : current ? "#1c5fc4" : "#a1a1aa";
            // เส้นเชื่อมไปขั้นถัดไป
            const connectorDone = !preOrder && rank < currentRank;
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

// ── 4) สรุปต้นทุน ──────────────────────────────────────────────
// ตัวเลขจริงเท่าที่มี · placeholder เมื่อยังไม่มีข้อมูล (ไม่ปั้นตัวเลข Landed ปลอม)
function CostSummary({
  status,
  isChina,
  sym,
  totalNative,
  fxRate,
  totalThb,
  goodsPayment,
  thaiFreightPayment,
}: {
  status: string;
  isChina: boolean;
  sym: string;
  totalNative: number;
  fxRate: number | null;
  totalThb: number | null;
  goodsPayment: PoPaymentData | null;
  thaiFreightPayment: PoPaymentData | null;
}) {
  // ค่าขนส่งจีน–ไทย: ไม่มี freight fields ใน boxes → ใช้ยอด GOODS ที่บันทึกถ้ามี · ไม่งั้น placeholder
  const arrivedTh = statusAtLeast(status, "ARRIVED_TH");
  const atWarehouse = statusAtLeast(status, "AT_WAREHOUSE");

  const chinaFreightNode = goodsPayment
    ? `${payCurSym(goodsPayment.currency)}${fmt(fromSatang(goodsPayment.amountSatang))}`
    : arrivedTh
      ? "รอกรอก"
      : "รอกรอก (เมื่อถึงไทย)";

  const thaiFreightNode = thaiFreightPayment
    ? `${payCurSym(thaiFreightPayment.currency)}${fmt(fromSatang(thaiFreightPayment.amountSatang))}`
    : atWarehouse
      ? "รอกรอก"
      : "รอกรอก (เมื่อถึงโกดัง)";

  // Landed ประมาณ = ยอดของ × เรต (subtotal) — label ชัดว่า "ประมาณ" · ไม่รวม freight ที่ยังไม่รู้แน่
  const landedEstimate = isChina && totalThb != null ? totalThb : !isChina ? totalNative : null;

  return (
    <Section title="สรุปต้นทุน" sub="ตัวเลขจริงเท่าที่มี — ช่องที่ยังไม่รู้จะขึ้น “รอกรอก” (ไม่เดาตัวเลข)">
      <div style={{ display: "grid", gap: 0, fontSize: 14 }}>
        <CostRow label={isChina ? "ยอดหยวน (ค่าของ)" : "ยอดบาท (ค่าของ)"} value={`${sym}${fmt(totalNative)}`} strong />
        {isChina && (
          <CostRow label="เรต ฿/¥" value={fxRate != null ? `1 ¥ = ฿${fmt(fxRate, 4)}` : "ยังไม่ใส่เรต"} muted={fxRate == null} />
        )}
        {isChina && totalThb != null && <CostRow label="ยอดของ (บาท)" value={`฿${fmt(totalThb)}`} />}
        <CostRow
          label="ค่าขนส่งจีน–ไทย"
          value={chinaFreightNode}
          muted={!goodsPayment}
        />
        <CostRow
          label="ค่าขนส่งในไทย"
          value={thaiFreightNode}
          muted={!thaiFreightPayment}
        />
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
          * ประมาณจากยอดของ × เรต — ยังไม่รวมค่าขนส่ง/ภาษีที่รอกรอก ตัวเลขจริงคิดตอนรับเข้าคลัง
        </div>
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

// ── 5) การจ่ายเงิน (จีนเท่านั้น) ───────────────────────────────
// 2 ด่าน: ค่าของ (GOODS) ปลดล็อก "ถึงโกดังเรา" · ค่าขนส่งในไทย (THAI_FREIGHT) ปลดล็อก "รับเข้าคลัง"
function PaymentSection({
  poId,
  status,
  payments,
  goodsPaid,
  thaiFreightPaid,
  goodsPayment,
  thaiFreightPayment,
  canManage,
  pending,
  run,
}: {
  poId: string;
  status: string;
  payments: PoPaymentData[];
  goodsPaid: boolean;
  thaiFreightPaid: boolean;
  goodsPayment: PoPaymentData | null;
  thaiFreightPayment: PoPaymentData | null;
  canManage: boolean;
  pending: boolean;
  run: (action: () => Promise<PoActionResult | BoxActionResult>, confirmMsg?: string, after?: () => void) => void;
}) {
  return (
    <Section title="การจ่ายเงิน" sub="2 ด่าน — จ่ายค่าของก่อนถึงโกดัง · จ่ายค่าขนส่งไทยก่อนรับเข้าคลัง">
      <div style={{ display: "grid", gap: 12 }}>
        <PaymentGate
          poId={poId}
          kind="GOODS"
          title="ค่าของ (GOODS)"
          paid={goodsPaid}
          payment={goodsPayment}
          // เปิดฟอร์มเมื่อ ≥ ถึงไทยแล้ว · default สกุล ¥ (จ่ายผู้ขายจีน)
          formOpen={statusAtLeast(status, "ARRIVED_TH")}
          notYetMsg="พอถึงไทยแล้วจะบันทึกจ่ายค่าของได้"
          defaultCurrency="CNY"
          hint="จ่ายค่าของก่อน จึงจะเลื่อน “ถึงโกดังเรา” ได้"
          canManage={canManage}
          pending={pending}
          run={run}
        />
        <PaymentGate
          poId={poId}
          kind="THAI_FREIGHT"
          title="ค่าขนส่งในไทย (THAI_FREIGHT)"
          paid={thaiFreightPaid}
          payment={thaiFreightPayment}
          // เปิดฟอร์มเมื่อ ≥ ถึงโกดังแล้ว · default สกุล ฿
          formOpen={statusAtLeast(status, "AT_WAREHOUSE")}
          notYetMsg="พอถึงโกดังแล้วจะบันทึกจ่ายค่าขนส่งไทยได้"
          defaultCurrency="THB"
          hint="จ่ายค่าขนส่งไทยก่อน จึงจะรับเข้าคลังได้"
          canManage={canManage}
          pending={pending}
          run={run}
        />

        {/* รายการจ่ายทั้งหมด (ledger) */}
        {payments.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 6 }}>ประวัติการจ่าย</div>
            <div style={{ display: "grid", gap: 4 }}>
              {payments.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                  <span>{p.kind === "GOODS" ? "ค่าของ" : "ค่าขนส่งในไทย"} · {fmtDateTime(p.paidAt)}{p.note ? ` · ${p.note}` : ""}</span>
                  <span style={{ fontWeight: 600, color: "#18181b" }}>{payCurSym(p.currency)}{fmt(fromSatang(p.amountSatang))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function PaymentGate({
  poId,
  kind,
  title,
  paid,
  payment,
  formOpen,
  notYetMsg,
  defaultCurrency,
  hint,
  canManage,
  pending,
  run,
}: {
  poId: string;
  kind: "GOODS" | "THAI_FREIGHT";
  title: string;
  paid: boolean;
  payment: PoPaymentData | null;
  formOpen: boolean;
  notYetMsg: string;
  defaultCurrency: "THB" | "CNY";
  hint: string;
  canManage: boolean;
  pending: boolean;
  run: (action: () => Promise<PoActionResult | BoxActionResult>, confirmMsg?: string, after?: () => void) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"THB" | "CNY">(defaultCurrency);
  const today = new Date().toISOString().slice(0, 10);
  const [paidAt, setPaidAt] = useState(today);
  const [localErr, setLocalErr] = useState<string | null>(null);

  function submit() {
    setLocalErr(null);
    const amt = numOrNull(amount);
    if (amt == null) {
      setLocalErr("กรุณาระบุยอดเงินที่จ่าย");
      return;
    }
    run(
      () =>
        recordPoPayment({
          poId,
          kind,
          amountSatang: Math.round(amt * 100),
          currency,
          paidAt: new Date(paidAt + "T00:00:00").toISOString(),
        }),
      undefined,
      () => setAmount(""),
    );
  }

  return (
    <div style={{ border: "1px solid var(--dc-line, #e4e4e7)", borderRadius: 12, padding: "12px 14px", background: paid ? "#f1faf3" : "#fcfcfd", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: "#18181b", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <CircleDollarSign size={15} /> {title}
        </span>
        {paid && payment && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#167a41", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Check size={14} /> จ่ายแล้ว · {payCurSym(payment.currency)}{fmt(fromSatang(payment.amountSatang))} · {fmtDateTime(payment.paidAt)}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => run(() => deletePoPayment(payment.id), "ยืนยันลบรายการจ่ายเงินนี้?")}
                disabled={pending}
                style={{ ...iconBtn, width: 30, height: 30, color: "#b8362a" }}
                title="ลบรายการจ่าย"
              >
                <Trash2 size={14} />
              </button>
            )}
          </span>
        )}
      </div>

      {!paid && (
        <>
          {canManage && formOpen ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                <label style={{ ...lbl, flex: "1 1 120px", minWidth: 110 }}>
                  ยอดที่จ่าย
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={inp} />
                </label>
                <div style={{ display: "grid", gap: 5 }}>
                  <span style={lblText}>สกุล</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => setCurrency("THB")} className={`dc-chip${currency === "THB" ? " is-active" : ""}`}>฿ บาท</button>
                    <button type="button" onClick={() => setCurrency("CNY")} className={`dc-chip${currency === "CNY" ? " is-active" : ""}`}>¥ หยวน</button>
                  </div>
                </div>
                <label style={{ ...lbl, flex: "0 0 auto" }}>
                  วันที่จ่าย
                  <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={{ ...inp, width: 160 }} />
                </label>
                <button type="button" onClick={submit} className="dc-btn-xl" style={btnSmall} disabled={pending}>
                  {kind === "GOODS" ? "บันทึกจ่ายค่าของ" : "บันทึกจ่ายค่าขนส่งไทย"}
                </button>
              </div>
              {localErr && <div style={{ color: "#b8362a", fontSize: 13, fontWeight: 600 }}>{localErr}</div>}
              <div style={{ fontSize: 12, color: "#92660a" }}>{hint}</div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "#a1a1aa" }}>{canManage ? notYetMsg : "ยังไม่ได้จ่าย"}</div>
          )}
        </>
      )}
    </div>
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
}: {
  poId: string;
  lines: PoLineData[];
  warehouses: WarehouseOption[];
  defaultWarehouseId: string | null;
  atWarehouse: boolean;
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
  const [recv, setRecv] = useState<Record<string, { rec: number; dmg: number }>>(
    () => Object.fromEntries(lines.map((l) => [l.id, { rec: l.qty, dmg: 0 }])),
  );

  function setLine(id: string, patch: Partial<{ rec: number; dmg: number }>) {
    setRecv((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
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
        router.refresh();
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
                  <th style={cellHead}>สินค้า</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>สั่ง</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>รับจริง</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>เสียหาย</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                    <td style={cell}>
                      <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: "#a1a1aa" }}>{l.sku}</div>
                    </td>
                    <td style={{ ...cell, textAlign: "right", color: "#71717a", fontVariantNumeric: "tabular-nums" }}>{l.qty} {l.unit}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <input
                        value={String(recv[l.id]?.rec ?? 0)}
                        onChange={(e) => setLine(l.id, { rec: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                        inputMode="numeric"
                        style={{ ...inp, width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <input
                        value={String(recv[l.id]?.dmg ?? 0)}
                        onChange={(e) => setLine(l.id, { dmg: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                        inputMode="numeric"
                        style={{ ...inp, width: 80, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td style={{ ...cell, color: "#a1a1aa" }} colSpan={4}>ใบนี้ไม่มีรายการสินค้า</td></tr>
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
