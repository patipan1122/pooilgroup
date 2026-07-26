"use client";

// คอลัมน์ 3 — ตัวดูรูปใบเสร็จ (พื้นดำ · หลายหน้า) ด้านบน + การ์ดประวัติผู้ขาย ด้านล่าง.
// พอร์ตจาก mockup claude.ai/design (คอลัมน์ขวา) แบบ pixel-exact — inline style ตรงตามต้นฉบับ.
// - รูปหน้า 1 = originalUrl (fallback thumbUrl) · หน้า 2..N = attachments ที่ kind==='page'.
// - PDF → การ์ด "เปิด PDF" (reuse แนว ReceiptThumb) · รูปพัง → สถานะจาง.
// - ประวัติผู้ขาย: อ่านล้วนผ่าน lookupPurchaseHistoryAction (ไม่มี write path).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { lookupPurchaseHistoryAction } from "../../_actions";
import type { ReceiptReviewData } from "./types";
import type { FieldConfidence } from "@/lib/ledger/types";

/** A receipt stored as PDF (e-tax invoice / supplier PDF) — can't render in <img>.
 *  ยกกฎเดียวกับ components/ledger/ReceiptThumb.tsx (isPdfUrl). */
function isPdfUrl(u: string | null | undefined): boolean {
  return !!u && /\.pdf(\?|#|$)/i.test(u);
}

/** ความมั่นใจรวม (%) จากค่า per-field ที่ AI อ่าน — เฉลี่ยค่าที่มี · ไม่มีเลย = null (ไม่กุตัวเลข). */
function overallConfidence(c: FieldConfidence | null | undefined): number | null {
  if (!c) return null;
  const vals = Object.values(c).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (vals.length === 0) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 100);
}

/** ISO (YYYY-MM-DD) → DD/MM/YY แบบ mockup ("05/06/26"). */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// hover สำหรับปุ่ม/ทัมบ์บนพื้นดำ — inline background จะชนะ :hover ของ class (specificity)
// ⇒ ต้องตั้ง background/border-color ผ่าน class เท่านั้น แล้ว :hover จึงมีผล.
const SCOPED_CSS = `
.rrv-btn{background:#374151}
.rrv-btn:hover{background:#4b5563}
.rrv-thumb{border-width:2px;border-style:solid}
.rrv-thumb-idle{border-color:#4b5563;background:#374151;color:#9ca3af}
.rrv-thumb-active{border-color:#60a5fa;background:#1d4ed8;color:#fff}
.rrv-thumb:hover{border-color:#93c5fd}
.rrv-addthumb{border:1.5px dashed #4b5563;color:#9ca3af}
.rrv-addthumb:hover{border-color:#93c5fd;color:#93c5fd}
.rrv-link:hover{text-decoration:underline}
`;

type HistoryHit = Awaited<ReturnType<typeof lookupPurchaseHistoryAction>>["hits"][number];

function histLabel(h: HistoryHit): string {
  const parts = [h.itemDescription, h.branchName].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.join(" · ") || h.vendor || h.docCode;
}

const VBTN: CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
};
const MUTED_ROW: CSSProperties = { fontSize: 11, color: "#94a3b8" };

