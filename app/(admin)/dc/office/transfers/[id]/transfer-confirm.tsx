"use client";

// DC · ยืนยันปลายทางรับโอน (client).
//   • IN_TRANSIT/DISPATCHED → ปุ่มใหญ่ 2 ทาง:
//       (1) "✓ ถึงแล้ว ครบ"     → confirmTransfer (รับครบทุกบรรทัดตามที่ส่ง)
//       (2) "⚠ ไม่ครบ/เสียหาย"  → เปิดช่องกรอกจำนวนรับรายบรรทัด แล้วกดยืนยัน
//   • CONFIRMED/AUTO_UNVERIFIED/CANCELLED → อ่านอย่างเดียว + badge
//   • โชว์ต้นทุนที่พกมา (carried cost) รายบรรทัด
//   • ปุ่มยกเลิกใบ (เฉพาะ IN_TRANSIT/DISPATCHED) — คืนของกลับต้นทาง

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertTriangle, XCircle } from "lucide-react";
import { confirmTransfer, cancelTransfer } from "@/lib/dc/transfer-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { DcThumb } from "@/components/dc/product-image";
import { DcTransferStatus } from "@/lib/generated/prisma/enums";

export type TransferConfirmLine = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  qtyReceived: number | null;
  unitCostSatang: number | null;
  /** URL รูปสินค้า (ถ้ามี) — โชว์ thumb หน้าชื่อ. optional (หลังบ้านเดิมไม่ส่งก็ได้) */
  imageUrl?: string | null;
};

export type TransferConfirmData = {
  id: string;
  transferCode: string;
  status: string;
  destType: string;
  fromName: string;
  destName: string;
  sameSite: boolean;
  dispatchedAt: string;
  confirmedAt: string | null;
  note: string | null;
  statusLabel: string;
  lines: TransferConfirmLine[];
  /** Wave 6 — ถ้าปลายทางเป็นสาขาตู้คีบ (ClawFleet) = ชื่อสาขา · null ถ้าไม่ใช่ (ของจะเข้าสโตร์สาขาเมื่อรับ) */
  clawfleetBranchName?: string | null;
  /** คนดูมีสิทธิ์ "รับเข้า" คลังปลายทางนี้ไหม (default true = หลังบ้าน/ผู้จัดการ) */
  canReceive?: boolean;
  /** คนดูมีสิทธิ์ "ยกเลิกใบโอน" ไหม (default true = ผู้จัดการ) */
  canCancel?: boolean;
};

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  DISPATCHED: "info",
  IN_TRANSIT: "warning",
  CONFIRMED: "success",
  AUTO_UNVERIFIED: "danger",
  CANCELLED: "neutral",
};

function fmtBaht(satang: number | null): string {
  if (satang == null) return "—";
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100);
}

