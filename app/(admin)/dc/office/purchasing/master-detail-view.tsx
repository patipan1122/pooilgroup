"use client";

// DC · มุมมอง "รายการ + รายละเอียด" (master-detail · ค่าเริ่มต้นของ workspace):
//   ซ้าย  = ลิสต์ใบแบบการ์ดกระชับ + ชิปกรองสถานะ + ป้าย "รอใส่ข้อมูล"
//   ขวา   = แผงรายละเอียดใบที่เลือก (โหลดสดผ่าน getPoDetailForPanel → render <PoDetail>)
// คลิกการ์ด → setSelected(id) → โหลด bundle (useTransition + skeleton) → แสดงในแผงขวา.
// onChanged ของ <PoDetail> = refetch bundle ของใบนั้น + router.refresh() ลิสต์ (สถานะ/ป้ายอัปเดต).

import { useEffect, useState, useTransition, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ship, Truck, ChevronDown, ImageIcon, CalendarDays, ArrowUpRight } from "lucide-react";
import { getPoDetailForPanel, type PoPanelBundle } from "@/lib/dc/po-actions";
import { PO_STATUS_LABEL, PO_STATUS_TONE, PO_FLOW_STATUSES, PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import { PoDetail } from "./[id]/po-detail";
import { DcDocDownload } from "@/components/dc/print-controls";
import {
  type PoListItem,
  fmtMoney,
  fmtDate,
  moneySym,
  needsInput,
  arrivalEstimate,
  shipModeLabel,
} from "./purchasing-workspace";

const ALL = "__ALL__";

function tone(status: string): string {
  return PO_STATUS_TONE[status] ?? "draft";
}

export function MasterDetailView({
  items,
  canManage,
  r2PublicUrl,
}: {
  items: PoListItem[];
  canManage: boolean;
  r2PublicUrl: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>(ALL);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (filter === ALL ? items : items.filter((it) => it.status === filter)),
    [items, filter],
  );

  // ใบที่เลือก (ตั้งต้น = ใบแรกในลิสต์ที่กรองแล้ว)
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  // ใบที่ "กางดูสินค้า" อยู่ (accordion ในการ์ด) — มือถือดูได้เลยไม่ต้องเลื่อนไปแผงล่าง
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<PoPanelBundle | null>(null);
  const [loading, startLoad] = useTransition();

  const loadBundle = useCallback((id: string) => {
    startLoad(async () => {
      const b = await getPoDetailForPanel(id);
      setBundle(b);
    });
  }, []);

  // คงใบที่เลือกไว้เสมอถ้ามันยัง "อยู่ในระบบ" (items) — แม้เปลี่ยนสถานะจนหลุด "ชิปกรอง"
  //   เดิม: เช็คกับ filtered → พอกดเลื่อนสถานะ ใบหลุดชิป → เด้งไปใบแรก (แผงขวากระโดดไปใบอื่น)
  //   ตอนนี้: เด้งไปใบใหม่เฉพาะเมื่อใบที่เลือกหายจากระบบจริง (ถูกลบ) หรือยังไม่เคยเลือก
  useEffect(() => {
    if (selectedId && items.some((it) => it.id === selectedId)) return; // ใบยังอยู่ → คงไว้
    setSelectedId(filtered.length > 0 ? filtered[0].id : null);
  }, [items, filtered, selectedId]);

  // โหลด bundle ทุกครั้งที่ใบที่เลือกเปลี่ยน
  useEffect(() => {
    if (!selectedId) {
      setBundle(null);
      return;
    }
    loadBundle(selectedId);
  }, [selectedId, loadBundle]);

  // onChanged จาก <PoDetail>: โหลด bundle ใบนี้ใหม่ + refresh ลิสต์ (สถานะ/ป้ายอัปเดต)
  const handleChanged = useCallback(() => {
    if (selectedId) loadBundle(selectedId);
    router.refresh();
  }, [selectedId, loadBundle, router]);

  return (
    <div className="dc-pur-md">
      {/* ── ซ้าย: ลิสต์ใบ ── */}
      <div className="dc-pur-md__list">
        <div className="dc-chips dc-pur-md__chips" role="tablist" aria-label="กรองสถานะใบสั่งซื้อ">
          <button
            type="button"
            role="tab"
            aria-selected={filter === ALL}
            className={`dc-chip${filter === ALL ? " is-active" : ""}`}
            onClick={() => setFilter(ALL)}
          >
            ทั้งหมด <span style={{ opacity: 0.7 }}>· {items.length}</span>
          </button>
          {PO_FLOW_STATUSES.map((s) =>
            counts[s] ? (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={filter === s}
                className={`dc-chip${filter === s ? " is-active" : ""}`}
                onClick={() => setFilter(s)}
              >
                {PO_STATUS_LABEL[s] ?? s} <span style={{ opacity: 0.7 }}>· {counts[s]}</span>
              </button>
            ) : null,
          )}
        </div>

        <div className="dc-pur-md__cards">
          {filtered.length === 0 ? (
            <div className="dc-pur-md__empty">ไม่มีใบสั่งซื้อในสถานะนี้</div>
          ) : (
            filtered.map((it) => (
              <PoCardMini
                key={it.id}
                item={it}
                active={it.id === selectedId}
                expanded={it.id === expandedId}
                onToggle={() => {
                  setSelectedId(it.id); // อัปเดตแผงขวา (desktop) ด้วย
                  setExpandedId((prev) => (prev === it.id ? null : it.id));
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── ขวา: แผงรายละเอียด ── */}
      <div className="dc-pur-md__panel">
        {!selectedId ? (
          <div className="dc-card dc-pur-md__placeholder">เลือกใบสั่งซื้อทางซ้ายเพื่อดูรายละเอียด</div>
        ) : loading && !bundle ? (
          <PanelSkeleton />
        ) : !bundle ? (
          <div className="dc-card dc-pur-md__placeholder">โหลดรายละเอียดใบนี้ไม่สำเร็จ — ลองเลือกใหม่อีกครั้ง</div>
        ) : (
          <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
            <PoDetail
              data={bundle.data}
              payments={bundle.payments}
              goodsPaid={bundle.goodsPaid}
              thaiFreightPaid={bundle.thaiFreightPaid}
              goodsOwedSatang={bundle.goodsOwedSatang}
              freightOwedSatang={bundle.freightOwedSatang}
              freightRatesConfigured={bundle.freightRatesConfigured}
              warehouses={bundle.warehouses}
              canManage={canManage}
              r2PublicUrl={r2PublicUrl || bundle.r2PublicUrl}
              onChanged={handleChanged}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── การ์ดใบ "เตี้ย/แน่น" (ลิสต์ซ้าย · CEO #9 ลดความสูง) ───────────────
//   2 บรรทัด: บน = ผู้ขาย + ยอด · ล่าง = poCode·รายการ·วันที่ + สถานะ (origin ย่อเป็นจุดสี)
//   override .dc-pur-card ให้ padding/gap เล็กลง (ลิสต์ scan ได้เยอะขึ้นในจอเดียว)
function PoCardMini({
  item,
  active,
  expanded,
  onToggle,
}: {
  item: PoListItem;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const s = moneySym(item);
  const isThai = item.origin === "THAI";
  const est = arrivalEstimate(item);
  const ModeIcon = item.shipMode === "TRUCK" ? Truck : Ship;
  return (
    <div style={{ display: "grid", gap: expanded ? 4 : 0 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        aria-expanded={expanded}
        className={`dc-pur-card${active ? " is-active" : ""}`}
        style={{ gap: 3, padding: "8px 11px", borderRadius: 11 }}
        title={`${PO_ORIGIN_LABEL[item.origin] ?? item.origin} · ${item.poCode}`}
      >
        {/* บน: ผู้ขาย (+จุดสี origin) · ยอด */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
            <span
              aria-hidden
              title={PO_ORIGIN_LABEL[item.origin] ?? item.origin}
              style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: 999, background: isThai ? "#167a41" : "#2456b8" }}
            />
            <span className="dc-pur-card__supplier" style={{ fontSize: 14 }}>
              {item.supplierName ?? "— ไม่ระบุผู้ขาย —"}
            </span>
          </span>
          <span className="dc-pur-card__total" style={{ fontSize: 14, flex: "0 0 auto" }}>
            {s}
            {fmtMoney(item.total, 0)}
          </span>
        </div>
        {/* กลาง: meta ย่อ + สถานะ + ลูกศรกาง */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: "var(--dc-muted, #5b6676)", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {item.poCode} · {item.lineCount} รก.{item.boxCount > 0 ? ` · ${item.boxCount} กล่อง` : ""}
          </span>
          <span style={{ display: "inline-flex", gap: 5, alignItems: "center", flex: "0 0 auto" }}>
            {needsInput(item) && <span className="dc-pur-badge-input" style={{ fontSize: 10, padding: "1px 7px" }}>รอใส่</span>}
            <span className={`dc-st dc-st--${tone(item.status)}`} style={{ fontSize: 11, padding: "2px 8px" }}>
              {PO_STATUS_LABEL[item.status] ?? item.status}
            </span>
            <ChevronDown size={15} aria-hidden style={{ color: "var(--dc-muted,#5b6676)", transition: "transform .15s", transform: expanded ? "rotate(180deg)" : "none" }} />
          </span>
        </div>
        {/* ล่าง (ใหม่): วันสั่ง + คาดว่าจะถึง (เรือ/รถ) — บรรทัดเล็ก */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--dc-muted,#5b6676)", flexWrap: "wrap", lineHeight: 1.3 }}>
          <CalendarDays size={12} aria-hidden style={{ flex: "0 0 auto" }} />
          <span>สั่ง {fmtDate(item.orderedAt ?? item.date)}</span>
          {est ? (
            <>
              <span aria-hidden>·</span>
              <ModeIcon size={12} aria-hidden style={{ flex: "0 0 auto" }} />
              <span style={{ color: "#1d4ed8", fontWeight: 600 }}>
                {shipModeLabel(item.shipMode)} {est.label}
              </span>
            </>
          ) : needsInput(item) ? (
            <>
              <span aria-hidden>·</span>
              <span>รอเลขพัสดุ (ประเมินวันถึงไม่ได้)</span>
            </>
          ) : null}
        </div>
      </button>

      {/* accordion: รายการสินค้าในใบ (กางดูในการ์ด — มือถือไม่ต้องเลื่อนไปแผงล่าง) */}
      {expanded && (
        <div style={expandBody}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--dc-muted,#5b6676)", marginBottom: 7 }}>
            สินค้าในใบ ({item.lineCount})
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {item.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={expandThumb}>
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt={l.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <ImageIcon size={14} color="#8a94a3" />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--dc-ink,#1c2533)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.name}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--dc-muted,#5b6676)", fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>×{l.qty}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", flex: "0 0 auto", minWidth: 54, textAlign: "right" }}>
                  {s}{fmtMoney(l.qty * l.unitPrice, 0)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
            <DcDocDownload
              pngHref={`/dc/office/purchasing/${item.id}/image`}
              printHref={`/dc/office/purchasing/${item.id}/print`}
            />
            <Link href={`/dc/office/purchasing/${item.id}`} style={{ ...expandOpen, marginTop: 0 }}>
              เปิดใบเต็ม <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

const expandBody: React.CSSProperties = {
  border: "1px solid var(--dc-line, #e7ebf2)",
  borderRadius: 11,
  padding: "10px 11px",
  background: "var(--color-brand-50, #f7faff)",
};
const expandThumb: React.CSSProperties = {
  flex: "0 0 auto",
  width: 28,
  height: 28,
  borderRadius: 6,
  overflow: "hidden",
  background: "#fff",
  border: "1px solid var(--dc-line,#e7ebf2)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const expandOpen: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  marginTop: 9,
  fontSize: 12.5,
  fontWeight: 700,
  color: "#1d4ed8",
  textDecoration: "none",
};

// ── skeleton ระหว่างโหลดแผงขวา ───────────────────────────────
function PanelSkeleton() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="dc-card" style={{ display: "grid", gap: 10 }}>
        <div className="dc-skel dc-skel--title" />
        <div className="dc-skel dc-skel--line" style={{ width: "60%" }} />
        <div className="dc-skel dc-skel--line" style={{ width: "45%" }} />
      </div>
      <div className="dc-skel dc-skel--card" />
      <div className="dc-skel dc-skel--card" />
    </div>
  );
}
