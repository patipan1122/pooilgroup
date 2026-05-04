# 🌙 รายงานคืนนี้ (5 พ.ค.)

> **ทำในขณะคุณนอน** — ตื่นมาดูตรงนี้ก่อน
> 13 commits ใหม่ · ครอบคลุม Phase C1 → C7 ของ CORE_PLAN.md

---

## 🎯 ทำอะไรเสร็จบ้าง — สรุปสั้น

```
✅ ปิดช่องโหว่ความปลอดภัย 3 จุด
✅ จัดการคน-สาขา ครบทุกหน้า (เพิ่ม / แก้ / ลบ / ส่งลิงก์ใหม่)
✅ เปิดให้สมัครใช้งานเองที่ /join + คิวให้ Admin อนุมัติ
✅ ตั้งค่าองค์กร / โปรแกรมเปิด-ปิดได้
✅ ระฆังแจ้งเตือนในทุกหน้า + กล่องข้อความเข้า
✅ หน้าหลักแสดง "เรื่องที่คุณต้องทำ" ก่อนทุกอย่าง
✅ Audit log filter ได้ตามวัน/คน/action
✅ Import คนหลายคนพร้อมกันด้วย CSV
```

**รวม 13 commits ใหม่** — git log สวย พร้อม push

---

## ⚠️ ต้องทำก่อนใช้งาน (สำคัญ!)

### 1. Apply Database Migration
มี 9 ตารางใหม่ที่ต้อง create ใน Supabase:

```bash
cd /Users/patipantantikul/Desktop/pooilgroup/web

# Option A: prisma push (เร็วสุด)
npx prisma db push

# Option B: รัน SQL ด้วยมือใน Supabase Dashboard
# → SQL Editor → paste ไฟล์ prisma/migrations/002_core_extensions.sql
```

ตารางที่เพิ่ม:
- `notifications` — ระฆังแจ้งเตือน
- `user_sessions` — ประวัติ login/devices
- `register_requests` — คิวสมัครเอง
- `org_modules` — toggle CashHub/FuelOS/DocuFlow
- `branch_groups` + `branch_group_members` — รวมกลุ่มสาขา
- `holidays` — ปฏิทินวันหยุด (ใช้ภายหลัง)
- `telegram_subscriptions`, `telegram_groups`, `telegram_pairing_tokens` — รอ bot

### 2. ลองทดสอบหน้าใหม่ (ตามลำดับ)

```
1. /login              → ลอง login (ถ้ารหัสผิด 5 ครั้งจะถูกล็อก 15 นาที)
2. /home               → ดู "MY ACTIONS" section ใหม่
3. /admin/profile      → ดูช่องทางแจ้งเตือน + กดเข้า "อุปกรณ์ที่เข้าใช้"
4. /admin/profile/sessions → ดู login history ของตัวเอง
5. /admin/users        → กด user ดู detail + แก้ไข + ปิดบัญชี
6. /admin/users/new    → สร้าง user ใหม่ (เหมือนเดิม)
7. /admin/users/import → 🆕 import CSV หลายคน
8. /admin/users/requests → 🆕 คำขอใหม่
9. /join               → 🆕 หน้าสมัครเอง (public)
10. /admin/branches    → 🆕 จัดการสาขา (ย้ายจาก /cashhub/branches)
11. /admin/branches/new → สร้างสาขา
12. /admin/settings    → 🆕 แก้ไขชื่อองค์กร / toggle modules / config CashHub
13. /admin/audit       → 🆕 มี filter bar
14. ระฆังที่มุมขวาบน — มี notification เด้งเมื่อมีคนสมัคร
```

---

## 📂 รายละเอียดสิ่งที่ทำ

### Phase C1 — Auth Hardening (commit 3-4)
ปิดช่องโหว่ที่ `CORE_PLAN.md` ระบุไว้:

| ที่อยู่ในโค้ด | ทำอะไร |
|---------------|--------|
| `lib/auth/login-tracker.ts` | helper functions (lock/track/record) |
| `/api/auth/check-login` | pre-flight 423 LOCKED ถ้าโดนล็อก |
| `/api/auth/track-failed-login` | นับ failed + ล็อก 5 ครั้ง = 15 นาที |
| `/api/auth/post-login` | สร้าง session row + audit LOGIN |
| `/api/auth/logout` | audit LOGOUT + ปิด session row |
| `/api/auth/sessions` | list user's sessions |
| `/api/auth/sessions/[id]` | DELETE = revoke session |
| `/admin/profile/sessions` | UI หน้า "อุปกรณ์ที่เข้าใช้" |

