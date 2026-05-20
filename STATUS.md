# 📍 STATUS.md — Pooilgroup ERP

> **Source of truth สำหรับสถานะจริง** — อัพเดต 2026-05-20 (Sentry + audit retention + user manuals)
> ใช้แทน `ดีเทลv1/PROJECT_TRACKER.md` (ซึ่งบอก 0% — ไม่จริง)
> Brand: **Pooilgroup** (คำเดียว, P ใหญ่)

## 🆕 Update (2026-05-20 — Observability + Compliance + End-user docs)

หลัง deep audit (6 personas) เผยช่องโหว่ 3 จุด · ทำในรอบเดียว · build pass · commit `27adffe`:

**A1 — Audit retention policy**
- เปลี่ยนแผนใน `CORE_PLAN.md` จาก "1 year cron" → **"5+ ปี · NO auto-delete cron"** (กฎหมายไทย พ.ร.บ.การบัญชี 2543 §14 · สรรพากร 10 ปี)
- เพิ่ม comment block ใน `prisma/schema.prisma` ที่ AuditLog model — กันคนสร้าง cleanup cron ในอนาคต
- ปัจจุบันไม่มี cron ลบ audit_logs อยู่แล้ว = compliant by default

**A2 — Sentry error tracking (@sentry/nextjs 10.53.1)**
- Files: `instrumentation.ts` · `instrumentation-client.ts` · `next.config.ts` (wrap) · `.env.example` (+5 vars)
- `npm install` + `npm run build` ผ่าน ✅ (Sentry v8/v9 ไม่ support Next 16 · ใช้ v10 ขั้นต่ำ)
- `enabled: Boolean(SENTRY_DSN)` — ถ้าไม่มี DSN ก็ skip · dev ไม่ crash
- CEO checklist ใน `SENTRY_SETUP.md` (signup sentry.io → DSN → Vercel env vars)

**B — User manual ภาษาไทย (`docs/user-guide/`)**
- `README.md` (150 บรรทัด) — index + role navigation
- `owner.md` (296 บรรทัด) — super_admin / org owner
- `branch-admin.md` (297 บรรทัด) — branch_manager / area_manager
- `staff.md` (281 บรรทัด) — staff (LIFF report)
- ไม่เขียนถึง feature ที่ STATUS บอกยังไม่ทำ (Telegram bot · LIFF จริง)
- screenshot placeholders ให้เติมภายหลัง

**To apply เมื่อ deploy**
1. CEO setup Sentry (5 ขั้นใน [`SENTRY_SETUP.md`](./SENTRY_SETUP.md)) · ใส่ env vars ใน Vercel
2. `git push` → Vercel deploy อัตโนมัติ (commit อยู่ใน main แล้ว)
3. ทดสอบ Sentry: เปิด `/api/non-existing-route` → ดู event ใน sentry.io

---

## 🆕 Update (2026-05-11 — FuelOS Sprint 6 kickoff)

เริ่ม FuelOS อย่างเป็นทางการหลังจากที่ค้างมา ตั้งทีม + ลง schema foundation ทั้งหมดในรอบเดียว.

**Virtual team (`.claude/agents/`)** — map กับ ORG_FULL.md:
- `pm-fuelos.md` — Senior PM (PMO, T3)
- `tech-lead-fuelos.md` — Tech Lead — FuelOS (T3)
- `backend-eng.md` — Senior Backend Engineer (T4)
- `frontend-eng.md` — Senior Frontend Engineer (T4)
- `qa-polish.md` — QA Lead + UX Polish (T4)
- `lean-process.md` — Lean Process Engineer (T3 OPEX)

**Working doc:** `web/FUELOS_PLAN.md` — Sprint 6 → 6.0 (schema), 6.1 (Price Engine), 6.2 (CRM Multi-Entity), 6.3 (Sales Workspace), 6.4 (LINE Bot)

**Sprint 6.0 — Schema foundation (this commit)**
- Added 16 Prisma models per FUELOS.md §12 / §14.6:
  - Price: `DepotPrice`, `ZoneMargin`
  - CRM: `Contact`, `CustomerEntity`, `DeliveryLocation` (Multi-Entity 3-layer)
  - Sales: `CustomerQuote`, `PriceAlertLog`, `LineResponseLog`
  - Orders + Fleet: `FuelOrder`, `Truck`, `DriverProfile`, `DriverLocation`
  - Money: `Payment`, `FlashSale`, `CreditDocument`, `ChequeTracking`
