# BIGFEATURE — LedgerLine รายจ่าย "โหมดตรวจใบเสร็จ" (Receipt-Review View Mode)

> Pixel-exact build blueprint for a NEW **additive** 3-column receipt-review workspace on
> `/ledger/expenses?view=receipt-review`. Desktop-only (~1440px). The existing list mode
> stays **byte-identical** — this is a separate render branch behind `?view=receipt-review`.
>
> Source of truth for LOOK = `scratchpad/mockup-receipt-review.html` (1440×900, inline-styled).
> Source of truth for DATA/REUSE = worktree `pg-wt-receipt-review/` (origin/setup).
> All hex/px below are extracted verbatim from the mockup. Cited `file:line` = existing code.

---

## A. Mockup layout skeleton

Outer frame: `width:1440px; height:900px; overflow:hidden; display:flex; flex-direction:column; background:#eef0f4`. Three stacked regions: **Header toolbar (52px)** → **Stat/filter bar (46px)** → **Main grid (flex:1)**. A filter overlay floats on top when opened.

```
┌────────────────────────────────────────────────────────────────────────────────────┐ 1440px
│ HEADER TOOLBAR   h=52  bg#fff  border-b #dfe3ea  pad 0 16  gap 12                     │
│ [P] ระบบบัญชี·รายจ่าย │ ‹co▾› ‹branch▾› [🔍search 250px] ····· J/K ⌘⏎  ⋯เครื่องมือ  ↑อัปโหลด│
├────────────────────────────────────────────────────────────────────────────────────┤
│ STAT / FILTER BAR  h=46  bg#fff  border-b #dfe3ea  pad 0 16  gap 8                    │
│ (⚠6,192฿ VAT ติด amber-pill) │ [รอตรวจ12][ยังไม่ส่ง25][ส่งแล้ว16]…7 chips ···· [ตัวกรอง•3]│
├─────────────┬──────────────────────────────────────────┬─────────────────────────────┤
│ GRID  flex:1  min-h:0   grid-template-columns: 272px  1fr  330px   gap:10  padding:10 │
│             │                                          │                             │
│ COL 1 272px │ COL 2  1fr   (detail form)               │ COL 3  330px  (flex-col g10)│
│ LIST RAIL   │ ┌ header: EXP-no + meta + ออกเอกสาร▾ +tag┐│ ┌ RECEIPT VIEWER (dark) ──┐ │
│ white card  │ │ ─ scroll body pad 11 13 gap 10 ─────  ││ │ bg#111827 flex:1 r12    │ │
│ border      │ │  ╔ section card #1+#2 (border e8ecf2)╗││ │ ┌bar #1f2937 h34: ต้นฉบับ│ │
│ #dfe3ea r12 │ │  ║ ① ลงบัญชี  2-col combo grid       ║││ │ │  รูป1/3  ‹ › ขยาย หมุน↗│ │
│             │ │  ║ ② ข้อมูลร้านค้า 1.4/1/1/1 grid     ║││ │ ├─────────────────────┤ │
│ ┌header 8/11┐│ │  ║   green VAT banner                ║││ │ │  big bill image       │ │
│ │title+sub+ ││ │  ╚═══════════════════════════════════╝││ │ │  w74%|100% ar 1/1.4   │ │
│ │เลือกหลายใบ ││ │  ╔ section card #3 รายการและยอดเงิน ╗││ │ │  shadow .45           │ │
│ ├──────────┤│ │  ║  table head grid(8 cols)          ║││ │ ├ footer #1f2937 ──────┤ │
│ │(sel bar) ││ │  ║  row1 / row2(#fffdf5 AI)          ║││ │ │ [1][2][3][+] 34×44   │ │
│ │ #eff6ff  ││ │  ║  totals grid: รวม/ส่วนลด/VAT/WHT/  ║││ │ │ ความมั่นใจ 86%        │ │
│ ├──────────┤│ │  ║          ยอดโอน 17px              ║││ └─┴─────────────────────┘ │
│ │ scroll   ││ │  ╚═══════════════════════════════════╝││ ┌ HISTORY card (white) ───┐ │
│ │ grouped: ││ └ footer bar: pipeline chips + พักไว้ +  ┘│ │ r12 pad 9 11            │ │
│ │ • ต้องตรวจ││   [ตั้งขอโอน] [ยืนยัน&ส่ง CTA shadow]     │ │ ประวัติผู้ขายรายนี้     │ │
│ │ • ติดปัญหา││                                          │ │ 3× (date·cat·amount)    │ │
│ │ • พร้อมโอน││                                          │ │ "ใช้ค่าเดิมของใบล่าสุด" │ │
│ │ • จบแล้ว  ││                                          │ └─────────────────────────┘ │
│ │ item cards││                                          │                             │
│ └──────────┘│                                          │                             │
└─────────────┴──────────────────────────────────────────┴─────────────────────────────┘
  FILTER OVERLAY (conditional): backdrop rgba(15,23,42,.28) z40 + panel top100 right16 w392 r14 z41
```

