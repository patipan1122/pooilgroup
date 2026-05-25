# AUDIT — ChairOps Module · 2026-05-25

> **Run:** `auditbigteam` ChairOps · 17 personas · 5 phases (Phase 0 briefing → Phase 1 Discovery → Phase 2 Design Sprint → Phase 3 Critique → Phase 4 Consolidation)
> **Repo:** `pooilgroup/legacy/pooilgroup-web` · commit `5cd5456`
> **Schema state at audit:** 16 `Chairops*` Prisma models live in `chairops` Postgres schema · 27+ admin/api routes shipped via commit `5e3a6d2`
> **Mode:** READ-ONLY spec · no feature code committed in this run
> **Output owners:** CEO sign-off + 4 Wave-1 implementers (BE/FE/IA/UX)

---

## § 1 · Executive Summary

ระบบ ChairOps ตอนนี้ **ขึ้น production แล้วเงียบ ๆ** — 16 ตาราง + ~27 หน้าจอ + 5 API routes ตามรอย commit `5e3a6d2` "chairops: full integration as Pool Command Center module" · แต่ memory ของผมยังบอกอยู่ว่า "build NOT started" (stale) · กฏข้อ #1 หลัง audit คือ retire memory ผิด + เขียนใหม่ว่า "ChairOps live on prod"

ทีม 17 personas (เพิ่ม OFC/FIN/AUD/SRE จากสูตรเดิม 13) เห็นพ้องว่า **structure ถูก แต่ enforcement และ design polish ขาด:**

- **16 conditional-PASS · 1 HARD-FAIL** · ตัวที่ FAIL คือ DEVIL ที่ flag overengineering 60-70% (BA + IA + FE + UX สี่คนสร้าง spec รวมกัน 4,000+ บรรทัด · 14 wireframes · 24 BRs · 12-14 primitives · 10-14 new tables ก่อนแม่บ้านเก็บคนแรกเกิดขึ้น)
- **5 ความเสี่ยงใหญ่ที่สุดถ้าลุย pilot วันนี้:** (1) Drift engine คำนวณ **lifetime sum** ไม่ใช่ window — BR2 zero-tolerance ที่ CEO ยืนยันไม่บังคับจริง (2) `vercel.json` **ไม่ลงทะเบียน cron** ChairOps สาม route เลย — drift recompute · sop-check · CEO digest **ตายเงียบ** (3) Module entitlement gate **ขาดทุก /chairops layout** — Pool driver ใด ๆ เข้าไปเก็บเงินสดได้โดยอัตโนมัติ (4) `getSession` auto-bootstrap **สร้าง ChairopsUser ใหม่ทันที** ที่ click เข้า · derive role จาก Pool · pool admin = chairops ADMIN เลย (5) LINE Notify ใกล้ EOL (sunset ปี 2025) · ทั้งระบบ alert ยังพึ่ง API ตัวที่จะตาย
- **ตัดสินใจที่ต้องทำในวันนี้:** เลือก 1 ใน 2 ทาง
  - **ทางลุย (DEVIL HARD FAIL):** ทำตาม spec ครบทุก wave → ~22 routes · 24 BRs · 10-14 ตารางใหม่ · 2-3 sprint · เสี่ยง spec ที่ไม่มี user validate ก่อนสร้าง
  - **ทางตัด (DEVIL recommend):** Wave 0 fixes + Phase 2.5 cut session → ตัด 60-70% · ship 5 routes · 3 BRs · 4 primitives · validate 1 สาขา · ค่อยขยาย

**ใครต้องทำอะไรต่อ (CEO sign-off list):**
1. CEO ตัดสิน Wave-1 scope (ลุยทั้งหมด หรือ DEVIL floor)
2. CEO ตอบ 6 P0 questions (POS vendor · maid count 91 vs 1,200 · area-manager exist · LINE Notify migration plan · period-close priority · TECHNICIAN role)
3. CEO อนุมัติ 8 D-### locked decisions (ChairOps live · window drift · LINE migration · audit immutability · `.chairops-scope` rename · MANAGER_AREA rank 3 · orgId migration · Phase 2.5 cut session)
4. CEO หา sponsor + เลือก 1 สาขา pilot + กำหนด go-live target date

---

## § 2 · Scope (IN / OUT / DEFERRED-HW)

### 2.1 IN scope (audited)

| Category | Items | Source |
|---|---|---|
| Admin routes (current) | 14 page-level: `accounts · alerts · audit · cleanliness · collect · damage · dashboard · dashboard-office · parts · pos-ingest · reconcile · reports · users · write-offs` (+ sub-routes) | `app/(admin)/chairops/*` |
| Admin routes (Phase 2 proposed) | +13 new: `manager · office · branches · chairs · settings · supply-requests · reports/leaderboard · periods/[ym] · adjustment/* · access-request · disputes · audit/export/[id] · m/profile · m/damage/success` | IA Phase 2 §1.2 + BA Phase 3 P0 |
| **Total proposed route count** | **37 page.tsx + 6 layout.tsx = 43 page files** (vs current 30 page + 8 layout = 38) | Net +5 page + (-2 layout consolidation) |
| Prisma models (current) | 16 in `chairops` schema (Branch · User · MaidAssignment · Chair · PosImport · PosDaily · CashCollection · Drift · Alert · WriteOff · DamageTicket · SparePart · SparePartMovement · CleanlinessReport · AuditLog · BankAccount) | `prisma/schema.prisma:2768-3168` |
| Prisma models (Phase 2 new) | +10: ReconcilePeriod · FiscalPeriod · CollectionLine · IdempotencyKey · CronRun · ManagerArea · OfficeAssignment · LineSendOutbox · AdjustmentRequest · JournalEntry · PayrollDeductionQueue · Dispute · WriteOffPolicy · PeriodReopenLog | BA Phase 2 + SA Phase 3 patches |
| API routes | 5: `audit-export · cron/sop-check · cron/recompute-drifts · cron/ceo-digest · r2/presign` + Phase 2 proposed `cron/alert-escalator · cron/damage-sla · cron/idempotency-sweep · cron/r2-orphan-sweep · line-deeplink/[token] · search` | `app/api/chairops/*` |
| Lib | `lib/chairops/` (auth · reconcile · utils · schemas · storage · audit · line) | Full audit by BE persona |
| Components | `components/chairops/{ui,features}/*` (4 forked primitives flagged DELETE by FE) | FE Phase 2 §1.2 |

### 2.2 OUT of scope

- Pool modules อื่น: CashHub · DocuFlow · Recruit · Repair · FuelOS · Playland · ClawFleet
- Buildly Go (separate Vercel + Supabase project)
- Pooil legacy archive (`pooilgroup/legacy/` other dirs)

### 2.3 DEFERRED-HW (hardware-blocked · MOCKABLE)

| Item | Status | Mock strategy |
|---|---|---|
| POS vendor API | 🔴 HW_BLOCKED · vendor TBD | CSV upload (already wired in `pos-ingest`) |
| CCTV anti-fraud | 🔴 HW_BLOCKED · not in v0.2 | Manual photo upload + watermark on display |
| Cash deposit device | 🔴 HW_BLOCKED · not in plan | Maid manual entry + slip photo |
| Face/QR maid identity | 🔴 HW_BLOCKED · not in scope | Standard login + LINE OAuth optional |
| LINE Notify | 🟡 MOCKABLE · EOL 2025-03-31 | **Must migrate to LINE Messaging API before pilot** (SRE Phase 1 + 3) |
| R2 photo storage | 🟢 BUILDABLE · 10GB free tier ok for pilot 1 branch | Lifecycle policy + compression must ship |
| Vercel cron (`CRON_SECRET`) | 🟢 BUILDABLE · just set env + add 5 entries to `vercel.json` | (Currently 0 entries · highest pilot blocker) |

---

## § 3 · Sitemap (from Phase 2 IA · with Phase 3 patches)

### 3.1 Final 2-shell sitemap (route group structure)

**Two route groups:** `app/(admin)/chairops/(office)/` (desktop top-nav + 3-pane) and `app/(admin)/chairops/(maid)/` (mobile bottom-nav)

