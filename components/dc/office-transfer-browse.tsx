"use client";

// DC office · มุมมอง "ดูสินค้าเป็นรายการตามใบโอน" (read-only)
//   คู่ขนานกับ office-po-browse.tsx แต่ฝั่ง "ใบโอน" (ของที่รับเข้าคลังจากการโอนภายใน)
//   1) เปิด → listOfficeTransfersForBrowse(warehouseId) → ลิสต์ใบโอนที่รับเข้าคลังแล้ว
//   2) แตะใบ → getOfficeTransferFulfillment(transferId) → สินค้าในใบ + โอนมา/รับ/คงเหลือจริง + รูป
//   • อ่านอย่างเดียว · reuse action floor (manager ⊆ floor role) · style .dcx office

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Package, Truck, Search, Printer, ArrowRight } from "lucide-react";
import {
  listOfficeTransfersForBrowse,
  getOfficeTransferFulfillment,
} from "@/lib/dc/transfer-browse-actions";
import { DcThumb } from "@/components/dc/product-image";
import { PoProgressBar } from "@/components/dc/po-progress-bar";
import type {
  ReceivedTransferForBrowse,
  TransferFulfillment,
  TransferFulfillmentLine,
} from "@/lib/dc/transfer-fulfillment";

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

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("th-TH", {
      day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function OfficeTransferBrowse({ warehouseId, r2PublicUrl }: { warehouseId?: string; r2PublicUrl?: string }) {
  const [transfers, setTransfers] = useState<ReceivedTransferForBrowse[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [detail, setDetail] = useState<TransferFulfillment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // setState อยู่ใน async IIFE (ไม่ใช่ body ของ effect ตรง ๆ) → เลี่ยง react-hooks/set-state-in-effect
    void (async () => {
      setListLoading(true);
      setListError(null);
      try {
        const res = await listOfficeTransfersForBrowse(warehouseId);
        if (cancelled) return;
        if (!res.ok) {
          setListError(res.error);
          setTransfers([]);
        } else {
          setTransfers(res.transfers);
        }
      } catch {
        if (!cancelled) {
          setListError("โหลดรายการใบโอนไม่สำเร็จ ลองอีกครั้ง");
          setTransfers([]);
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const openTransfer = useCallback(async (transferId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setShowLog(false);
    try {
      const res = await getOfficeTransferFulfillment(transferId);
      if (!res.ok) {
        setDetailError(res.error);
        return;
      }
      setDetail(res.data);
    } catch {
      setDetailError("โหลดใบโอนไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return transfers;
    return transfers.filter((t) =>
      `${t.transferCode} ${t.fromName ?? ""} ${t.toName ?? ""}`.toLowerCase().includes(term),
    );
  }, [transfers, q]);

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
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-.01em" }}>{detail.transferCode}</div>
                  <div style={{ fontSize: 13.5, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <b style={{ color: "var(--ink)", fontWeight: 700 }}>{detail.fromName ?? "คลังต้นทาง"}</b>
                    <ArrowRight size={13} style={{ color: "var(--muted)" }} />
                    <b style={{ color: "var(--ink)", fontWeight: 700 }}>{detail.toName ?? "คลังปลายทาง"}</b>
                    <span style={{ color: "var(--muted)" }}>· รับเข้า {fmtDate(detail.receivedAt)} · {detail.lines.length} รายการ</span>
                  </div>
                </div>
                <a
                  href={`/dc/office/transfers/${detail.transferId}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: "#fff",
                    border: "1px solid var(--border)", borderRadius: 10, padding: "8px 13px", fontSize: 13,
                    fontWeight: 700, color: "var(--ink)", textDecoration: "none", whiteSpace: "nowrap",
                  }}
                >
                  <Printer size={15} /> ปริ้นเอกสาร
                </a>
              </div>

              {/* สรุป ส่ง/รับ/ขาด — CEO: ใบโอนต้องบอกโอนไปทั้งหมดเท่าไร ฝั่งรับเท่าไร ขาดเท่าไร */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <SummaryStat label="โอนไปทั้งหมด" value={detail.totals.sent} tone="ink" />
                <SummaryStat label="ฝั่งรับ" value={detail.totals.received} tone="accent" />
                <SummaryStat label="ขาด" value={detail.totals.shortage} tone={detail.totals.shortage > 0 ? "danger" : "muted"} />
              </div>

              {detail.status === "AUTO_UNVERIFIED" && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#b9781a", background: "#fff7e8", border: "1px solid #f0d9a8", borderRadius: 9, padding: "6px 10px", fontWeight: 600 }}>
                  ⚠ ใบนี้ระบบปิดอัตโนมัติ — ยังไม่มีคนยืนยันรับจริง เลข &quot;รับ&quot; จึงถือว่าครบตามที่ส่ง (ขาดจริงอาจต่างจากนี้)
                </div>
              )}

              {/* log เส้นทางใบโอน — จากไหน → ไปไหน · ใครส่ง/รับ · เมื่อไร */}
              <button
                type="button"
                onClick={() => setShowLog((v) => !v)}
                style={{
                  marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, background: "transparent",
                  border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: "var(--primary)",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {showLog ? "ซ่อน log การโอน" : "ดู log การโอน (จากไหน → ไปไหน)"}
              </button>
              {showLog && <TransferTrail detail={detail} />}
            </div>

            {detail.lines.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, background: "#f7f8fb", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 13px", marginBottom: 12 }}>
                <b style={{ color: "var(--ink)" }}>คงเหลือจริง</b> (เลขตัวใหญ่) = ของจริงในคลังปลายทางตอนนี้ ·{" "}
                แถวเล็กด้านล่างคือที่มา: <b style={{ color: "var(--ink)" }}>โอนมา</b> → <b style={{ color: "var(--ink)" }}>รับ</b> (รับเข้าจริง)
              </div>
            )}

            {detail.lines.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14, background: "#fff", border: "1px solid var(--border)", borderRadius: 14 }}>
                ใบนี้ไม่มีรายการสินค้า
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detail.lines.map((l) => (
                  <TransferLineCard key={l.productId} line={l} imgSrc={imageSrc(l.imageR2Path, r2PublicUrl)} />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ── ลิสต์ใบโอน ──
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid var(--border)", borderRadius: 11, padding: "11px 14px", marginBottom: 14 }}>
        <Search size={17} color="#9A9082" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาเลขใบโอน / คลัง…"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: "var(--ink)" }}
        />
      </div>

      {listError ? (
        <div style={{ padding: 32, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>{listError}</div>
      ) : listLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 15 }}>กำลังโหลด…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 15, background: "#fff", border: "1px solid var(--border)", borderRadius: 14 }}>
          {transfers.length === 0 ? "ยังไม่มีใบโอนที่รับเข้าคลัง" : "ไม่พบใบโอนที่ค้นหา"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
          {filtered.map((t) => (
            <button
              key={t.transferId}
              type="button"
              onClick={() => void openTransfer(t.transferId)}
              style={{
                display: "flex", flexDirection: "column", gap: 8,
                textAlign: "left", width: "100%", border: "1px solid var(--border)", background: "#fff",
                borderRadius: 14, padding: "14px 16px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, width: "100%" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 16, fontWeight: 800, color: "var(--ink)", lineHeight: 1.25 }}>
                    <Truck size={16} color="var(--primary)" /> {t.transferCode}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3 }}>
                    {(t.fromName ?? "คลังต้นทาง") + " → " + (t.toName ?? "คลังปลายทาง")} · รับเข้า {fmtDate(t.receivedAt)}
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
                  <Package size={15} /> {t.lineCount} รายการ
                </div>
              </div>
              <div style={{ width: "100%" }}>
                <PoProgressBar value={t.totalReceived} total={t.totalSent} label="รับ" unit="ชิ้น" compact />
                {t.totalSent - t.totalReceived > 0 ? (
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "#c0392b", marginTop: 3 }}>
                    ขาด {t.totalSent - t.totalReceived} ชิ้น
                  </div>
                ) : t.status === "AUTO_UNVERIFIED" ? (
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "#b9781a", marginTop: 3 }}>
                    ยังไม่ยืนยันรับ
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// การ์ดสินค้า 1 รายการในใบโอน (read-only)
//   • ตัวเอก = "คงเหลือจริง" ที่คลังปลายทาง (onHand) เลขใหญ่ + สีสถานะ (เขียว>0 / แดงหมด)
//   • ที่มาของยอด (โอนมา→รับ) = แถวสรุปย่อ ตัวเล็ก สีจาง
function TransferLineCard({ line, imgSrc }: { line: TransferFulfillmentLine; imgSrc: string | null }) {
  const inStock = line.onHand > 0;
  const hero = inStock
    ? { bg: "#eafaf0", fg: "#1e8e4e", bd: "#bfe6cd" }
    : { bg: "#fdecea", fg: "#c0392b", bd: "#f5c6c0" };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid var(--border)", borderRadius: 14, padding: 12 }}>
      <DcThumb url={imgSrc} alt={line.name} size={52} />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--ink)", lineHeight: 1.25 }}>{line.name}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 1 }}>{line.sku}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--ink2)", overflowX: "auto", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          <FlowStep label="โอนมา" value={line.sent} />
          <span style={{ color: "var(--muted)", opacity: 0.6 }}>→</span>
          <FlowStep label="รับ" value={line.received} accent />
          {line.shortage > 0 && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, marginLeft: 2, padding: "1px 8px", borderRadius: 999, background: "#fdecea", border: "1px solid #f5c6c0" }}>
              <span style={{ color: "#c0392b", fontSize: 11, fontWeight: 600 }}>ขาด</span>
              <b style={{ color: "#c0392b", fontWeight: 800, fontSize: 12.5 }}>{line.shortage}</b>
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0, minWidth: 78, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "8px 12px", borderRadius: 12, background: hero.bg, border: `1px solid ${hero.bd}`,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: hero.fg, opacity: 0.85, whiteSpace: "nowrap", lineHeight: 1 }}>คงเหลือจริง</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: hero.fg, lineHeight: 1.1, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{line.onHand}</div>
        {!inStock && <div style={{ fontSize: 10.5, fontWeight: 700, color: hero.fg, marginTop: 1 }}>หมด</div>}
      </div>
    </div>
  );
}

function FlowStep({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <b style={{ fontWeight: 700, fontSize: 13, color: accent ? "var(--primary)" : "var(--ink)" }}>{value}</b>
    </span>
  );
}

// การ์ดสรุปตัวเลข ส่ง/รับ/ขาด ในหัวใบ (โทน: ink=ปกติ · accent=รับ · danger=ขาด>0 · muted=ขาด0)
function SummaryStat({ label, value, tone }: { label: string; value: number; tone: "ink" | "accent" | "danger" | "muted" }) {
  const color =
    tone === "danger" ? "#c0392b" : tone === "accent" ? "var(--primary)" : tone === "muted" ? "var(--muted)" : "var(--ink)";
  return (
    <div style={{ flex: "1 1 92px", minWidth: 92, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 12px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1.15, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

// log เส้นทางใบโอน: ส่งออก (ต้นทาง·ผู้ส่ง·เวลา) → รับเข้า (ปลายทาง·ผู้รับ·เวลา) + หมายเหตุ
function TransferTrail({ detail }: { detail: TransferFulfillment }) {
  return (
    <div style={{ marginTop: 10, background: "#f7f8fb", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <TrailStep
        icon="out"
        title="ส่งออก"
        place={detail.fromName ?? "คลังต้นทาง"}
        who={detail.dispatchedByName}
        when={fmtDateTime(detail.dispatchedAt)}
      />
      <div style={{ height: 14, borderLeft: "2px dashed var(--border)", marginLeft: 9 }} />
      <TrailStep
        icon="in"
        title="รับเข้า"
        place={detail.toName ?? "คลังปลายทาง"}
        who={detail.confirmedByName}
        when={detail.confirmedAt ? fmtDateTime(detail.confirmedAt) : null}
        pending={!detail.confirmedAt}
      />
      {detail.note && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink2)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <b style={{ color: "var(--ink)" }}>หมายเหตุ:</b> {detail.note}
        </div>
      )}
    </div>
  );
}

function TrailStep({
  icon, title, place, who, when, pending = false,
}: { icon: "out" | "in"; title: string; place: string; who: string | null; when: string | null; pending?: boolean }) {
  const dot = pending ? "#c9a227" : icon === "out" ? "#6b7785" : "#1e8e4e";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ width: 18, height: 18, borderRadius: 999, flexShrink: 0, marginTop: 1, background: dot, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        {icon === "out" ? <Truck size={11} color="#fff" /> : <Package size={11} color="#fff" />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{title} · {place}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
          {pending ? "ยังไม่ได้รับ / รอปลายทางยืนยัน" : `${who ?? "—"} · ${when ?? "—"}`}
        </div>
      </div>
    </div>
  );
}