Distinct regions top→bottom, left→right:
1. **Header toolbar** (52px) — brand, company/branch selects, search, kbd hints, tools menu, upload CTA.
2. **Stat/filter bar** (46px) — VAT-warning pill, 7 status chips, ตัวกรอง button.
3. **List rail** (col1) — header strip (title/sub/multi-select toggle), optional blue select-mode bar, grouped scrollable item cards.
4. **Detail form** (col2) — header (doc no + provenance + ออกเอกสาร▾ + status pill), scroll body with §1 ลงบัญชี, §2 ข้อมูลร้านค้า (both inside ONE card), §3 รายการและยอดเงิน (second card), footer action bar (pipeline + พักไว้ + ตั้งขอโอน + CTA).
5. **Receipt viewer** (col3 top, dark) — toolbar (label + page count + prev/next/zoom/rotate/Drive), image stage, thumbnail strip (1/2/3 + add + confidence note).
6. **Vendor history** (col3 bottom, white) — "ประวัติผู้ขายรายนี้" + 3 rows + "ใช้ค่าเดิมของใบล่าสุด" link.
7. **Filter overlay** (conditional).

---

## B. Design-token table (exact mockup values — grading surface)

### Background / surface
| token | hex | usage |
|---|---|---|
| page bg | `#eef0f4` | outer frame |
| surface / card | `#fff` | all cards, toolbars |
| muted input bg | `#f8fafc` | search input, table head, combo option hover base, ghost btn |
| selected-row bg | `#eff6ff` | active list item, active combo option, "ready" tag bg |
| select-mode bar bg | `#eff6ff` (border `#dbeafe`) | multi-select strip |
| AI-uncertain row bg | `#fffdf5` | line-item row 2 |
| totals strip bg | `#fbfcfe` | §3 totals grid |
| warn banner bg | `#fffbeb` | VAT-ติด pill, warn chip |
| success banner bg | `#f2fbf5` (border `#bbf7d0`) | green VAT-ok banner |
| dark viewer bg | `#111827` | receipt pane |
| dark viewer bar bg | `#1f2937` | viewer header + footer |
| dark viewer btn | `#374151` (hover `#4b5563`) | ‹ › zoom หมุน Drive |
| image stage bg | `#f8fafc` | behind the bill image |

### Border
| token | hex |
|---|---|
| card border | `#dfe3ea` |
| inner divider | `#eef1f5` |
| standard input border | `#e2e8f0` |
| soft input border (line items) | `#e8ecf2` |
| row separator (line items) | `#f4f6f9` |
| active/AI input border (blue) | `#93c5fd` |
| AI-uncertain input border (amber) | `#fcd34d` |
| warn pill border | `#fde68a` |
| dashed divider (in section) | `1px dashed #e8ecf2` |
| combo dropdown border | `#cbd5e1` |
| dark viewer divider | `#374151` / dashed add-thumb `#4b5563` |

### Text
| token | hex |
|---|---|
| primary text | `#0f172a` |
| muted / label | `#94a3b8` |
| secondary | `#475569` |
| tertiary | `#64748b` |
| link / accent blue | `#2563eb` (hover `#1d4ed8`) |
| dark-pane text | `#e5e7eb` (muted `#9ca3af`) |
| confidence-yellow accent (dark) | `#fbbf24` |

### Brand / accent
| token | hex | usage |
|---|---|---|
| primary blue | `#2563eb` | CTA, upload btn, active tab, links, §-number badge |
| navy (logo) | `#1e293b` |
| dark CTA / filter apply | `#0f172a` |
| active status chip | bg `#1e3a8a` / fg `#fff` |
| inactive status chip | bg `#f1f5f9` / fg `#475569` |

### Status / semantic chips (bg + fg)
| meaning | fg | bg | border |
|---|---|---|---|
| amber warn (VAT ติด, รอใบกำกับ, AI 62/80/90%) | `#b45309` | `#fffbeb` or `#fef3c7` | `#fde68a` |
| green ok (ขอคืนได้, 100%, AI 98%) | `#059669` | `#ecfdf5` | — |
| green banner (ใบกำกับเต็มรูป) | `#166534` / `#15803d` | `#f2fbf5` | `#bbf7d0` |
| neutral (ไม่มี VAT, pics badge) | `#64748b` | `#f1f5f9` | — |
| header tag — sent | `#059669` | `#ecfdf5` | — |
| header tag — ready (พร้อมส่ง) | `#1d4ed8` | `#eff6ff` | — |
| header tag — wait (รอยืนยัน) | `#c2410c` | `#fff7ed` | — |
| group: ต้องตรวจก่อน | `#2563eb` | (dot only) | |
| group: ติดปัญหา | `#b45309` | | |
| group: พร้อมตั้งขอโอน | `#0f766e` | | |
| group: จบแล้ว | `#64748b` | | |
| quick-action primary | `#fff` | `#2563eb` | `#2563eb` |
| quick-action warn | `#b45309` | `#fffbeb` | `#fde68a` |
| quick-action dark | `#fff` | `#0f172a` | `#0f172a` |
| quick-action ghost | `#475569` | `#fff` | `#e2e8f0` |
| pipeline chip done | `#166534` | `#ecfdf5` | `#bbf7d0` |
| pipeline chip pending | `#94a3b8` | `#f8fafc` | `#e2e8f0` |

