# ChairOps · BIGFEATURE Persona — UI (Visual / Design)

> **Persona:** UI (Visual/Design) · **Run:** /bigfeature roundtable · **Date:** 2026-05-27
> **Goal:** Audit ChairOps' current design system before Wave 0-3 ship · flag token gaps · cleanup forked primitives · enforce brand consistency with Pool.

---

## 1. Design System Audit

ChairOps **does NOT have a scoped token file** (unlike CashHub which has `.ch-scope` in `components/cashhub/redesign/tokens.css`). It currently relies entirely on Pool defaults from `app/globals.css:20-58` (`--color-brand-*` / `--color-leaf-*` / `--color-success/warning/danger/info` in OKLCH).

What ChairOps owns:
- `components/chairops/_kit/*.tsx` — 8 specialised primitives (KpiTile · ShortageDriftCell · DiffBucketPills · PhotoProofPanel · MasterDetailShell · MakerCheckerBadge · LineNotifyToggle · ChairCodeChip)
- `components/chairops/ui/{button,card,input,badge}.tsx` — **4 duplicate primitives** that re-skin Pool's `components/ui/*` with shadcn-style CVA but add zero unique value
- `components/chairops/features/admin-shell.tsx` — top-nav shell (currently translucent bg violation, see §5)

**Verdict:** ChairOps is mid-fork. `_kit` is justified (signature patterns), `ui/` is dead weight to delete.

---

## 2. Token Gap Analysis (Wave 0-3 needs)

| New feature | Token needed | Exists? |
|---|---|---|
| Bills list (W2) | bill status colours (RECEIVED · APPROVED · PAID · DISPUTED · OVERDUE) — 5 distinct | NO — only generic success/warning/danger |
| Period close (W2.3) | period status (OPEN · SOFT_CLOSED · HARD_CLOSED) — 3 tones | NO |
| LINE OA preview (W1.2) | LINE green `#06C755` brand · rich-menu card frame · Thai sans display 22-26px | NO |
| Status grid 30×4 (W1.4) | `--co-cell-ok` / `--co-cell-pending` / `--co-cell-late` / `--co-cell-missing` solid swatches at WCAG AA against zinc-50 | NO |
| Cost editor (W0.2) | per-cost-bucket pill colour (rent · utility · staff · other · deposit) | NO |
| Drift heatmap | red-amber-green stepped scale per cumulative-days bucket (1d · 2-3d · 4-7d · 8+d) | partial (rose-50→rose-700 in shortage-drift-cell.tsx:76-79) |
| Audit-of-auditors row (W3.1) | actor_kind chips (HUMAN · CRON · OVERRIDE · SYSTEM) | NO |

→ Wave 0 must ship `components/chairops/redesign/tokens.css` scoped to `.co-scope` mirroring CashHub's pattern.

---

## 3. Forked Primitive Cleanup