| Path | Who | Why (JTBD) | KPI | Click depth | Entitlement |
|---|---|---|---|---|---|
| `/home` | all | Pool launcher · ChairOps card lands by role | module CTR | 0 | `userHasModuleAccess(user, 'chairops')` |
| `/chairops` (NEW redirect) | all | Role-aware redirect to default landing | — | 0 | session check only |
| `/chairops` (executive home) | MANAGER+ | 5 KPI tiles + 30-branch table + alert feed + write-off badge | shortageCount · missedCount · todayRevenue · pendingWriteoffCount · cumulativeDriftTotal | 1 | `assertModuleEnabled('chairops') && rank>=MANAGER` |
| `/chairops/all-branches` | MANAGER+ | TV grid grouped by mall | branchHealthMix | 2 | `rank>=MANAGER` |
| `/chairops/b/[branchSlug]` | MANAGER+ AREA | 30-day per-branch timeline + sub-tabs | drift trend · ticketCount · cleanlinessRate | 2 | `rank>=OFFICE && areaCanSee(branchId)` |
| `/chairops/office` (NEW) | OFFICE default landing | Morning digest · "ใครยังไม่ส่ง" + LINE template · EOD summary | pendingTasksCount | 1 | `role==OFFICE` |
| `/chairops/manager` (NEW) | MANAGER_AREA default landing | Area morning view · "รออนุมัติของฉัน" + area FAILs + overdue repairs | pendingMineCount · areaMissedCount | 1 | `rank==MANAGER_AREA` |
| `/chairops/reconcile` | OFFICE+ | Drift list sortable · "ใครยังไม่ส่ง" panel | totalDrift · shortageBranches · missedCount | 2 | `rank>=OFFICE && areaScope` |
| `/chairops/reconcile/b/[branchSlug]` | OFFICE+ AREA | Branch reconcile timeline + write-off request | driftAgeHours | 3 | `rank>=OFFICE && areaCanSee` |
| `/chairops/pos-ingest` | OFFICE+ | POS CSV import queue · filter | pendingImports · committedToday | 2 | `rank>=OFFICE` |
| `/chairops/pos-ingest/new` | OFFICE+ | Upload CSV · drag-drop · dup detect | rowsParsed | 3 | `rank>=OFFICE` |
| `/chairops/pos-ingest/i/[filename]` | OFFICE+ | Diff preview (4 buckets) + commit (no self-commit) | new/same/changed/error | 3 | `rank>=OFFICE && uploaderId !== userId` |
| `/chairops/alerts` | OFFICE+ AREA | Alert center · 7 kinds · bulk ack/resolve · saved filter | open · ack · critical | 2 | `rank>=OFFICE && areaScope` |
| `/chairops/write-offs` | OFFICE+ (approve MANAGER/CEO) | Pending + history · bulk approve <500 | pendingCount · approvalLatencyHours | 2 | `rank>=OFFICE`; approve = `canApproveWriteOff(amount, role)` |
| `/chairops/write-offs/new?branch=&drift=` | OFFICE | Request write-off (maker) | n/a | 3 | `role==OFFICE` |
| `/chairops/damage` | TECH/MGR+ AREA | Ticket list · 6-filter | OPEN/IN_PROGRESS counts | 2 | `rank>=OFFICE && areaScope` |
| `/chairops/damage/d/[ticketCode]` | TECH/MGR+ AREA | Ticket detail + parts request + photo gallery | ageHours | 3 | `rank>=OFFICE && areaCanSee` |
| `/chairops/parts` | OFFICE+ | Spare parts catalog · low-stock filter | lowCount · stockValue | 2 | `rank>=OFFICE` |
| `/chairops/parts/p/[partCode]` | OFFICE+ | Part detail + movement ledger | stockOnHand | 3 | `rank>=OFFICE` |
| `/chairops/supply-requests` (NEW) | OFFICE+ AREA | Supply request workflow new/approved/shipped/received | pendingCount | 2 | `rank>=OFFICE && areaScope` |
| `/chairops/supply-requests/r/[requestCode]` (NEW) | OFFICE+ | Request status + approve/ship/receive | statusAge | 3 | `rank>=OFFICE`; approve = `rank>=MANAGER_AREA` |
| `/chairops/cleanliness` | MGR+ AREA | Audit overview · FAIL escalation queue | passRate · failConsecutive | 2 | `rank>=MANAGER_AREA && areaScope` |
| `/chairops/cleanliness/r/[reportId]` | MGR+ AREA | Per-report + escalate manager | escalationLevel | 3 | `rank>=MANAGER_AREA` |
| `/chairops/reports` | MGR+ | Hub: monthly · export · cleanliness 30d | passRate | 2 | `rank>=MANAGER` |
| `/chairops/reports/monthly` | MGR+ | Per-branch monthly P/D/D/W | monthlyDrift | 3 | `rank>=MANAGER` |
| `/chairops/reports/leaderboard` (NEW) | CEO+ | Per-maid shortage leaderboard (fraud surface) | worstMaidShortage | 3 | `rank>=CEO` |
| `/chairops/reports/export` | MGR+ | CSV/XLSX export · BC/Express template · GL codes | rowsExported | 3 | route handler · `rank>=MANAGER` |
| `/chairops/branches` (NEW · was unreachable) | ADMIN | Branch master CRUD | n/a | 2 | `role==ADMIN` |
| `/chairops/branches/b/[slug]` (NEW) | ADMIN | Branch detail · mall · chairs · maid | n/a | 3 | `role==ADMIN` |
| `/chairops/chairs` (NEW) | ADMIN | Chair master CRUD · 91-1200 chair audit | totalChairs · activeChairs | 2 | `role==ADMIN` |
| `/chairops/chairs/c/[chairCode]` (NEW) | ADMIN | Chair detail + repair + revenue | revenuePerChair | 3 | `role==ADMIN` |
| `/chairops/users` | ADMIN | User list · 4-filter | activeUsersByRole | 2 | `role==ADMIN` |
| `/chairops/users/u/[email]` | ADMIN | Edit user · role · area · branch | roleChangeEvents | 3 | `role==ADMIN` |
| `/chairops/users/new` | ADMIN | Create user · invite | n/a | 3 | `role==ADMIN` |
| `/chairops/accounts` | OFFICE+ | Bank accounts CRUD inline | activeAccounts | 2 | `rank>=OFFICE` |
| `/chairops/audit` | CEO+ | Audit log · 6-filter · pagination | actionsPerDay | 2 | `rank>=CEO` |
| `/chairops/audit/e/[entity]/[entityId]` | CEO+ | Per-entity audit trail | n/a | 3 | `rank>=CEO` |
| `/chairops/audit/export/[exportId]` (NEW) | CEO+ | Audit-of-auditors trail (per BR6) | n/a | 3 | `rank>=CEO` |
| `/chairops/settings` (NEW) | ADMIN | Settings hub · write-off threshold · LINE matrix · escalation timers | n/a | 2 | `role==ADMIN` |
| `/chairops/periods/[YYYY-MM]` (NEW · P0) | CEO+ | Period-lock UI · soft/hard close · adjustment review | periodStatus | 2 | `rank>=CEO` |
| `/chairops/adjustment/request?ref=&drift=` (NEW · P0) | OFFICE+ | Submit adjustment request for closed period | n/a | 3 | `rank>=OFFICE` |
| `/chairops/adjustment/[requestId]` (NEW · P0) | CEO+ | Approve/reject adjustment + reopen window | requestAgeHours | 3 | `rank>=CEO` |
| `/chairops/disputes` (NEW · P0) | OFFICE+ AREA | Dispute machine state board | openDisputeCount | 2 | `rank>=OFFICE && areaScope` |
| `/chairops/access-request` (NEW · P0 BR12) | session-auth only | First-touch deny + request access | n/a | 1 | auth check only · no role |

### 3.2 Maid shell · `(maid)` route group

| Path | Who | Why | Click depth |
|---|---|---|---|
| `/chairops/m` | MAID | Maid home · greeting + today drift + big CTA + recent | 1 |
| `/chairops/m/collect` | MAID | Today collection list | 1 |
| `/chairops/m/collect/new` | MAID | Record collection · offline-queue · clientToken dedup | 2 |
| `/chairops/m/collect/c/[id]` | MAID + checker | Detail (read-only after lock) | 2 |
| `/chairops/m/cleanliness` | MAID | Recent reports + add new | 1 |
| `/chairops/m/cleanliness/new` | MAID | Submit · 6 toggle (default=null) + photo | 2 |
| `/chairops/m/damage/new` | MAID | Create ticket · chair picker | 2 |
| `/chairops/m/damage/success/[code]` (NEW · STAFF P0) | MAID | Success page · big code + LINE share | 3 |
| `/chairops/m/profile` (NEW) | MAID | Profile + logout (moved out of bottom-nav) | 2 |

