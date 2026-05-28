# 🏗️ CORE_PLAN.md — Core System ครบทุกซอก

> **โฟกัส Core System อย่างเดียว** — ไม่แตะ CashHub/FuelOS/DocuFlow จนกว่า Core จะแน่น
> Source: `ดีเทลv1/CORE_SYSTEM.md` + `RULES.md`
> Updated: 2026-05-04

---

## 🎯 7 หมวดของ Core System (ตามสเปค)

```
1. AUTH                — Login, Session, Security
2. USER MANAGEMENT     — Roles, Invite, Self-Register, Offboarding, Templates
3. BRANCH MANAGEMENT   — CRUD, Groups, GPS, Module Toggle
4. EXECUTIVE DASHBOARD — Cross-module summary, My Action Center
5. NOTIFICATIONS       — Telegram (4 bots), Cron schedules, In-app inbox
6. SETTINGS            — Org, CashHub config, Security, Backup, Modules
7. AUDIT LOG           — All actions, Filter, Export
```

---

## 📊 Status Matrix (รายฟีเจอร์ — ละเอียด)

### 1️⃣ AUTH

| # | Feature | Status | ที่อยู่ในโค้ด |
|---|---------|--------|---------------|
| 1.1.A | Login Email/Password | ✅ | `app/(auth)/login/` |
| 1.1.B | Login LINE LIFF | ⬜ | — (ไม่มี `@line/liff`) |
| 1.1.C | Routing by role | 🟡 | ทุก role → `/home` (สเปคต้องแยก) |
| 1.2.A | JWT 8hr access token | 🟡 | Supabase default (ยังไม่ override) |
| 1.2.B | Refresh token 7d | ✅ | Supabase auto |
| 1.2.C | Idle timeout 60min | ⬜ | ต้องทำใน proxy.ts |
| 1.2.D | Failed login lock 5x → 15min | ⬜ | schema มี field แต่ logic ไม่มี |
| 1.2.E | Force Logout (revoke all sessions) | ⬜ | ต้องใช้ Supabase admin API |
| 1.2.F | Login History (devices/IP) | ⬜ | ไม่มี table + page |
| 1.2.G | Multi-device tracking | ⬜ | — |
| 1.2.H | Logout button + endpoint | ⬜ | **ไม่มีปุ่ม logout เลย!** |
| 1.2.I | Forgot Password | ✅ | `app/(auth)/forgot-password/` |
| 1.2.J | Change Password | ✅ | `app/api/profile/password/` |
| 1.x | LOGIN audit log | ⬜ | มีแค่ CREATE_USER ตอน signup |
| 1.x | LOGOUT audit log | ⬜ | — |
| 1.x | FAILED_LOGIN audit log | ⬜ | — |

### 2️⃣ USER MANAGEMENT

| # | Feature | Status | ที่อยู่ในโค้ด |
|---|---------|--------|---------------|
| 2.1 | 6 Roles in enum | ✅ | `prisma/schema.prisma` |
| 2.2.A | Invite by token | ✅ | `app/api/admin/users/route.ts` |
| 2.2.B | Accept invite (set password) | ✅ | `app/api/auth/invite/accept/` |
| 2.2.C | Resend invite | ⬜ | — |
| 2.2.D | Copy invite link UI | ✅ | `users/new/invite-form.tsx` |
| 2.3.A | Self-Register page `/join` | ⬜ | — |
| 2.3.B | Register requests queue | ⬜ | ไม่มี table `register_requests` |
| 2.3.C | Approve via Telegram | ⬜ | (ต้อง Telegram bot) |
| 2.4.A | Deactivate user (1-click) | ⬜ | — |
| 2.4.B | Force Logout on deactivate | ⬜ | — |
| 2.4.C | Reassign reports on deactivate | ⬜ | — |
| 2.4.D | Telegram notify on deactivate | ⬜ | — |
| 2.5 | Permission Templates (4 preset) | 🟡 | hardcoded matrix แต่ไม่มี UI |
| 2.6 | Temporary Access (auto-expire) | ⬜ | — |
| 2.7 | Access Review cron (90 days) | ⬜ | — |
| 2.8 | Permission Matrix | ✅ | `lib/auth/permissions.ts` |
| 2.x | Edit user (name, role, branches) | ⬜ | — |
| 2.x | Bulk import users (Excel) | ⬜ | — |
| 2.x | Pair LINE/Telegram to user | ⬜ | — |

