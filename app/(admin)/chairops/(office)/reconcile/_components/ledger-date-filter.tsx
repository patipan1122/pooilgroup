// Reconcile v2 · Ledger date-range filter (CEO 2026-06-02 ask).
//
// Plain server-rendered link strip — every preset rewrites the URL with
// `?from`/`?to`/`?view=ledger`. Custom range goes through a tiny client
// island so the date inputs can submit on change without a full form.
//
// Conventions:
//   • "ครบรอบ POS" = posCoverThrough — used as the inclusive end-of-range so
//     filters never include partially-uploaded days.
//   • Presets are anchored to posCoverThrough, NOT today, because POS often
//     trails the calendar by a day or two and CEO explicitly said:
//     "default ให้ดูข้อมูลวันล่าสุดที่อัพ data ตาม POS ได้เลย".
//   • Custom dates clamp to posCoverThrough — preventing accidental selection
//     of "tomorrow" or unimported days.

import Link from "next/link";
import { Calendar, Clock, ChevronDown } from "lucide-react";
import { LedgerDateFilterCustom } from "./ledger-date-filter-custom";

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildHref(base: string, args: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  usp.set("view", "ledger");
  for (const [k, v] of Object.entries(args)) {
    if (v) usp.set(k, v);
  }
  return `${base}?${usp.toString()}`;
}

export function LedgerDateFilter({
  baseHref,
  from,
  to,
  posCoverThrough,
}: {
  baseHref: string;
  from: string | null;
  to: string | null;
  posCoverThrough: string | null;
}) {
  // If POS hasn't been uploaded yet, presets degrade to "no filter" (current
  // behavior = newest 200 days reversed).
  const anchor = posCoverThrough;
  const presets = anchor
    ? [
        { label: "7 วันล่าสุด", from: isoMinusDays(anchor, 6), to: anchor },
        { label: "30 วันล่าสุด", from: isoMinusDays(anchor, 29), to: anchor },
        { label: "90 วัน", from: isoMinusDays(anchor, 89), to: anchor },
        { label: "ทั้งหมด", from: undefined, to: undefined },
      ]
    : [];

  const activeKey = !from && !to ? "default" : `${from ?? ""}|${to ?? ""}`;

  return (
    <div
      className="card"
      style={{
        margin: "12px 22px 0",
        padding: "10px 14px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
      }}
    >
      <span
        className="text-3"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
        }}
      >
        <Calendar size={12} aria-hidden="true" />
        ช่วงเวลา
      </span>

      {presets.map((p) => {
        const key = `${p.from ?? ""}|${p.to ?? ""}`;
        const active =
          (key === "|" && activeKey === "default") || key === activeKey;
        return (
          <Link
            key={p.label}
            href={buildHref(baseHref, { from: p.from, to: p.to })}
            className="btn btn-sm"
            style={
              active
                ? {
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    borderColor: "var(--accent)",
                  }
                : undefined
            }
            scroll={false}
          >
            {p.label}
          </Link>
        );
      })}

      <LedgerDateFilterCustom
        baseHref={baseHref}
        from={from}
        to={to}
        max={anchor}
      />

      {anchor && (
        <span
          className="text-3"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
          }}
        >
          <Clock size={11} aria-hidden="true" />
          POS ครบถึง <strong className="mono">{anchor}</strong> · filter
          ใช้ได้แค่วันที่ POS อัพแล้ว
        </span>
      )}
    </div>
  );
}