- Reused `Vehicle` (DocuFlow scope) → `Truck` 1-1; `User.role=driver` + `DriverProfile` satellite
- Migration SQL: `supabase/migrations/20260511000001_fuelos_sprint6_foundation.sql`
  - GENERATED columns on `fuel_orders` (margin_per_liter, total_amount, total_profit)
  - GENERATED column on `line_response_log` (response_minutes)
  - RLS enabled + org-isolation policies on all 16 tables
- Deferred to 6.4+: `CreditScoreHistory`, `ChurnSignal` (AI features)

**To apply เมื่อ deploy**
1. `cd web && npx prisma db push` (apply Sprint 6 models)
2. Run `supabase/migrations/20260511000001_fuelos_sprint6_foundation.sql` (RLS + GENERATED columns)
3. Next: Sprint 6.1 — Price Engine UI/API (see FUELOS_PLAN.md §3)

**Open questions (FUELOS_PLAN.md §8)**
1. PTT scraper Sprint 6 หรือ Sprint 7?
2. Display format (`฿28.41/L` vs `Intl.NumberFormat`)?
3. MOPS Alert ก่อนหรือหลัง Telegram bot (Phase C4)?

---

## 🆕 Update (2026-05-09 — รวม 8 commits หลัง 05-04)

ตั้งแต่ Dashboard pass (05-04) → วันนี้ มี 8 commits ใหญ่:

**DocuFlow (Sprint 8) — bootstrap → polish → UAT fixes ครบในรอบเดียว**
- Schema + 4 migrations: `20260508000002_docuflow_foundation` / `_advanced` / `_polish` / `_005_audit_renew_chain_index`
- Pages: `/docuflow/{documents,expiry,persons,vehicles,risk,search,checklist}`
- Features: sharing, AI search, risk scoring, signature placement, renewal workflow, vehicle/person tracking
- UAT pass ปิด: role gates, rate limit, perf indexes (commit `5ef20e6`)

**Infra**
- **Vercel cron 7 jobs** (`vercel.json`): morning-brief 07:00, evening-check 18:00, deadline-reminder ทุก 30 นาที, monthly-report-pdf, access-review, health-score 23:00 BKK, docuflow-expiry
- **LINE Rich Menu** config + upload script (`scripts/line-rich-menu.mjs` + `npm run line:rich-menu`)
- **`@line/liff` ติดตั้งแล้ว** (^2.28.0) — แต่ LIFF page ยังใช้ session, ยังไม่ `liff.init()` จริง
- **RLS audit pass 2** — ปิด 18 ตารางที่ตกหล่น (`_007_rls_for_remaining_tables`)
- Temp access column + streak retry + form template seed race-fix

**Core**
- Cross-module Executive Dashboard (CashHub × FuelOS × DocuFlow rollup)
- Quick Approve Bar (พร้อมจะใช้กับ Telegram inline)
- 3 settings pages เพิ่ม + `/join` refactor + backup CSV
- CSP/HSTS/CORS headers ใน proxy.ts (RULES §21 layer 2)
- ปิด cross-org leaks, soft delete enforce, idempotent submit

**Auth**
- Per-user module access (CashHub / FuelOS / DocuFlow toggle ต่อ user)
- Permission cleanup — ปิด `/signup`, fix admin tier, guard PDF, roles ใน invite

**To apply เมื่อ deploy**
1. `cd web && npx prisma db push` (apply 7 migrations ใหม่)
2. ตั้ง env: `CRON_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LIFF_ID`
3. (Optional) `npm run line:rich-menu` — upload Rich Menu

---

## 🆕 Update (2026-05-04 — Dashboard ยอดขาย full pass)

ทำในรอบเดียว — typecheck สะอาด, `next build` ผ่าน:

**Schema + migration**
- เพิ่ม Prisma models: `BranchTarget`, `BranchHealthScore`, `BranchStreak`, `MissingReportReason`
- SQL migration: `supabase/migrations/20260504000002_dashboard_addons.sql` (รวม RLS) — รัน `prisma db push` หรือ apply ไฟล์นี้

**Libraries**
- `lib/cashhub/health-score.ts` — A-F algorithm ตามสเปค §9 (pure)
- `lib/cashhub/streak.ts` — current/longest streak + badge
- `lib/cashhub/forecast.ts` — EOM forecast + target progress (pace marker)
- `lib/cashhub/aggregator.ts` — single-shot dashboard data loader (parallel queries, soft-fail on missing tables)

**Charts** (no external deps — pure SVG)
- `components/cashhub/charts.tsx`: `Sparkline`, `BarStrip`, `ProgressBar`, `CalendarHeatmap`, `PatternHeatmap`, `HealthBadge`, `Donut`

