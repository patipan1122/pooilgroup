"use client";

// Reconcile v2 left sidebar (280px) — mockup `BranchSidebar` parity.
// Client island ONLY for the live search filter; navigation is plain <Link>
// so the rest of the screen stays server-rendered (URL drives branch + view).
//
// Rows: "ทุกสาขารวม" pinned at top (org) · then branch rows with status dot +
// cumulative-drift chip (color by sign). Active row gets the accent left edge
// via [data-active] (see reconcile-v2.css).

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LayoutGrid, Search, EyeOff, RotateCcw, Send } from "lucide-react";
import type { ReconcileSidebarRow } from "@/lib/chairops/queries/reconcile-v2";
import {
  toggleBranchClosedAction,
  bulkSendDepositsToReconcileAction,
} from "@/lib/chairops/reconcile/actions";

function fmtCumDrift(n: number): string {
  const r = Math.round(n);
  // cumDrift = -(driftAmount): negative = shortage, positive = surplus.
  // Show "ค้างฝาก X" so office staff aren't confused by "−5,168".
  if (r < 0) return `ค้างฝาก ${Math.abs(r).toLocaleString("en-US")}`;
  if (r > 0) return `+${r.toLocaleString("en-US")}`;
  return "ปกติ";
}

/**
 * Positive-only formatter for the "ค้างฝากรวม" aggregate (no sign prefix).
 * Per CEO ruling 2026-06-02, the org-row aggregate is always ≥ 0 — a single
 * branch surplus does not pay back another branch's shortage.
 */
