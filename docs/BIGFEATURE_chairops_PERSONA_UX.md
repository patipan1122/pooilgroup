# BIGFEATURE · ChairOps · UX Persona

> **Run:** /bigfeature ChairOps · Phase 3 · UX persona
> **Date:** 2026-05-27 · Scope: full ship (Wave 0-3)
> **Source:** Audit §3 IA + §5 wireframes · CHAIROPS_WAVE_PLAN_2026-05-27 · memory rules

---

## 1 · Journey map per role

### Office (8-hour day · 1-2 people)
```
 08:00 ──► open /chairops/office (default landing · NOT /chairops)
        │  see morning digest: "เมื่อวาน 3 สาขายังไม่ส่ง · 1 alert P0"
        │
 08:15 ──► click "ตามแม่บ้าน" → LINE OA template prefilled per maid
 09:00 ──► download StarThing XLSX from email · save to Desktop
 09:05 ──► drag XLSX into /chairops/pos-ingest (NEW · 2-click target)
        │  see diff preview · scan for "new branch?" prompts
 09:08 ──► click "บันทึก" → redirect to /chairops exec home · KPI updated
 10:00 ──► triage /chairops/reconcile · pick worst drift · investigate
 12:00 ──► lunch
 13:00 ──► approve write-offs · ack alerts · update damage tickets
 16:00 ──► review AI-extracted vendor bills in /chairops/bills (NEW · Wave 2)
 17:00 ──► EOD checklist: "อย่าลืม close วันนี้" (BR3 ปิดยอด button)
 17:30 ──► soft close · LINE OA digest auto-pushes to CEO at 18:00
```

### Maid (8 collect + 4 clean events per day · 30 people · all on phone)
```
 09:00 ──► clock-in via LINE OA rich menu (no app install)
 10:30 ──► [collect rotation 1] open LIFF Mini App → m/collect/new
        │  fill 4 fields · attach photo · submit · success page
 12:00 ──► [clean shift A] m/cleanliness · 10-toggle · "ทุกข้อปกติ" shortcut
 13:00 ──► [collect rotation 2] same flow
 15:00 ──► [damage spotted] m/damage/new · chair picker · photo · urgency
 17:00 ──► [clean shift B] m/cleanliness
 19:00 ──► [collect rotation 3] same flow · count cash · deposit photo
 20:00 ──► see m/ home: "วันนี้: 3 รอบ · ขาด 0 บาท · ปกติ ✓"
 20:15 ──► clock-out · LINE OA "พรุ่งนี้ 09:00"
```

### CEO weekly (2-3 check-ins · 5-10 min each)
```
 Mon 09:00 ──► LINE OA push: weekly summary (rev · cost · profit · top/worst 3)
 Mon 09:05 ──► click deep link → /chairops · scan 5 KPI tiles · drill worst branch
 Mon 09:10 ──► approve any pending high-value write-offs (>500฿ · BR per audit §3)
 Wed 18:00 ──► spot-check /chairops/reports/leaderboard for maid fraud signals
 Fri 17:00 ──► review /chairops/bills queue · 1-click approve AI-extracted bills
```

### CEO monthly (close period · review bills · ~30 min)
```
 Day 1   ──► /chairops/periods/2026-04 · scan summary · soft-close
 Day 3   ──► accountant runs /chairops/audit/export · BC/Express CSV
 Day 5   ──► review any AdjustmentRequest · approve/reject · reopen window
 Day 7   ──► hard-close · LINE OA push "เดือนเมษาปิดสมบูรณ์"
```

---

## 2 · Critical UX flows (must-be-perfect · step counts)

### Flow A · Office upload XLSX → see dashboard  (target: 4 steps)
```
1. Drag XLSX onto /chairops/pos-ingest dropzone   (1 action)
2. Server parses → show diff preview screen        (server-render)
3. Resolve any "branch ใหม่: 'xyz'" inline prompt   (0-3 actions · empty if names match)
4. Click "บันทึก ยอด N รายการ"                      (1 action) → redirect /chairops with toast
```
**Cite:** `app/(admin)/chairops/(office)/pos-ingest/new/upload-form.tsx` exists today · current page does NOT auto-redirect to exec home (line 215-218 returns to list view) — **gap to fix in W0.4**.
**Verdict:** "2-click upload" is **realistic ONLY IF** branch-name fuzzy-match resolves ≥95% of rows. CEO sample XLSX has consistent names per `[[chairops-starthing-xlsx-schema-2026-05-27]]`; risk is mall-rename mid-month.
**Edge cases to design:** (i) duplicate file upload — show "already imported on {date}" not error; (ii) zero new rows — show "ไฟล์นี้ไม่มีของใหม่ · กลับไปดูยอด" link; (iii) all rows error — block commit · show first 5 errors inline.