**Pages (CashHub)**
- `/cashhub/dashboard` — rewrite mobile-first; 7 sections: hero/forecast/target, alerts, by business type, payment mix donut, pending list, leaderboard top 8, calendar heatmap, pattern heatmap
- `/cashhub/dashboard/business/[type]` — drill-down (§10.2)
- `/cashhub/branches/[id]` — branch detail (§10.3) with health breakdown + 30-day shortages
- `/cashhub/compare?a=YYYY-MM&b=YYYY-MM` — month-vs-month comparison (§10.4)
- `/cashhub/leaderboard` — sortable (total/health/streak), filterable by type
- `/cashhub/heatmap` — full สาขา × วัน matrix
- `/cashhub/shortages` — filterable + group-by-person
- `/cashhub/reports` — filters + bulk Quick Approve

**APIs**
- `/api/cashhub/approve-bulk` — multi-report approve with permission check
- `/api/cashhub/targets` — PUT manual target
- `/api/cron/health-score` — daily compute (GET/POST + `Bearer ${CRON_SECRET}`)
- `/api/dev/seed-test-data` — rewrite to seed 35 days, 6 personality tiers, weekend bias, occasional shortages, auto-derive targets, compute health + streaks

**LIFF report (Staff)**
- Deadline countdown ในหัวฟอร์ม (เปลี่ยนสีแดงเมื่อเลย)
- "เมื่อวาน ฿X" reference (ไม่ auto-fill — แค่อ้างอิง)
- Streak badge "🔥 N วัน" เมื่อ ≥1

**To apply เมื่อตื่น**
1. `cd web && npx prisma db push` (หรือรัน SQL ใน `20260504000002_dashboard_addons.sql` ด้วยมือ)
2. login เข้า `/cashhub/dashboard` → กด "สร้างข้อมูลตัวอย่าง" (ตอนนี้ seed 35 วัน × ทุกสาขา + targets + health + streaks)
3. ดู dashboard / drill-down / leaderboard / compare / heatmap
4. (Optional) ตั้ง Vercel cron `/api/cron/health-score` 23:00 BKK + `CRON_SECRET` ใน env


---

## 🎯 Where we are

**Sprint 0–2 ส่วนใหญ่เสร็จแล้ว + Sprint 3 (CashHub) อยู่ในมือ**
มี 11 commits, codebase พร้อม dev. ติดที่ยังไม่มี LINE/Telegram bot integration และ 7 forms ยังไม่ครบ.

**Stack ที่ใช้จริง:**
- Next.js **16.2.4** + React 19 + TS strict + Tailwind v4
- Prisma **7.8** + Supabase (Postgres + Auth + RLS) + Cloudflare R2
- shadcn-style UI + sonner (toast) + react-hook-form + zod
- ⚠️ Next.js 16 มี breaking changes — อ่าน `node_modules/next/dist/docs/` ก่อนเขียน

---

## ✅ Done (committed)

### Foundation
- [x] Next.js 16 + TS strict + Tailwind v4 init
- [x] Prisma schema **8 tables**: Organization, User, Branch, UserBranch, ReportTemplate, DailyReport, CashShortage, AuditLog
- [x] Supabase RLS migration (`supabase/migrations/20260504000001_rls_and_jwt_claim.sql`)
- [x] Supabase SSR client + middleware proxy
- [x] Cloudflare R2 client + signed-URL upload + uploader UI
- [x] Permission Matrix (6 roles, hardcoded — `lib/auth/permissions.ts`)
- [x] Session helpers (`lib/auth/session.ts`)
- [x] Audit log helper (`lib/audit/log.ts`)
- [x] Seed script + form configs

### Auth flow
- [x] Login / Signup / Forgot-password pages
- [x] **Invite token** flow (token → set password → first-user-becomes-Owner)
- [x] `/api/auth/signup`, `/api/auth/invite/accept`
- [x] Profile page + change password
- [x] 403 page

### Admin (web)
- [x] Admin shell (sidebar + navbar)
- [x] Pages: home, profile, settings, audit, users (+ new), docuflow placeholder, fuelos placeholder
- [x] `/api/admin/users` CRUD
- [x] R2 upload demo page