### 3️⃣ BRANCH MANAGEMENT

| # | Feature | Status | ที่อยู่ในโค้ด |
|---|---------|--------|---------------|
| 3.1.A | Branch list view | 🟡 | `app/(admin)/cashhub/branches/page.tsx` (ผูกกับ CashHub) |
| 3.1.B | Branch CRUD (Create/Edit/Delete) | ⬜ | — |
| 3.1.C | GPS picker + map | ⬜ | — |
| 3.1.D | Manager assignment | ⬜ | — |
| 3.1.E | LINE Group ID linking | ⬜ | — |
| 3.1.F | Deadline + shifts config | ⬜ | — |
| 3.1.G | Holidays per branch | ⬜ | — |
| 3.2.A | Branch Groups (region/cluster) | ⬜ | ไม่มี table |
| 3.2.B | Filter Dashboard by group | ⬜ | — |
| 3.2.C | Compare performance per group | ⬜ | — |
| 3.x | Toggle modules per branch | ⬜ | — |

### 4️⃣ EXECUTIVE DASHBOARD

| # | Feature | Status | ที่อยู่ในโค้ด |
|---|---------|--------|---------------|
| 4.1.A | Cross-module summary cards | 🟡 | `home/page.tsx` มีของ CashHub |
| 4.1.B | Filter (วันที่/สัปดาห์/เดือน/กำหนดเอง) | ⬜ | — |
| 4.1.C | View by module/business type | ⬜ | — |
| 4.1.D | Group filter | ⬜ | — |
| 4.2 | Quick Approve Bar | ⬜ | — |
| 4.4 | My Action Center (per role) | ⬜ | — |
| 4.5 | Scheduled PDF Report (cron วันที่ 1) | ⬜ | — |
| 4.x | Branch Leaderboard | ⬜ | — |
| 4.x | Calendar Heatmap | ⬜ | — |
| 4.x | Drill-down panel | ⬜ | — |

### 5️⃣ NOTIFICATIONS

| # | Feature | Status | Note |
|---|---------|--------|------|
| 5.0 | Telegram Bot infra (4 bots) | ⬜ | แผนละเอียดในแชทก่อนหน้า |
| 5.0.a | `@pooilgroup_bot` (Core) | ⬜ | Phase 1 |
| 5.0.b | `@pooilcash_bot` | ⬜ | Phase 2 |
| 5.0.c | `@pooilfuel_bot` | ⬜ | Phase 4 |
| 5.0.d | `@pooildoc_bot` | ⬜ | Phase 4 |
| 5.0.e | `/start` pairing flow | ⬜ | — |
| 5.0.f | Webhook routes ×4 | ⬜ | — |
| 5.0.g | `telegram_subscriptions` table | ⬜ | ต้องเพิ่ม schema |
| 5.0.h | `telegram_groups` table | ⬜ | ต้องเพิ่ม schema |
| 5.0.i | `telegram_pairing_tokens` table | ⬜ | ต้องเพิ่ม schema |
| 5.1.A | Cron 07:00 Morning Brief | ⬜ | — |
| 5.1.B | Cron 18:00 Evening Check | ⬜ | — |
| 5.1.C | URGENT alerts | ⬜ | — |
| 5.2 | Smart Digest (batch/anti-spam) | ⬜ | — |
| 5.x | In-app notifications table | ⬜ | ไม่มี `notifications` table |
| 5.x | Notification Bell ใน navbar | ⬜ | — |
| 5.x | Mark as read/dismiss | ⬜ | — |

### 6️⃣ SETTINGS

| # | Feature | Status | ที่อยู่ในโค้ด |
|---|---------|--------|---------------|
| 6.A | Org info display | ✅ | `settings/page.tsx` (read-only) |
| 6.B | Edit Org name/logo/slug | ⬜ | — |
| 6.C | Fiscal Year setting | ⬜ | — |
| 6.D | CashHub config (deadline/threshold) | ⬜ | — |
| 6.E | Notification preferences | ⬜ | — |
| 6.F | Security policy (timeout/password) | ⬜ | — |
| 6.G | Backup config + manual backup | ⬜ | — |
| 6.H | Module Toggle per Org | ⬜ | ไม่มี table `org_modules` |
| 6.I | Holidays calendar | ⬜ | — |

### 7️⃣ AUDIT LOG