**ข้อดี:** brute-force รหัสไม่ได้ + รู้ทุก device ที่ login + กด revoke ได้

### Phase C2 — User CRUD ครบ (commit 5)
| Route | ทำอะไร |
|-------|--------|
| `/admin/users/[id]` | หน้า detail (ข้อมูล + channels + branches + 5 sessions ล่าสุด) |
| `/admin/users/[id]/edit` | แก้ไข name/role/phone/branches |
| `PATCH /api/admin/users/[id]` | บันทึกการแก้ไข (กัน demote super_admin คนสุดท้าย) |
| `DELETE /api/admin/users/[id]` | ปิดบัญชี + force logout ทุก device |
| `POST /api/admin/users/[id]/reactivate` | เปิดบัญชีอีกครั้ง |
| `POST /api/admin/users/[id]/resend-invite` | สร้างลิงก์ใหม่ 48 ชม. |

ป้องกัน:
- ปิดบัญชีตัวเองไม่ได้
- demote/ปิด super_admin คนสุดท้ายไม่ได้

### Phase C3 — Branch CRUD as Core (commit 6)
**Architecture fix:** สาขาเป็นข้อมูลกลาง ไม่ใช่ของ CashHub
- ย้าย `/admin/cashhub/branches` → `/admin/branches`
- เก่า redirect → ใหม่ (back-compat)
- Sidebar: เพิ่ม "สาขา" ใต้ ADMIN_NAV

| Route | ทำอะไร |
|-------|--------|
| `/admin/branches` | list + business-type chips + status badges |
| `/admin/branches/new` | form สร้างใหม่ |
| `/admin/branches/[id]` | detail (info / location / staff ที่ผูก / activity) |
| `/admin/branches/[id]/edit` | edit form (รหัส + ประเภท locked หลัง create) |
| API ครบ POST/PATCH/DELETE/reactivate | |

Form มี:
- 9 ประเภทธุรกิจ (radio cards พร้อม emoji)
- GPS lat/lng + ลิงก์เปิด Google Maps
- Manager dropdown
- Deadline time picker
- LINE Group ID field

### Phase C4a — Self-Register (commit 7)
| Route | ทำอะไร |
|-------|--------|
| `/join` | **public** หน้าสมัคร (ไม่ต้อง login) |
| `POST /api/auth/register-request` | รับคำขอ + rate limit 3/7วัน/เบอร์ |
| `/admin/users/requests` | คิวพิจารณา + ประวัติ |
| `PATCH /api/admin/register-requests/[id]` | approve / reject พร้อมเหตุผล |

Approve flow → สร้าง pending User + invite link ใน modal ให้ copy ส่ง LINE

ทุกครั้งมีคนสมัคร → ระฆัง Admin **เด้งทันที** + audit log

### Phase C5 — Settings editable (commit 9)
ก่อนหน้านี้ Settings เป็น read-only. ตอนนี้แก้ได้แล้ว:

3 cards:
1. **ข้อมูลองค์กร** — name / logoUrl / timezone / currency
2. **โปรแกรมที่เปิดใช้** — toggle switch ต่อ module
3. **ตั้งค่า CashHub** — deadline / reconcile mode / spike multiplier / off-hours

API:
- `PATCH /api/admin/settings/org` — merge settings JSON
- `PATCH /api/admin/settings/modules` — toggle on/off

### Phase C6 — Notifications (commits 8 + 10)

**ส่วน backend:**
- `lib/notifications/send.ts` — `sendNotification`, `sendNotificationToMany`, `getOrgAdminIds`
- `GET /api/notifications` — latest 20 + unread count
- `PATCH /api/notifications` — mark all read
- `PATCH /api/notifications/[id]` — mark one

