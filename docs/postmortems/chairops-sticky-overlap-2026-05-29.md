# Post-mortem — ChairOps sticky-header text overlap

- **Date:** 2026-05-29
- **Owner:** patipan1122 (with Claude)
- **Fix commit:** `6065864` (cherry-picked to prod as `6708aab` on `setup`)
- **Module:** ChairOps (massage-chair ERP module inside Pool)
- **Severity:** Cosmetic but high-visibility — reported by CEO 3+ times; eroded trust ("บอกไปหลายรอบแล้ว")

## Summary

ChairOps tables with a sticky header (`สาขาที่ต้องดูก่อน` critical-branches table on the dashboard, and the all-branches P&L table) rendered the frozen header row directly on top of body rows during scroll, so column labels (`สาขา / ยอดขาย / เงินสด / เงินโอน`) visually collided with branch data underneath. Root cause was a viewport-anchored sticky `<thead>` (`top-14 sm:top-16`) carrying its background on `<thead>`/`<tr>` — Chrome drops that background during `position: sticky`, and the fixed viewport offset is wrong whenever a second sticky bar stacks under the topbar. Fixed by switching both tables to **container-scroll** (`max-h` + `overflow-auto` + `thead sticky top-0`) with the background moved onto the `<th>` cells, plus a global `!important` solid-bg guard on every `.co-scope thead.sticky`. Deployed to prod 2026-05-29.

## Symptom

- Dashboard `สาขาที่ต้องดูก่อน` table and the "all branches reconcile / P&L" view: header row text overlapped the first body rows while scrolling.
- Visible as two layers of Thai text occupying the same pixels — header labels wedged into branch sales/cash/transfer numbers.
- Reproduced on every scroll of those tables, on the CEO's machine, across multiple sessions. Three separate reports.

## Root cause

Both tables used the project's "standard" sticky-thead recipe (recorded in memory `sticky-thead-pattern`):

```tsx
<div className="overflow-x-auto">
  <table>
    <thead className="sticky top-14 z-20 bg-zinc-50 sm:top-16">
      <tr className="... text-zinc-500">
```

Two independent defects compound here:

1. **Background dropped during sticky.** The background lived on `<thead>` / `<tr>` (`bg-zinc-50`). Chrome (and other engines) frequently fail to paint a `<thead>`/`<tr>` background while the element is in `position: sticky`. The header therefore became effectively transparent and body rows showed straight through it.
2. **Wrong sticky anchor.** `top-14 sm:top-16` anchors the header to a fixed offset from the **viewport** top, chosen to sit just under the admin topbar. But ChairOps stacks a second bar (approval / context strip) under the topbar in several states, and the page itself scrolls — so the header froze at a viewport Y that no longer matched the table position, floating over a mid-table row instead of the table's own top edge.

The `sticky-thead-pattern` memory had even logged the second defect as an "acceptable trade-off" ("when QuickApproveBar is showing, thead hides behind it") — it was not acceptable; it was this bug.

## Why it produced the symptom

Transparent header (defect 1) means whatever is behind it is visible. Wrong anchor (defect 2) means "behind it" is a body row, not empty space above the table. Combined: legible header text painted over legible body text at the same coordinates = the overlap the CEO saw. Because both defects are scroll-dependent, the table looked fine at rest and only broke once the user scrolled — which is exactly when a frozen header is supposed to help.

## Fix

Commit `6065864` (live as `6708aab`). Three files:

- `app/(admin)/chairops/(office)/_components/critical-branches-table.tsx`
- `app/(admin)/chairops/(office)/_components/all-branches-pl-table.tsx`

  Both changed from viewport-sticky to **container-scroll**:
  ```tsx
  <div className="max-h-[60vh] overflow-auto">      {/* was overflow-x-auto */}
    <table>
      <thead className="sticky top-0 z-20">          {/* was sticky top-14 sm:top-16 bg-zinc-50 */}
        <tr className="... bg-zinc-50 [&>th]:bg-zinc-50">   {/* bg on the CELLS */}
  ```
  `sticky top-0` is now relative to the table's own scroll box, so it is immune to viewport offset and stacking bars. `[&>th]:bg-zinc-50` puts the background on each `<th>`, which engines reliably paint during sticky.