| # | Feature | Status | ที่อยู่ในโค้ด |
|---|---------|--------|---------------|
| 7.A | Display all actions | ✅ | `audit/page.tsx` |
| 7.B | Action type icons + colors | ✅ | — |
| 7.C | Filter by user | ⬜ | — |
| 7.D | Filter by action type | ⬜ | — |
| 7.E | Filter by date range | ⬜ | — |
| 7.F | Filter by module | ⬜ | — |
| 7.G | Export Excel | ⬜ | — |
| 7.H | Retention 1 year auto-archive | ⬜ | — |
| 7.x | Audit ครบ ทุก sensitive action | 🟡 | มีแค่ CREATE_USER + APPROVE/REJECT_REPORT |

---

## 🗄️ Database Schema ที่ต้องเพิ่ม

```prisma
// ── Notifications ──────────────────────
model Notification {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @map("org_id") @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  type          String   // info/warning/danger/success
  module        String?  // cashhub/fuelos/docuflow/core
  title         String
  body          String
  link          String?
  isRead        Boolean  @default(false) @map("is_read")
  sentTelegram  Boolean  @default(false) @map("sent_telegram")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  
  @@index([userId, isRead, createdAt])
  @@map("notifications")
}

// ── Login History ──────────────────────
model UserSession {
  id             String   @id @default(uuid()) @db.Uuid
  orgId          String   @map("org_id") @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  ipAddress      String?  @map("ip_address") @db.Inet
  userAgent      String?  @map("user_agent")
  device         String?  // parsed from UA
  loginAt        DateTime @default(now()) @map("login_at") @db.Timestamptz(6)
  lastActiveAt   DateTime @default(now()) @map("last_active_at") @db.Timestamptz(6)
  logoutAt       DateTime? @map("logout_at") @db.Timestamptz(6)
  isRevoked      Boolean  @default(false) @map("is_revoked")
  
  @@index([userId, loginAt])
  @@map("user_sessions")
}

// ── Self-Register Requests ─────────────
model RegisterRequest {
  id             String   @id @default(uuid()) @db.Uuid
  orgId          String   @map("org_id") @db.Uuid
  name           String
  phone          String
  email          String?
  branchId       String?  @map("branch_id") @db.Uuid
  requestedRole  String   @map("requested_role")
  notes          String?
  status         String   @default("pending") // pending/approved/rejected
  reviewedById   String?  @map("reviewed_by_id") @db.Uuid
  reviewedAt     DateTime? @map("reviewed_at") @db.Timestamptz(6)
  rejectReason   String?  @map("reject_reason")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  
  @@index([orgId, status])
  @@map("register_requests")
}

// ── Org Module Toggle ──────────────────
model OrgModule {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @map("org_id") @db.Uuid
  moduleName    String   @map("module_name") // cashhub/fuelos/docuflow
  isActive      Boolean  @default(true) @map("is_active")
  activatedAt   DateTime @default(now()) @map("activated_at") @db.Timestamptz(6)
  
  @@unique([orgId, moduleName])
  @@map("org_modules")
}

// ── Branch Groups ──────────────────────
model BranchGroup {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  name        String   // "อีสาน", "ปั๊มทั้งหมด"
  emoji       String?
  groupType   String   @map("group_type") // region/business/custom
  isActive    Boolean  @default(true) @map("is_active")
  
  @@map("branch_groups")
}

model BranchGroupMember {
  id        String   @id @default(uuid()) @db.Uuid
  groupId   String   @map("group_id") @db.Uuid
  branchId  String   @map("branch_id") @db.Uuid
  
  @@unique([groupId, branchId])
  @@map("branch_group_members")
}

// ── Telegram Multi-Bot ─────────────────
model TelegramSubscription {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  botName     String   @map("bot_name")
  chatId      String   @map("chat_id")
  isActive    Boolean  @default(true) @map("is_active")
  linkedAt    DateTime @default(now()) @map("linked_at") @db.Timestamptz(6)
  
  @@unique([userId, botName])
  @@map("telegram_subscriptions")
}

model TelegramGroup {
  id        String   @id @default(uuid()) @db.Uuid
  orgId     String   @map("org_id") @db.Uuid
  botName   String   @map("bot_name")
  chatId    String   @unique @map("chat_id")
  name      String
  module    String
  scope     Json     @default("{}")
  isActive  Boolean  @default(true) @map("is_active")
  
  @@index([orgId, module, isActive])
  @@map("telegram_groups")
}

model TelegramPairingToken {
  id         String   @id @default(uuid()) @db.Uuid
  orgId      String   @map("org_id") @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  token      String   @unique
  botName    String?  @map("bot_name")
  expiresAt  DateTime @map("expires_at") @db.Timestamptz(6)
  usedAt     DateTime? @map("used_at") @db.Timestamptz(6)
  
  @@index([token])
  @@map("telegram_pairing_tokens")
}

// ── Holidays (per Org) ─────────────────
model Holiday {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  date        DateTime @db.Date
  name        String
  isOrgWide   Boolean  @default(true) @map("is_org_wide")
  branchIds   String[] @default([]) @db.Uuid // empty = all branches
  
  @@unique([orgId, date])
  @@map("holidays")
}
```

