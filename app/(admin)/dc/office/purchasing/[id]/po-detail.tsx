"use client";

// DC · รายละเอียดใบสั่งซื้อจีน + ปุ่มดำเนินการตามสถานะ:
//   DRAFT          → ส่งขออนุมัติ / ยกเลิก
//   PENDING_APPROVAL → อนุมัติ (canDcManage) / ยกเลิก
//   APPROVED       → ทำเครื่องหมายว่าสั่งแล้ว / ยกเลิก
//   ORDERED/อื่น ๆ → ไม่มีปุ่ม (จบ flow ฝั่งสั่งซื้อ)
// แต่ละปุ่มเรียก server action ผ่าน useTransition + ยืนยันก่อนทำงานที่กระทบเงิน.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon } from "lucide-react";
import {
  submitPo,
  approvePo,
  markOrdered,
  cancelPo,
  type PoActionResult,
} from "@/lib/dc/po-actions";
import { PO_STATUS_LABEL } from "@/lib/dc/nav";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

export type PoLineData = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unitPriceCny: number;
  unitPriceThb: number | null;
  photoR2Key: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  cbmPerUnit: number | null;
  note: string | null;
};

export type PoDetailData = {
  id: string;
  poCode: string;
  status: string;
  currency: string;
  fxRate: number | null;
  note: string | null;
  supplierName: string | null;
  warehouseName: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  createdAt: string;
  lines: PoLineData[];
};

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  ORDERED: "brand",
  PARTIAL: "brand",
  CLOSED: "success",
  CANCELLED: "danger",
};

function fmt(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function PoDetail({
  data,
  canManage,
  r2PublicUrl,
}: {
  data: PoDetailData;
  canManage: boolean;
  r2PublicUrl: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalCny = data.lines.reduce((s, l) => s + l.qty * l.unitPriceCny, 0);
  const totalThb = data.fxRate != null ? totalCny * data.fxRate : null;
  const totalCbm = data.lines.reduce((s, l) => s + (l.cbmPerUnit != null ? l.qty * l.cbmPerUnit : 0), 0);

  function run(action: () => Promise<PoActionResult>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function photoUrl(key: string): string {
    if (/^https?:\/\//.test(key)) return key;
    return r2PublicUrl ? `${r2PublicUrl}/${key}` : key;
  }

  const status = data.status;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* หัวใบ + ปุ่มดำเนินการ */}
      <div className="dc-card" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <StatusPill tone={STATUS_TONE[status] ?? "neutral"} dot>
              {PO_STATUS_LABEL[status] ?? status}
            </StatusPill>
            <div style={{ display: "grid", gap: 2, fontSize: 14, color: "#52525b", marginTop: 4 }}>
              <div>ผู้ขาย: <b style={{ color: "#18181b" }}>{data.supplierName ?? "—"}</b></div>
              <div>คลังปลายทาง: {data.warehouseName ?? "—"}</div>
              {data.note && <div>โน้ต: {data.note}</div>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "DRAFT" && (
              <Button size="lg" loading={pending} onClick={() => run(() => submitPo(data.id))}>
                ส่งขออนุมัติ
              </Button>
            )}
            {status === "PENDING_APPROVAL" && canManage && (
              <Button
                size="lg"
                loading={pending}
                onClick={() => run(() => approvePo(data.id), "ยืนยันอนุมัติใบสั่งซื้อนี้? (เป็นการอนุมัติเงินออก)")}
              >
                อนุมัติ
              </Button>
            )}
            {status === "APPROVED" && (
              <Button
                size="lg"
                loading={pending}
                onClick={() => run(() => markOrdered(data.id), "ยืนยันว่าได้สั่งซื้อกับผู้ขายแล้ว?")}
              >
                สั่งแล้ว
              </Button>
            )}
            {(status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED") && (
              <Button
                size="lg"
                variant="danger"
                loading={pending}
                onClick={() => run(() => cancelPo(data.id), "ยืนยันยกเลิกใบสั่งซื้อนี้?")}
              >
                ยกเลิกใบ
              </Button>
            )}
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>{error}</p>
        )}

        {/* รอยทาง: ใคร/เมื่อไหร่ */}
        <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#71717a", borderTop: "1px solid var(--dc-line, #f0f0f2)", paddingTop: 12, fontVariantNumeric: "tabular-nums" }}>
          <div>สร้างโดย: {data.createdBy ?? "—"} · {fmtDateTime(data.createdAt)}</div>
          {data.approvedBy && <div>อนุมัติโดย: <b style={{ color: "#18181b" }}>{data.approvedBy}</b> · {fmtDateTime(data.approvedAt)}</div>}
          {data.orderedAt && <div>สั่งเมื่อ: {fmtDateTime(data.orderedAt)}</div>}
        </div>
      </div>

      {/* รายการสินค้า */}
      <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
              <th style={cellHead}>รูป</th>
              <th style={cellHead}>สินค้า</th>
              <th style={{ ...cellHead, textAlign: "right" }}>จำนวน</th>
              <th style={{ ...cellHead, textAlign: "right" }}>ราคา/หน่วย</th>
              <th style={cellHead}>ขนาด (ซม.)</th>
              <th style={{ ...cellHead, textAlign: "right" }}>CBM/ชิ้น</th>
              <th style={{ ...cellHead, textAlign: "right" }}>รวม (CNY)</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const lineCny = l.qty * l.unitPriceCny;
              const dims = [l.lengthCm, l.widthCm, l.heightCm].every((d) => d != null)
                ? `${l.lengthCm}×${l.widthCm}×${l.heightCm}`
                : "—";
              return (
                <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    {l.photoR2Key ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl(l.photoR2Key)}
                        alt={l.name}
                        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: "1px solid var(--dc-line, #e4e4e7)" }}
                      />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 8, border: "1px dashed var(--dc-line, #d4d4d8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#c4c4cc" }}>
                        <ImageIcon size={18} />
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{l.sku}</div>
                    {l.note && <div style={{ fontSize: 12, color: "#a1a1aa" }}>{l.note}</div>}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {l.qty} {l.unit}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    ¥{fmt(l.unitPriceCny)}
                    {l.unitPriceThb != null && (
                      <div style={{ fontSize: 12, color: "#a1a1aa" }}>฿{fmt(l.unitPriceThb)}</div>
                    )}
                  </td>
                  <td style={{ ...cell, fontVariantNumeric: "tabular-nums", color: "#52525b" }}>{dims}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {l.cbmPerUnit != null ? fmt(l.cbmPerUnit, 6) : "—"}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    ¥{fmt(lineCny)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--dc-line, #e4e4e7)", background: "#fafafa" }}>
              <td style={cell} colSpan={5}>
                <b>รวมทั้งใบ</b>
                <span style={{ fontSize: 12, color: "#71717a", marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>
                  ปริมาตร ~{fmt(totalCbm, 4)} m³
                </span>
              </td>
              <td style={cell}></td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>¥{fmt(totalCny)}</div>
                {totalThb != null && (
                  <div style={{ fontSize: 12, color: "#71717a" }}>≈ ฿{fmt(totalThb)}</div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
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
