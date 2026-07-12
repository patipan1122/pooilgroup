"use client";

// DC · หลังบ้าน · แถวใบโอนแบบ "กางดูบรรทัดในตัว" (inline-expand) — client child ของ page.tsx (server).
//
//   • page.tsx (server) โหลด list หัวใบ → ส่ง base rows มาเป็น props (ไม่มี query ที่นี่).
//   • กดแถว/ปุ่ม chevron → กางแผงบรรทัดสินค้าใต้แถว · โหลด lazy ครั้งแรก (getTransferDetail).
//   • ชื่อใบยังเป็น <Link> ไปหน้าเต็ม (กดชื่อ = เปิดเต็มหน้า · กด chevron = กางในตัว).
//   • ในแผงมีปุ่มพิมพ์ (DcDocDownload) — reuse route /image (PNG) + /print (PDF) เดิม ไม่สร้างใหม่.
//
// ส่งออก <TransferExpandPanel> ให้ floor view reuse ด้วย (แผงบรรทัด + ปุ่มพิมพ์ตัวเดียวกัน).

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { DcThumb } from "@/components/dc/product-image";
import { DcDeleteButton } from "@/app/(admin)/dc/_components/dc-delete-button";
import { DcDocDownload } from "@/components/dc/print-controls";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import {
  getTransferDetail,
  type TransferDetail,
  type TransferDetailLine,
} from "@/app/(admin)/dc/transfers/transfer-detail-action";

// tone ป้ายสถานะ — เดียวกับ page.tsx
const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  DISPATCHED: "info",
  IN_TRANSIT: "warning",
  CONFIRMED: "success",
  AUTO_UNVERIFIED: "danger",
  CANCELLED: "neutral",
};

/** แถวใบโอน (หัวใบ) ที่ page.tsx ส่งมาเป็น props — ตรงกับ select ใน page.tsx. */
export type OfficeTransferRow = {
  id: string;
  transferCode: string;
  status: string;
  fromName: string;
  destName: string;
  sameSite: boolean;
  lineCount: number;
  dispatchedAtLabel: string;
  firstImageUrl: string | null;
  isInTransit: boolean;
};

// ── per-line สถานะ (จาก qty vs qtyReceived) ──────────────────────────────
//   ยังไม่รับ (qtyReceived==null) = "รอรับ" · รับครบ = "ครบ" · รับขาด = "ขาด N"
function lineStatus(l: TransferDetailLine): { label: string; tone: "neutral" | "success" | "warning" } {
  if (l.qtyReceived == null) return { label: "รอรับ", tone: "neutral" };
  if (l.qtyReceived >= l.qty) return { label: "ครบ", tone: "success" };
  return { label: `ขาด ${l.qty - l.qtyReceived}`, tone: "warning" };
}

/**
 * แผงบรรทัดสินค้า + ปุ่มพิมพ์ (shared — floor view reuse ตัวนี้ด้วย).
 * โหลด detail lazy ครั้งแรกที่กาง · โชว์ loading/empty/error graceful.
 */