export function TransferConfirm({ data }: { data: TransferConfirmData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialMode, setPartialMode] = useState(false);
  // จำนวนรับรายบรรทัด (default = qty เต็ม)
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.lines.map((l) => [l.id, l.qty])),
  );

  const isOpen =
    data.status === DcTransferStatus.IN_TRANSIT || data.status === DcTransferStatus.DISPATCHED;
  const isModuleDest = data.destType === "MODULE";
  const canReceive = data.canReceive ?? true; // ปุ่มรับ = โชว์เฉพาะคนที่รับคลังนี้ได้จริง
  const canCancel = data.canCancel ?? true; // ปุ่มยกเลิก = เฉพาะผู้จัดการ

  const setRecv = useCallback((lineId: string, v: number) => {
    setReceived((prev) => ({ ...prev, [lineId]: Math.max(0, Math.trunc(v || 0)) }));
  }, []);

  const confirmAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmTransfer({ transferId: data.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      setError("ยืนยันรับไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, data.id, router]);

  const confirmPartial = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const lines = data.lines.map((l) => ({ lineId: l.id, qtyReceived: received[l.id] ?? 0 }));
      const res = await confirmTransfer({ transferId: data.id, lines });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      setError("ยืนยันรับไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, data.id, data.lines, received, router]);

  const doCancel = useCallback(async () => {
    setError(null);
    const res = await cancelTransfer(data.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }, [data.id, router]);

  const totalQty = useMemo(() => data.lines.reduce((s, l) => s + l.qty, 0), [data.lines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      {/* สรุปหัวใบ */}
      <div className="dc-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill tone={STATUS_TONE[data.status] ?? "neutral"} dot>
            {data.statusLabel}
          </StatusPill>
          {data.sameSite && <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>อยู่ที่เดียวกัน</span>}
          <span style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)" }}>{isModuleDest ? "ปลายทาง: สาขา/โมดูล" : "ปลายทาง: คลัง DC"}</span>
        </div>
        <div style={{ fontSize: 14, color: "#52525b" }}>
          ส่งเมื่อ {data.dispatchedAt}
          {data.confirmedAt ? ` · ปิดเมื่อ ${data.confirmedAt}` : ""}
        </div>
        {data.note && <div style={{ fontSize: 14, color: "#52525b" }}>หมายเหตุ: {data.note}</div>}
        {/* Wave 6 — ปลายทางสาขาตู้คีบ: บอกชัดว่า "รับแล้ว" ของจะเข้าสโตร์สาขาจริง */}
        {data.clawfleetBranchName && (
          <div
            style={{
              marginTop: 2,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              alignSelf: "flex-start",
              background: "#eef2ff",
              color: "#3730a3",
              border: "1px solid #c7d2fe",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 13.5,
              fontWeight: 600,
              lineHeight: 1.4,
            }}
          >
            🕹️ ปลายทาง: ตู้คีบ {data.clawfleetBranchName} — รับแล้วของจะเข้าสโตร์สาขา
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "#fdecea",
            color: "#c0392b",
            border: "1px solid #f5c6c0",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {data.status === DcTransferStatus.AUTO_UNVERIFIED && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ⚠️ ใบนี้ถูกปิดอัตโนมัติเพราะค้างนาน (ยังไม่มีคนยืนยันรับด้วยมือ) — ตรวจสอบว่าของถึงครบจริงไหม
        </div>
      )}

      {/* บรรทัดสินค้า */}
      <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
              <th style={cellHead}>สินค้า</th>
              <th style={{ ...cellHead, textAlign: "right" }}>ส่ง</th>
              <th style={{ ...cellHead, textAlign: "right" }}>{isOpen && partialMode ? "รับจริง" : "รับแล้ว"}</th>
              <th style={{ ...cellHead, textAlign: "right" }}>ต้นทุน/หน่วย</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                <td style={cell}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {l.imageUrl !== undefined && <DcThumb url={l.imageUrl} alt={l.name} size={40} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: "#71717a" }}>{l.sku}</div>
                    </div>
                  </div>
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {l.qty} {l.unit}
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {isOpen && partialMode ? (
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={l.qty}
                      value={received[l.id] ?? 0}
                      onChange={(e) => setRecv(l.id, Number(e.target.value))}
                      aria-label={`จำนวนรับจริง ${l.name}`}
                      style={{
                        width: 80,
                        textAlign: "right",
                        border: "1.5px solid var(--dc-line, #e6eaf0)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontSize: 15,
                        fontWeight: 600,
                      }}
                    />
                  ) : l.qtyReceived != null ? (
                    <span style={{ color: l.qtyReceived < l.qty ? "#c0392b" : "#16a34a", fontWeight: 600 }}>
                      {l.qtyReceived} {l.unit}
                    </span>
                  ) : (
                    <span style={{ color: "#a1a1aa" }}>—</span>
                  )}
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                  {fmtBaht(l.unitCostSatang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ผู้ดูใบที่ไม่ได้สังกัดคลังปลายทาง (เช่น คนต้นทางเปิดดู) — เห็นใบได้ แต่กดรับไม่ได้ */}
      {isOpen && !canReceive && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#f4f7fc",
            color: "#5b6676",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          รับเข้าได้เฉพาะพนักงานคลังปลายทาง
        </div>
      )}

      {/* ปุ่มยืนยัน (เฉพาะใบที่ยังเปิด + คนที่รับคลังนี้ได้) */}
      {isOpen && canReceive && !partialMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" className="dc-btn-xl" onClick={confirmAll} disabled={busy}>
            <Check size={22} />
            {busy ? "กำลังยืนยัน…" : isModuleDest ? "✓ ยืนยันส่งถึง (ปิดใบ)" : `✓ ถึงแล้ว ครบ (${totalQty} ชิ้น)`}
          </button>
          {!isModuleDest && (
            <button
              type="button"
              className="dc-btn-xl dc-btn-xl--ghost"
              onClick={() => setPartialMode(true)}
              disabled={busy}
            >
              <AlertTriangle size={20} />
              ⚠ ไม่ครบ / เสียหาย — กรอกจำนวนรับจริง
            </button>
          )}
        </div>
      )}

      {isOpen && canReceive && partialMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" className="dc-btn-xl" onClick={confirmPartial} disabled={busy}>
            <Check size={22} />
            {busy ? "กำลังยืนยัน…" : "ยืนยันตามจำนวนรับจริง"}
          </button>
          <button
            type="button"
            className="dc-btn-xl dc-btn-xl--ghost"
            onClick={() => setPartialMode(false)}
            disabled={busy}
          >
            ยกเลิก — กลับไปรับครบ
          </button>
        </div>
      )}

      {/* ยกเลิกใบ (คืนของกลับต้นทาง) — เฉพาะผู้จัดการ */}
      {isOpen && canCancel && (
        <ConfirmDialog
          trigger={
            <button
              type="button"
              style={{
                background: "transparent",
                border: "none",
                color: "#c0392b",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                padding: "6px 0",
              }}
            >
              <XCircle size={16} /> ยกเลิกใบโอนนี้ (คืนของกลับคลังต้นทาง)
            </button>
          }
          title="ยกเลิกใบโอน?"
          body="ของจะถูกคืนกลับเข้าคลังต้นทาง และใบนี้จะถูกปิดเป็น “ยกเลิก” — ทำแล้วย้อนไม่ได้"
          confirmLabel="ยกเลิกใบโอน"
          onConfirm={doCancel}
        />
      )}
    </div>
  );
}

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};