### CashHub MVP
- [x] **Universal ReportForm** engine (อ่าน `constants/business-types.ts` → render fields)
- [x] `constants/business-types.ts` (465 บรรทัด — 7 ประเภทธุรกิจครบ)
- [x] Reconcile indicator (real-time)
- [x] Shortage modal (เงินขาด → ระบุคน/หมายเหตุ)
- [x] Reconcile logic (`lib/cashhub/reconcile.ts`)
- [x] LIFF report page `/liff/report/[branchId]` (ใช้ session-based, ยังไม่ใช่ LIFF init จริง)
- [x] LIFF status page
- [x] `/api/cashhub/reports`, `/api/cashhub/approve`, `/api/cashhub/export`
- [x] Draft auto-save ใน localStorage

### DevOps
- [x] `.env.example` ครบ (DB / Supabase / R2 / LINE / Telegram / App)
- [x] R2 CORS script
- [x] Vercel deploy prep
- [x] Git: 11 commits, ประวัติสะอาด

---

## 🟡 Uncommitted (กำลังรีแสตรัคเจอร์)

```
Working tree changes:
 D app/(admin)/branches/page.tsx        ← ย้ายเข้า cashhub/branches/
 D app/(admin)/cashhub/page.tsx
 D app/(admin)/dashboard/*              ← ย้ายเข้า cashhub/dashboard/
 D app/(admin)/reports/*                ← ย้ายเข้า cashhub/reports/
 M app/(admin)/settings/page.tsx
 M app/(admin)/users/page.tsx
 M app/page.tsx
 M components/layout/admin-shell.tsx
 M components/ui/card.tsx

?? app/(admin)/cashhub/{branches,dashboard,reports}/   ← โครงสร้างใหม่
?? app/(admin)/{docuflow,fuelos,home}/
?? components/ui/{data-table,empty-state,section,stat-block}.tsx
?? lib/modules.ts
```

**= module-based folder restructure** ตามสเปค `(admin)/<module>/<page>` — ยังไม่ commit

---

## ⬜ Not started yet

### Sprint 0 ที่เหลือ
- [ ] **LINE Messaging API webhook** (`/api/line/webhook`)
- [ ] **LIFF init จริง** — `@line/liff` install แล้ว แต่ page ยังใช้ `requireSession()` แทน `liff.init()`
- [ ] **Telegram Bot** (Grammy, ยังไม่ install + ไม่มี `/api/telegram/webhook`)
- [x] ~~LINE Rich Menu config + upload script~~ — `scripts/line-rich-menu.mjs` + `npm run line:rich-menu`
- [ ] Telegram Admin Chat ID setup

### Sprint 1–2 ที่เหลือ
- [x] ~~Self-Register flow (`/join` page) + อนุมัติ~~ — admin queue (Telegram notify ค่อยทำกับ bot)
- [ ] Permission Templates UI (4 preset)
- [ ] Branch Groups (จัดกลุ่มสาขา) — มี table แล้ว, เหลือ UI
- [x] ~~Module Toggle UI per Org~~ — เพิ่ม per-user module access ด้วย
- [ ] Smart Digest (กัน Telegram spam) — รอ Telegram bot
- [x] ~~My Action Center widget~~
- [x] ~~Scheduled PDF Monthly Report~~ — Vercel cron `monthly-report-pdf`

### CashHub (Sprint 3–5)
- [ ] **ทดสอบ ReportForm 7 ประเภทครบ** (มี config แล้ว แต่ยังไม่ verify ครบทุก type)
- [x] ~~Spike Alert~~ (commit `692bfbb`)
- [ ] Anti-Stupidity ที่เหลือ: Time Alert (00:00–05:00), Pre-check Rule 7
- [ ] Approval ผ่าน **Telegram Inline** [✅][❌][📊] — Quick Approve Bar (web) มีแล้ว
- [x] ~~Smart Approval Panel (Web)~~ — Quick Approve Bar
- [x] ~~Analytics: Branch View + Super View + Calendar Heatmap~~
- [x] ~~Health Score A–F~~ + Cron (Vercel `health-score` 23:00 BKK)
- [x] ~~Branch Leaderboard + Streak Badge~~
- [x] ~~Drill-down: ภาพรวม → ธุรกิจ → สาขา → รายวัน~~
- [ ] AI Chat "Ask Me Anything" (Claude Haiku)
- [x] ~~Forecast สิ้นเดือน, Pattern Heatmap~~
- [ ] Quick Note Staff → เจ้าของ
- [x] ~~Missing Report Reason flow~~

