# CLAUDE.md — Pooilgroup ERP (pool-eng)

> ไฟล์นี้ Claude Code อ่านอัตโนมัติทุกครั้งที่เปิด `legacy/pooilgroup-web/`
> Last expanded: 2026-05-20 (was 1-line `@AGENTS.md` before)

@AGENTS.md
@docs/MODULE_GUIDE.md

> ⚠️ **READ `docs/MODULE_GUIDE.md` FIRST** if you are starting work on any module.
> It covers file ownership, shared-infra rules, worktree setup for parallel
> sessions, and the audit findings (R2 prefix, schema prefix, entitlement gates).

---

## 🎯 Project Context

**Pooilgroup ERP** = ระบบ ERP ภายในสำหรับธุรกิจน้ำมัน PO Oil Group
3 modules:
- **CashHub** — รายงานยอดสาขารายวัน · reconcile เงินขาด · approval flow
- **FuelOS** — ขายส่งน้ำมัน B2B · CRM 1,400 ราย · Price Engine · Quote/Win-Loss (Sprint 6.0 schema · UI ยังไม่ทำ)
- **DocuFlow** — เอกสารบริษัท · expiry tracking · renewal · signature placement

**Production:** https://pooilgroup.vercel.app (Vercel · Asia-SE)
**Customer #0:** PO Oil Group · 5 บริษัทในเครือ · ~50-100 พนักงาน

**ผู้พัฒนาไม่ใช่ developer แบบ traditional** → CEO ใช้ Claude Code · vibe coding
→ explain ทุก decision ภาษาคน · ไม่ใช่ jargon
→ ทุก action ต้องอธิบายผลกระทบ business

---

## 🛠 Tech Stack

```
Frontend:        Next.js 16.2.4 (App Router) + React 19 + TypeScript strict + Tailwind v4
Database:        Supabase (Postgres + Auth + RLS)
ORM:             Prisma 7.8 (schema-first) + adapter-pg
Object Storage:  Cloudflare R2 (signed-URL upload)
AI:              Anthropic SDK · Google Gemini (เลือก 1 ตัวใน .env)
LIFF/LINE:       @line/liff 2.28 · @line/bot-sdk
Deploy:          Vercel · timezone Asia/Bangkok
Forms:           react-hook-form + zod
UI:              shadcn-style · sonner toast
```

⚠️ **Next.js 16 มี breaking changes** จาก training data → อ่าน `node_modules/next/dist/docs/` ก่อนเขียน (ดู AGENTS.md)
⚠️ **Zod v4 strict UUID rejects seed UUIDs** → ใช้ `zUUID()` จาก `@/lib/zod-helpers` ไม่ใช่ `z.string().uuid()`

---

## 🏛 Architecture Principles

### 1. Multi-tenant by `org_id` + RLS
- ทุก table มี `org_id` (Prisma `@map("org_id") @db.Uuid`)
- RLS enabled บน ~46/52 tables (เหลือ 6 tables ที่ยังไม่ enable — ดู STATUS.md "Known Gaps")
- JWT custom claim hook ใส่ `org_id` ให้ Postgres policy ใช้
- **ปัจจุบัน 60/82 API routes ใช้ `adminClient()` = bypass RLS** → ต้องเขียน `.eq("org_id", session.user.org_id)` ด้วยมือทุก query (Tech Lead audit flag เป็น critical · ดู STATUS.md)

### 2. 6 Roles + Per-Branch ACL
- Roles: `super_admin · org_admin · admin · area_manager · branch_manager · staff · driver · viewer`
- ดู `lib/auth/permissions.ts` สำหรับ Permission Matrix
- ดู `lib/auth/role-guards.ts` สำหรับ executive/admin tier gates
- `user_branches` table = per-branch assignment (1 user หลายสาขาได้)
- `canApproveBranch(user, branchId, userBranchIds)` = key permission check

### 3. Audit Log = ห้ามลบ · เก็บ 5+ ปี
- `audit_logs` table — sensitive action trail
- **Retention policy: ≥5 ปี** (กฎหมายไทย พ.ร.บ.การบัญชี 2543 §14)
- **ห้ามสร้าง cron ลบ audit_logs เด็ดขาด** — comment ใน `prisma/schema.prisma`
- ใช้ `audit({ orgId, userId, action, resourceType, resourceId, diff, ipAddress, userAgent })` helper
- Sensitive HTTP routes → pass `...getRequestMeta(req)` เพื่อ capture IP/UA

### 4. Server-First + Server Actions
- Default = Server Component
- ใช้ `"use client"` เฉพาะที่จำเป็น (form interactive · browser API)
- API routes สำหรับ external integration (LINE webhook · Telegram · cron)

---

## 📁 Key Folder Structure