### Flow B · Maid collect cash → tally OK  (target: 5 steps)
```
1. Tap rich-menu [💰 เก็บเงิน] → LIFF opens m/collect/new
2. Tap chair (auto-filtered to assigned branch) or "ทุกตัว"
3. Type counted amount · numeric pad
4. Tap "ถ่ายรูปสลิป" → camera → confirm
5. Tap "บันทึก" → success page + drift indicator update
```
**Cite:** `app/(admin)/chairops/(maid)/m/collect/new/page.tsx` + `form.tsx` exist · currently 5-6 fields (per audit §5 staff P0 lists damage-success-page · same pattern). **Gap:** offline outbox v1 (IndexedDB) not wired yet — needed for "ห้างชั้น 4 WiFi ขาด ๆ" scenario.

### Flow C · Maid clean checklist → submit  (target: 3 steps)
```
1. Tap rich-menu [🧹 ตรวจคลีน] → m/cleanliness
2. Either tap "ทุกข้อปกติ ✓" (1-tap shortcut) OR toggle 10 checkboxes
3. Attach 1 photo · tap "ส่ง" → success
```
**Gap:** current `m/cleanliness/page.tsx` has list-of-reports but no "ทุกข้อปกติ" shortcut — IA Phase 3 P0.

### Flow D · CEO approves vendor bill from email AI extract  (target: 4 steps)
```
1. LINE OA push: "บิลใหม่ ห้างเซ็นทรัล · 45,000฿ · ครบ 30 เม.ย." → tap deep-link
2. Open /chairops/bills/[id] with PDF preview LEFT + extracted JSON RIGHT
3. Visually verify amount + due date match PDF
4. Tap "อนุมัติ" → mark APPROVED · audit-trail entry · LINE confirm push
```
**Cite:** `[[ceo-prefers-manual-ai-triggers]]` — AI populates form, CEO clicks button. **Never auto-approve.** Layout MUST be 2-pane (PDF + form) on desktop · stack on mobile.

### Flow E · Period close → adjustment → reopen  (target: 6 steps)
```
1. CEO opens /chairops/periods/2026-04 → "Soft close"
2. (Day 3) Office finds shortage missed by 200฿ → /chairops/adjustment/request
3. Office types reason + attachment → "ส่ง"
4. CEO LINE OA push → opens /chairops/adjustment/[id]
5. CEO reviews diff + clicks "อนุมัติ + เปิดยอด 24 ชม."
6. Period status → REOPENED_WINDOW · 24h timer · auto-hard-close after
```
**Cite:** Audit §3.3 — all 3 routes (`periods/[ym]`, `adjustment/request`, `adjustment/[id]`) are NEW · Wave 2.

---

## 3 · Alternative solutions considered + rejected

| Alternative | Why considered | Why rejected |
|---|---|---|
| **Gmail forward-to-system** instead of OAuth poll | Lower infra · no token refresh | Bills as PDF attachments need re-fetching · forward strips reply-to context · Wave 2.2 spec says cron-poll Gmail label is fine because CEO already manages a label |
| **Phone IVR** for maid collect instead of LINE OA | Older maids may struggle with smartphones | Maids already in 30 LINE groups today (per `[[chairops-line-group-structure-current]]`) · they own LINE accounts · IVR adds telco cost + transcription noise |
| **Per-tenant LINE channel** vs single channel | Future multi-org scale | CEO owns 1 ChairOps biz (per Wave Plan D-NEW-E) · 1 channel · revisit if 2nd tenant signs |
| **CSV instead of XLSX** for POS ingest | Simpler parser | StarThing exports XLSX only · 42 tabs in source sheet (per `[[chairops-sheet-42-tabs]]`) · must support XLSX |
| **Auto-approve high-confidence AI bills** (>95% score) | Faster CEO turnaround | Violates `[[ceo-prefers-manual-ai-triggers]]` · 1 wrong auto-approve = trust collapse · always-manual is cheap (CEO 30 sec) |
| **Single shared LINE group with all 30 maids** instead of OA | Cheaper, no OA fee | The pain point IS 30 noisy groups · adding another group makes it worse · OA = 1-to-1 DM with each maid · clean |

