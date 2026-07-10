"use client";

// DC · ประวัติใบนับ — client
//   • รายการใบนับ (การ์ด): เลขที่ · วันที่/เวลา · ใครนับ · #รายการ · ส่วนต่างรวม (ขาด/เกิน)
//   • กดใบ → เปิดแผ่นรายละเอียด (getCountSheet): สินค้า | ระบบมี | นับได้ | ขาด/เกิน + หมายเหตุ + ใครนับ
//   mobile-first: การ์ดกดง่าย · แผ่น bottom-sheet เลื่อนดูได้.

import { useEffect, useState } from "react";
import { X, ClipboardList, User, CalendarClock } from "lucide-react";
import {
  getCountSheet,
  type CountSheetSummary,
  type CountSheetDetail,
} from "@/lib/dc/count-actions";

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** ป้ายส่วนต่างรวม: 0 = ตรง (เขียวจาง) · +เกิน (เขียว) · −ขาด (แดง) */
function NetVarianceBadge({ net }: { net: number }) {
  const tone =
    net === 0
      ? { bg: "#eef2f7", fg: "var(--dc-muted)", label: "ตรงพอดี" }
      : net > 0
        ? { bg: "#eaf6ee", fg: "#1f8a4c", label: `เกินรวม +${net}` }
        : { bg: "#fdecec", fg: "#c0392b", label: `ขาดรวม ${net}` };
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12.5,
        fontWeight: 700,
        color: tone.fg,
        background: tone.bg,
        borderRadius: 8,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {tone.label}
    </span>
  );
}

export function CountHistoryView({ initialSheets }: { initialSheets: CountSheetSummary[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (initialSheets.length === 0) {
    return (
      <div className="dc-card" style={{ textAlign: "center", padding: 40, color: "var(--dc-muted)" }}>
        <ClipboardList size={30} style={{ opacity: 0.5, marginBottom: 8 }} />
        <div style={{ fontSize: 14.5 }}>ยังไม่มีใบนับในคลังนี้</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>ไปที่หน้า “นับสต๊อก” นับแล้วกด “บันทึกใบนับ” จะขึ้นที่นี่</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {initialSheets.map((s) => (
        <button
          key={s.countId}
          type="button"
          onClick={() => setOpenId(s.countId)}
          className="dc-card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
            textAlign: "left",
            cursor: "pointer",
            border: "1.5px solid var(--dc-line)",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontWeight: 800, fontSize: 15.5, color: "var(--dc-ink)" }}>{s.countCode}</span>
            <NetVarianceBadge net={s.netVariance} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 13, color: "var(--dc-muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <CalendarClock size={14} /> {fmtDateTime(s.countedAt)}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <User size={14} /> {s.actorName ?? "—"}
            </span>
            <span>{s.lineCount} รายการ</span>
          </div>
        </button>
      ))}

      {openId && <CountDetailSheet countId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ====================================================================
// แผ่นรายละเอียดใบนับ (bottom-sheet)
// ====================================================================
function CountDetailSheet({ countId, onClose }: { countId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CountSheetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // โหลดรายละเอียดตอนเปิด
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getCountSheet(countId);
      if (cancelled) return;
      if (res.ok) setDetail(res.sheet);
      else setError(res.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [countId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="รายละเอียดใบนับ"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "rgba(20,28,45,0.32)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--dc-paper)",
          width: "100%",
          maxWidth: 760,
          maxHeight: "90vh",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -8px 34px rgba(20,40,90,0.22)",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "16px 16px 12px",
            borderBottom: "1px solid var(--dc-line)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "var(--dc-ink)" }}>
              {detail ? detail.countCode : "ใบนับ"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--dc-muted)" }}>
              {detail
                ? `${fmtDateTime(detail.countedAt)} · ${detail.actorName ?? "—"}${detail.warehouseName ? ` · คลัง ${detail.warehouseName}` : ""}`
                : "กำลังโหลด…"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 10,
              border: "1.5px solid var(--dc-line)",
              background: "var(--dc-paper)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: "var(--dc-muted)",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* note */}
        {detail?.note && (
          <div style={{ padding: "10px 16px 0", fontSize: 13.5, color: "var(--dc-ink)" }}>
            <span style={{ color: "var(--dc-muted)", fontWeight: 700 }}>หมายเหตุ:</span> {detail.note}
          </div>
        )}

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 8px 8px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)", fontSize: 14 }}>กำลังโหลด…</div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: 28, color: "#c0392b", fontSize: 14 }}>{error}</div>
          ) : !detail ? null : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr>
                    <ThD style={{ textAlign: "left", paddingLeft: 14 }}>สินค้า</ThD>
                    <ThD style={{ textAlign: "right" }}>ระบบมี</ThD>
                    <ThD style={{ textAlign: "right" }}>นับได้</ThD>
                    <ThD style={{ textAlign: "right", paddingRight: 14 }}>ขาด/เกิน</ThD>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l, i) => {
                    const vColor = l.variance > 0 ? "#1f8a4c" : l.variance < 0 ? "#c0392b" : "var(--dc-muted)";
                    return (
                      <tr key={`${l.productId}-${i}`}>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--dc-line)", minWidth: 180 }}>
                          <div style={{ fontWeight: 650, fontSize: 14.5, color: "var(--dc-ink)", lineHeight: 1.25 }}>{l.name}</div>
                          <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 1 }}>{l.sku}</div>
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--dc-line)", textAlign: "right", whiteSpace: "nowrap", color: "var(--dc-ink)", fontWeight: 600 }}>
                          {l.systemQty}
                          {l.unit ? <span style={{ color: "var(--dc-muted)", fontWeight: 400, fontSize: 12.5 }}> {l.unit}</span> : null}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--dc-line)", textAlign: "right", whiteSpace: "nowrap", color: "var(--dc-ink)", fontWeight: 700 }}>
                          {l.countedQty}
                        </td>
                        <td style={{ padding: "10px 12px 10px 12px", paddingRight: 14, borderBottom: "1px solid var(--dc-line)", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: vColor }}>
                          {l.variance === 0 ? "ตรง" : `${l.variance > 0 ? "+" : ""}${l.variance} ${l.variance > 0 ? "เกิน" : "ขาด"}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding: "12px 12px", textAlign: "right", fontWeight: 700, color: "var(--dc-muted)" }}>
                      ส่วนต่างรวม
                    </td>
                    <td style={{ padding: "12px 14px 12px 12px", textAlign: "right", fontWeight: 800, color: detail.netVariance > 0 ? "#1f8a4c" : detail.netVariance < 0 ? "#c0392b" : "var(--dc-muted)" }}>
                      {detail.netVariance === 0 ? "ตรงพอดี" : `${detail.netVariance > 0 ? "+" : ""}${detail.netVariance}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ padding: "10px 16px 16px", borderTop: "1px solid var(--dc-line)" }}>
          <button type="button" className="dc-btn-xl" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

function ThD({ children, style, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      style={{
        fontSize: 12.5,
        fontWeight: 700,
        color: "var(--dc-muted)",
        padding: "11px 12px",
        borderBottom: "1.5px solid var(--dc-line)",
        whiteSpace: "nowrap",
        background: "var(--dc-canvas)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}