### Typography
- **Family:** `'IBM Plex Sans Thai','IBM Plex Sans',sans-serif`. Latin numerals / codes / dates / GL codes / doc-no use `'IBM Plex Sans',sans-serif` explicitly.
- **Distinct font-sizes (px):** `9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 17`.
- **Weights:** `400, 600, 700`.
- **Numeric:** every money/qty/tax-id field carries `font-variant-numeric: tabular-nums`.

### Border-radius
`4` (image, tiny tags) · `5` (kbd chip, thumb) · `6` (line-item inputs, small buttons) · `7` (logo, combo option) · `8` (inputs, header buttons) · `9` (VAT banner, filter search) · `10` (list-item card, footer buttons, combo dropdown) · `11` (section cards) · `12` (main column cards, dark viewer, history card) · `14` (filter panel) · `999px / 50%` (pills, dots, status chips).

### Key paddings / gaps
- Grid: `gap:10 padding:10`.
- Header row: `pad 0 16 · gap 12`. Stat row: `pad 0 16 · gap 8`.
- List card body pad `6`; item pad `7 8`; item internal gap `5–6`; item bottom-margin `5`.
- Section card pad `9 11`; combo grid `gap 8 10`.
- Detail body pad `11 13 · gap 10`; detail header pad `9 13`; footer pad `8 13 9`.
- Viewer header/footer h `34` / pad `7 9`; image stage pad `9`.

### Shadows
| use | value |
|---|---|
| combo dropdown | `0 14px 32px rgba(15,23,42,.18)` |
| filter panel | `0 22px 54px rgba(15,23,42,.28)` |
| CTA (ready) | `0 6px 16px rgba(37,99,235,.26)` |
| receipt image | `0 12px 30px rgba(0,0,0,.45)` |

> **Brand-token note:** app `--color-brand-500/600` = `oklch(0.52 0.25 264)` / `oklch(0.45 0.24 264)` — a *near* match to `#2563eb` but not identical. For a graded 100% pixel match, the receipt-review branch should hard-code the mockup hexes (isolated design-locked view). `SectionTitle` already renders `--color-brand-600` with fallback `#2563EB` (`ExpenseReviewPane.tsx:123`), so §-number badges are effectively on-brand either way.

---

## C. Region-by-region component spec

### C1 · Header toolbar (52px)
`bg#fff · border-b 1px #dfe3ea · pad 0 16 · gap 12 · align-center`.
- **Logo block:** 24×24 rounded-7 `bg#1e293b` white "P" 12px/700 + title "ระบบบัญชี · รายจ่าย" (12.5px/700) over subtitle "LedgerLine · LINE → AI อ่าน → …" (10px `#94a3b8`).
- Divider 1px×24 `#e8ecf2`.
- **Company select** + **branch select:** 12px/600, pad `6 8`, border `#e2e8f0`, radius 8.
- **Search input:** width 250, 12px, pad `6 10`, bg `#f8fafc`, border `#e2e8f0`, radius 8.
- Spacer `flex:1`.
- **Kbd hints:** "J/K เลื่อนใบ" + "⌘⏎ ยืนยัน+ส่ง" — kbd chips pad `2 6` border `#e2e8f0` bg `#f8fafc` radius 5, 10.5px `#475569`/600.
- **⋯ เครื่องมือ** ghost button: 12px/600 `#475569`, border `#e2e8f0`, radius 8, pad `6 10`.
- **↑ อัปโหลดใบเสร็จ** CTA: 12px/700 `#fff` on `#2563eb`, radius 8, pad `7 12`.

### C2 · Stat / filter bar (46px)
`bg#fff · border-b 1px #dfe3ea · pad 0 16 · gap 8`.
- **VAT-warn pill:** `#b45309` on `#fffbeb`, border `#fde68a`, radius 999, pad `4 9`, 11.5px/600 — "⚠ 6,192 ฿ VAT ติด" + trailing "· อีก 1 ใบยังไม่ตรวจ" (`#a16207`/400).
- Divider 1px×20 `#e8ecf2`.
- **Status chips** (7): pad `5 10` radius 999, 11.5px/600. Active `bg#1e3a8a fg#fff` · inactive `bg#f1f5f9 fg#475569`. Count sub-span 10.5px/700 opacity .85. Labels/counts: รอตรวจ 12 · ยังไม่ส่ง 25 · ส่งแล้ว 16 · ขอโอน 5 · รอโอน 6 · โอนแล้ว 4 · ทั้งหมด 41.
- Spacer.
- **ตัวกรอง button:** 12px/600 `#334155`, border `#e2e8f0` (active `#93c5fd` + bg `#eff6ff`), radius 8, pad `6 11` + count badge (10.5px/700 `#fff` on `#2563eb`, radius 999).

