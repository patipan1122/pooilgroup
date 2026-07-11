"use client";

// DC office · มุมมอง "ดูสินค้าเป็นรายการตามใบ PO" (read-only · Pinpoint #8)
//   1) เปิด → listPosForMoveAction(warehouseId) → ลิสต์ใบ PO ที่รับเข้าคลังแล้ว
//   2) แตะใบ → getPoFulfillmentAction(poId, warehouseId) → สินค้าในใบ + สั่ง/รับเข้า/เบิก-โอนแล้ว/เหลือในใบ/คงเหลือจริง + รูป
//   • อ่านอย่างเดียว (หน้า office = ดูภาพรวม) · reuse action floor (manager ⊆ floor role) · style .dcx office
//   • ผู้จัดการดูได้ว่าแต่ละใบ PO ของมากี่รายการ เหลือในใบเท่าไร ของจริงในคลังเท่าไร

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Package, FileText, Search } from "lucide-react";
import { listPosForMoveAction, getPoFulfillmentAction } from "@/lib/dc/po-move-actions";
import { DcThumb } from "@/components/dc/product-image";
import type { ReceivablePoForMove, PoFulfillment, PoFulfillmentLine } from "@/lib/dc/po-fulfillment";

function imageSrc(path: string | null, base?: string): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  if (!base) return null;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}

export function OfficePoBrowse({ warehouseId, r2PublicUrl }: { warehouseId?: string; r2PublicUrl?: string }) {
  const [pos, setPos] = useState<ReceivablePoForMove[]>([]);
  const [posLoading, setPosLoading] = useState(true);
  const [posError, setPosError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [detail, setDetail] = useState<PoFulfillment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPosLoading(true);
    setPosError(null);
    void (async () => {
      try {
        const res = await listPosForMoveAction(warehouseId);
        if (cancelled) return;
        if (!res.ok) {
          setPosError(res.error);
          setPos([]);
        } else {
          setPos(res.pos);
        }
      } catch {
        if (!cancelled) {
          setPosError("โหลดรายการใบ PO ไม่สำเร็จ ลองอีกครั้ง");
          setPos([]);
        }
      } finally {
        if (!cancelled) setPosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const openPo = useCallback(
    async (poId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const res = await getPoFulfillmentAction(poId, warehouseId);
        if (!res.ok) {
          setDetailError(res.error);
          return;
        }
        setDetail(res.data);
      } catch {
        setDetailError("โหลดใบ PO ไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        setDetailLoading(false);
      }
    },
    [warehouseId],
  );

  const filteredPos = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return pos;
    return pos.filter((p) => `${p.poCode} ${p.supplierName ?? ""}`.toLowerCase().includes(term));
  }, [pos, q]);

  // ── รายละเอียดใบที่เลือก ──
  if (detail || detailLoading || detailError) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setDetail(null);
            setDetailError(null);
          }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14,
            background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
            padding: "8px 13px", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit",
            cursor: "pointer", color: "var(--ink)",
          }}
        >
          <ChevronLeft size={16} /> เลือกใบอื่น
        </button>

        {detailLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 15 }}>กำลังโหลดใบ…</div>
        ) : detailError ? (
          <div style={{ padding: 32, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>{detailError}</div>
        ) : detail ? (
          <div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-.01em" }}>{detail.poCode}</div>
              <div style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 3 }}>
                {detail.supplierName ?? "ไม่ระบุผู้ขาย"} · {detail.lines.length} รายการในใบ
              </div>
            </div>

            {detail.lines.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14, background: "#fff", border: "1px solid var(--border)", borderRadius: 14 }}>
                ใบนี้ไม่มีรายการสินค้า
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detail.lines.map((l) => (
                  <PoLineCard key={l.productId} line={l} imgSrc={imageSrc(l.imageR2Path, r2PublicUrl)} />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ── ลิสต์ใบ PO ──
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid var(--border)", borderRadius: 11, padding: "11px 14px", marginBottom: 14 }}>
        <Search size={17} color="#9A9082" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาเลขใบ PO / ผู้ขาย…"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: "var(--ink)" }}
        />
      </div>

      {posError ? (
        <div style={{ padding: 32, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>{posError}</div>
      ) : posLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 15 }}>กำลังโหลด…</div>
      ) : filteredPos.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 15, background: "#fff", border: "1px solid var(--border)", borderRadius: 14 }}>
          {pos.length === 0 ? "ยังไม่มีใบ PO ที่รับเข้าคลัง" : "ไม่พบใบ PO ที่ค้นหา"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
          {filteredPos.map((p) => (
            <button
              key={p.poId}
              type="button"
              onClick={() => void openPo(p.poId)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                textAlign: "left", width: "100%", border: "1px solid var(--border)", background: "#fff",
                borderRadius: 14, padding: "14px 16px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 16, fontWeight: 800, color: "var(--ink)", lineHeight: 1.25 }}>
                  <FileText size={16} color="var(--primary)" /> {p.poCode}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3 }}>
                  {p.supplierName ?? "ไม่ระบุผู้ขาย"} · รับเข้า {fmtDate(p.receivedAt)}
                </div>
              </div>
              <div style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
                <Package size={15} /> {p.lineCount} รายการ
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// การ์ดสินค้า 1 รายการในใบ PO (read-only) — รูป + ชื่อ + chips ยอด
function PoLineCard({ line, imgSrc }: { line: PoFulfillmentLine; imgSrc: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid var(--border)", borderRadius: 14, padding: 12 }}>
      <DcThumb url={imgSrc} alt={line.name} size={52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--ink)", lineHeight: 1.25 }}>{line.name}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 1 }}>{line.sku}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <PoChip label="สั่ง" value={line.ordered} />
          <PoChip label="รับเข้า" value={line.received} />
          <PoChip label="เบิก/โอนแล้ว" value={line.movedOut} />
          <PoChip label="เหลือในใบ" value={line.remaining} tone="brand" />
          <PoChip label="คงเหลือจริง" value={line.onHand} tone={line.onHand > 0 ? "ok" : "warn"} />
        </div>
      </div>
    </div>
  );
}

function PoChip({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "brand" | "ok" | "warn" }) {
  const palette: Record<string, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: "var(--surf2, #f4f5f8)", fg: "var(--muted, #6b7280)", bd: "var(--border, #e6e8ee)" },
    brand: { bg: "#eef3fe", fg: "#1d4ed8", bd: "#c7d7fb" },
    ok: { bg: "#eafaf0", fg: "#1e8e4e", bd: "#bfe6cd" },
    warn: { bg: "#fdecea", fg: "#c0392b", bd: "#f5c6c0" },
  };
  const c = palette[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: "nowrap" }}>
      {label} <b style={{ fontWeight: 800, fontSize: 13.5 }}>{value}</b>
    </span>
  );
}
