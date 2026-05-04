# 📍 STATUS.md — Pooilgroup ERP

> **Source of truth สำหรับสถานะจริง** — อัพเดต 2026-05-04 (ระบบ Dashboard ยอดขาย ครบ MVP)
> ใช้แทน `ดีเทลv1/PROJECT_TRACKER.md` (ซึ่งบอก 0% — ไม่จริง)
> Brand: **Pooilgroup** (คำเดียว, P ใหญ่)

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
- [ ] **LIFF init จริง** (`@line/liff` package, ยังไม่ install)
- [ ] **Telegram Bot** (Grammy, ยังไม่ install + ไม่มี `/api/telegram/webhook`)
- [ ] LINE Rich Menu config + upload script
- [ ] Telegram Admin Chat ID setup

### Sprint 1–2 ที่เหลือ
- [ ] Self-Register flow (`/join` page) + Telegram approval
- [ ] Permission Templates UI (4 preset)
- [ ] Branch Groups (จัดกลุ่มสาขา)
- [ ] Module Toggle UI per Org
- [ ] Smart Digest (กัน Telegram spam)
- [ ] My Action Center widget
- [ ] Scheduled PDF Monthly Report

### CashHub (Sprint 3–5)
- [ ] **ทดสอบ ReportForm 7 ประเภทครบ** (มี config แล้ว แต่ยังไม่ verify ครบทุก type)
- [ ] Anti-Stupidity Rules: Spike Alert, Time Alert (00:00–05:00), Pre-check Rule 7
- [ ] Approval ผ่าน **Telegram Inline** [✅][❌][📊]
- [ ] Smart Approval Panel (Web)
- [ ] Analytics: Branch View + Super View + Calendar Heatmap
- [ ] **Health Score A–F** (Cron 23:00)
- [ ] Branch Leaderboard + Streak Badge
- [ ] Drill-down: ภาพรวม → ธุรกิจ → สาขา → รายวัน
- [ ] AI Chat "Ask Me Anything" (Claude Haiku)
- [ ] Forecast สิ้นเดือน, Pattern Heatmap
- [ ] Quick Note Staff → เจ้าของ
- [ ] Missing Report Reason flow

### FuelOS (Sprint 6–7) — ยังไม่เริ่ม
- [ ] Price Engine (2 ราคา, MOPS Alert)
- [ ] CRM ลูกค้า ~1,000 (Multi-Entity, Credit, GPS)
- [ ] LINE Bot รับออเดอร์จาก Group
- [ ] Sales Workspace + Win/Loss + Competitor Intel
- [ ] Driver PWA (GPS + Photo + Invoice)
- [ ] Dispatch Board + Route Optimization
- [ ] Flash Sale (LINE OA Broadcast)
- [ ] TRCloud Sync

### DocuFlow (Sprint 8) — ยังไม่เริ่ม
- [ ] 4 ระดับเอกสาร + 5 บริษัท
- [ ] Tag System
- [ ] Expiry Dashboard
- [ ] Vehicle + Driver tracking
- [ ] Renewal Workflow + AI Comparison
- [ ] Signature Placement (Box drag-drop)
- [ ] External Sign (OTP, ไม่ต้อง Account)

---

## 🚀 Next 5 Concrete Steps (ลำดับ)

1. **Commit งานที่ค้าง** — module folder restructure อย่าทิ้งไว้ลอย
2. **เลือก channel ก่อน:**
   - **A) Telegram first** (ง่ายกว่า, Admin จำเป็นต้องใช้ทันที) → install grammy + `/api/telegram/webhook` + Approval flow
   - **B) LINE LIFF first** (Staff ใช้, แต่ต้อง LINE Channel + LIFF App ก่อน) → install @line/liff + `/api/line/webhook` + Rich Menu
3. **เติม Anti-Stupidity Rules** ที่เหลือใน CashHub (Spike, Time, Pre-check) — ของง่าย, ค่ากลับสูง
4. **Sprint 4 — Approval flow ครบ** (Telegram inline → DB → web fallback)
5. **Health Score A–F + Cron 23:00** → unlock Dashboard ของจริง

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