---

## 🚦 Phased Plan — Core เท่านั้น

### **Phase C1 — Auth Hardening** (3-4 วัน)
ปิดช่องโหว่ความปลอดภัยที่หายไป + สร้าง audit baseline ครบ

```
□ /api/auth/logout/route.ts          (Logout endpoint + revoke session)
□ Logout button ใน navbar             (admin-shell.tsx)
□ Login route handler audit          (LOGIN action)
□ FAILED_LOGIN tracking + lock 5x    (15min lock + email warn)
□ Idle timeout 60min                 (proxy.ts middleware)
□ /api/auth/sessions/list             (My Sessions page)
□ /admin/profile/sessions page        (รายการ devices ที่ login อยู่)
□ Force Logout button + endpoint     (revoke specific session)
□ JWT 8hr config (Supabase Dashboard) → docs only
```

### **Phase C2 — User CRUD ครบ** (3-4 วัน)
admin จัดการ user ครบทุกอย่าง

```
□ Edit user page + API               (name/role/phone/branches)
□ Deactivate user (1-click flow)
   - Force Logout
   - Revoke permission
   - Reassign pending reports → Manager
   - Telegram notify
   - DEACTIVATE_USER audit
□ Reactivate user
□ Resend invite
□ Permission Templates apply UI       (4 preset → 1-click)
□ Bulk import users (CSV upload)
□ User search + filter + pagination
□ Cancel pending invite
```

### **Phase C3 — Branch CRUD ครบ** (3 วัน)
แยก Branch out จาก CashHub-only namespace

```
□ ย้าย /admin/cashhub/branches → /admin/branches  (Core, ไม่ใช่ CashHub)
□ Create branch + Edit + Deactivate
□ GPS picker (manual lat/lng เริ่มก่อน, map picker phase 2)
□ Manager assignment (dropdown)
□ Deadline + shifts config UI
□ Toggle modules per branch
□ Branch Groups CRUD
□ Branch list filter by group/business type/region
```

### **Phase C4 — Self-Register + Telegram (Bot 1)** (5-7 วัน)
เปิดให้ staff register เอง + ใช้ Telegram จริง

```
□ Add prisma models (TelegramSubscription, TelegramGroup, 
                      TelegramPairingToken, RegisterRequest,
                      Notification, UserSession, OrgModule, 
                      BranchGroup, Holiday)
□ Migration + RLS policies
□ /join page + register API
□ /api/auth/register-requests (queue management)
□ Install grammy + @line/bot-sdk
□ /api/telegram/pooilgroup/webhook/route.ts
□ /api/telegram/pairing/start/route.ts (gen token)
□ Bot /start <token> handler
□ DM template builders (lib/telegram/messages/core.ts)
□ Notify Owner on register request
□ Approve/Reject register via Telegram inline keyboard
□ Profile page → "ผูก Telegram" section + QR code
```

### **Phase C5 — Settings + Org Config** (3 วัน)
Owner ตั้งค่าจริงได้

```
□ Edit Organization (name, logo upload R2, slug locked)
□ Module Toggle per Org (cashhub/fuelos/docuflow on/off)
□ Fiscal Year config
□ CashHub default config (deadline 21:00, threshold 1%/5%, spike 1.5x)
□ Notification preferences (Telegram opt-in per type)
□ Security settings (idle timeout, lock duration)
□ Holidays calendar CRUD
□ Backup config (auto daily 03:00) — schedule only, action เริ่มกับ Supabase
```

### **Phase C6 — Executive Dashboard + In-app Notifications** (3-4 วัน)
รวม Cross-module + Notification Bell