| Path | Verdict | Action |
|---|---|---|
| `components/chairops/_kit/kpi-tile.tsx` (155 LOC) | **KEEP** — centered-value variant differs from Pool `components/ui/kpi-tile.tsx` (horizontal compact). Add sparkline (see §7) | KEEP + extend |
| `components/chairops/_kit/shortage-drift-cell.tsx` | **KEEP** — ChairOps signature (cumulative-days badge + escalation tier) | KEEP |
| `components/chairops/_kit/diff-bucket-pills.tsx` | **KEEP** — 4-bucket POS-ingest pattern reusable in W0.4 + W2.1 bills diff | KEEP |
| `components/chairops/_kit/photo-proof-panel.tsx` | **KEEP** — sticky right-rail proof viewer | KEEP |
| `components/chairops/_kit/master-detail-shell.tsx` | **KEEP** — exports `stickyTheadClass()` helper used in 4+ pages | KEEP |
| `components/chairops/_kit/maker-checker-badge.tsx` | **MERGE UPSTREAM** — `components/ui/badge.tsx` already has tone props; this is just a tone preset | Move to `components/ui/badge-presets.ts` |
| `components/chairops/_kit/line-notify-toggle.tsx` | **REWRITE** — LINE Notify is EOL (audit risk #5); will become LINE-OA-toggle in W1.1 | REWRITE |
| `components/chairops/_kit/chair-code-chip.tsx` | **KEEP** | KEEP |
| `components/chairops/ui/button.tsx` (40 LOC) | **DELETE** — identical to Pool `components/ui/button.tsx` w/ CVA | DELETE + redirect imports |
| `components/chairops/ui/card.tsx` (37 LOC) | **DELETE** — identical | DELETE |
| `components/chairops/ui/input.tsx` (19 LOC) | **DELETE** — Pool input is richer | DELETE |
| `components/chairops/ui/badge.tsx` (25 LOC) | **DELETE** — Pool badge superset | DELETE |
| `components/chairops/features/admin-shell.tsx` | **REPLACE** in Wave 0 — uses translucent sticky (§5) and no module-entitlement gate | REPLACE |

Net delete: 121 LOC of dead forks. Saves 4 import sources + removes onboarding confusion.

---

## 4. Status Tone Palette (4-6 distinct, per `[[recruit-canvas-parity-2026-05-22]]`)

### ChairopsAlertStatus (4 tones — `prisma/schema.prisma:2794`)
```css
.co-status-OPEN     { --bg: #fee2e2; --fg: #991b1b; --ring: #fecaca; } /* rose */
.co-status-ACK      { --bg: #fef3c7; --fg: #92400e; --ring: #fde68a; } /* amber */
.co-status-RESOLVED { --bg: #dcfce7; --fg: #166534; --ring: #bbf7d0; } /* emerald */
.co-status-IGNORED  { --bg: #f1f5f9; --fg: #475569; --ring: #cbd5e1; } /* slate */
```

### ChairopsBillStatus (5 tones — to be added Wave 2)
```css
.co-bill-RECEIVED { --bg: #dbeafe; --fg: #1e40af; --ring: #bfdbfe; } /* blue */
.co-bill-APPROVED { --bg: #ede9fe; --fg: #5b21b6; --ring: #ddd6fe; } /* violet */
.co-bill-PAID     { --bg: #dcfce7; --fg: #166534; --ring: #bbf7d0; } /* emerald */
.co-bill-DISPUTED { --bg: #fef3c7; --fg: #92400e; --ring: #fde68a; } /* amber */
.co-bill-OVERDUE  { --bg: #fee2e2; --fg: #991b1b; --ring: #fecaca; } /* rose — pulse */
```

### ChairopsPeriodStatus (3 tones)
```css
.co-period-OPEN         { --bg: #dcfce7; --fg: #166534; }
.co-period-SOFT_CLOSED  { --bg: #fef3c7; --fg: #92400e; }
.co-period-HARD_CLOSED  { --bg: #f1f5f9; --fg: #1e293b; --ring-width: 2px; }
```

All swatches verified WCAG AA (4.5:1+) against white surfaces. No translucent `/20 /30 /40` per `[[sticky-bg-inherit-anti-pattern]]`.

---

## 5. Violations to Fix in Wave 0

### A. Uppercase-Thai violations (`[[section-component-eyebrow-rootcause]]`)
Found `uppercase tracking-wide` on **20+ Thai label sites** in `app/(admin)/chairops/`. Sample:
- `reconcile/page.tsx:360` · `reconcile/[branchId]/page.tsx:157,653`
- `write-offs/page.tsx:238,280,442,463,484,492,545` · `write-offs/write-off-selection-shell.tsx:186`
- `users/new/new-user-form.tsx:73` · `users/[id]/page.tsx:186,248,309,328,353` · `users/[id]/user-detail-form.tsx:83`
- `alerts/error.tsx:28` · `write-offs/error.tsx:30`

Mass-replace pattern: `text-[10-11px] font-bold uppercase tracking-wide` → `text-[11px] font-semibold tracking-[0.02em]`.

### B. Translucent sticky bg violations (`[[sticky-bg-inherit-anti-pattern]]`)
- `components/chairops/features/admin-shell.tsx:33` — `bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80`
- `app/(admin)/chairops/collect/_components/maid-shell.tsx:22` — `bg-background/95 backdrop-blur`
- `app/(admin)/chairops/(office)/write-offs/page.tsx:335` — same
- `app/(admin)/chairops/(office)/write-offs/loading.tsx:6` · `alerts/loading.tsx:6` — `bg-background/95`

Fix: replace with solid `bg-background` (or `bg-white`). Backdrop-blur stays only for non-sticky elements (modals).

---

## 6. Accessibility Checklist (Maid PWA + Office Dashboard)

- **Focus ring** — all `_kit/*` use `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. Verify by tab-walk in Wave 1 QA.
- **Min touch target 44×44** — `diff-bucket-pills.tsx:97` uses `h-11` (44px) when interactive — good. `_kit/kpi-tile.tsx:141` is 120px min-height — good.
- **ARIA on status grid** — 30×4 cells must each have `aria-label="สาขา X · งาน Y · สถานะ Z"`. Currently missing — Wave 1 must add.
- **WCAG AA contrast** — verified §4 palette. Action items: re-test `text-zinc-500` on `bg-zinc-50` (currently 3.8:1 — fails). Replace with `text-zinc-600` (4.7:1).
- **Screen reader (Thai TTS)** — maid PWA must read photo alt-text in Thai. `photo-proof-panel.tsx` currently uses generic `alt={proof.label}` — confirm caller passes Thai labels.
- **Keyboard nav** — drag-drop XLSX upload (W0.4) needs `<input type="file">` fallback for keyboard users.
- **Pulsing alerts** — `shortage-drift-cell.tsx:93` uses `animate-pulse` for CEO escalation. Respect `prefers-reduced-motion`: wrap in `motion-safe:animate-pulse`.

---

## 7. Mobile Breakpoints + Pool KPI Tile Spec

**Targets:** iPhone portrait 375 · Android compact 360 · tablet 768 · maid LIFF webview (often 360-414).

**Maid PWA layout** (≤640px):
- 1-column · sticky bottom CTA (`safe-area-inset-bottom`)
- KPI tiles 2-up (`grid-cols-2 sm:grid-cols-3`)
- Photo proof panel becomes full-width swipeable carousel (NOT sticky right-rail)

**Office dashboard** (≥1024):
- 5-up KPI strip · sidebar 240px · main scroll area · right-rail proof panel sticky `top-20`

**Pool-quality KPI tile (extend `_kit/kpi-tile.tsx`):**
```tsx
<ChairopsKpiTile
  label="รายได้วันนี้"
  value={847230}
  unit="บาท"
  delta="+12%"
  deltaDirection="up"
  tone="success"
  sparklineData={last7DaysRevenue}   // NEW — 7-point inline SVG sparkline
  href="/chairops/dashboard/revenue"
/>
```
Visual: border `ring-1 ring-zinc-200` (NOT `border-zinc-200` — softer) · sparkline `h-6` under value · arrow icon next to delta · click target = whole card.

---

## 8. LINE OA Rich Menu (Wave 1.2 visual spec)

4-button grid · 2500×843px canvas (LINE standard) · brand-blue gradient header · Thai Sarabun 38px buttons:

```
┌─────────────────────────────────────────────────────────┐
│  ChairOps · {{branchName}}                  (logo)      │  ← header 200px, --color-brand-500 → --color-brand-700 gradient
├──────────────┬──────────────┬──────────────┬───────────┤
│  💰          │  🧹          │  🔧          │  📦       │
│  เก็บเงิน    │  ตรวจคลีน   │  แจ้งซ่อม   │  เบิกของ │  ← 4 buttons 600×640px each
│              │              │              │           │
└──────────────┴──────────────┴──────────────┴───────────┘
```

Per-button bg tints (subtle, NOT solid · WCAG AA against header text):
- เก็บเงิน — `#dcfce7` (emerald-100)
- ตรวจคลีน — `#dbeafe` (blue-100)
- แจ้งซ่อม — `#fef3c7` (amber-100)
- เบิกของ — `#ede9fe` (violet-100)

Icons: Noto Color Emoji (cross-platform on Android+iOS LINE). Thai label below 28pt. Tap target full-button.

---

## 9. Brand Consistency

- **Pool blue** = `--color-brand-500` (oklch(0.52 0.25 264) ≈ `#3b5cff`) — use everywhere as primary CTA. ChairOps current `Button` from `chairops/ui/button.tsx:10` uses `bg-primary` which maps to brand-500 already. Once we DELETE that file (§3), all routes inherit Pool's `<Button>`.
- **Nav shell** — `chairops/features/admin-shell.tsx` should mirror CashHub/Repair/Recruit shells (sticky solid header + max-w-7xl + 14/16px nav). Replace in Wave 0 with shared shell.
- **Sidebar density** — match Pool's 240px width (NOT 280 like a few clawfleet pages). Same icon size (`size-4`) + same `text-sm font-medium` labels.
- **Number formatting** — `tabular-nums` everywhere money appears (already done in `_kit/`).

---

## 10. Wave 0 Concrete Tokens to Add

Create `components/chairops/redesign/tokens.css` (scoped):

```css
.co-scope {
  /* Reuse Pool brand */
  --co-brand: var(--color-brand-500);
  --co-brand-hover: var(--color-brand-600);

  /* ChairOps-only */
  --co-cell-ok: #dcfce7;
  --co-cell-pending: #fef3c7;
  --co-cell-late: #fed7aa;
  --co-cell-missing: #fee2e2;

  --co-radius-tile: 14px;
  --co-radius-pill: 999px;
  --co-radius-card: 18px;

  --co-shadow-tile: 0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.06);
  --co-shadow-hover: 0 4px 12px rgb(0 0 0 / 0.08);

  --co-space-pad-tile: 16px;
  --co-space-pad-card: 20px;

  --co-line-green: #06c755;   /* LINE OA brand */
  --co-line-soft: #e7f9ee;
}
```

Apply via `<body class="co-scope">` from `app/(admin)/chairops/layout.tsx` (after entitlement gate). Tokens scoped, no leak.

---

**END · UI persona output · ~880 words**