### FuelOS (Sprint 6–7) — Sprint 6.0 schema ✅ (2026-05-11)
- [x] **Sprint 6.0 — Schema foundation** (16 models + RLS + GENERATED columns)
- [ ] Sprint 6.1 — Price Engine (depot price entry + zone margin admin) ← **next**
- [ ] Sprint 6.2 — CRM Multi-Entity (contacts/entities/locations + credit fields)
- [ ] Sprint 6.3 — Sales Workspace (Priority List + Quote/Win-Loss + Margin Analytics)
- [ ] Sprint 6.4 — LINE Bot (Reply API + Response Time tracking)
- [ ] Sprint 7 — MOPS Alert + PTT Scraper
- [ ] Sprint 7 — Driver PWA (GPS + Photo + Invoice)
- [ ] Sprint 7 — Dispatch Board + Route Optimization
- [ ] Sprint 7 — Flash Sale (LINE OA Broadcast)
- [ ] Sprint 7 — TRCloud Sync

### DocuFlow (Sprint 8) — ✅ MVP ครบ (ยังไม่ได้ UAT จริง)
- [x] ~~4 ระดับเอกสาร + 5 บริษัท~~ (foundation migration)
- [x] ~~Tag System~~
- [x] ~~Expiry Dashboard~~ + cron `docuflow-expiry`
- [x] ~~Vehicle + Driver tracking~~
- [x] ~~Renewal Workflow + AI Comparison~~
- [x] ~~Signature Placement (Box drag-drop)~~
- [ ] External Sign (OTP, ไม่ต้อง Account) — ยังไม่ทำ

---

## 🚀 Next 5 Concrete Steps (ลำดับ — refresh 2026-05-11)

1. **Apply FuelOS Sprint 6.0 migration** — `npx prisma db push` + run `20260511000001_fuelos_sprint6_foundation.sql` ใน Supabase
2. **Sprint 6.1 — Price Engine UI/API** — `/fuelos/price-master` + `lib/fuelos/pricing.ts` (pure compute) + audit log บน publish (FUELOS_PLAN.md §3)
3. **Telegram Bot** — install grammy + `/api/telegram/webhook` + Approval inline `[✅][❌][📊]` (block FuelOS MOPS Alert + CashHub approve flow)
4. **LIFF init จริง** — เปลี่ยน `/liff/report/[branchId]` จาก `requireSession()` → `liff.init()` + map LINE userId → User
5. **CashHub Anti-Stupidity ที่เหลือ** — Time Alert (00:00–05:00) + Pre-check Rule 7

---

## ⚠️ Open questions / Risks

- **Next.js 16 docs**: หลาย API เปลี่ยน, agent ต้องอ่าน `node_modules/next/dist/docs/` ก่อน (ดู `AGENTS.md`)
- **LIFF page ปัจจุบันใช้ `requireSession()`** = ยังไม่ใช่ LIFF จริง (ต้อง login ก่อน). ถ้าจะให้ Staff เปิดจาก LINE Rich Menu ตรง ๆ ต้องเพิ่ม `liff.init()` + map LINE userId → User
- **PROJECT_TRACKER.md ในสเปคล้าสมัย** — ต่อไปอัพเดตที่ STATUS.md นี้แทน
- **Brand wording**: "Pooilgroup" (คำเดียว) — ตรวจ UI strings เก่าที่ยังเขียน "Pool Group" อยู่
- **External accounts ที่ต้องตั้งจริง**: LINE Developers Channel, LIFF App, Telegram BotFather, Cloudflare R2 Bucket (น่าจะมีบ้างแล้ว — ตรวจ `.env.local`)

---

## 📂 Source-of-truth Map

```
ดีเทลv1/                        ← Specs (อ่านก่อนเขียน feature)
├── CLAUDE.md                  Master overview
├── CORE_SYSTEM.md             Auth/User/Dashboard
├── CASHHUB.md                 รายงานยอดสาขา
├── FUELOS.md                  ขายน้ำมัน B2B
├── DOCUFLOW.md                เอกสาร + ลายเซ็น
├── RULES.md                   Coding standards (22 rules)
└── PROJECT_TRACKER.md         ⚠️ ล้าสมัย — ใช้ STATUS.md แทน

web/
├── STATUS.md                  ← ไฟล์นี้ (สถานะจริง)
├── CLAUDE.md                  → @AGENTS.md
├── AGENTS.md                  Next.js 16 warning
├── prisma/schema.prisma       8 tables (DONE)
├── constants/business-types.ts  7 form configs (DONE)
├── lib/auth/permissions.ts    Permission Matrix (DONE)
├── lib/cashhub/reconcile.ts   Reconcile logic (DONE)
└── app/(admin)/cashhub/...    Module-based pages (in progress)
```