```
□ My Action Center widget (per role pending list)
□ Quick Approve Bar (cross-module 1-click)
□ Module Filter on Dashboard
□ Date range filter (วันนี้/สัปดาห์/เดือน/custom)
□ Notification Bell + dropdown (in-app inbox)
□ /api/notifications/list + mark-read
□ Branch Leaderboard widget
□ Calendar Heatmap (สาขาส่ง/ไม่ส่งรายงาน)
□ Drill-down panel (click branch → detail)
```

### **Phase C7 — Audit Enhancement + Cron** (2 วัน)
audit เต็มสตรีม + scheduled jobs

```
□ Audit ครบทุก sensitive action (เพิ่ม USER_EDIT, BRANCH_*, SETTINGS_*, etc.)
□ Audit filter UI (user/action/date range/module)
□ Audit Excel export
□ Audit retention **5+ ปี · NO auto-delete cron** (กฎหมายไทย พ.ร.บ.การบัญชี 2543 §14 · สรรพากรแนะนำ 10 ปี · ห้ามสร้าง cron ที่ลบ audit_logs)
□ /api/cron/* setup (Vercel Cron)
   - 07:00 morning-brief
   - 18:00 evening-check
   - 23:00 health-score
   - daily 03:00 backup-trigger
   - monthly 1st 08:00 pdf-report
   - quarterly access-review
□ /api/cron/* shared secret guard (CRON_SECRET)
```

### **Phase C8 — LINE LIFF (Bot 2 + LIFF)** (3-4 วัน)
LINE channel ใช้งานจริง

```
□ Install @line/liff
□ /api/line/webhook (Messaging API)
□ /api/line/pairing — link LINE userId → User
□ LIFF init helper (lib/line/liff.ts)
□ Convert /liff/* pages to use real LIFF (ไม่ใช้ session)
□ LINE Rich Menu config + upload script
□ LINE chatbot replies (พิมพ์ "ยอดวันนี้" → ตอบสรุป)
```

---

## 📈 Progress Summary

```
Total Core features: ~75 รายการ
✅ Done:        ~14 (19%)
🟡 Partial:     ~6 (8%)
⬜ Not started: ~55 (73%)

Phase C1-C2 (Auth + User CRUD)         → unlock: ทำงานปลอดภัย
Phase C3 (Branch)                      → unlock: setup ข้อมูลจริง
Phase C4 (Self-Reg + Telegram bot 1)   → unlock: ใช้งานจริงใน Telegram
Phase C5-C6 (Settings + Dashboard)     → unlock: Owner ใช้สมบูรณ์
Phase C7-C8 (Audit + LINE LIFF)        → Core เสร็จ → ค่อยลง Module
```

---

## ⚠️ Known Gaps / Risks

1. **ไม่มี Logout button** — bug ใหญ่ ลำดับ 1 แก้ก่อนเลย
2. **Failed login ไม่ถูก lock** — ใช้รหัสคาด brute-force ได้
3. **Branch อยู่ใต้ /admin/cashhub/** — ผิด architecture (Branch เป็น Core ไม่ใช่ CashHub)
4. **uncommitted module restructure** — ค้างใน working tree (12 files modified, 11 untracked)
5. **JWT custom claim hook** ต้อง enable ที่ Supabase Dashboard manually
6. **No Telegram bot integration** — Owner ยังต้องเข้าเว็บอนุมัติทุกอย่าง
7. **No in-app notifications** — Notification Bell หายไป

---

## 🎯 Next 3 Concrete Actions (เริ่มเลย)

### Action 1: Logout flow
```
File ใหม่: app/api/auth/logout/route.ts
แก้ navbar:  components/layout/admin-shell.tsx
Audit:      LOGOUT action
```

### Action 2: Login + Failed-login audit + lock
```
File ใหม่: app/api/auth/login/route.ts (replace direct Supabase call)
File ใหม่: lib/auth/login-attempts.ts (track + lock)
Audit:      LOGIN, FAILED_LOGIN
ใช้ field:  users.failed_login_count, users.locked_until
```

### Action 3: Sessions page + Force Logout
```
File ใหม่: prisma migration → user_sessions table
File ใหม่: app/(admin)/profile/sessions/page.tsx
File ใหม่: app/api/auth/sessions/route.ts (list + revoke)
Hook:       login route → insert session row
            logout route → mark logoutAt
            middleware → update lastActiveAt
```

---

*CORE_PLAN.md v1.0 — เริ่มทำ Phase C1 ทันที*