### 3.3 IA Phase 3 P0 patches (5 missing routes ADD)

| Missing route | Source | Why it blocks pilot |
|---|---|---|
| `/chairops/periods/[ym]` | BA BR5 period-lock | CEO cannot soft/hard close month-end without UI |
| `/chairops/adjustment/request + /adjustment/[id]` | BA §7 reopen flow | OFFICE submit + CEO approve 24h reopen — no UI = closed period changes go silent |
| `/chairops/access-request` | BR12 bootstrap-deny | First-touch users have no exit path |
| `/chairops/disputes` | BA §2.3 dispute machine | Dispute state OPEN→RESOLVED_MAID/OFFICE/WRITEOFF_REQUESTED has no UI |
| `/chairops/audit/export/[exportId]` | BR6 audit-of-auditors | Cannot trace who exported CSV without UI |

### 3.4 Nav consolidation diagram

**Current state (BROKEN · 4 shells):**
```
admin-shell.tsx          dashboard/layout.tsx       dashboard-office/layout.tsx   MaidShell (inline 3x)
   9 items                  6 items                       4 items                     4 tabs
   /settings = 404          ความสะอาด = MAID-403         /dashboard-office = orphan   "ออก" in bottom-nav
                                                                                       (mis-tap risk)
```

**Proposed state (2 shells via Next.js route groups):**
```
(office)/layout.tsx                                        (maid)/layout.tsx
  Top nav 8 items (role-filtered):                          Header h-14 + main + bottom-nav 4 items
  หน้าหลัก · สาขา · เงิน▾ · ของเสีย · อะไหล่▾ · ตรวจสภาพ · รายงาน · ตั้งค่า▾
  └ 3-pane workspace (sidebar 260 + main + meta 360)        Logout MOVED to /m/profile
  └ Role-aware default landing                              Single source MaidShell component
     CEO/ADMIN/MGR → /chairops
     MGR_AREA      → /manager
     OFFICE        → /office
     MAID          → /m
```

### 3.5 Search/filter coverage per list page (IA §4)

Every list-style route gets text search + 2-4 filter pills + default sort + saved-filter dropdown. Global `cmd-K` palette at `/api/chairops/search` returns top 5 from each: branches · tickets · parts · users · audit · role-filtered. Full matrix in `/tmp/audit_chairops_phase2_ia.md` §4.

---

## § 4 · ASCII Wireframes (reference only · do NOT re-paste)

**Wireframe source-of-truth:** `/tmp/audit_chairops_phase2_ux.md` (1,556 lines)

### 4.1 Admin wireframes (14+1)

UX Phase 2 §3 contains drawn wireframes for: `/dashboard` · `/dashboard/all-branches` · `/dashboard/[branchSlug]` · `/dashboard-office` (rename → `/office`) · `/reconcile` · `/reconcile/[branchId]` · `/pos-ingest` · `/pos-ingest/[id]/preview` · `/alerts` · `/write-offs` · `/damage` · `/damage/[ticketCode]` · `/cleanliness` · `/cleanliness/audit (new)` · `/parts` · `/audit` (and TV variant `/all-branches`).

### 4.2 Mobile maid wireframes (3)

UX Phase 2 §4: `/m/collect/new` · `/m/cleanliness/new` · `/m/damage/new` (each with bottom-sheet replacing native confirm + offline indicator + photo upload progress).

### 4.3 8 reusable patterns (UX §2)