---

## 4 · Patterns to reuse (from Pool ecosystem · cited)

| Pattern | Source | Apply in ChairOps |
|---|---|---|
| **3-pane workspace shell** | `components/chairops/_kit/master-detail-shell.tsx:1-84` (already forked · keep) and `components/recruit/applications-inbox.tsx:1` (Recruit 3-pane) | Use for `/chairops/office` · `/chairops/reconcile` · `/chairops/bills` · `/chairops/damage` |
| **View tabs + biz filter** | `components/repair/view-header.tsx:1-150` (Overview/Inbox/Table tabs + `?company=` URL param) | Use for `/chairops` exec home view-toggle (Today/Week/Month) + branch filter |
| **Diff preview before write** | `components/chairops/_kit/diff-bucket-pills.tsx` + `pos-ingest/i/[id]/diff-table.tsx` already wired | Already correct · just shorten redirect path post-commit |
| **Sticky thead solid bg** | `chairops/_kit/master-detail-shell.tsx:91-97 stickyTheadClass()` helper · `[[sticky-thead-pattern]]` · `[[sticky-bg-inherit-anti-pattern]]` | All list pages |
| **AI manual approval queue** | `components/recruit/applications-inbox.tsx` triage pattern · `[[ceo-prefers-manual-ai-triggers]]` | `/chairops/bills` queue identical pattern |
| **LINE OA + LIFF init + HMAC verify** | `[[recruit-omnichannel-prod-2026-05-23]]` · `lib/recruit/inbox/*` · AES-256-GCM token encryption | Copy directly into `lib/chairops/line-oa/` |
| **Offline outbox v1 (IndexedDB)** | ClawFleet collect-form `components/clawfleet/collect-form.tsx` + `photo-capture-button.tsx` | Apply to maid PWA m/collect/new |
| **Command palette + multi-pane** | `components/playland/command-palette.tsx` (Playland · cites `[[ceo-prefers-multi-pane-workspace]]`) | Optional W3.3 nicety · cmd-K to jump branch/maid/date |
| **KPI tile + delta arrow** | `components/chairops/_kit/kpi-tile.tsx` already shipped · used at `app/(admin)/chairops/page.tsx:104-145` | Already correct — extend with sparkline in W3.3 |
| **Period-close + adjustment** | New pattern (no precedent in Pool · CashHub closes daily, not monthly) | Build clean in Wave 2 — model after accounting-software UX (Quickbooks-style soft/hard close indicator) |

---

## 5 · Friction points in current UX (from audit + actual file inspection)

1. **Audit §3.4 "4 nav shells" problem** — current `admin-shell.tsx · dashboard/layout.tsx · dashboard-office/layout.tsx · MaidShell` all fight. Office user clicks "ความสะอาด" → 403 because that tab is MAID-only. Consolidating to 2-shell (office route group + maid route group) is W1.4 deliverable.
2. **`/chairops/page.tsx:90-96` — "รีเฟรช" link points back to `/chairops`** — placebo refresh. Replace with router.refresh() client island OR a real "เพิ่งอัพเดท XX วินาทีก่อน" stamp.
3. **Branches leaderboard click target unclear** — `_components/branches-leaderboard` rows don't obviously click-through (audit §5.2 row /chairops); CEO expects card-style with explicit arrow.
4. **Maid home (`m/page.tsx:148-158`) — primary CTA is "เก็บเงินรอบใหม่" but no secondary CTA for "ตรวจคลีน" / "แจ้งซ่อม"** — maid must scroll-up to bottom-nav each time. Add 3-button row under primary CTA.
5. **POS ingest list (`pos-ingest/page.tsx:104-108`) — "อัปโหลด POS CSV" CTA mentions CSV but spec is XLSX** — wording drift · update to "อัปโหลด POS XLSX (StarThing)".
6. **No "ใครยังไม่ส่งวันนี้" panel on `/chairops`** — CEO must visit `/chairops/office` to find it. Wave 0 should promote this onto exec home OR add a tile.
7. **30-branch × 4-task status grid is spec'd but not built** — audit §5 mandates it for office dashboard · currently the dashboard-office route is orphan (per IA Phase 3 P0).
8. **No breadcrumb anywhere** — audit §3.4 IA flagged this · drilling into a branch gives no "back to all branches" path.

