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

function buildHref(
  base: string,
  args: { from?: string; to?: string; all?: boolean },
): string {
  const usp = new URLSearchParams();
  usp.set("view", "ledger");
  if (args.all) {
    usp.set("all", "1");
  } else {
    if (args.from) usp.set("from", args.from);
    if (args.to) usp.set("to", args.to);
  }
  return `${base}?${usp.toString()}`;
}

export function LedgerDateFilter({
  baseHref,
  from,
  to,
  allTime,
  posCoverThrough,
}: {
  baseHref: string;
  from: string | null;
  to: string | null;
  allTime?: boolean;
  posCoverThrough: string | null;
}) {
  // If POS hasn't been uploaded yet, presets degrade to "no filter" (current
  // behavior = newest days reversed).
  const anchor = posCoverThrough;
  const presets: Array<{
    label: string;
    from?: string;
    to?: string;
    all?: boolean;
  }> = anchor
    ? [
        { label: "7 วัน", from: isoMinusDays(anchor, 6), to: anchor },
        { label: "30 วัน", from: isoMinusDays(anchor, 29), to: anchor },
        { label: "90 วัน", from: isoMinusDays(anchor, 89), to: anchor },
        // CEO 2026-06-25: "ทั้งหมด" now carries an explicit ?all=1 so the shell
        // loads the full history instead of silently falling into the 30-day
        // default (which made this button show only 30 days).
        { label: "ทั้งหมด", all: true },
      ]
    : [];

  const activeKey =
    !from && !to && !allTime ? "default" : `${from ?? ""}|${to ?? ""}`;

  return (
    <div
      className="card"
      style={{
        margin: "8px 22px 0",
        padding: "5px 10px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
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
        const active = p.all
          ? !!allTime
          : !allTime && key === activeKey && activeKey !== "default";
        return (
          <Link
            key={p.label}
            href={buildHref(baseHref, { from: p.from, to: p.to, all: p.all })}
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
          title="filter ใช้ได้แค่วันที่ POS อัพแล้ว (POS มักช้ากว่าปฏิทิน 1-2 วัน)"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          <Clock size={11} aria-hidden="true" />
          POS ครบ <strong className="mono">{anchor}</strong>
        </span>
      )}
    </div>
  );
}