1. `<ShortageDriftCounter>` — ChairOps signature · amount red + cumulative days badge + age badge + escalation badge
2. `<CsvDiffBuckets>` (= FE's `DiffBucketPills`) — 4-bucket pill cluster · 🆕⚪🟡🔴 · click = filter
3. `<PhotoProofPanel>` — sticky right-rail · prev/next nav · Z=lightbox · watermark on render
4. `<LineNotifyMatrix>` — per-event × channel inline toggle grid
5. `<KpiTile>` (= Pool primitive · just adopt) — big number + delta arrow + sparkline + CTA
6. `<MasterDetailShell>` — 3-pane base · sidebar 260 + main + meta 360
7. `<Drawer>` (= FE's `SlideOverPreview`) — replaces every list→page→back nav
8. `<MaidBottomSheet>` — replaces native `confirm()` · Thai labels · h-14 buttons

### 4.4 UX self-revisions in Phase 3 (PASS_WITH_REVISIONS)

**6 over-architected screens to downgrade (single-pane instead of 3-pane):**
- `/dashboard-office` (rename `/office`) → 2-pane (digest + LINE template)
- `/dashboard/all-branches` → grid view-toggle, not separate URL
- `/parts` → split into `/parts` (inventory) + `/supply-requests` (workflow) per IA
- `/accounts` → inline-edit single pane (5 banks max · 3-pane overkill)
- `/reports` → 2-pane hub
- `/users` → single-table admin (role tree in meta too heavy)

**9 missing screens to add (per IA mandate):**
- `/chairops/manager` (MANAGER_AREA morning view)
- `/chairops/office` (replaces dashboard-office)
- `/chairops/branches` · `/chairs` · `/settings` · `/supply-requests` · `/reports/leaderboard`
- `/chairops/m/profile` (safe logout)
- `/chairops/m/damage/success/[code]` (STAFF P0)

**Mobile re-spec to Android Go 360×640 (NOT iPhone 393×852):**
- Drawer 480-560px doesn't fit · need re-spec at 360
- Bottom-sheet `backdrop-blur-sm` needs graceful fallback (Chrome <80 lacks `backdrop-filter`)
- Bottom-nav 3 tabs at h-16 + header h-14 + sheet pull-handle = 140px chrome on 640px screen (22% eaten)
- Recolor confirm CTA to emerald (rose = destruction confusion)
- Add network indicator (4G/2G/offline) to header
- Canvas/`SubtleCrypto`/Camera feature-detect + fallback for Android 7-9 (STAFF Phase 3 must-fix)

---

## § 5 · Hardware Dependency Matrix

| Item | Status | Mock strategy | Timeline blocker |
|---|---|---|---|
| **POS API** | 🔴 HW_BLOCKED · vendor TBD | CSV upload (wired) | **BLOCKS pilot** — without vendor confirmed, BR1 noon-window + per-chair reconcile (BR10) are theater. CEO must confirm in P0 question #1. |
| **CCTV anti-fraud** | 🔴 HW_BLOCKED · not in v0.2 scope | Manual photo + watermark on display | Defer to Phase 4+ |
| **Cash deposit device** | 🔴 HW_BLOCKED · not in plan | Maid manual fill + slip photo | Defer (acceptable trade-off) |
| **Face/QR maid identity** | 🔴 HW_BLOCKED · not in scope | Standard login | Defer |
| **LINE Notify** | 🟡 MOCKABLE · **EOL 2025-03-31** | Migrate to LINE Messaging API + per-channel bot tokens (encrypted at-rest using AES-256-GCM per Recruit-omnichannel pattern) | **BLOCKS pilot** — currently 5 env-vars wired to notify-api.line.me; will die. SRE flagged Phase 1 + Phase 3. |
| **R2 photo storage** | 🟢 BUILDABLE · 10GB free ok for 1-branch pilot | Compression (4MB→500KB · 8x) + lifecycle 90d cold + 7yr retention | Cost compounds at 30br × 91 chairs = 180GB/mo @ $2.70 ($164 without compression) |
| **Vercel CRON + `CRON_SECRET`** | 🟢 BUILDABLE · 5 entries to add | Set env + add to `vercel.json`: `recompute='*/30 * * * *' · sop-check='0 11 * * *' · escalator='*/15 * * * *' · damage-sla='0 * * * *' · digest='0 1 * * *'` (all UTC) | **BLOCKS pilot** — current count = 0 entries. Pool Pro tier confirmed = 300s cap; recompute serial 30 branches × 5s = 150s headroom OK. |
| **Postgres advisory_lock** | 🟢 BUILDABLE | `pg_try_advisory_xact_lock(hashtext(route))` per cron | Pilot-ready |
| **SMS gateway (BR2 step-4 PAGE)** | 🟡 MOCKABLE · vendor TBD | ThaiBulkSMS or Twilio · cost ~30฿/page × 30br = 900฿/incident | Out-of-scope Wave 1 · CEO accept LINE-only fallback for pilot |
| **Object-lock on R2 bucket** | 🟢 BUILDABLE | Set retention 7yr matching SOX precedent | Compliance bomb if locked without retention |

---

## § 6 · Claude Design Tokens (ChairOps overlay)

Source: UX Phase 2 §1 · namespace renamed to **`.chairops-scope`** per FE Phase 3 (avoid collision with CashHub's `.ch-scope`).

```js
chairops_tokens = {
  // Layout (3-pane drill-down · CEO Linear/Notion preference)
  layout: {
    shell: "grid-cols-[260px_minmax(0,1fr)_360px]",
    shell_md: "grid-cols-[220px_minmax(0,1fr)]",
    shell_sm: "grid-cols-1",  // drawer for sidebar on mobile
    sidebar_bg: "bg-zinc-50 dark:bg-zinc-900/60",
    main_bg: "bg-background",
    meta_bg: "bg-zinc-50/60 dark:bg-zinc-900/40 border-l border-border",
    pane_padding: "p-4 sm:p-6",
    sticky_thead: "sticky top-14 sm:top-16 z-20 bg-background",  // SOLID · NEVER /20 /30 /40 /50
  },

  // Shortage signature (Plan K cumulative drift · zero-tolerance)
  shortage: {
    number_red: "text-rose-600 dark:text-rose-400 font-bold tabular-nums text-base",  // QC: bump to text-base from default
    cumulative_badge: "rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200",
    age_badge:        "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200",
    escalation_mgr:   "ring-1 ring-violet-300 bg-violet-50 text-violet-800 text-[10px] px-1.5 py-0.5 rounded font-semibold",  // QC: Latin-only badge · DO NOT use uppercase tracking with Thai
    escalation_ceo:   "ring-1 ring-rose-400 bg-rose-100 text-rose-900 text-[10px] px-1.5 py-0.5 rounded animate-pulse font-semibold",
    row_left_stripe:  "border-l-4 border-rose-500",  // bigger than Phase 1 ask /2 → /4
  },

  // CSV diff (4-bucket · briefing §6 mandate)
  diff: {
    new:     { emoji: "🆕", bg: "bg-emerald-50", ring: "ring-1 ring-emerald-200", text: "text-emerald-700" },
    same:    { emoji: "⚪", bg: "bg-zinc-50",    ring: "ring-1 ring-zinc-200",    text: "text-zinc-600"  },
    changed: { emoji: "🟡", bg: "bg-amber-50",   ring: "ring-1 ring-amber-200",   text: "text-amber-800" },
    bad:     { emoji: "🔴", bg: "bg-rose-50",    ring: "ring-1 ring-rose-200",    text: "text-rose-700"  },
  },

  // Status pills · solid + ring (NOT /15 opacity from old badge primitives)
  status_pill: {
    base: "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1",
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
    bad: "bg-rose-50 text-rose-700 ring-rose-200",
    info: "bg-zinc-50 text-zinc-700 ring-zinc-200",
    admin: "bg-violet-50 text-violet-700 ring-violet-200",
  },

  // Photo proof (first-class per briefing §6)
  photo: {
    thumb: "rounded-md ring-1 ring-border w-16 h-16 object-cover cursor-zoom-in",
    panel: "sticky top-20 rounded-xl border border-border bg-background p-3 flex flex-col gap-2",
    lightbox_bg: "fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center",
    watermark: "absolute bottom-2 left-2 right-2 text-[10px] text-white/80 font-mono bg-black/40 px-2 py-0.5 rounded",
  },

  // Maker/Checker visual states
  maker_checker: {
    blocked_btn: "opacity-50 cursor-not-allowed pointer-events-none",
    blocked_msg: "text-xs text-rose-600 italic mt-1",  // "คุณคือ maker ของรายการนี้"
    cosign_req: "rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 ring-1 ring-violet-200",
  },

  // Maid mobile (Android Go 360×640 · separate from desktop admin)
  maid: {
    shell: "min-h-dvh bg-zinc-50 flex flex-col",
    header: "sticky top-0 z-30 h-14 bg-background border-b border-border flex items-center px-4",
    main: "flex-1 overflow-y-auto p-4 pb-24",
    bottom_nav: "fixed bottom-0 inset-x-0 h-16 bg-background border-t border-border grid grid-cols-4",  // 4 tabs (IA) or 3 (UX) — PHASE 4 DECISION
    big_btn: "h-14 w-full rounded-xl text-base font-semibold",
    input_xl: "h-14 text-2xl tabular-nums text-center",
    sheet_handle: "mx-auto h-1 w-12 rounded-full bg-zinc-300 mb-3",  // QC patch
    confirm_cta_emerald: "h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold",  // NOT rose (destruction confusion)
  },

  // Z-index scale (QC patch · was ambiguous)
  z: {
    sticky_thead: 20,
    sticky_date_subheader: 15,
    drawer_overlay: 40,
    drawer_panel: 50,
    lightbox: 50,
  },
};
```

**Thai-first typography rules (from `[[section-component-eyebrow-rootcause]]` — non-negotiable):**
- NO `uppercase` on Thai text
- NO `tracking >0.05em` on Thai
- Hierarchy: 24-28 / 18-20 / 14-15 / 12
- Numbers `tabular-nums`, units small, **right-aligned in tables**
- Buttons: `ด่วน` not `URGENT` · `ผู้จัดการ` not `MANAGER`

---

## § 7 · Acceptance Criteria Per Screen (CRITICAL)

> Synthesized from BA Phase 2 §3 + QA Phase 3 test plans. Each row = top-14 admin + 3 mobile maid screens. Test plan link = QA Phase 3 `missing_tests` array (40 P0 + 12 P1).

### 7.1 CEO/Manager-facing screens

| Screen | Acceptance criteria (5-10 per screen) | BR refs | Test scenarios |
|---|---|---|---|
| `/chairops` (exec home) | (1) KPI tile #1 ขาดสะสมระบบ = sum(active SHORTAGE alerts amount) refreshes every 30 min via cron. (2) KPI tile #5 "Write-off รอ CEO" clickable → `/write-offs?tab=pending&approver=me`. (3) Branch table sortable + default sort `driftAmount DESC`. (4) Recent alerts panel = last 10 OPEN/ACK by `createdAt DESC`. (5) Sticky thead `top-14 z-20 bg-background` SOLID. (6) Mobile iPhone portrait: KPI tiles 2×3 above branches table. (7) `cmd-K` opens global palette. (8) Refresh button = optimistic + revalidatePath. | OWN P3 must-fix · BR2 · BR3 · `[[ceo-prefers-multi-pane-workspace]]` | QA cases dashboard-1..3 · OWN scan_10min_morning |
| `/chairops/all-branches` | (1) Grid grouped by mall · responsive 1/2/3/4 col. (2) Each card status dot 🔴🟡🟢 + drift amount. (3) Click card → `/b/[branchSlug]`. (4) q-search by branch name/mall. (5) Empty state "ไม่มีสาขาที่ตรง filter · ล้าง filter". | IA Phase 3 gap (consider view-toggle vs separate URL) | QA dashboard-all-1 |
| `/chairops/b/[branchSlug]` | (1) 30-day timeline + sub-tabs overview/collection/drift/cleanliness/damage. (2) Drill from sidebar w/o nav. (3) Photo proof panel sticky on meta. (4) Breadcrumb `Pool > ChairOps > สาขา > [name]`. (5) Audit trail link in meta. (6) MGR_AREA sees only if assigned. | IA breadcrumb · BR8 areaCanSee | QA branch-1..3 · areaCanSee leak test |
| `/chairops/manager` (NEW) | (1) 5 KPI tiles: pending-mine + missed-in-area + cleanliness FAIL 2x + overdue repairs + branches-not-submitted. (2) ≤2-click drill on every item. (3) Server query filtered by `getUserAreaBranchIds(orgId, userId)`. (4) Default landing for `role==MANAGER_AREA`. | MGR Phase 1 · BR8 | QA manager-1..5 |
| `/chairops/audit` | (1) 11 filter chips: entity · entityId · userEmail · action · date-range + **branch · actor_kind · override-only · cron-only · JSON-path query** (AUD Phase 3 P0). (2) DataGrid `persistKey="audit-filters"` (CEO no re-type). (3) Click row → drawer with diff JSON before/after side-by-side. (4) Export button → `/audit/export/[id]` (audit-of-auditors trail). (5) CEO/ADMIN read-only · no edit · no delete (BR6). | BR6 · AUD Phase 3 patches | QA audit-1..5 |

### 7.2 Office-facing screens

| Screen | Acceptance criteria | BR refs | Test scenarios |
|---|---|---|---|
| `/chairops/office` (NEW) | (1) Morning digest checklist. (2) "ใครยังไม่ส่ง" panel + LINE template button (auto-prefilled from `MISSED_COLLECTION` alert kind). (3) EOD summary card at 17:00 (closed-today · pending · carry-over). (4) Default landing for `role==OFFICE`. (5) Pre-pilot fix: `MISSED_COLLECTION → LINE template draft` mapping table (OFC P1). | OFC Phase 1 · BR9 final-of-day | QA office-1..3 |
| `/chairops/reconcile` | (1) Sticky thead `top-14 z-20 bg-muted`. (2) Drift list sorted by `driftAmount DESC`. (3) 4 KPI tiles: totalDrift · shortageBranches · missedCount · noiseTolerance. (4) Bulk checkbox + "Bulk OK drift=0 (N rows)" button. (5) Recompute selected branches (not all) — OFC P1 fix. (6) Drill row → sidebar list w/o nav (3-pane). | BR1 noon-window · BR2 zero-tol | QA reconcile-1..8 · noon-window cases |
| `/chairops/reconcile/b/[branchSlug]` | (1) Window 12:00→12:00 Bangkok per branch. (2) Timeline shows POS + collection interleaved · color-coded. (3) Photo thumbnail (64px) inline on each collection row + click = lightbox. (4) Inline dispute action (no nav). (5) "อายุ DRIFT" badge + escalation tier (MGR/CEO). (6) Inline write-off request CTA. (7) Office checker count input field (BR7 maker/checker) — BA Phase 3 must-add. (8) "ปิดยอดวันนี้" button (BR9) for MAID — BA Phase 3 must-add. | BR1 · BR7 · BR9 · BR15 | QA branch-reconcile-1..10 |
| `/chairops/pos-ingest/i/[filename]` | (1) 4-bucket pill cluster (🆕⚪🟡🔴) at top + click = filter table. (2) Past-day rows highlighted amber chip. (3) Self-commit HARD BLOCK if `previewer_id == committer_id` AND `role < MANAGER` (BR16). (4) Checker meta panel shows uploader + committer enforcement. (5) Mixed-period CSV: rows in OPEN + HARD_CLOSED → flag both, commit blocks closed rows. (6) Duplicate file-hash: flash "ไฟล์ซ้ำ · เปิด preview เดิม". (7) Idempotency on commit (BR11 1h TTL). | BR5 · BR11 · BR16 · `[[pool-csv-import-must-diff-before-write]]` | QA pos-ingest-1..7 · CSV Thai dates · BE/AD ambiguity |
| `/chairops/alerts` | (1) DataGrid w/ checkbox + bulk Ack/Resolve sticky bottom + `Shift+A` keyboard. (2) 4 filter pills: branch · kind · level · status. (3) LineNotifyMatrix inline at meta per selected alert. (4) `auto-resolve` on writeoff approval (BR15) — alert closes in same TX. (5) `evaluateAlerts` UNIQUE INDEX `(branch_id, kind, day_bucket) WHERE status IN (OPEN,ACK)` at DB layer (SRE Phase 3 patch). | BR2 · BR15 · BR20 anti-flap | QA alerts-1..6 |
| `/chairops/write-offs` | (1) Pending + history tabs. (2) Quick reasons preset block (`Cmd+1-5` hotkey). (3) Maker history sidebar (rejected/approved counts). (4) Approve button HARD BLOCK if `wo.makerId === session.user.id` (BR7 DB CHECK constraint). (5) ADMIN cannot solo-approve · requires CEO co-sign (BR3 + OWN P3 conditional opt-out). (6) Bulk approve <500 checkbox (OFC P1). (7) On approve: BR15 atomic chain (adjustment + drift recompute + alert resolve + payroll queue in 1 TX). | BR3 · BR7 · BR15 · BR23 | QA writeoff-1..10 · ADMIN test 30 cases |
| `/chairops/disputes` (NEW) | (1) State machine OPEN→RESOLVED_MAID/RESOLVED_OFFICE/WRITEOFF_REQUESTED. (2) SELECT FOR UPDATE on collection row (race-lock). (3) MAID push notification on dispute open. | BA §2.3 · IA Phase 3 P0 | QA dispute-1..3 |

### 7.3 Mobile maid screens

| Screen | Acceptance criteria | BR refs | Test scenarios |
|---|---|---|---|
| `/chairops/m/collect/new` | (1) `inputMode=numeric` on amount inputs (NOT decimal — strip non-digit consistent). (2) `clientNonce` UUID per submit + DB UNIQUE PK + request_hash check (BR11). (3) Photo: canvas compress (1600px, jpeg 0.85 → <500KB target) + sha256 hash + R2 PUT + HEAD verify. (4) Bottom-sheet replaces native `confirm()` — Thai labels + emerald CTA. (5) Offline outbox v1 + IndexedDB (STAFF P0 PROMOTE from v2). (6) `placeholder="เช่น 4,500"` (no bare 0). (7) `localStorage` draft auto-save every 5s + clear after success. (8) "ปิดยอดวันนี้" button for `isFinalForBizDay=true` (BR9). | BR9 · BR10 · BR11 · BR19 · BR24 STAFF | QA collect-1..8 · STAFF S0-1..S0-8 |
| `/chairops/m/cleanliness/new` | (1) 6-item checklist tri-state default=null · BLOCK submit until all tapped. (2) "ทุกข้อปกติ · ส่งเลย" shortcut (long-press 2s confirm) — STAFF S0-3 nice-to-have. (3) 5-photo grid · per-item linkage. (4) Live grade preview PASS/WARN/FAIL. (5) FAIL → bottom-sheet confirm. (6) clientNonce dedup. | BR11 · BR18 manager audit | QA cleanliness-1..4 |
| `/chairops/m/damage/new` | (1) Chair picker max-h-72 + chip selected. (2) URGENT requires confirm sheet (STAFF S0-6). (3) Success page `/m/damage/success/[code]` with big mono `CH-2569-NNNN` + copy/LINE share. (4) `clientNonce` dedup. (5) Sentence example `placeholder="เครื่องที่ 3 ฝั่งขวา ไฟไม่ติด"` (not `G031xx-3`). | BR11 · BR17 SLA | QA damage-1..3 · STAFF S0-6 |

### 7.4 Top noon-to-noon + zero-tolerance test scenarios (QA Phase 3)

**Noon-to-noon (BR1) — 13 P0 cases drafted:**
- collect 11:59:59 BKK → bizDate = prior day
- collect 12:00:00 → bizDate = today
- collect 12:00:01 → bizDate = today
- POS at 23:59 (prior day window) + maid at 00:01 → both in window X
- Window X spans 12:00 D → 11:59:59 D+1 (36h coverage if D+1 collect at 11:50)
- Per-branch override: gas-station 24h anchored 06:00 (memory · ChairOps stays 12:00)
- TZ: BKK +07:00 fixed (no DST) · server UTC + offset = no off-by-1-hour
- ReconcilePeriod `status=OK` closed at 13:00 → late POS at 14:00 → reject or queue
- `MISSED_COLLECTION` when window closes with 0 maid rows but POS > 0
- Vacuous window (0 POS, 0 collect) → must NOT alert
- Two windows back-to-back: surplus +100 vs shortage -100 → NEVER auto-cancel
- Cron recompute mid-window (12:30) → partial vs sealed aggregate distinction
- Backdated collection (CEO override) → bizDate prior day + drift recompute prior window

**Zero-tolerance shortage (BR2) — 12 P0 cases drafted:**
- diff = -1฿ in closed window → fires SHORTAGE immediately (no tolerance)
- diff = +100 vs -100 asymmetric (BR4 surplus has 7d auto-resolve)
- shortage age 0s/30s/60s/5min/6min — step 1 emission timing
- shortage NOT acked at 2h → step 2 MANAGER + audit row
- shortage acked at 1h, re-opens (new shortage same window) — timer reset?
- writeoff approved within 5 min → BR15 auto-resolves alert + audit chain has 3 rows linked by `tx_id`
- writeoff REJECTED — alert stays open · escalation continues
- Multiple shortages same branch same day — G15 anti-flap caps LINE at 3 · in-app banner shows all · audit captures suppression
- Step 4 PAGE (LINE+SMS+email) at T+72h — SMS gateway test + email deliverability + LINE backup
- BR15 atomic chain: simulate DB failure between adjustment insert + alert resolve → rollback BOTH
- Cross-branch: 5 shortages simultaneous → cron processes all in 5min without timeout
- Negative-only: surplus 500฿ does NOT trigger SHORTAGE (BR4 separate path)

**BR2 SPEC CONTRADICTION (QA Phase 3 top blocker #1):** BR2 says "WITHIN 60s" but enforcement is CRON 5-min cadence → real SLA = up to 5-6 min. **CEO must rule:** (a) change SLA to "within 5 min" OR (b) change to webhook-trigger model (POS-commit + cash-collection mutate-triggers fire engine).

---

## § 8 · Persona Sign-off Table (Phase 4)

Legend: ✅ PASS · 🟡 CONDITIONAL_PASS · ❌ FAIL

| # | Persona | Phase 1 top concern | Phase 2 addressed? | Phase 3 verdict | Must-fix before pilot |
|---|---|---|---|---|---|
| 1 | **PM** | dashboard-office zombie route · maid mobile missing · POS vendor unknown · chair count 91 vs 1,200 | Mostly · IA killed orphan · `(maid)` route group + PWA · POS still unresolved | 🟡 CONDITIONAL_PASS | Confirm POS vendor · add historical-shortage `ยอดยกมา` field · cut Wave-1 to A+B+E skeleton · Settings page Wave 1 |
| 2 | **BA** | Drift engine LIFETIME-SUM (BR1+BR2 not enforced) · maker/checker absent on cash · write-off doesn't close shortage · 11 flow gaps + 11 rule additions G11-G21 | Mostly · 24 BRs · maker/checker matrix · BR15 atomic chain · period-close machine | 🟡 CONDITIONAL_PASS | 5 new BRs (BR25 supply-request state machine · BR26 period-lock UI · BR27 access-request · BR28 org-switcher · BR29 maid-assignment source-of-truth) + UX wireframe for period-close + officeCheckerCount input + ปิดยอดวันนี้ button |
| 3 | **SA** | Cron NOT registered in `vercel.json` · module entitlement bypassed · zero `org_id` scoping (3 P0 RF) | All 7 SA-P0 closed in Phase 2 · BUT 6 NEW issues (RP-S1 name collision · RP-S5 Drift-vs-Period dual-write · MA-S1 enum rank 3.5 off-by-one · MA-S2 orgId omission · LE-3 action gate bypass · LE-4 cron killswitch bypass) | 🟡 CONDITIONAL_PASS | P0-A rename split ReconcilePeriod vs FiscalPeriod · P0-B decide Drift fate (MAT VIEW vs delete) · P0-C renumber MANAGER_AREA enum (integers not 3.5) · P0-D orgId on 10 NEW tables · P0-E concrete `vercel.json` snippet · P0-F add CronRun model · P0-G pre-flight bizDate range check · P0-I enforceModuleAccess on every action · P0-J cron killswitch · P0-K RLS rollout Pool-wide |
| 4 | **FE** | 4 forked UI primitives · 0 loading.tsx · alert()/confirm() in 2 forms · 25+ Thai uppercase violations · LOC drift | DELETE `chairops/ui/*` + `.chairops-scope` overlay (renamed) · 19 loading.tsx · 12 new primitives (revised → 14 post-cross-check) · Pool primitives reused | 🟡 CONDITIONAL_PASS | LOC math optimistic by ~1,100 (honest target 4,400 not 3,300) · 2-shell migration spans 2-3 sprints not 1 · 30-min naming sync to lock `.chairops-scope` + clientNonce + Drawer/DiffBuckets names BEFORE coding |
| 5 | **QA** | ZERO automated tests across 11 action files · drift engine LIFETIME · no idempotency | 24 BRs all have acceptance criteria + 22 sad paths + maker/checker matrix · idempotency spec concrete | 🟡 CONDITIONAL_PASS | Resolve BR2 60s-vs-5min contradiction (BLOCKER) · disambiguate BR15 "same window" (BLOCKER) · unify G01 threshold (50%/150%/900% triple-spec · BLOCKER) · 5 missing sad paths · 13 of 24 guards lack DB belt-and-suspenders |
| 6 | **QC** | 25+ uppercase Thai · 0 loading.tsx · faint tones · row tone /5 invisible · KPI cheap | All 3 P0 design-resolved · tokens solid -50 + ring · border-l-4 stripe · KPI sparkline + delta arrow | 🟡 CONDITIONAL_PASS | 8 must-fix: escalation token Latin/Thai split (P0 trap) · numeric column alignment cross-cutting rule · z-index scale · 3+ graphical loading skeletons drawn · border-radius lock · padding normalization · KPI border contrast WCAG · icon library decision (Lucide vs emoji) |
| 7 | **UX** | Master-detail anti-pattern in every list · LINE Notify matrix 100% missing UI · photo proof invisible in lists | Mostly · 14+1 wireframes · 8 patterns · MasterDetailShell + Drawer · LineNotifyMatrix + PhotoProofPanel · drilling no-nav | 🟡 CONDITIONAL_PASS (self-score 8→7) | Nest 3-pane UNDER IA top-nav (not replacement) · wireframe 9 missing screens · re-spec mobile at Android Go 360×640 + backdrop-filter fallback · collapse 13 chairops/redesign components → 8 ChairOps-only · MANAGER_AREA-filtered sidebar variant · cmd-K palette wireframe · breadcrumb contract · emerald confirm CTA · network indicator |
| 8 | **IA** | 4 nav shells · /dashboard-office orphan · zero breadcrumbs · UUID URLs unshareable | 37 routes · 2 shells via route groups · MANAGER_AREA + ChairopsManagerArea + helper · breadcrumb scheme · natural-key URLs · cmd-K | 🟡 CONDITIONAL_PASS | 3 P0 (5 missing routes: periods · adjustment · access-request · disputes · audit-export) · TECHNICIAN role decision · ADMIN write-off cell wrong (must be CEO co-sign not solo) + 6 P1 · email-in-URL PDPA concern |
| 9 | **OWN** | No write-off CEO tile · no per-maid leaderboard · LINE digest 08:00 only (no realtime) · mobile table swipe | Mostly · KPI tile #6 · /reports/leaderboard · BA escalation matrix realtime · LINE deep-link auth | 🟡 CONDITIONAL_PASS | iPhone-portrait wireframe (KPI tiles + alert feed FIRST · not after table swipe) · resolve IA/UX naming /dashboard-office vs /office · FaceID approve P1 not P2 · SHORTAGE-uncap toggle override BR20 cap · CEO-opt-out toggle for ADMIN co-sign · MANAGER_AREA defer to post-pilot |
| 10 | **MGR** | Area-manager scope doesn't exist · manager approval queue not first-class · zero handover · zero stock-low alert | Area-scope FIXED (rank 3.5 + table + helper) · approval queue first-class · /manager morning view | 🟡 CONDITIONAL_PASS (score 8) | Handover note model (ChairopsHandoverNote + pinned widget) · SPARE_PART_LOW alert kind + threshold · complete past-day-edit request workflow (currently half-baked) |
| 11 | **STAFF** | ZERO offline tolerance · no photo compression · no idempotency · native `confirm()` · cleanliness default-all-PASS bug · placeholder=0 trap | 10/13 P0 fixed in Phase 2 · 3 gaps remain | 🟡 CONDITIONAL APPROVE | IndexedDB outbox + SW from v2 → v1 (P0 promotion · ห้างชั้น 4 WiFi ขาด ๆ ไม่ทนได้) · feature-detect canvas/SubtleCrypto/Camera fallback Android 7-9 · cleanliness "ทุกข้อปกติ" shortcut · mapServerError enum 10+ Thai cases · clear-draft after success · damage URGENT confirm sheet · real-device QA 3 Android × 3 WiFi profiles · `MANAGER` → `ผู้จัดการ` consistency |
| 12 | **DEVIL** | ChairOps over-scoped 2-3x for pilot · 14 routes + 16 models for 1-branch pilot · separate `chairops` schema breaks Pool convention · Plan K depends on POS API that may not exist | Phase 2 IGNORED Phase 1 cuts · BA + IA + FE + UX collectively planned ~22 routes + ~26 tables + 18 wireframes + 12 primitives · NET MORE scope | ❌ **HARD FAIL** | DELETE Phase 2: MANAGER_AREA · PeriodLock + Adjustment + Journal · CollectionLine · OfficeAssignment · Payroll · line_send_outbox · Dispute · cmd-K · natural-key URLs · 14 loading.tsx · 9 anti-stupid guards beyond G01 — defer all to post-pilot. CONFIRM POS vendor before any drift code. FREEZE wireframes at 5. MERGE OfficeShell + MaidShell. REJECT IA's 7 new pages. REJECT BR5/BR8/BR10/BR17/BR18/BR20/BR21/BR22/BR23/BR24 enforcement layer. Ship pilot with BR2 + BR3 + BR7 + BR11 + BR12 + BR13 + BR14 + BR15 + BR16. |
| 13 | **OFC** | OFFICE self-commit POS soft-warn only · no morning digest · no LINE template button · broken filter href bug · no bulk-actions · no Excel/BC export | Mostly · POS hard maker-checker · /office morning digest · 4-bucket diff · bulk Ack/Resolve · audit-of-auditors | 🟡 CONDITIONAL_PASS (score 8.7/10) | 2 P0: xlsx writer + BC/Express GL mapping table · ChairopsOfficeAssignment + ManagerArea SQL + RLS migration. 4 P1: MISSED_COLLECTION → LINE template draft · bulk approve write-off <500 in §3.7 · resolve G20 conflict with daily bulk OK drift=0 · EOD checklist persist server action |
| 14 | **FIN** | Zero period-close lock · no VAT/tax mark · write-off no GL mapping · no salary deduction export · no companyId | Mostly · BR5 period-lock + JournalEntry · BR21 VAT P1 · BR22 companyId P1 · BR23 deductionMethod + PayrollDeductionQueue | 🟡 CONDITIONAL_PASS | Elevate to P0: VAT mark + rate · Express export GL mapping · Chart-of-account table · companyId on ChairopsBranch · Payroll deduction CSV export endpoint. Pilot exit criteria: "บัญชี import เดือนแรกเข้า Express สำเร็จ ≥ 95% rows ไม่ re-key" |
| 15 | **AUD** | Audit log no DB-level immutability · auto-ADMIN bootstrap · audit-export no self-audit (3 P0) | All 3 P0 closed · BR6 DB trigger · BR12 deny + request-flow · BR6 audit-of-auditors with size guard | 🟡 CONDITIONAL_PASS | 4 residual: cron audit-export gap · `tx_id` propagation unverified · IA audit page lacks override/cron filter chips (spec'd in BA 5.4 but IA didn't surface) · photo watermark on render unspecified |
| 16 | **SRE** | 3 cron routes NOT scheduled in `vercel.json` (BLOCKER) · LINE Notify EOL + no 429/retry/DLQ · no run-log table · no observability | Mostly · BA §8.3 cron-run table · BR11 idempotency · BR20 LINE caller-check + outbox · BA G14 advisory_lock · BR6 DB immutability | 🟡 CONDITIONAL_GO_with_must_fix | 7 must-fix added Phase 3: exact cron schedule strings · move watermark to server-side day 1 · UNIQUE INDEX on (branch_id, alert_kind, day_bucket) · LINE Messaging API migration deadline + AES-256-GCM key storage · r2_orphan_sweep + lifecycle 90d cold + 7yr retention · ACK-suppresses-later-step + CRITICAL exemption from BR20 · phased migration playbook |
| 17 | **BE** | Audit log writes NOT in TX (7 actions) · cron has no execution lock · photo R2 orphan keys · `as never` JsonValue cast | Mostly · 33-action audit-log map · BR11 idempotency · BR15 atomic chain · BA §7 period-close tables | 🟡 CONDITIONAL_GO | 3 top blockers: BA spec lacks `tx_id` population mechanism (must add helper in `lib/chairops/audit/log.ts`) · cron clientNonce fallback to `randomUUID()` defeats dedup (use deterministic `{route+minuteBucket}`) · ReconcilePeriod migration is 5 steps × 30 branches × 6 months backfill (recommend dual-write 1 week + verify match then drop cache) |

**Tally:** 16 CONDITIONAL_PASS · 1 HARD FAIL (DEVIL).

---

## § 9 · Locked Decisions D-### (NEW from this audit)

| # | Title | One-line summary |
|---|---|---|
| **D-NEW-1** | ChairOps สถานะจริง: live on prod | 16 models + ~27 routes + 5 API ขึ้นแล้วผ่าน commit `5e3a6d2` · update memory `[[chairops-massage-chair-business]]` ที่บอก "build NOT started" (stale) |
| **D-NEW-2** | Drift engine = window-based (BR1) | Aggregate by `(branchId, windowStartTs, windowEndTs)` ตาม `[[chairops-reconcile-window-noon-to-noon]]` · ไม่ใช่ lifetime sum · default window 12:00 BKK → 12:00 BKK (per-branch override via `ChairopsReconcilePolicy`) |
| **D-NEW-3** | LINE Notify EOL → migrate Messaging API | `notify-api.line.me` sunset 2025-03-31 · ต้อง migrate ก่อน pilot · per-channel bot tokens + AES-256-GCM at-rest (per Recruit-omnichannel pattern memory) · caller MUST check `.ok` |
| **D-NEW-4** | Audit log DB-trigger immutability | `BEFORE UPDATE/DELETE/TRUNCATE` trigger raises exception on `chairops.audit_log` · REVOKE ALL FROM PUBLIC + only `audit_admin` role can DROP TRIGGER · NOT application-level discipline |
| **D-NEW-5** | `.chairops-scope` theme overlay (rename from `.ch-scope`) | CashHub already owns `.ch-scope` · ChairOps must use `.chairops-scope` · cost 30-min find-replace · prevents CSS-var collision |
| **D-NEW-6** | MANAGER_AREA role rank = **3** (NOT 3.5) | Use integers; renumber whole enum (OFFICE=2, MANAGER_AREA=3, MANAGER=4, CEO=5, ADMIN=6). Update `lib/chairops/auth/role-guards.ts` RANK map + every `rank >= MANAGER` callsite. Add Vitest asserting rank-order invariant. |
| **D-NEW-7** | 10 new tables MUST have `orgId NOT NULL` | BA spec covered existing 16 but omitted on new tables (ReconcilePeriod · FiscalPeriod · CollectionLine · IdempotencyKey · CronRun · ManagerArea · OfficeAssignment · LineSendOutbox · AdjustmentRequest · JournalEntry). 3-step migration (ADD NULL → backfill default → ALTER NOT NULL) per table. |
| **D-NEW-8** | Phase 2.5 cut session before Wave-1 | DEVIL Phase 3 HARD FAIL flagged 60-70% overengineering · CEO must rule on Wave-1 scope (full vs DEVIL floor) BEFORE any Wave-1 migration ships · 1-hour CEO + sponsor session recommended |

---

## § 10 · Open Questions / Risks + CEO Sign-off Items

### 10.1 P0 questions ที่ต้อง CEO ตอบ (before any implementation)

| # | Question | Why blocks pilot | Options |
|---|---|---|---|
| **P0-Q1** | **POS vendor confirmed หรือยัง? มี API หรือ CSV เท่านั้น?** | Without time-stamped POS data, BR1 noon-window + per-chair reconcile (BR10) are theater. Drift engine + ChairopsCollectionLine model would be built on a hard dependency that may not exist. | (a) Block pilot until vendor confirmed (b) Build CSV path only + mock POS schema (c) Switch vendor before code |
| **P0-Q2** | **Maid count จริง: 91 chairs ที่เห็นใน sheet หรือ 1,200 chairs ที่ CEO ambition?** | Drift recompute serial 30 branches × 5s = 150s exceeds Vercel hobby (60s) cap. At 1,200 chairs scale, CollectionLine = 30M rows/year, needs partition + parallel cron. Schema-level decision. | (a) 91 chairs pilot scope, scale later (b) Design for 1,200 from day 1 (more upfront work) |
| **P0-Q3** | **Area-manager มีจริงไหม? ใครเป็น MGR_AREA?** | IA Phase 2 added MANAGER_AREA role + ChairopsManagerArea table + helper + UI for assignment. But CEO Phase 1 admitted "manager existence not even confirmed". If managers don't exist post-pilot, this is dead code with backward-compat baggage. | (a) Build enum + table but don't require day-1 (default no MGR_AREA users) — OWN recommendation (b) Defer entirely until /feature-workshop managers (DEVIL recommendation) |
| **P0-Q4** | **Wave-1 scope: full DEVIL HARD FAIL list OR 60-70% cut?** | DEVIL Phase 3 verdict: 4 personas (BA+IA+FE+UX) optimized own deliverable without shared scope ceiling. Phase 1 said 5 routes. Phase 2 planned 22 routes + 24 BRs + 18 wireframes + 12 primitives + 10-14 new tables. | (a) Lui-Lui ship full spec: ~22 routes · 24 BRs · 10-14 tables · 2-3 sprint (b) **DEVIL floor: 5 routes (collect, reconcile, dashboard, pos-ingest, users) + 3 BRs (BR2, BR3, BR12) + 0 new tables + 4 primitives + 1 cron + 1 SHORTAGE alert kind only** — validate 1 branch 4 weeks (c) Middle ground: Wave 0 P0 SA fixes + Wave 1 = 8 routes + 8 BRs |
| **P0-Q5** | **LINE Notify migration plan: timeline + Messaging API setup** | EOL 2025-03-31. SRE flagged Phase 1 + Phase 3. AES-256-GCM at-rest per Recruit-omnichannel pattern. Need vendor decision + per-channel bot tokens. | (a) Migrate before pilot (recommended) (b) Pilot with notify-api.line.me + migrate after pilot validates (c) Use webhook-trigger alternative |
| **P0-Q6** | **Period-close + accounting export: Wave 1 P0 (FIN) or Wave 3 defer (DEVIL)?** | FIN Phase 3: "VAT mark + Express export + companyId + payroll CSV — pilot first month accountant cannot import = re-key everything = release blocker." DEVIL: "1-branch pilot won't close a month for 30 days. Building period-lock + JournalEntry + PeriodReopenLog before first 'oops' = speculation." | (a) Wave 1 (FIN) — but adds 5-7 days + 4 tables (b) Wave 3 defer (DEVIL) — but accountant must wait 1 month before they can import (c) Compromise: PeriodLock + AdjustmentRequest in Wave 2 · VAT + companyId + payroll Wave 3 |

### 10.2 Risks register

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| **R1** | POS vendor doesn't open API · stays CSV-only | Drift engine + ChairopsCollectionLine + BR10 stillborn | P0-Q1 — CEO confirm vendor before code |
| **R2** | Maid adoption fails (Android Go users abandon app) | EPIC A undeliverable · pilot dies | IndexedDB outbox v1 (not v2) · real-device QA 3 Androids · cleanliness "ทุกข้อปกติ" shortcut · feature-detect fallbacks |
| **R3** | Silent money-math regression (drift cache vs ReconcilePeriod dual-write) | Trust loss + audit fail · CEO sees stale shortage | BE recommendation: delete Drift cache · MAT VIEW REFRESH ON COMMIT OR dual-write 1 week + verify match + drop cache |
| **R4** | RLS leak via multi-tenant (no orgId today, BYPASSRLS on prisma_owner) | Cross-org data exposure | SA P0-K: RLS rollout = Pool-wide infra change · escalate before BR14 commit · 3-step orgId migration |
| **R5** | Audit log wipe (Prisma client deleteMany works today) | Court/tax inadmissible · SOX fail | D-NEW-4 — DB-trigger immutability + REVOKE ALL + DROP TRIGGER permission |
| **R6** | LINE Notify EOL kills all alerts (zero-tolerance promise breaks) | SHORTAGE alerts go silent · CEO blames system | D-NEW-3 — Messaging API migration before pilot |
| **R7** | Scope creep (DEVIL HARD FAIL · 70% never gets used) | 5-7 days wasted on dead code + 4 tables that never see data | D-NEW-8 — Phase 2.5 cut session · CEO ruling P0-Q4 |

### 10.3 CEO sign-off checklist

- [ ] **Approve scope cut decision** (P0-Q4 · DEVIL recommended Wave 1 floor OR full lui-lui)
- [ ] **Answer 6 P0 questions** (POS vendor · maid count · area-manager · Wave-1 scope · LINE migration · period-close priority)
- [ ] **Approve 8 D-### new decisions** (ChairOps live state · window drift · LINE migration · audit immutability · `.chairops-scope` · MANAGER_AREA rank 3 · orgId · Phase 2.5 cut)
- [ ] **Approve hardware deferred list** (POS API · CCTV · cash deposit · face/QR · SMS gateway · object-lock retention)
- [ ] **Pick sponsor + pilot branch + go-live target date** (recommended: 1 branch · 91 chairs · 4 weeks)
- [ ] **Convene 30-min naming sync** (lock `.chairops-scope` · `clientNonce` not clientToken · Drawer not SlideOverPreview · DiffBuckets not DiffBucketPills · BEFORE Phase 4 implementation kicks off)
- [ ] **Confirm Vercel Pro tier** (need 300s cron cap headroom · hobby 60s won't fit)
- [ ] **Set `CRON_SECRET` env in Vercel + add 5 entries to `vercel.json`** (Wave 0 · 1-day fix · highest pilot unblocker)

---

## § 11 · Appendix · File references

**Phase 0:**
- `/tmp/audit_chairops_phase0_briefing.md`
- `/tmp/audit_chairops_phase0_drift.md`

**Phase 1 (Discovery — 17 JSONs):**
- `/tmp/audit_chairops_phase1_{pm,ba,sa,fe,be,qa,qc,ux,ia,own,mgr,staff,devil,ofc,fin,aud,sre}.json`

**Phase 2 (Design Sprint — 4 outputs):**
- `/tmp/audit_chairops_phase2_ux.md` (1,556 lines)
- `/tmp/audit_chairops_phase2_ia.md` (530 lines)
- `/tmp/audit_chairops_phase2_fe.md` (905 lines)
- `/tmp/audit_chairops_phase2_ba.md` (640 lines)

**Phase 3 (Critique — 17 JSONs):**
- `/tmp/audit_chairops_phase3_{pm,ba,sa,fe,be,qa,qc,ux,ia,own,mgr,staff,devil,ofc,fin,aud,sre}.json`

**Code paths cited:**
- Schema: `prisma/schema.prisma:2768-3168`
- Auth session: `lib/chairops/auth/session.ts:40-94`
- Role guards: `lib/chairops/auth/role-guards.ts:7-52`
- Cron secret: `lib/chairops/auth/cron-secret.ts:1-39`
- Drift engine: `lib/chairops/reconcile/drift-engine.ts:44-148`
- Alerts: `lib/chairops/reconcile/alerts.ts:8-70`
- Cron handlers: `app/api/chairops/cron/{recompute-drifts,sop-check,ceo-digest}/route.ts`
- POS ingest tx loop: `app/(admin)/chairops/pos-ingest/actions.ts:518-575`
- Rate-limit (in-memory): `lib/chairops/utils/rate-limit.ts:6-29`
- Modules registry: `lib/modules.ts:58,464-553`
- Missing module gate (all 14 layouts): `app/(admin)/chairops/{dashboard,users,audit,collect,cleanliness,damage,parts,reports,accounts,dashboard-office}/layout.tsx`
- **vercel.json crons missing:** `vercel.json` (no `/api/chairops/cron/*` entries)

---

**END OF AUDIT · 2026-05-25 · 17 personas · 5 phases · 16 CONDITIONAL_PASS · 1 HARD FAIL · Wave-1 scope decision pending**