- `components/chairops/redesign/fixes.css` — global backstop for the other ~9 ChairOps sticky tables not yet migrated:
  ```css
  .co-scope thead.sticky th,
  .co-scope thead.sticky tr { background-color: #ffffff !important; }
  .co-scope thead.sticky th { box-shadow: inset 0 -1px 0 var(--border); }
  ```
  `fixes.css` loads last in the ChairOps layout, so this wins specificity over translucent `bg-muted/50` headers elsewhere.

This addresses the root cause (background now on a reliably-painted element; anchor now relative to the scroll container) rather than nudging offsets.

### Prior failed attempt

An earlier fix shipped only the CSS background rule, via PR #13 — which **never merged** (conflicts against a fast-moving `origin/setup` from parallel sessions). The CEO kept seeing the overlap because the fix was never on prod, and even the CSS-only approach left defect 2 (wrong anchor) in place. The definitive fix had to (a) actually land on `setup`, and (b) fix both defects.

## How it was found

- Repro was trivial (CEO screenshots, every scroll).
- First hypothesis: translucent/`bg-inherit` cell (the known `sticky-bg-inherit-anti-pattern` from CashHub). Partially right — background *was* the issue — but solidifying the `<thead>` bg alone did not fix it, which pointed past a simple opacity bug.
- Reading the rendered DOM showed the header floating at a viewport offset unrelated to the table top → identified defect 2 (anchor).
- Confirming experiment: switching to container-scroll (`sticky top-0` inside `max-h overflow-auto`) eliminated the overlap regardless of approval-bar state, isolating the viewport anchor as the second cause.

## Why it slipped through

- **The house pattern was itself wrong.** `sticky-thead-pattern` memory prescribed `top-14 sm:top-16` and even pre-excused the stacking-bar failure. We were following our own broken guidance.
- **No visual regression test.** Nothing exercises scroll + sticky header; type-check and `next build` pass on this bug because it is pure runtime layout.
- **Merge churn hid the first fix.** PR #13 sat unmerged against a fast-moving prod branch, so "fixed" in a PR ≠ fixed on prod. Three of the CEO's reports were against a prod that never had any fix.

## Validation

- `tsc --noEmit` + `next build` clean on the fix commit.
- Cherry-picked cleanly onto current prod source (`origin/setup`, includes maid-LIFF work) → `6708aab`; pushed to `setup` so prod source-of-truth carries the fix (prevents next-session regression).
- `vercel --prod` deploy READY on project `pooilgroup`; `https://pooilgroup.vercel.app/chairops` and `/chairops/reconcile` return HTTP 307 (healthy, auth redirect).
- **Not yet visually confirmed by me in a browser** — the prod CSS change requires a hard refresh (Cmd+Shift+R) to bypass cache. Visual sign-off is with the CEO. Validation coverage is: build + deploy + route-health; **pending** human visual confirmation of the scroll behavior.

## Action items

- [ ] Migrate the remaining ~9 ChairOps sticky tables from viewport-sticky to container-scroll (the global CSS rule is a backstop, not a real fix for defect 2). Owner: next ChairOps session.
- [ ] Extract a shared `<StickyTable>` primitive so the correct recipe (container-scroll + `[&>th]` bg) is the only way to build one. Owner: TBD.
- [ ] Add a Playwright visual smoke test that scrolls a sticky table and asserts the header is opaque / non-overlapping. Closes the CI gap. Owner: TBD.
- [x] Corrected the `sticky-thead-pattern` and `sticky-bg-inherit-anti-pattern` memories so the broken recipe is no longer prescribed.