---

## 6 · Mobile-first checks (maid PWA · Android 7-9 · 3G WiFi · gloves)

| Concern | Status today | Required fix |
|---|---|---|
| **Tap target ≥ 48×48** | `m/page.tsx:152` primary CTA `h-14` (56px) ✓ · KPI tiles `h-auto p-3` (probably 64px) ✓ | Audit chair-picker grid · ensure ≥48px squares · gloves OK at 56px |
| **Font ≥ 16px** to prevent iOS zoom-in | KPI tiles `text-base` ✓ but `text-xs` on metadata may be 12px — fine for screen-real-estate but **never on form labels** | Form inputs in `m/collect/new/form.tsx` MUST be `text-base` (16px) |
| **Photo upload <2MB** | R2 presign exists at `app/api/chairops/r2/` but no client-side compression | Add `browser-image-compression` before upload · target 1MB · maintain EXIF |
| **Offline outbox** | Not wired today | IndexedDB queue · clientToken for idempotency · sync-on-online with retry-3x |
| **3G ‹ 200ms render** | Server-render all maid pages ✓ already · `dynamic = "force-dynamic"` at `m/page.tsx:24` | Keep · avoid client islands except form + camera |
| **Glove tap (cold mall AC)** | Tap targets large enough · BUT inputs use native `<input>` — capacitive gloves work | Test on real device with ChairOps maid Day 1 of Wave 1 pilot |
| **LIFF init failure** | Not yet wired | Fallback: if `liff.isInClient()` false, show "เปิดผ่าน LINE OA ก่อน" · do not error |
| **Battery / camera permission** | First-time prompt unexpected | Pre-explain screen: "ระบบจะขอเปิดกล้องเพื่อถ่ายสลิป" before triggering native permission |

---

## 7 · LINE OA + LIFF integration UX

### Rich-menu structure (6 cells · 2×3 grid)
```
┌─────────────┬─────────────┬─────────────┐
│  💰 เก็บเงิน  │  🧹 ตรวจคลีน │  🔧 แจ้งซ่อม  │
├─────────────┼─────────────┼─────────────┤
│  📦 เบิกของ  │  📊 สรุปวันนี้│  👤 โปรไฟล์  │
└─────────────┴─────────────┴─────────────┘
```
Each cell opens LIFF wrapping existing `/chairops/m/*` route. The 5th cell ("สรุปวันนี้") is the maid home `/chairops/m/` — gives CEO-style at-a-glance for the maid herself.

### LIFF init flow
```
1. Tap rich-menu cell → LINE opens LIFF webview
2. JS: liff.init({ liffId }) → liff.getProfile() → userId + displayName
3. POST /api/chairops/line/liff-resolve → lookup ChairopsLineMaidMap
   - If mapped: set session cookie · render route
   - If unmapped: redirect /chairops/m/profile?bind=1 · OTP-link to maid record
4. Subsequent navigations: cookie persists across LIFF tabs
```

### Context handoff (CEO deep-link)
- LINE OA push to CEO: "บิลใหม่ · 45,000฿ · เปิดดู"
- Deep-link: `https://t.me/chairopsBot?startapp=bill_xxx` → resolves via `/api/chairops/line/deeplink/[token]`
- Token = 1-time JWT · expires 24h · audit-logged

### Offline behavior
- If LIFF loads but request fails: form draft saves to IndexedDB
- Top banner: "ออฟไลน์ · จะส่งเมื่อกลับเข้า WiFi"
- `navigator.onLine` listener · auto-flush queue on reconnect

---

## 8 · Information architecture — `/chairops` exec home

**5 KPI tiles (top row · click-through · per audit §3 row "/chairops"):**