### C3 · List rail (col1 · 272px)
White card, border `#dfe3ea`, radius 12, flex-col, overflow hidden.
- **Header strip:** pad `8 11`, border-b `#eef1f5`. Title 12.5px/700 + subtitle 10.5px `#94a3b8` (ellipsis) + **เลือกหลายใบ** toggle (10.5px/600, off `#475569`/`#fff`/border `#e2e8f0`, on `#fff`/`#2563eb`/border `#2563eb`, radius 6, pad `3 8`).
- **Select-mode bar** (conditional): pad `7 10`, `bg#eff6ff` border-b `#dbeafe`. "เลือก N ใบ · ฿sum" 11px/700 `#1e3a8a` + ส่งทั้งหมด (primary) + ล้าง (ghost).
- **Scroll body:** pad 6, `overflow-y:auto`.
  - **Group header:** dot 5×5 (group color) + label 10.5px/700 uppercase letter-spacing .03em (group color) + hairline `#eef1f5` + count 10px `#94a3b8`. Groups: ต้องตรวจก่อน `#2563eb` · ติดปัญหา รอร้านตอบ `#b45309` · พร้อมตั้งขอโอน `#0f766e` · จบแล้ว `#64748b`.
  - **Item card:** pad `7 8`, radius 10, mb 5, border `#eef1f5` (active `#93c5fd`), bg `#fff` (active `#eff6ff`).
    - Row A: optional 15×15 checkbox (radius 4, border `#cbd5e1`→`#2563eb`) + vendor 12px/600 (ellipsis) + amount 12px/700 tabular.
    - Row B: "date · cat" 10px `#94a3b8` + optional "🖼 N" pics badge (9.5px/600 `#64748b` on `#f1f5f9` radius 4) + VAT tag (9.5px/600; ขอคืนได้ `#059669`/`#ecfdf5` · รอใบกำกับ `#b45309`/`#fffbeb` · else `#64748b`/`#f1f5f9`).
    - Row C (top border `#f4f6f9`, active `#dbeafe`): todo text 10.5px/700 (group color) + quick-action button (10.5px/700, one of the 4 QSTYLE variants above).

### C4 · Detail form (col2 · 1fr)
White card, radius 12, flex-col, overflow hidden.
- **Header** (`flex:none`, pad `9 13`, border-b `#eef1f5`): doc-no 14px/700 `'IBM Plex Sans'` + provenance line 10.5px `#94a3b8` ("ที่มา: LINE · AI: gemini-3.1-flash-lite · อัปโหลด …") · spacer · **ออกเอกสาร ▾** ghost (11.5px/600, border `#e2e8f0`, radius 8, pad `5 10`) · **status pill** (11px/700 radius 999 pad `5 10`; sent/ready/wait palette from §B).
- **Scroll body** (`flex:1 overflow-y:auto`, pad `11 13`, gap 10):
  - **Card A** (border `#e8ecf2`, radius 11, pad `9 11`) holds §1 and §2:
    - **§1 ลงบัญชี** — number badge 17×17 `#2563eb`, title 12px/700, hint 10.5px `#94a3b8`, right link "จำค่านี้ไว้ให้ผู้ขายรายนี้" (10.5px/600 `#2563eb`). Body = **2-col combo grid** (`1fr 1fr`, gap `8 10`): ประเภทค่าใช้จ่าย (with "AI 80%" pill) + สาขา/ศูนย์ต้นทุน. Both = searchable inputs, border `#93c5fd`, radius 8, 12.5px/600; dropdown = absolute panel border `#cbd5e1` radius 10 shadow `.18` max-h 196, options 12px/600 with code (10.5px `#94a3b8` mono) + label + hint.
    - dashed divider `#e8ecf2`.
    - **§2 ข้อมูลร้านค้าและเอกสาร** — number badge 17×17 `#334155`, title, right link "🕘 ดูประวัติผู้ขายรายนี้และราคาที่เคยซื้อ". Grid `1.4fr 1fr 1fr 1fr` gap `7 10`: ชื่อร้าน (+100% pill), ประเภทเอกสาร (select), เลขผู้เสียภาษี (+100%), วันที่ออก (+90% amber, border `#fcd34d`), รหัสสาขาผู้ขาย, ที่อยู่ผู้ขาย (`grid-column:span 2`). Standard inputs border `#e2e8f0` radius 8 12px/600.
    - **Payment sub-grid** `96px 1fr 1fr 104px` (top dashed divider): วิธีชำระ / บัญชีจ่ายออก / บัญชีรับโอน / กำหนดชำระ — all selects.
    - **Green VAT banner:** `bg#f2fbf5 border#bbf7d0 radius9 pad6 9` — "✓ ใบกำกับเต็มรูป · ขอคืน VAT ได้" 11px/700 `#166534` + detail `#15803d` + right link "เปลี่ยนสถานะภาษีซื้อ".
  - **Card B** (border `#e8ecf2`, radius 11, overflow hidden) = **§3 รายการและยอดเงิน**:
    - Header pad `9 11`: number badge 17×17 `#334155`, title, "2 รายการ · แก้…" hint, warn tag "1 รายการที่ AI ไม่มั่นใจ" (`#b45309`/`#fffbeb`/`#fde68a`), "+ เพิ่มรายการ" link.
    - **Table head** grid `20px 92px 1fr 148px 46px 74px 80px 44px` gap `0 7`, pad `5 11`, `bg#f8fafc`, 10px `#94a3b8`/600 — #, รหัส/SKU, ชื่อรายการ, ผังบัญชี(GL), จน., ราคา, รวม, AI.
    - **Rows** same grid, pad `5 11`, border-b `#f4f6f9`; inputs 11.5–12px, radius 6, border `#e8ecf2` (uncertain row bg `#fffdf5` + border `#fcd34d`); "รวม" cell 12px/700 tabular; AI cell = confidence pill (98% green / 62% amber).
    - **Totals grid** `1fr 92px 92px 92px 92px 150px` gap `0 9` pad `7 11` `bg#fbfcfe` align-end: note input + label "ช่องขอบเหลือง…" ; รวมรายการ (12.5px/600) ; ส่วนลด (amber input) ; VAT 7% (amber input) ; หัก ณ ที่จ่าย (standard input) ; **ยอดที่ต้องโอน** (left-border `#e8ecf2`, 17px/700 tabular "896.66 ฿").
