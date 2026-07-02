# Post-mortem — FlowCo report inflated to ฿2.3B (real ~฿130M/mo)

**Date:** 2026-07-02 · **Repo:** pooilgroup-web (branch `setup`) · **Owner:** CashHub/FlowCo
**Fix commits:** `2ab35f96` (anomaly filter), operational re-import, `b1d82e6b` (matrix sticky overlap)

## Summary

The FlowCo fuel-sales report ("สรุปทุกสาขา" matrix and the CashHub dashboard) showed a total of **฿2.3 billion** when the real figure is **~฿130M/month**. Root cause: a handful of garbage rows in the externally-synced `po_fuel_sales_daily` (meter-reset / sync glitches — one grade showing ฿867M in a day, another showing −443,809 liters) were summed straight into per-branch/day totals with no bounds check. Fixed by adding `isAnomalousGrade` filtering in `fetchFlowcoAggregates` / `fetchFlowcoGradeRows` (report reads source live → clean immediately) plus an operational re-import to overwrite the garbage already persisted in `daily_reports`. A secondary UI bug (sticky matrix columns showing through and overlapping adjacent cells) was fixed in the same session.

## Symptom

- `/cashhub/flowco?view=matrix`: "ยอดขายรวมทุกสาขา" = **฿2,038,920,028** (June). Branch "สาขา 6 โคกสูง 1" = **฿1,928,359,712** for the month.
- `/cashhub/dashboard` (ภาพรวม): same branch inflated, because the import wrote the garbage into `daily_reports`.
- Individual days in the per-branch table: `2026-06-15 = ฿1,018,133,350`, `2026-06-14 = ฿893,732,250`, vs a normal day ~฿500–700K.

## Root cause

`po_fuel_sales_daily` is populated by an office-PC sync into the **same Supabase DB the app uses** (project `gockzhprlylabpurvhoz`, `public` schema, not modeled in Prisma). Some rows are meter-reset / sync artifacts with physically-impossible values:

| ste_id | business_date | grade | sell_q | sell_a |
|---|---|---|---|---|
| 1006 | 2026-06-15 | GASOHOL91 | 1,445,296 L | ฿867,790,741 |
| 1006 | 2026-06-14 | GASOHOL91 | −443,809 L | ฿852,557,858 |
| 1005 | 2026-05-02 | DIESEL | −8,303,594 L | ฿81,312,065 |
| 1005 | 2026-05-02 | E20 | 16,632,271 L | ฿49,525,936 |

`fetchFlowcoAggregates` (in `lib/cashhub/flowco-source.ts`) did `Σ sell_a` per `(ste_id, business_date)` with **no upper/lower bound**, so a single ฿867M grade row dominated the branch-day total. ~17 such grade rows across 2 months pushed the org total from ~฿130M/mo to ฿2.3B.

## Why it produced the symptom

Two read paths consume the same aggregate:

1. **Report** (`/cashhub/flowco`) reads `po_fuel_*` **live** via `adminClient().from()` → inflated on every page load.
2. **Import** (`/api/cashhub/flowco-import` → `computeFlowcoPlan` in `flowco-import-core.ts`) snapshots the same aggregate into `daily_reports` (`total_sales`), which `/cashhub/dashboard` reads.

So the garbage appeared in two places, and the persisted copy (`daily_reports`) did **not** self-heal when the code was fixed.

## Fix

**Code (`2ab35f96`).** Added `isAnomalousGrade(q, a)` in `flowco-source.ts` — drops a grade row when `sell_q < 0 || sell_a < 0 || sell_q > 100_000 || sell_a > 5_000_000` (impossible for one grade in one day at a single station). Applied in both `fetchFlowcoAggregates` (feeds report **and** import) and `fetchFlowcoGradeRows`, and surfaced as an `anomalyCount` badge (⚠️) per row so filtering is visible, not silent. This addresses the root cause (bounds the summation) rather than the symptom, and makes the report correct immediately because it reads source live.