```
app/
├── (admin)/              ← Authenticated admin shell
│   ├── cashhub/         ← CashHub pages (dashboard · reports · leaderboard · heatmap · etc.)
│   ├── docuflow/        ← Document mgmt pages
│   ├── fuelos/          ← FuelOS placeholder (Sprint 6 UI พัฒนาภายหลัง)
│   ├── users/           ← User CRUD
│   ├── branches/        ← Branch CRUD
│   └── audit/           ← Audit log viewer
├── (auth)/              ← Login · signup · forgot-password
├── api/                 ← API routes
│   ├── auth/            ← Login/logout/invite
│   ├── cashhub/         ← Report CRUD · approve · unlock · export
│   ├── docuflow/        ← Upload · share · sign
│   ├── admin/           ← User mgmt · settings
│   └── cron/            ← Vercel cron (morning-brief · evening-check · health-score · etc.)
├── liff/                ← LINE LIFF pages (ยัง session-based · LIFF init จริงรอ)
└── sign/[placementId]/  ← External signing (no-account OTP — ยังไม่ทำ)

lib/
├── auth/                ← session · permissions · role-guards · login-tracker
├── audit/               ← audit log helper + request-meta
├── db/                  ← Supabase client (server · admin · insert helpers)
├── cashhub/             ← reconcile · health-score · streak · forecast · aggregator
├── docuflow/            ← doc analysis · ai-search · signature
├── notifications/       ← in-app notify · Telegram sender · LINE sender
├── r2/                  ← signed-URL upload
└── zod-helpers.ts       ← zUUID() (Zod v4 workaround)

prisma/
├── schema.prisma        ← 52 models · ~1500 lines
└── seed.ts              ← dev seed (UUIDs ไม่ผ่าน RFC 4122 strict)

supabase/migrations/     ← 12 SQL migrations (RLS + GENERATED columns + custom claims)
```

---

## 🚦 Workflow Rules

### Always before code change
1. อ่าน `STATUS.md` first — รู้ sprint ปัจจุบัน · อะไรเสร็จ · อะไรค้าง
2. อ่าน file ที่จะแก้ก่อน (Read tool) · ไม่เดา
3. ถ้า touch DB → ตรวจ `prisma/schema.prisma` + migrations ที่เกี่ยวข้อง

### Security hard rules
- `SUPABASE_SERVICE_ROLE_KEY` server-side เท่านั้น · ห้าม expose client
- ทุก HTTP route ที่ touch user data → verify session ก่อน (`requireSession()` / `requireRole()`)
- `adminClient()` ใช้ใน server-side เท่านั้น · query ต้องมี `.eq("org_id", session.user.org_id)` ทุกครั้ง
- ห้าม commit secrets · ตรวจ `.env.example` ว่าครบ

### Audit hard rules
- ทุก sensitive action (approve · reject · unlock · permission change · ฯลฯ) → `await audit({...})`
- HTTP context → pass `...getRequestMeta(req)` ลงในเเnt audit entry
- `audit_logs` ห้ามลบ · retention ≥5 ปี

### Coding conventions
- TypeScript strict · ห้าม `any` (มี 68 จุดที่ใช้ eslint-disable workaround · ค่อย ๆ ลด)
- เขียน comment ภาษาไทยได้สำหรับ business logic
- Naming: kebab-case file · PascalCase component · camelCase func/var
- Imports: ใช้ `@/` alias เสมอ

---

## 🧪 Verification before "Done"

[[feedback-real-world-verification]] · **typecheck ไม่พอ**:
1. `npm run build` ต้องผ่าน
2. ถ้าแตะ critical route (approve · unlock · export) → ทดสอบ curl/Playwright
3. ถ้าแตะ schema → `prisma db push` บน dev DB ก่อน production
4. **`git push` ≠ deploy prod** ([[feedback-push-not-equals-deploy]]) → Vercel ต้องกด "Redeploy" เอง

---

## 🚨 Known Critical Debts (อ่านก่อนเริ่มงาน)

จาก deep audit 2026-05-20 (6 personas):

1. **adminClient overuse** — 60/82 routes bypass RLS · ถ้าหลุด query 1 จุดที่ลืม `.eq("org_id")` = cross-tenant leak
2. **6 tables ขาด RLS** — `companies`, `branch_rentals`, `user_modules`, `ai_search_cache`, `document_analyses`, `document_signature_placements`
3. **Zero automated tests** — ไม่มี vitest/jest/playwright · refactor ใหญ่ต้องระมัดระวัง
4. **Failed-login lock มี code แต่ verify ว่า wire จริง** — `lib/auth/login-tracker.ts` พร้อม · ต้อง verify
5. **LIFF init ยังไม่จริง** — `/liff/report/[branchId]` ใช้ `requireSession()` แทน · พนักงานเปิด LINE Rich Menu ไม่ได้ตรง

---

## 🔗 Related

- Pool root: `../README.md` (workspace explainer)
- Buildly Go (โปรเจกต์อื่น): `/Users/patipantantikul/Code/buildlygo/`
- Production health: https://pooilgroup.vercel.app/api/health
- Sentry: https://auditmekub.sentry.io (project `javascript-nextjs-uc`)
- Deep audit summary: `STATUS.md` "🆕 Update (2026-05-20)" section