- **Footer action bar** (`flex:none`, border-t `#eef1f5`, pad `8 13 9`, gap 8, `bg#fff`):
  - Left col: **pipeline chips** (ยืนยันแล้ว → ส่ง TRCloud → สร้าง AP/PV → ตั้งขอโอน) — 10px/600 radius 999 pad `2 7`, done `#166534`/`#ecfdf5`/`#bbf7d0` vs pending `#94a3b8`/`#f8fafc`/`#e2e8f0`, joined by "→" `#cbd5e1`; + pipelineNote + footNote (10.5px `#94a3b8`).
  - **พักไว้** (border `#e2e8f0`, `#475569`, radius 10, pad `10 12`).
  - **ตั้งขอโอน** (radius 10 pad `10 13`; idle `#0f172a` on `#fff` border `#e2e8f0`, done green).
  - **CTA** "ยืนยัน & ส่งเข้า TRCloud" (radius 10 pad `10 16`, 12.5px/700; ready `#fff` on `#2563eb` + shadow `.26`; not-ready `#94a3b8` on `#e2e8f0`; sent `#fff` on `#059669`).

### C5 · Receipt viewer (col3 top · dark) — **NEW build**
`flex:1 · bg#111827 · border #dfe3ea · radius 12 · flex-col · overflow hidden`.
- **Toolbar** (h34, `bg#1f2937`, `#e5e7eb`, pad `0 9`, gap 6): "ต้นฉบับ" 11.5px/600 + "รูป 1/3" 10.5px `#9ca3af` · spacer · buttons ‹ · › · ขยาย/ย่อ · หมุน · Drive↗ (each 11px, `bg#374151` hover `#4b5563`, radius 6, pad `3 8`).
- **Image stage** (`flex:1`, pad 9, center, `overflow:auto`): frame `width:74%|100%` (zoom), `aspect-ratio:1/1.4`, radius 4, `box-shadow 0 12px 30px rgba(0,0,0,.45)`, `bg#f8fafc`, holds the bill `<img>` (contain).
- **Thumbnail footer** (`bg#1f2937`, border-t `#374151`, pad `7 9`, gap 7): page thumbs 34×44 radius 5 (active border `#60a5fa` bg `#1d4ed8` fg `#fff`; idle border `#4b5563` bg `#374151` fg `#9ca3af`) + dashed "+" add-thumb + confidence note ("ความมั่นใจรวม 86%" — 86% in `#fbbf24`/700, rest `#9ca3af` 10px).

### C6 · Vendor history (col3 bottom · white) — **NEW UI, existing data**
`flex:none · bg#fff · border #dfe3ea · radius 12 · pad 9 11 · flex-col gap 6`.
- Title "ประวัติผู้ขายรายนี้" 11.5px/700.
- Rows (×3): date 10.5px `#94a3b8` mono + cat 11.5px (ellipsis) + amount 11.5px/600 tabular.
- Link "ใช้ค่าเดิมของใบล่าสุด (หมวด + สาขา + GL)" 10.5px/600 `#2563eb`.

### C7 · Filter overlay (conditional)
Backdrop `rgba(15,23,42,.28)` z40. Panel: absolute `top:100 right:16 width:392 z41`, `bg#fff` border `#cbd5e1` radius 14 shadow `.28` max-h 720. Header (title "ตัวกรอง (N)" 13px/700 + ✕) → search input (bg `#f8fafc`) → scrollable filter groups (label 11px `#64748b`/600 + wrap of pills: active `#1e293b`/`#fff`, idle `#f8fafc`/`#475569` border `#e2e8f0`, optional dot) → footer (ล้างตัวกรอง ghost + ดูผลลัพธ์ dark `#0f172a`).

---

## D. Reuse map (mockup region → existing component)