**Operational.** The already-persisted garbage in `daily_reports` was written by the first import (before the filter existed). It is overwritten only for days **inside the import's date range**. Re-importing with **June in range** (`computeFlowcoPlan` reclassifies `2026-06-15` as changed: ฿1,018M → ฿447K → upsert) dropped June from ฿2.04B to ฿130.4M.

**Secondary UI (`b1d82e6b`).** `flowco-matrix-table.tsx` sticky columns (`สาขา`, `รวม`) rendered adjacent cells through them (e.g. `฿196K฿6.0M94`) because the zebra stripe used a semi-transparent `rgba(59,79,246,0.035)` background on the sticky `<td>`. A sticky cell must be **opaque** to occlude scrolled content behind it. Changed to solid `#f6f7fc`; also added per-column dividers and left/right shadows on the sticky columns.

## How it was found

- Repro was deterministic: open the report, total reads ฿2.3B.
- `SELECT ... WHERE sell_a > 5000000` on `po_fuel_sales_daily` returned ~9 rows; `WHERE sell_q > 100000` returned ~8 — the offending set, all meter-reset shaped (huge or negative).
- Confirmed impact: `Σ sell_a` all = ฿2.3B; `Σ sell_a WHERE within-bounds` = ~฿92–130M. The delta was those ~17 rows.
- Re-import not clearing `daily_reports` was cracked by bucketing rows by `updated_at`: the garbage rows stayed at the first-import timestamp while later batches (May-only) advanced — proving the re-imports never covered June 14/15.

## Why it slipped through

- **Untrusted external source, no ingest validation.** `po_fuel_*` is synced by an office PC and never validated on the way in. Any bound-check was in the read layer, added only after the symptom appeared.
- **Persisted snapshot vs live read.** A read-layer filter fixes the live report instantly but cannot retroactively rewrite rows already committed to `daily_reports`. The two paths drifted.
- **Re-import is silently date-range-scoped.** The commit path only touches days in `[from, to]`; a partial range (May-only) leaves other days stale with no warning. Nothing surfaced "you did not cover the dates that are wrong."

## Validation

`daily_reports` where `extra_fields->>'source'='flowco'`, after the June re-import:

| month | rows | Σ total_sales | max row | rows > ฿5M |
|---|---|---|---|---|
| พ.ค. | 630 | ฿133,689,353 | ฿810,267 | 0 |
| มิ.ย. | 618 | ฿130,402,588 | ฿16.7M (สาขา 6) | 0 |
| ก.ค. | 1 | ฿173,120 | — | 0 |

Live report ("สรุปทุกสาขา", June) = ฿130,402,588. Shift breakdown independently reconciles (กะเช้า+กะดึก = daily total, ±0–1฿ rounding, verified across ste 1006/1011/1032). Matrix overlap fix validated visually against the CEO's screenshot case. Not separately load-tested; data volume is ~a few thousand rows.

## Action items / follow-ups

- **Ingest-time bounds check / quarantine.** The office sync (or a DB trigger / staging view) should clamp or quarantine impossible meter deltas before they reach `po_fuel_sales_daily`, so no read layer has to defend. (Owner: FlowCo sync maintainer.)
- **Re-import full-range default + partial-coverage warning.** Default the FlowCo import date range to the full data span, and warn when the selected range excludes days that currently have anomalous persisted totals. (Owner: CashHub.)
- **"Recompute persisted totals" admin action.** A one-click reconcile that re-runs `computeFlowcoPlan` over the entire data span, so a code-level filter change can heal `daily_reports` without a manual full re-import. (Owner: CashHub.)
- **Lint rule / convention: sticky table cells must use opaque backgrounds.** Recurring class of bug in dense CashHub tables. (Owner: CashHub UI.)
- **Data-quality alert.** Flag any branch-day whose total exceeds a sane ceiling (e.g. > ฿5M/day) in the import preview. (Owner: CashHub.)