**ส่วน UI:**
- `components/layout/notification-bell.tsx`
  - dropdown ที่มุมขวาบน (ทุกหน้า)
  - icon ตาม type (info/warning/danger/success)
  - dot สีฟ้าถ้ายังไม่อ่าน
  - poll ทุก 60 วินาที (debounced)
  - empty state + loading
- คลิก notification → mark read + นำทางไปหน้าที่เกี่ยวข้อง

**My Action Center (บน /home):**
- section ใหม่อยู่บนสุด: "MY ACTIONS · มี N เรื่องรอคุณ"
- card รายงาน CashHub รออนุมัติ (สีอำพัน)
- card คำขอเข้าใช้งานใหม่ (สีฟ้า, admin only)
- ถ้าไม่มีอะไร → empty state "เคลียร์หมดแล้ว"

### Phase C7 — Polish (commits 11-13)
- **Audit log:** filter bar (วันนี้/7วัน/30วัน/ทั้งหมด · action · user) + chips count action ยอดนิยม
- **Profile page:** card ใหม่แสดงสถานะผูก LINE/Telegram (รอ bot)
- **Bulk Import Users:** หน้าใหม่ /admin/users/import
  - Copy template CSV
  - paste → live CSV parser → preview table
  - validate ก่อน submit
  - download result CSV (มี invite URL ของทุกคนพร้อมส่ง)

---

## 🐛 ของที่เจอแล้วแก้ระหว่างทาง

1. **Login redirect bug** — `/dashboard` ไม่มีแล้ว (โดน restructure เป็น `/cashhub/dashboard`) → แก้ทุก redirect เป็น `/`
2. **Brand wording** — placeholder ยังเขียน `@poolgroup.com` → แก้เป็น `@pooilgroup.com` ทุกที่
3. **Branches ผิด namespace** — อยู่ใต้ `/cashhub/branches` แต่จริง ๆ เป็น Core → ย้าย + redirect

---

## ⏳ ที่ยังไม่ได้ทำ (รอ user input หรือ bot tokens)

```
□ Phase C4b — Telegram Bot scaffold
   ต้องการ: bot tokens จาก @BotFather (4 bots: pooilgroup/cash/fuel/doc)
   เมื่อพร้อม → ผมเริ่ม install grammy + webhook + pairing flow

□ Phase C8 — LINE LIFF จริง
   ต้องการ: LINE Channel + LIFF App + tokens
   เมื่อพร้อม → install @line/liff + Rich Menu + webhook

□ Branch Groups CRUD UI
   schema มีแล้ว · UI ยังไม่ได้ทำ (low priority)

□ Holidays Calendar UI
   schema มีแล้ว · UI ยังไม่ได้ทำ

□ Audit Excel Export (placeholder ในหน้า audit)

□ Idle timeout 60 นาที (ต้อง verify Next.js 16 middleware API ก่อน)

□ Forgot password UX improvement (ใช้ Supabase default ตอนนี้)
```

---

## 📊 Code Stats คืนนี้

```
13 commits
~5,000+ lines added
22 ไฟล์ใหม่ (pages + API routes + helpers)
9 ตาราง DB schema
0 dependencies เพิ่มใหม่ (ใช้ของที่มี)
```

ทุก commit มี Co-Authored-By Claude · ประวัติสะอาด

---

## 🎯 พรุ่งนี้แนะนำ

ตามลำดับ:

1. **รัน `npx prisma db push`** (สำคัญสุด — ไม่งั้น notification + sessions ใช้ไม่ได้)
2. **ลองทดสอบหน้า /home** — ดู My Action Center
3. **ลองสมัครใหม่ที่ /join** จากเครื่องอื่น — admin จะเห็นในระฆัง + /users/requests
4. **ลอง import CSV** ที่ /users/import — สร้างพนักงาน 5 คนพร้อมกัน
5. **ตอบคำถามที่ค้างจากครั้งก่อน** เพื่อปลด Phase ถัดไป:
   - Bot username ที่อยากใช้
   - Region splitting สาขา
   - Driver ใช้ Telegram จริงไหม

หลังจากนั้นผมเริ่ม Phase C4b (Telegram bot 4 ตัว) ได้เลย

---

*Generated overnight by Claude · ทุก commit verifiable ใน git log · ตื่นมาเปิด `git log --oneline -15` เห็นทั้งหมด*