export function TransferExpandPanel({ transferId }: { transferId: string }) {
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      const res = await getTransferDetail(transferId);
      if (res.ok) setDetail(res.detail);
      else setError(res.error);
    });
  }, [transferId]);

  // โหลดครั้งแรกเมื่อ mount (component ถูก render เฉพาะตอน "กาง" เท่านั้น = lazy)
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      style={{
        padding: "12px 14px 14px",
        background: "#fafafa",
        borderTop: "1px dashed var(--dc-line, #e7ebf2)",
      }}
    >
      {pending && detail == null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#71717a", fontSize: 13, padding: "8px 0" }}>
          <Loader2 size={16} className="animate-spin" /> กำลังโหลดรายการสินค้า…
        </div>
      ) : error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "#b91c1c", fontSize: 13, padding: "6px 0" }}>
          <span>โหลดไม่สำเร็จ: {error}</span>
          <button
            type="button"
            onClick={load}
            style={{ border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            ลองใหม่
          </button>
        </div>
      ) : detail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {detail.lines.length === 0 ? (
            <div style={{ color: "#71717a", fontSize: 13 }}>ไม่มีรายการสินค้าในใบนี้</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#71717a" }}>
                    <th style={lineHead}></th>
                    <th style={lineHead}>สินค้า</th>
                    <th style={{ ...lineHead, textAlign: "right" }}>ส่ง</th>
                    <th style={{ ...lineHead, textAlign: "right" }}>รับแล้ว</th>
                    <th style={lineHead}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => {
                    const st = lineStatus(l);
                    return (
                      <tr key={l.id} style={{ borderTop: "1px solid #eef0f3" }}>
                        <td style={{ ...lineCell, width: 44 }}>
                          <DcThumb url={l.imageUrl} alt={l.name} size={36} />
                        </td>
                        <td style={lineCell}>
                          <div style={{ fontWeight: 600, color: "#27272a" }}>{l.name}</div>
                          <div style={{ color: "#a1a1aa", fontSize: 11 }}>{l.sku}</div>
                        </td>
                        <td style={{ ...lineCell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                          {l.qty} {l.unit}
                        </td>
                        <td style={{ ...lineCell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                          {l.qtyReceived == null ? "—" : `${l.qtyReceived} ${l.unit}`}
                        </td>
                        <td style={lineCell}>
                          <StatusPill tone={st.tone} size="sm" dot>
                            {st.label}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <DcDocDownload
              pngHref={`/dc/office/transfers/${detail.id}/image`}
              printHref={`/dc/office/transfers/${detail.id}/print`}
              pngLabel="ปริ้นใบโอน (รูป)"
              pdfLabel="ปริ้นใบโอน (PDF)"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const lineHead: React.CSSProperties = { padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" };
const lineCell: React.CSSProperties = { padding: "8px 10px", verticalAlign: "middle" };

const cell: React.CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/**
 * ตารางแถวใบโอน (client) — page.tsx ส่ง rows + canDelete มา · เรนเดอร์แถวกางได้.
 */
export function TransfersOfficeRows({
  rows,
  canDelete,
}: {
  rows: OfficeTransferRow[];
  canDelete: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
            <th style={{ ...cellHead, width: 36 }}></th>
            <th style={{ ...cellHead, width: 52 }}></th>
            <th style={cellHead}>เลขที่</th>
            <th style={cellHead}>ต้นทาง → ปลายทาง</th>
            <th style={{ ...cellHead, textAlign: "right" }}>รายการ</th>
            <th style={cellHead}>สถานะ</th>
            <th style={cellHead}>ส่งเมื่อ</th>
            {canDelete && <th style={{ ...cellHead, textAlign: "right" }}>ลบ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const open = openId === t.id;
            const colSpan = canDelete ? 8 : 7;
            return (
              <Fragment key={t.id}>
                <tr
                  onClick={() => setOpenId(open ? null : t.id)}
                  style={{
                    borderTop: "1px solid var(--dc-line, #f0f0f2)",
                    background: open ? "#f4f6fb" : t.isInTransit ? "#fffbf5" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <td style={{ ...cell, width: 36, color: "#71717a" }}>
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </td>
                  <td style={{ ...cell, width: 52 }} onClick={(e) => e.stopPropagation()}>
                    <DcThumb url={t.firstImageUrl} alt={t.transferCode} size={40} />
                  </td>
                  <td style={cell} onClick={(e) => e.stopPropagation()}>
                    <Link
                      href={`/dc/office/transfers/${t.id}`}
                      style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {t.transferCode}
                    </Link>
                  </td>
                  <td style={{ ...cell, color: "#52525b" }}>
                    {t.fromName}
                    <span style={{ margin: "0 6px", color: "#a1a1aa" }}>→</span>
                    <strong style={{ color: "#3f3f46" }}>{t.destName}</strong>
                    {t.sameSite ? <span style={{ marginLeft: 6, fontSize: 12, color: "#16a34a" }}>(อยู่ที่เดียวกัน)</span> : null}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {t.lineCount}
                  </td>
                  <td style={cell}>
                    <StatusPill tone={STATUS_TONE[t.status] ?? "neutral"} size="sm" dot>
                      {TRANSFER_STATUS_LABEL[t.status] ?? t.status}
                    </StatusPill>
                  </td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>{t.dispatchedAtLabel}</td>
                  {canDelete && (
                    <td style={{ ...cell, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <DcDeleteButton docType="transfer" docId={t.id} docCode={t.transferCode} size="sm" />
                    </td>
                  )}
                </tr>
                {open && (
                  <tr>
                    <td colSpan={colSpan} style={{ padding: 0 }}>
                      <TransferExpandPanel transferId={t.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