| # | Tile | Source query | Click → |
|---|---|---|---|
| 1 | ยอดขาย POS วันนี้ | `kpis.todayPosRevenue` (exists) | `/chairops/pos-ingest` |
| 2 | ฝากแม่บ้านวันนี้ | `kpis.todayDepositTotal` (exists) | `/chairops/reconcile` |
| 3 | ยอดขาดสุทธิสะสม | `kpis.cumulativeDriftTotal` (exists · drives `[[chairops-no-cumulative-shortage]]`) | `/chairops/reconcile?filter=drift` |
| 4 | สาขามี shortage | `kpis.shortageBranchCount` (exists) | `/chairops/reconcile` |
| 5 | Alerts P0 ค้าง | `kpis.criticalOpenAlertCount` (exists) | `/chairops/alerts?level=CRITICAL` |
| **6 (NEW)** | **กำไรสุทธิวันนี้** | revenue − dailyCost (W0.2 new ChairopsBranchDailyRevenue) | `/chairops/reports/leaderboard` |

CEO goal "รู้กำไรสุทธิต่อสาขา/วัน" (per goal §business goal 4) is **not yet on exec home** — Wave 0 must add tile #6. Current `page.tsx:99` says 5-col grid · need to drop to 6 tiles in 3×2 mobile, 6-col strip on desktop.

---

## 9 · `/chairops/dashboard-office` 30×4 status grid layout

**Goal:** 30 branches × 4 daily tasks (collect / clean-A / clean-B / damage-check) in 1366×768 view.

**Math:** 1366px viewport − 220px sidebar − 32px padding = 1114px usable. Need columns for: branch name (140px) + 4 task cells (60px each = 240px) + drift (90px) + maid name (110px) + actions (90px) = 670px. **Fits with room to spare.**

**Vertical:** 30 rows × 36px row height = 1080px > 768px — **must scroll**, sticky thead per `[[sticky-thead-pattern]]`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ /chairops/office · เช้านี้                          [↻ รีเฟรช]      │
├─────────┬────────────────────────────────┬─────────────────────────┤
│ Sidebar │ Morning Digest (1 row)                                    │
│ 220px   │ ┌──────────────────────────────────────────────────────┐ │
│         │ │ 🟡 5/30 สาขายังไม่ส่ง · 🔴 2 P0 alert · 💰 ขาด 1,200฿ │ │
│ Today   │ └──────────────────────────────────────────────────────┘ │
│ Yest.   │                                                          │
│ Week    │ 30×4 Status Grid (sticky thead)                          │
│ ─────   │ ┌─Branch──┬─💰─┬─🧹A─┬─🧹B─┬─🔧─┬─Drift─┬─Maid───┬─Act─┐│
│ Pin     │ │ Central │ ✓  │ ✓   │ ⏳  │ ✓  │   0   │ น้อง A │ →  ││
│ Esplan. │ │ Esplan. │ ✗  │ ⏳  │ ⏳  │ ✓  │ -200  │ น้อง B │ 📱 ││
│ ...     │ │ ...     │    │     │     │    │       │        │    ││
│         │ │ (30 rows scrollable · sticky thead top-14)            ││
│         │ └────────┴────┴─────┴─────┴────┴───────┴────────┴─────┘│
└─────────┴────────────────────────────────────────────────────────┘
```

**Cell legend:** ✓ done · ⏳ pending · ✗ missed · 📱 = "ส่ง LINE OA prefilled message" 1-tap.

**Multi-pane compliance** (`[[ceo-prefers-multi-pane-workspace]]`): NO "list → new page → back". Clicking a row opens a right-rail drawer (or third pane on lg+) showing branch detail · staying on dashboard. Use `MasterDetailShell` with right meta pane.

---

## 10 · UX sign-off conditions

| Condition | Wave | Status |
|---|---|---|
| Tile #6 "กำไรสุทธิ" on exec home | W0 | ❌ MUST ADD |
| Auto-redirect to `/chairops` after commit | W0 | ❌ MUST FIX |
| StarThing branch fuzzy-match resolves ≥95% | W0 | ❓ verify with CEO sample |
| 30×4 status grid sticky thead solid bg | W1 | new build |
| Maid offline outbox v1 (IndexedDB) | W1 | new build |
| "ทุกข้อปกติ" shortcut on m/cleanliness | W1 | new build |
| LINE OA rich menu 6-cell + LIFF init | W1 | new build |
| Bills 2-pane PDF + form layout | W2 | new build |
| Period-close + adjustment 6-step flow | W2 | new build |
| Audit page 11-chip filter | W3 | new build |
| Breadcrumb scheme on every detail page | W3 | new build |

---

**END · UX persona · 992 words**