| Mockup region | Existing component / file | Verdict |
|---|---|---|
| Header toolbar (whole 52px row) | `LedgerHeader` + `CompanyBranchPicker` + `ExpenseSearch` + `HeaderToolsMenu` + `UploadReceiptButton` (`page.tsx:417-457`) | **REUSE data + actions**, but the mockup lays them out as one flat 52px bar → **NEW thin layout wrapper** for receipt-review mode (the current header stacks differently). |
| Kbd hints (J/K, ⌘⏎) | — | **NEW** (cosmetic; wire real J/K nav optional). |
| Stat bar VAT-warn pill | `CompletenessSummaryStrip` (`page.tsx:461`, from `summarizeCompleteness`) | **REUSE data**, restyle into the single amber pill. |
| Status chips (7) | `ExpenseStatusTabs` (`ExpenseStatusTabs.tsx:19-29`, drives `?status/tr/ap/pv/pay`) + `statusCounts` (`page.tsx:293-307`) | **REUSE** — same 7 tabs/counts already exist; render as pills. Labels differ slightly (mockup "ยังไม่ส่ง" vs code "ยังไม่ส่ง PO"). |
| ตัวกรอง button + overlay | `FilterSheet.tsx` (desktop centered card popover) | **REUSE** — already a single "ตัวกรอง (n)" popover; mockup anchors it top-right (cosmetic). |
| List rail header + multi-select toggle | `ExpenseList.tsx` bulk bar (`ExpenseList.tsx:488-567`) | **REUSE logic** (checked-set, bulkConfirm/Send/Convert/Void/ขอโอน). Mockup's "เลือกหลายใบ" toggle + blue select bar = **restyle**. |
| List item card (grouped) | `ExpenseList.tsx:871-1156` (card-per-row) + `StatusBadge`/`DocTag`/`PaymentTag`/`CompletenessDot`/`SOURCE_DOT` | **REUSE row data/chips**. Mockup adds **group headers** (ต้องตรวจ/ติดปัญหา/พร้อมโอน/จบแล้ว) — **NEW grouping layer** over `rows` (derive from status/payState/gate). Item shell = restyle. |
| Detail header (doc-no + provenance + status pill) | `ExpenseReviewPane.tsx` header region (`ocrModel`, `source`, `createdAt`) | **REUSE data**, restyle. |
| §1 ลงบัญชี (combo: หมวด + สาขา) | `ExpenseReviewPane.tsx:823-941` §1 + `SearchableSelect` | **REUSE** components + `saveExpense`. |
| §2 ข้อมูลร้านค้า (grid of vendor/tax/date/…) | `ExpenseReviewPane.tsx:944-1046` §2 + `DOC_TYPES` | **REUSE** fields/state. |
| Green VAT banner | `ExpenseReviewPane` claimability UI + `overrideClaimability` | **REUSE** logic. |
| §3 รายการและยอดเงิน (line-item table + totals) | `ExpenseReviewPane.tsx:1049-1287` §3 (`draft.items`, `AmountInput`, recheck) | **REUSE** — mockup lays items as a **flat 8-col table**; current pane uses stacked cards ≥768px. Table layout = **restyle** of the same state. |
| Footer action bar (pipeline + พักไว้ + ตั้งขอโอน + CTA) | `ExpenseReviewPane` confirm/save + `TrcloudButton` (`page.tsx:613`) + `createPaymentRequestAction` | **REUSE** actions. **Pipeline chips** (ยืนยัน→ส่ง→AP/PV→ขอโอน) = **NEW** derived-status strip. |
| **Receipt viewer (dark pane: big image + prev/next + zoom/rotate + thumb strip 1/2/3)** | `ReceiptThumb.tsx` (small thumb + fullscreen lightbox); §5 renders a `grid-cols-3` of ReceiptThumbs (`ExpenseReviewPane.tsx:1404-1416`) | **NEW — must build `ReceiptViewerPane`.** A dedicated dark multi-page viewer with active-page state, ‹/› paging, zoom(74%↔100%), rotate, and the 34×44 numbered thumb strip does **NOT** exist. **Data source EXISTS**: `Expense.originalUrl` + `Expense.attachments.filter(kind==='page')` (`lib/ledger/types.ts:67-73, 120-124`). Page 1 = `originalUrl/thumbUrl`; pages 2..N = attachments `kind:'page'`. Reuse `ReceiptThumb`'s PDF-guard + lightbox internals. |
| **Vendor history block ("ประวัติผู้ขายรายนี้")** | `lookupPurchaseHistoryAction(term, companyId)` (`_actions.ts:3207`, reuses `searchPurchases` → `{hits, trend, vendorCompare}`); trigger link already at `ExpenseReviewPane.tsx:957` | **DATA EXISTS — NEW compact card UI.** The always-visible 3-row list (date · cat · amount) + "ใช้ค่าเดิมของใบล่าสุด" is new; wire it to the existing action (call with `vendor` as `term`). "ใช้ค่าเดิม" can reuse `lastPayeeForVendor` (`_actions.ts:4004`) pattern / last-row values. |
| Full-bleed (no shell) | `admin-shell.tsx` `isDcFullBleedPath` early-return (`admin-shell.tsx:243-251`) | **REUSE mechanism** — extend condition (see §E). |

**Gaps to build NEW:** (1) `ReceiptViewerPane` dark multi-page viewer, (2) vendor-history compact card wired to `lookupPurchaseHistoryAction`, (3) group-header layer over the list, (4) pipeline-status chip strip, (5) the flat receipt-review page shell/layout that arranges everything into the 272/1fr/330 grid, (6) kbd-hint chrome (cosmetic).

---

## E. View-toggle integration + full-bleed mechanism

