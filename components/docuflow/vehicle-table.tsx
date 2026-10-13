// VehicleTable — desktop-only table view for the fleet list
// ────────────────────────────────────────────────────────────────────
// CEO Pinpoint item #10 (2026-10-13): "/docuflow/vehicles wants a real
// sortable/filterable TABLE instead of cards, plus click-through to a
// vehicle's attached documents." Per the UI persona's explicit call in
// the synthesis spec — VehicleCard stays the CANONICAL MOBILE layout,
// this is an ADDITIVE `lg:`+ enhancement, not a replacement (a 5-column
// table is unreadable under ~1024px without horizontal scroll, and the
// card already reads well on phones — no reason to regress that).
//
// Reuses the exact same VehicleCardVm the card renders from — one data
// shape, two presentations, so this never drifts out of sync with the
// card's own worst-status logic.
//
// Real <table>/<thead>/<tbody> semantics (not div-grid rows) per the UI
// persona's a11y requirement. Sticky header reuses the existing
// `.df-sticky-head` token from docuflow.css (solid background so rows
// don't show through while the head is pinned) — same convention as
// /docuflow/audit's day-group header, just applied to an actual <thead>
// here since this page has a real table instead of a flat event list.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { thaiDateLong } from "@/lib/utils/format";
import type { ExpiryStatus } from "@/lib/vehicles/data";
import type { VehicleCardVm } from "./vehicle-card";

const TONE_CLASS: Record<ExpiryStatus | "missing", string> = {
  expired: "text-rose-700 bg-rose-50 border-rose-200",
  critical: "text-rose-700 bg-rose-50 border-rose-200",
  urgent: "text-amber-800 bg-amber-50 border-amber-200",
  watch: "text-sky-800 bg-sky-50 border-sky-200",
  ok: "text-emerald-700 bg-emerald-50 border-emerald-200",
  no_expiry: "text-zinc-600 bg-zinc-50 border-zinc-200",
  missing: "text-zinc-600 bg-zinc-50 border-zinc-200",
};

export function VehicleTable({ rows }: { rows: VehicleCardVm[] }) {
  return (
    <div
      className="hidden lg:block rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--df-line)", background: "var(--df-surface)" }}
    >
      {/* Bounded scroll container (not just overflowX) — `position:sticky`
          with no scrollable ancestor pins to the VIEWPORT edge instead of
          the table's own edge once the page scrolls past it (a real bug
          hit before on a `display:grid` child — see
          [[feedback-sticky-position-grid-child-pins-on-first-paint-2026-09-30]]).
          A fixed max-height + overflowY makes the table itself the
          scrolling ancestor the sticky header resolves against. */}
      <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
        <table
          style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            {/* Sticky header: position:sticky goes on each <th> (not the
                <tr> — browsers don't reliably stick table ROWS, only
                cells), but the solid background needs to live on the same
                sticky cell too, or the body rows show through underneath
                it while pinned. `.df-sticky-head` (docuflow.css) supplies
                that background token; applied on both the row (for the
                non-sticky visual baseline) and repeated inline on each
                cell (for while it's actually pinned mid-scroll). */}
            <tr className="df-sticky-head">
              <Th style={STICKY_TH_STYLE}>ทะเบียน</Th>
              <Th style={STICKY_TH_STYLE}>ประเภท</Th>
              <Th style={STICKY_TH_STYLE}>วันหมดอายุ</Th>
              <Th style={STICKY_TH_STYLE}>สาขา / บริษัท</Th>
              <Th center style={STICKY_TH_STYLE}>
                เอกสาร
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((vm, i) => {
              const worstDoc = vm.docs.find((d) => d.status === vm.worstStatus);
              return (
                <tr
                  key={vm.id}
                  style={{
                    borderTop: "1px solid var(--df-line)",
                    background: i % 2 === 0 ? "var(--df-surface)" : "var(--df-surface-soft)",
                  }}
                >
                  <td style={cellStyle}>
                    <span className="font-bold tabular-nums text-zinc-900">
                      {vm.licensePlate}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span className="whitespace-nowrap">
                      {vm.vehicleTypeEmoji} {vm.vehicleTypeLabel}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap",
                        TONE_CLASS[vm.worstStatus],
                      )}
                    >
                      {vm.worstStatusLabel}
                    </span>
                    {worstDoc?.expiryDate && (
                      <span className="block text-[11px] text-zinc-500 mt-1">
                        {thaiDateLong(worstDoc.expiryDate)}
                      </span>
                    )}
                  </td>
                  <td style={cellStyle}>
                    <div className="text-zinc-800">{vm.branchLabel ?? "—"}</div>
                    {vm.companyLabel && (
                      <div className="text-[11px] text-zinc-500">{vm.companyLabel}</div>
                    )}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "center" }}>
                    <Link
                      href={`/docuflow/vehicles/${vm.id}`}
                      className="inline-flex items-center gap-1 font-semibold text-xs"
                      style={{ color: "var(--df-brand)" }}
                    >
                      <FileText size={13} />
                      ดูเอกสาร
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "10px 14px" };

const STICKY_TH_STYLE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "var(--df-surface-soft)",
};

function Th({
  children,
  center,
  style,
}: {
  children: React.ReactNode;
  center?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: center ? "center" : "left",
        fontSize: 11,
        fontWeight: 700,
        color: "var(--df-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        ...style,
      }}
    >
      {children}
    </th>
  );
}
