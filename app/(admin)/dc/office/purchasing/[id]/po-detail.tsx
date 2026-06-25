"use client";

// DC · รายละเอียดใบสั่งซื้อ (client) — 4 ส่วน:
//   1) หัวใบ: poCode · ผู้ขาย · จุดเริ่ม (จีน/ไทย) · สถานะ · เรต (จีน) · ยอดรวม
//   2) รายการสินค้า (read-only) — แก้ตอนร่างที่หน้า new/list
//   3) กล่อง/พัสดุ: เพิ่ม/แก้/ลบ · เลขพัสดุ · รถ/เรือ · L×W×H → CBM สด · ของในกล่อง
//   4) สถานะ: ปุ่มเดินสถานะตามสถานะปัจจุบัน (submit/approve/markOrdered/.../cancel)
//   5) รับเข้าคลัง: ฟอร์มรับต่อบรรทัด (รับจริง/เสียหาย) + เลือกคลัง + หมายเหตุ → receivePo
//
// ทุก action ผ่าน useTransition + refresh + ภาษาไทย + busy-lock + แสดง error.
// Flow ล็อก: DRAFT → PENDING_APPROVAL → APPROVED → ORDERED → SHIPPED →
//            ARRIVED_TH → AT_WAREHOUSE → RECEIVED. ยกเลิกได้จาก ร่าง/รออนุมัติ/อนุมัติ.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Package, Plus, Pencil, Trash2, Truck, Ship, X } from "lucide-react";
import {
  submitPo,
  approvePo,
  markOrdered,
  markShipped,
  markArrivedTh,
  markAtWarehouse,
  cancelPo,
  receivePo,
  type PoActionResult,
} from "@/lib/dc/po-actions";
import { addBox, updateBox, removeBox, setBoxContents, type BoxActionResult } from "@/lib/dc/box-actions";
import { retryTrcloud } from "@/lib/dc/grn-actions";
import { PO_STATUS_LABEL, PO_STATUS_TONE, PO_ORIGIN_LABEL } from "@/lib/dc/nav";

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

// ── main ──────────────────────────────────────────────────────
export function PoDetail({
  data,
  warehouses,
  canManage,
  r2PublicUrl,
}: {
  data: PoDetailData;
  warehouses: WarehouseOption[];
  canManage: boolean;
  r2PublicUrl: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isChina = data.origin !== "THAI" && data.currency !== "THB";
  const s = isChina ? "¥" : "฿";

  const totalNative = data.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCny, 0);
  const totalThb = isChina && data.fxRate != null ? totalNative * data.fxRate : null;
  const totalCbm = data.boxes.reduce((sum, b) => sum + (b.cbmTotal ?? 0), 0);

  function run(action: () => Promise<PoActionResult | BoxActionResult>, confirmMsg?: string, after?: () => void) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        after?.();
        router.refresh();
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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && (
        <div className="dc-card" style={{ background: "#fdeaea", borderColor: "#f3c7c2", color: "#b8362a", fontWeight: 600, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* 1) หัวใบ */}
      <div className="dc-card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className={`dc-st dc-st--${tone(status)}`}>{PO_STATUS_LABEL[status] ?? status}</span>
              <span className={`dc-st dc-st--${isChina ? "ship" : "ok"}`} style={{ fontSize: 11 }}>
                {PO_ORIGIN_LABEL[data.origin] ?? data.origin}
              </span>
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

      {/* 4) สถานะ — ปุ่มเดินสถานะตามสถานะปัจจุบัน */}
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
