"use client";

// DC · มุมมอง "รายการ + รายละเอียด" (master-detail · ค่าเริ่มต้นของ workspace):
//   ซ้าย  = ลิสต์ใบแบบการ์ดกระชับ + ชิปกรองสถานะ + ป้าย "รอใส่ข้อมูล"
//   ขวา   = แผงรายละเอียดใบที่เลือก (โหลดสดผ่าน getPoDetailForPanel → render <PoDetail>)
// คลิกการ์ด → setSelected(id) → โหลด bundle (useTransition + skeleton) → แสดงในแผงขวา.
// onChanged ของ <PoDetail> = refetch bundle ของใบนั้น + router.refresh() ลิสต์ (สถานะ/ป้ายอัปเดต).

import { useEffect, useState, useTransition, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getPoDetailForPanel, type PoPanelBundle } from "@/lib/dc/po-actions";
import { PO_STATUS_LABEL, PO_STATUS_TONE, PO_FLOW_STATUSES, PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import { PoDetail } from "./[id]/po-detail";
import {
  type PoListItem,
  fmtMoney,
  fmtDate,
  moneySym,
  needsInput,
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
  const [bundle, setBundle] = useState<PoPanelBundle | null>(null);
  const [loading, startLoad] = useTransition();

  const loadBundle = useCallback((id: string) => {
    startLoad(async () => {
      const b = await getPoDetailForPanel(id);
      setBundle(b);
    });
  }, []);

  // ถ้าใบที่เลือกหลุดออกจากลิสต์ที่กรอง → เด้งไปใบแรกของลิสต์ใหม่
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((it) => it.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

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
                onSelect={() => setSelectedId(it.id)}
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

// ── การ์ดใบกระชับ (ลิสต์ซ้าย) ─────────────────────────────────
function PoCardMini({
  item,
  active,
  onSelect,
}: {
  item: PoListItem;
  active: boolean;
  onSelect: () => void;
}) {
  const s = moneySym(item);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`dc-pur-card${active ? " is-active" : ""}`}
    >
      <div className="dc-pur-card__top">
        <span className="dc-pur-card__supplier">{item.supplierName ?? "— ไม่ระบุผู้ขาย —"}</span>
        <span className={`dc-st dc-st--${item.origin === "THAI" ? "ok" : "ship"}`} style={{ fontSize: 10.5, padding: "2px 7px" }}>
          {PO_ORIGIN_LABEL[item.origin] ?? item.origin}
        </span>
      </div>
      <div className="dc-pur-card__meta">
        {item.poCode} · {item.lineCount} รายการ
        {item.boxCount > 0 ? ` · ${item.boxCount} กล่อง` : ""} · {fmtDate(item.date)}
      </div>
      <div className="dc-pur-card__bottom">
        <span className="dc-pur-card__total">
          {s}
          {fmtMoney(item.total)}
        </span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {needsInput(item) && <span className="dc-pur-badge-input">รอใส่ข้อมูล</span>}
          <span className={`dc-st dc-st--${tone(item.status)}`}>{PO_STATUS_LABEL[item.status] ?? item.status}</span>
        </span>
      </div>
    </button>
  );
}

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