export function RRReceiptColumn({ data }: { data: ReceiptReviewData }) {
  const exp = data.selectedExpense;
  const companyId = data.companyId;

  const [activePage, setActivePage] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<{ loading: boolean; hits: HistoryHit[] }>({
    loading: false,
    hits: [],
  });

  // รีเซ็ตสถานะ viewer เมื่อสลับใบ — page index/หมุน/ซูม ต้องไม่รั่วข้ามบิล.
  useEffect(() => {
    setActivePage(0);
    setZoom(false);
    setRotation(0);
    setBroken({});
  }, [exp?.id]);

  // ประวัติผู้ขาย — ยิง action เมื่อชื่อผู้ขาย/บริษัทเปลี่ยน (อ่านล้วน · กัน race ด้วย cancelled).
  const vendor = exp?.vendor ?? null;
  useEffect(() => {
    const v = (vendor ?? "").trim();
    if (!v) {
      setHistory({ loading: false, hits: [] });
      return;
    }
    let cancelled = false;
    setHistory({ loading: true, hits: [] });
    lookupPurchaseHistoryAction(v, companyId)
      .then((res) => {
        if (!cancelled) setHistory({ loading: false, hits: res.ok ? res.hits.slice(0, 3) : [] });
      })
      .catch(() => {
        if (!cancelled) setHistory({ loading: false, hits: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [vendor, companyId]);

  // หน้าของบิล: หน้า 1 = originalUrl (fallback thumbUrl) · หน้า 2..N = attachments kind:'page'.
  const pages: string[] = [];
  if (exp) {
    const first = exp.originalUrl || exp.thumbUrl;
    if (first) pages.push(first);
    for (const a of exp.attachments) {
      if (a.kind === "page" && a.url) pages.push(a.url);
    }
  }
  const total = pages.length;
  const safePage = total > 0 ? Math.min(activePage, total - 1) : 0;
  const curUrl = total > 0 ? pages[safePage] : null;
  const driveUrl = exp?.driveWebUrl || exp?.originalUrl || null;
  const pct = exp ? overallConfidence(exp.ocrConfidence) : null;
  const picLabel = `รูป ${total > 0 ? safePage + 1 : 0}/${total}`;

  const frameStyle: CSSProperties = {
    width: zoom ? "100%" : "74%",
    maxWidth: "100%",
    aspectRatio: "1 / 1.4",
    position: "relative",
    boxShadow: "0 12px 30px rgba(0,0,0,.45)",
    borderRadius: 4,
    overflow: "hidden",
    background: "#f8fafc",
  };

  // ── เนื้อในเวทีรูป ────────────────────────────────────────────────────────
  let stage: ReactNode;
  if (!exp) {
    stage = <div style={{ fontSize: 12, color: "#6b7280" }}>เลือกใบเพื่อดูรูป</div>;
  } else if (!curUrl) {
    stage = <div style={{ fontSize: 12, color: "#6b7280" }}>ไม่มีรูปใบเสร็จ</div>;
  } else if (isPdfUrl(curUrl)) {
    stage = (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 16,
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 46,
            height: 46,
            borderRadius: 12,
            background: "#fee2e2",
            color: "#dc2626",
          }}
        >
          <FileText size={22} aria-hidden />
        </span>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>เอกสาร PDF</div>
        <a
          href={curUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            background: "#0f172a",
            padding: "6px 12px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          <ExternalLink size={14} aria-hidden /> เปิด PDF
        </a>
      </div>
    );
  } else if (broken[curUrl]) {
    stage = <div style={{ fontSize: 12, color: "#6b7280" }}>โหลดรูปไม่ได้</div>;
  } else {
    stage = (
      <div style={frameStyle}>
        {/* R2 host varies; plain <img> avoids next/image domain config (เหมือน ReceiptThumb) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={curUrl}
          alt="ใบเสร็จ"
          loading="lazy"
          decoding="async"
          onError={() => setBroken((b) => ({ ...b, [curUrl]: true }))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: `rotate(${rotation}deg)`,
          }}
        />
      </div>
    );
  }

  // ── ประวัติผู้ขาย ─────────────────────────────────────────────────────────
  let historyBody: ReactNode;
  if (!exp) {
    historyBody = <div style={MUTED_ROW}>เลือกใบเพื่อดูประวัติ</div>;
  } else if (!(vendor && vendor.trim())) {
    historyBody = <div style={MUTED_ROW}>ใบนี้ยังไม่มีชื่อผู้ขาย</div>;
  } else if (history.loading) {
    historyBody = <div style={MUTED_ROW}>กำลังดึงประวัติ…</div>;
  } else if (history.hits.length === 0) {
    historyBody = <div style={MUTED_ROW}>ยังไม่มีประวัติซื้อจากผู้ขายรายนี้</div>;
  } else {
    historyBody = (
      <>
        {history.hits.map((h) => (
          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div className="rr-mono" style={{ fontSize: 10.5, color: "#94a3b8", flex: "none" }}>
              {fmtDate(h.docDate)}
            </div>
            <div
              style={{
                fontSize: 11.5,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {histLabel(h)}
            </div>
            <div className="rr-num" style={{ fontSize: 11.5, fontWeight: 600, flex: "none" }}>
              {fmtAmount(h.amount)}
            </div>
          </div>
        ))}
        {/* หมายเหตุ: ลิงก์ autofill (โชว์อย่างเดียว — โหมดตรวจใบเสร็จเป็น read-only ไม่เขียนอะไร) */}
        <div
          className="rrv-link"
          style={{ fontSize: 10.5, color: "#2563eb", fontWeight: 600, cursor: "pointer" }}
        >
          ใช้ค่าเดิมของใบล่าสุด (หมวด + สาขา + GL)
        </div>
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
      <style>{SCOPED_CSS}</style>

      {/* ── ตัวดูรูปใบเสร็จ (พื้นดำ) ─────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "#111827",
          border: "1px solid #dfe3ea",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* toolbar */}
        <div
          style={{
            height: 34,
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 9px",
            background: "#1f2937",
            color: "#e5e7eb",
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600 }}>ต้นฉบับ</div>
          {exp && <div style={{ fontSize: 10.5, color: "#9ca3af" }}>{picLabel}</div>}
          <div style={{ flex: 1 }} />
          {exp && total > 0 && (
            <>
              <div
                className="rrv-btn"
                style={VBTN}
                onClick={() => setActivePage((p) => Math.max(0, p - 1))}
              >
                ‹
              </div>
              <div
                className="rrv-btn"
                style={VBTN}
                onClick={() => setActivePage((p) => Math.min(total - 1, p + 1))}
              >
                ›
              </div>
              <div className="rrv-btn" style={VBTN} onClick={() => setZoom((z) => !z)}>
                {zoom ? "ย่อ" : "ขยาย"}
              </div>
              <div
                className="rrv-btn"
                style={VBTN}
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                หมุน
              </div>
              <div
                className="rrv-btn"
                style={VBTN}
                onClick={() => {
                  if (driveUrl) window.open(driveUrl, "_blank", "noopener,noreferrer");
                }}
              >
                Drive ↗
              </div>
            </>
          )}
        </div>

        {/* image stage */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: 9,
            display: "flex",
            alignItems: exp && curUrl ? "flex-start" : "center",
            justifyContent: "center",
            overflow: "auto",
          }}
        >
          {stage}
        </div>

        {/* thumbnail footer */}
        {exp && (
          <div
            style={{
              flex: "none",
              padding: "7px 9px",
              background: "#1f2937",
              borderTop: "1px solid #374151",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {pages.map((_, i) => (
              <div
                key={i}
                className={`rrv-thumb ${i === safePage ? "rrv-thumb-active" : "rrv-thumb-idle"}`}
                style={{
                  width: 34,
                  height: 44,
                  borderRadius: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                  cursor: "pointer",
                }}
                onClick={() => setActivePage(i)}
              >
                {i + 1}
              </div>
            ))}
            <div
              className="rrv-addthumb"
              style={{
                width: 34,
                height: 44,
                borderRadius: 5,
                fontSize: 15,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                cursor: "pointer",
              }}
            >
              +
            </div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 10, color: "#9ca3af", lineHeight: 1.4 }}>
              {pct != null ? (
                <>
                  ความมั่นใจรวม{" "}
                  <span style={{ color: "#fbbf24", fontWeight: 700 }}>{pct}%</span>
                  <br />
                </>
              ) : null}
              ลากรูปมาวางเพิ่มได้ · คลิกช่องขอบเหลือง = ไฮไลต์บนบิล
            </div>
          </div>
        )}
      </div>

      {/* ── การ์ดประวัติผู้ขาย (พื้นขาว) ─────────────────────────────────── */}
      <div
        style={{
          flex: "none",
          background: "#fff",
          border: "1px solid #dfe3ea",
          borderRadius: 12,
          padding: "9px 11px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 700 }}>ประวัติผู้ขายรายนี้</div>
        {historyBody}
      </div>
    </div>
  );
}