### E1 · How `ViewToggle` works (`components/recruit/view-toggle.tsx`)
- Pure presentational. Props: `current: "list"|"kanban"|"table"` + three **pre-built hrefs** (`listHref`, `kanbanHref`, `tableHref`).
- It renders `<Link>`s only — **the parent server page builds each href from the current searchParams**, so all active filters are preserved (the toggle never mutates params itself). Active segment gets `bg-white text-zinc-900 shadow-sm`; inactive `text-zinc-500`. Container = `inline-flex rounded-xl border border-zinc-200 bg-zinc-50/40 p-0.5`, each item `h-8 px-2.5 text-xs font-bold rounded-lg`.

### E2 · Add a 2-way toggle (โหมดเดิม ↔ โหมดตรวจใบเสร็จ)
- New component `LedgerViewToggle` (mirror recruit's): `current: "list"|"receipt-review"` + `listHref` + `reviewHref`, same styling.
- Build both hrefs in `page.tsx` from `baseParams` (which already encodes company/branch/status/tr/…): `listHref = /ledger/expenses?${baseParams}` ; `reviewHref = /ledger/expenses?${baseParams}&view=receipt-review`. Filters preserved by construction — identical to recruit's approach.
- Place it in the page `right={…}` header slot **next to `UploadReceiptButton`** (`page.tsx:449`).
- Add `view?: string` to the `searchParams` type. Derive `const view = sp.view === "receipt-review" ? "receipt-review" : "list";`. When `view === "receipt-review"`, render the NEW branch instead of the existing grid (`page.tsx:513-660`). **The existing list-mode JSX is untouched** — wrap in `view === "list" ? (<existing/>) : (<ReceiptReviewWorkspace .../>)`. All the same server data (rows, categories, selectedExpense, statusCounts, completenessSummary, projectOptions) feeds both branches.

### E3 · Full-bleed (hide the big left nav + top navbar) ONLY when `?view=receipt-review`
- The mockup is 1440px full-bleed with **no `w-64` sidebar** (`admin-shell.tsx:494`) and its **own** 52px toolbar (not the app's 56/64px `<header>`). To match, the receipt-review branch must escape all AdminShell chrome — exactly what `isDcFullBleedPath`'s early-return does (`admin-shell.tsx:243-251`, returns `<>{children}{Pinpoint}</>`).
- **`isDcFullBleedPath(pathname)` is path-only and returns `false`** — it cannot see `?view=`. BUT **`AdminShell` is already a `"use client"` component** (`admin-shell.tsx:1`) and already imports from `next/navigation` (`usePathname`, `useRouter` at line 6). **So it CAN read search params** — just add `useSearchParams()`.
- **Cleanest mechanism (recommended):**
  ```
  // top of AdminShell, next to usePathname()
  const searchParams = useSearchParams();
  const isReceiptReview =
    pathname === "/ledger/expenses" && searchParams.get("view") === "receipt-review";
  // change the early-return guard:
  if (isDcFullBleedPath(pathname) || isReceiptReview) { return (<>{children}{Pinpoint}</>); }
  ```
  Because AdminShell re-renders on soft navigation, toggling `?view=` flips the chrome **without a full reload** — the toggle "just works" and filters survive.
- **Suspense caveat:** `useSearchParams()` in a client component normally wants a `<Suspense>` boundary for static prerender, but `/ledger/expenses` is `export const dynamic = "force-dynamic"` (`page.tsx:33`) and AdminShell is already client — no new boundary needed. If lint/CI complains about a bare `useSearchParams`, wrap the AdminShell body once, or read it via a tiny child; not expected to be required here.
- **Alternative (if avoiding `useSearchParams` in the shell is preferred):** the admin `layout.tsx` (server) could read `searchParams`… but Next App-Router **layouts do NOT receive `searchParams`** (only pages do) — so this is *not* available server-side in the layout. Hence the client `useSearchParams` route is the clean one. (A last-resort signal — page setting a cookie/context — is more moving parts; not recommended.)

---

## F. Checklists

### 👁️ Pixel checklist (verify against mockup)
1. Outer frame bg `#eef0f4`; header + stat bars `#fff` with `1px #dfe3ea` bottom borders.
2. Header height exactly **52px**; stat bar exactly **46px**.
3. Main grid columns exactly `272px 1fr 330px`, gap `10px`, padding `10px`.
4. Logo tile 24×24, radius 7, bg `#1e293b`, white "P" 12px/700.
5. Header title 12.5px/700; subtitle 10px `#94a3b8`.
6. Upload CTA: `#fff` on `#2563eb`, radius 8, pad `7 12`, 12px/700.
7. Kbd chips: bg `#f8fafc`, border `#e2e8f0`, radius 5, `#475569`.
8. VAT-warn pill: `#b45309` on `#fffbeb`, border `#fde68a`, radius 999.
9. Status chip active = `bg#1e3a8a fg#fff`; inactive = `bg#f1f5f9 fg#475569`; radius 999; 11.5px/600.
10. ตัวกรอง count badge: `#fff` on `#2563eb`, radius 999.
11. All 3 column cards: border `#dfe3ea`, radius **12**.
12. List item card: radius **10**, `1px #eef1f5` border (active `#93c5fd`), bg `#fff` (active `#eff6ff`).
13. List multi-select checkbox 15×15, radius 4, border `#cbd5e1`→checked `#2563eb`.
14. Group-header dot 5×5 in group color; label 10.5px/700 UPPERCASE letter-spacing .03em.
15. pics badge "🖼 N": 9.5px/600 `#64748b` on `#f1f5f9`, radius 4.
16. VAT tags: ขอคืนได้ `#059669`/`#ecfdf5`; รอใบกำกับ `#b45309`/`#fffbeb`; else `#64748b`/`#f1f5f9`.
17. Quick-action variants exact: primary `#fff`/`#2563eb`; warn `#b45309`/`#fffbeb`/`#fde68a`; dark `#fff`/`#0f172a`; ghost `#475569`/`#fff`/`#e2e8f0`.
18. §-number badges 17×17 circle: §1 `#2563eb`, §2/§3 `#334155`, white 10.5px/700.
19. §1/§2 wrapped in ONE card border `#e8ecf2` radius **11**; dashed `#e8ecf2` between §1 and §2.
20. Combo/AI inputs border `#93c5fd`; amber (low-confidence) inputs border `#fcd34d`; standard `#e2e8f0`.
21. AI-confidence pills: ≥green `#059669`/`#ecfdf5`; amber `#b45309`/`#fef3c7`; radius 5, 9.5px/700.
22. §2 field grid ratio `1.4fr 1fr 1fr 1fr`; address spans 2 cols.
23. Green VAT banner: `bg#f2fbf5 border#bbf7d0 radius9`; text `#166534`/`#15803d`.
24. Line-item table grid `20px 92px 1fr 148px 46px 74px 80px 44px`, gap `0 7`.
25. Table head bg `#f8fafc`, 10px `#94a3b8`/600; row inputs radius 6 border `#e8ecf2`.
26. AI-uncertain line-item row bg `#fffdf5` + amber input borders.
27. Totals strip bg `#fbfcfe`, grid `1fr 92 92 92 92 150`; "ยอดที่ต้องโอน" 17px/700 tabular with left-border `#e8ecf2`.
28. Footer pipeline chips: done `#166534`/`#ecfdf5`/`#bbf7d0`, pending `#94a3b8`/`#f8fafc`/`#e2e8f0`, "→" `#cbd5e1`.
29. CTA ready: `#fff` on `#2563eb` + shadow `0 6px 16px rgba(37,99,235,.26)`; not-ready `#94a3b8`/`#e2e8f0`; sent `#fff`/`#059669`.
30. Receipt viewer pane bg `#111827`, radius 12; toolbar/footer `#1f2937` h34.
31. Viewer buttons `#374151` (hover `#4b5563`), radius 6, 11px, pad `3 8`.
32. Bill frame: `aspect-ratio 1/1.4`, radius 4, shadow `0 12px 30px rgba(0,0,0,.45)`, width 74%↔100% on zoom.
33. Page thumbs 34×44, radius 5; active border `#60a5fa` bg `#1d4ed8`; idle border `#4b5563` bg `#374151`.
34. Confidence note "86%" in `#fbbf24`/700, rest `#9ca3af` 10px.
35. History card: title 11.5px/700; rows date(mono `#94a3b8`)/cat/amount(tabular/600); link `#2563eb`.
36. Filter panel: `top100 right16 w392 radius14` shadow `0 22px 54px rgba(15,23,42,.28)`; backdrop `rgba(15,23,42,.28)`.
37. Combo dropdown shadow `0 14px 32px rgba(15,23,42,.18)`, border `#cbd5e1`, radius 10.
38. All money/qty/tax-id cells use `tabular-nums`.
39. Body font `'IBM Plex Sans Thai'`; codes/dates/doc-no `'IBM Plex Sans'`.
40. No horizontal page scroll at 1440; columns fill exactly (272 + gap + 1fr + gap + 330 within padding 10).

### ⚙️ Function checklist
1. `?view=receipt-review` renders the NEW 3-col workspace; absence (or `view=list`) renders the **existing untouched** grid (default = list mode).
2. `LedgerViewToggle` switches modes **without losing any active filter** (company/branch/status/tr/ap/pv/cc/q/tab/sort/nr/pay all survive via `baseParams`).
3. Toggling `?view=` flips AdminShell to full-bleed (hides `w-64` sidebar + app top navbar) via `useSearchParams` in `admin-shell.tsx`, and back — no full reload.
4. Clicking a list item loads it into the middle detail form (`?selected=` — existing `getExpense` path).
5. Receipt viewer shows page 1 (`originalUrl`) + pages 2..N (`attachments kind:'page'`); ‹/› and thumb clicks swap the big image; zoom toggles 74%↔100%.
6. Vendor-history card populates from `lookupPurchaseHistoryAction(vendor, companyId)`; empty vendor / no hits → graceful empty (no crash).
7. §1–§3 edits + Confirm/Save/ขอโอน/ส่ง TRCloud reuse existing server actions (no new write paths); NEVER auto-post (draft→confirm stays explicit).
8. Status chips + ตัวกรอง drive the same URL params as list mode (counts match `statusCounts`).
9. PDF receipts still render the `ReceiptThumb` PDF card (viewer must guard `isPdfUrl`).
10. Existing list mode remains byte-identical (diff shows only additive branch + toggle + shell condition).