function fmtShortage(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function cumClass(n: number): string {
  if (n < -500) return "crit";
  if (n < -100) return "warn";
  return "muted";
}

/**
 * CEO 2026-07-01 · "กี่วันไม่ได้เก็บ" badge + color signal on each branch.
 * เก็บวันนี้/1 วัน = เขียว (สด) · 2–3 วัน = เหลือง · 4 วันขึ้นไป/ไม่เคยเก็บ = แดง.
 */
function daysBadge(days: number): { text: string; tone: "fresh" | "mid" | "stale" } {
  if (days >= 999) return { text: "ไม่เคยเก็บ", tone: "stale" };
  if (days === 0) return { text: "เก็บวันนี้", tone: "fresh" };
  if (days <= 1) return { text: `${days} วัน`, tone: "fresh" };
  if (days <= 3) return { text: `${days} วัน`, tone: "mid" };
  return { text: `${days} วัน`, tone: "stale" };
}

export function ReconcileSidebar({
  rows,
  activeBranchId,
  orgCumShortage,
  view,
  canManage = false,
}: {
  rows: ReconcileSidebarRow[];
  activeBranchId: string | null;
  /**
   * Canonical positive-only "ค้างฝากรวมทุกสาขา" aggregate (always ≥ 0).
   * Comes from `getCumulativeShortage(orgId)` so it matches the exec home
   * tile and the reconcile hero exactly (CEO ruling 2026-06-02 · CONF-05).
   */
  orgCumShortage: number;
  view: string;
  /** CEO 2026-07-01 · super_admin only — show the ปิด/เปิดสาขา button per row. */
  canManage?: boolean;
}) {
  const [q, setQ] = useState("");
  const [pending, startTransition] = useTransition();

  const handleToggleClosed = (branchId: string, closed: boolean) => {
    startTransition(async () => {
      await toggleBranchClosedAction(branchId, closed);
    });
  };

  // CEO 2026-09-09 (Pinpoint) · โหมดเลือกหลายสาขาแล้วส่งเข้า reconcile ทีเดียว —
  // แทนที่ต้องเปิดทีละสาขากดปุ่มส่งเอง. เลือกได้เฉพาะสาขาที่ตั้งค่าบัญชีธนาคารแล้ว
  // + ยังไม่ปิด/ย้าย (เหมือน bulkEligible ใน write-off-selection-shell.tsx).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendPending, startSendTransition] = useTransition();

  const eligibleIds = useMemo(
    () =>
      rows.filter((r) => r.reconcileConfigured && !r.isClosed).map((r) => r.branchId),
    [rows],
  );
  const allEligibleSelected =
    eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
  const partialSelected = selected.size > 0 && !allEligibleSelected;

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelected(new Set());
  };

  const toggleOneBranch = (branchId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });

  const toggleAllEligible = () =>
    setSelected(allEligibleSelected ? new Set() : new Set(eligibleIds));

  const handleBulkSend = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    startSendTransition(async () => {
      const r = await bulkSendDepositsToReconcileAction(ids);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const parts = [`ส่งสำเร็จ ${r.sentCount} สาขา`];
      if (r.skippedCount > 0) parts.push(`ข้าม ${r.skippedCount} สาขา (ไม่มีรายการใหม่)`);
      if (r.errorCount > 0) parts.push(`พลาด ${r.errorCount} สาขา`);
      if (r.errorCount > 0) toast.error(parts.join(" · "));
      else toast.success(parts.join(" · "));
      setSelected(new Set());
      setSelectMode(false);
    });
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.mallLabel.toLowerCase().includes(query),
    );
  }, [q, rows]);

  const viewQs = view && view !== "ledger" ? `?view=${view}` : "";

  return (
    <aside className="rc-sidebar">
      <div className="rc-sidebar-head">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Reconcile</div>
            <div className="text-3" style={{ fontSize: 11 }}>
              {rows.length} สาขา
            </div>
          </div>
          <button
            type="button"
            className="rc-side-selectbtn"
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
            title={
              selectMode
                ? "ออกจากโหมดเลือกส่ง"
                : "เลือกหลายสาขาเพื่อส่งเข้า reconcile"
            }
          >
            <Send size={13} aria-hidden="true" />
          </button>
        </div>
        <div className="rc-sidebar-search">
          <Search size={13} aria-hidden="true" />
          <input
            placeholder="ค้นหาสาขา…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="ค้นหาสาขา"
          />
        </div>
        {selectMode && (
          <label className="rc-selectall-row">
            <input
              type="checkbox"
              checked={allEligibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = partialSelected;
              }}
              onChange={toggleAllEligible}
              disabled={eligibleIds.length === 0}
            />
            เลือกทั้งหมด ({eligibleIds.length} สาขาที่ตั้งค่าบัญชีแล้ว)
          </label>
        )}
      </div>
      <div className="rc-sidebar-list">
        {/* ทุกสาขารวม — pinned org row */}
        <Link
          href={`/chairops/reconcile${viewQs}`}
          className="rc-side-row rc-side-org"
          data-active={activeBranchId === null ? "" : undefined}
        >
          <div className="rc-side-icon">
            <LayoutGrid size={14} aria-hidden="true" />
          </div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="rc-side-name">ทุกสาขารวม</div>
            <div className="text-3" style={{ fontSize: 11 }}>
              {rows.length} สาขา · ค้างฝากรวม {fmtShortage(orgCumShortage)} ฿
            </div>
          </div>
        </Link>

        {filtered.map((b) => {
          const badge = daysBadge(b.daysSinceCollect);
          return (
            <div
              key={b.branchId}
              className="rc-side-rowwrap"
              data-closed={b.isClosed ? "" : undefined}
            >
              {selectMode && (
                <div className="rc-side-check">
                  <input
                    type="checkbox"
                    aria-label={`เลือกสาขา ${b.name} เพื่อส่งเข้า reconcile`}
                    checked={selected.has(b.branchId)}
                    onChange={() =>
                      b.reconcileConfigured && !b.isClosed && toggleOneBranch(b.branchId)
                    }
                    disabled={!b.reconcileConfigured || b.isClosed}
                    title={
                      b.isClosed
                        ? "สาขาปิด/ย้ายแล้ว"
                        : !b.reconcileConfigured
                          ? "ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคาร — ตั้งค่าที่หน้าสาขานี้ก่อน"
                          : "เลือกเพื่อส่งเข้า reconcile"
                    }
                  />
                </div>
              )}
              <Link
                href={`/chairops/reconcile/${b.branchId}${viewQs}`}
                className="rc-side-row"
                data-active={activeBranchId === b.branchId ? "" : undefined}
              >
                <div className="rc-side-dot" data-status={b.status} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="rc-side-name">{b.name}</div>
                  <div style={{ marginTop: 2 }}>
                    {b.isClosed ? (
                      <span className="rc-days-badge closed">ปิด/ย้ายแล้ว</span>
                    ) : (
                      <span className={"rc-days-badge " + badge.tone}>
                        {badge.text}
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className={"rc-side-cum mono co-drift " + cumClass(b.cumDrift)}
                >
                  {fmtCumDrift(b.cumDrift)}
                </div>
              </Link>
              {canManage && (
                <button
                  type="button"
                  className="rc-side-close"
                  disabled={pending}
                  onClick={() => handleToggleClosed(b.branchId, !b.isClosed)}
                  title={
                    b.isClosed ? "เปิดสาขาคืน" : "ปิดสาขา (ย้าย/เลิกกิจการ)"
                  }
                  aria-label={b.isClosed ? "เปิดสาขาคืน" : "ปิดสาขา"}
                >
                  {b.isClosed ? <RotateCcw size={13} /> : <EyeOff size={13} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {selectMode && selected.size > 0 && (
        <div className="rc-bulk-bar">
          <div className="rc-bulk-bar-count">เลือกแล้ว {selected.size} สาขา</div>
          <button
            type="button"
            className="rc-bulk-bar-clear"
            onClick={() => setSelected(new Set())}
          >
            ล้างที่เลือก
          </button>
          <button
            type="button"
            className="rc-bulk-bar-send"
            disabled={sendPending}
            onClick={handleBulkSend}
          >
            {sendPending ? "กำลังส่ง…" : `ส่งเข้า reconcile (${selected.size})`}
          </button>
        </div>
      )}
    </aside>
  );
}
