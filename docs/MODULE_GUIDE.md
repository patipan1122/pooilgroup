# MODULE_GUIDE.md — Multi-Module Architecture + Parallel Development

> **READ THIS FIRST** before starting work on any Pool module.
> Authored 2026-05-30 after the branch-flip + parallel-session incidents.
> Owner: human (CEO) — Claude should follow these rules, not change them.

---

## 1. Architecture in one picture

```
pooilgroup-web/  (Next.js · 1 deploy → pooilgroup.vercel.app)
│
├── PoolShell (โครงร่วม — แตะเมื่อจำเป็นเท่านั้น)
│   ├── /dashboard                ← Pool main + module switcher
│   ├── /(admin)/layout.tsx       ← auth + sidebar + module switcher
│   └── lib/modules.ts            ← registry ของ 9 module
│
├── ของแต่ละโมดูล (ของส่วนตัว · เขียนได้เต็มที่ใน scope ตัวเอง)
│   ├── app/(admin)/<slug>/*      ← UI + routes
│   ├── app/api/<slug>/*          ← API route handlers
│   ├── lib/<slug>/*              ← server logic + queries + actions
│   └── components/<slug>/*       ← UI components
│
└── ของส่วนกลาง (shared infra — มีคนเดียวแก้ได้ในเวลาเดียวกัน)
    ├── prisma/schema.prisma      ← มี Cf*, Recruit*, Inbox*, Repair*... prefix
    ├── Supabase 1 ตัว             ← table prefix: cf_*, recruit_*, inbox_*, ...
    ├── R2 bucket 1 ตัว             ← key prefix: clawfleet/..., recruit/..., ...
    └── Auth/RLS 1 ระบบ             ← User · Branch · Organization (shared)
```

**Pattern:** modular monolith. ทุกโมดูล deploy รวมเป็น Next.js app เดียว ใช้ DB + storage ตัวเดียวกัน แต่แยกขอบเขตด้วย **prefix** (ตาราง, R2 key) และ **โฟลเดอร์**.

---

## 2. Module Registry (9 modules)

| slug | name | basePath | DB prefix | R2 prefix | schema |
|---|---|---|---|---|---|
| `cashhub` | CashHub | `/cashhub` | `daily_reports`, `cash_*` (legacy, no clean prefix) | `cashhub/` | `public` |
| `docuflow` | DocuFlow | `/docuflow` | `documents*`, `document_*` (no prefix but distinct) | `documents/`, `signatures/` | `public` |
| `repairs` | ระบบแจ้งซ่อม | `/repairs` | `repair_*` | `repair/` | `public` |
| `clawfleet` | ClawFleet | `/clawfleet` | `cf_*` | `clawfleet/` | `public` |
| `chairops` | เก้าอี้นวด | `/chairops` | `chairops_*` (+ `chairops` schema) | ⚠️ `cash/`, `cleanliness/`, `damage/` (NO module prefix — fix needed) | `chairops` |
| `recruit` | รับสมัครพนักงาน | `/recruit` | `recruit_*` | `recruit/`, `recruit-questions/` | `public` |
| `playland` | Playland | `/playland` | (uses `playland` schema, no `pl_` prefix on table names) | `playland/` | `playland` |
| `inbox` | กล่องข้อความรวม | `/inbox` | `inbox_*` | `inbox/` | `public` |
| `fuelos` | FuelOS | `/fuelos` | `fuel_orders`, `depot_prices`, etc. (NO prefix — legacy) | n/a | `public` |

> **Source of truth:** `lib/modules.ts` (slug → name, icon, basePath, nav, roles)

---

## 3. File Ownership Map (กฎเหล็ก)

For any module `<slug>`:

### 🟢 OWNED by the module (Claude สำหรับ `<slug>` แก้ได้เต็มที่)
- `app/(admin)/<slug>/**`
- `app/api/<slug>/**`
- `lib/<slug>/**`
- `components/<slug>/**`
- `supabase/migrations/*_<slug>_*.sql` (only the module's own)
- The `model XYZ` blocks in `prisma/schema.prisma` that begin with the module's prefix

### 🔴 SHARED — ต้องคนเดียวแก้ในเวลาเดียวกัน
| File | Why | Rule |
|---|---|---|
| `lib/modules.ts` | central registry | One Claude at a time. Coordinate via Slack/CEO. |
| `prisma/schema.prisma` (User/Branch/Organization/UserBranch/UserModule blocks) | shared auth/multi-tenant primitives | Don't modify without explicit CEO sign-off. |
| `app/(admin)/layout.tsx` | top auth + sidebar | Treat as read-only unless you have a specific gate task. |
| `app/dashboard/page.tsx` | Pool main | Only the person redesigning the dashboard touches this. |
| `package.json` / `package-lock.json` | npm deps | Whoever adds a package merges first; others run `npm install` after pull. |
| `middleware.ts` | top-level auth/routing | Almost never touch; coordinate. |
| `next.config.*`, `tsconfig.json`, `tailwind.config.*` | global config | Same as above. |

### ⛔ FORBIDDEN
- Touching another module's `lib/<other-slug>/`, `app/(admin)/<other-slug>/`, etc.
- Reading another module's Prisma models (`prisma.cfMachine` from `lib/recruit/` = NO).
- Using another module's R2 prefix.

---

## 4. Shared Infra Rules

### 4.1 Supabase (1 DB · prefix แยก)

- **Naming:** `<slug>_<entity>` (e.g. `cf_machines`, `recruit_postings`, `repair_tickets`).
- **Migrations:** filename must include slug: `20260601000000_<slug>_<purpose>.sql`. Ambiguous names (`20260504_dashboard_addons.sql`) cause confusion when audit-tracing changes.
- **RLS / org scoping:** every query must filter by `orgId: session.user.org_id`. Per-branch scoping via `userBranchIds(session)` for non-admin users.
- **Schema isolation (Postgres `schema=`):** ChairOps + Playland use dedicated schemas. Don't cross schemas in queries without explicit intent.

### 4.2 R2 (1 bucket · key prefix แยก)

- **Pattern:** every key MUST start with `<slug>/`. Then `<orgId>/<yyyy-mm>/...` for retention sanity.
- **Example correct:** `clawfleet/<org>/<yyyy-mm>/<machine>/<event>/<phase>.webp`
- **Example wrong:** `cash/<yyyy>/<mm>/...` (missing module prefix → cross-module collision possible)
- **Retention crons** must filter by their own prefix only. Never delete keys you didn't write.

### 4.3 `lib/modules.ts` (central nav registry)

When adding/editing a module:
1. Use a unique slug (lowercase, kebab-case).
2. `basePath: /<slug>` — match the folder.
3. Every `nav` item: `roles: [...]` OR `adminOnly: true` (don't leave both blank — silent access leak).
4. Icons must be imported at top of the file. If lucide exports `Foo` and you alias as `FooIcon`, reference `FooIcon`, not `Foo`.
5. `MODULES_DISABLED` env var gates modules at runtime (comma-separated slugs). Module disabled → layout redirects to `/dashboard`.

### 4.4 Module entitlement gate (REQUIRED in every module's layout)

Every `app/(admin)/<slug>/layout.tsx` MUST:
```ts
import { isModuleDisabled } from "@/lib/modules";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

if (isModuleDisabled("<slug>")) redirect("/dashboard");
const session = await requireSession();
if (!isAdminTier(session.user.role)) {
  const ok = await userHasModuleAccess(session.user, "<slug>");
  if (!ok) redirect("/403");
}
```
Role check alone is NOT enough (admin could otherwise bypass module entitlement).

---

## 5. Parallel Development — Worktree Layout

```
/Users/patipantantikul/Code/pooilgroup/legacy/
├── pooilgroup-web/                   ← main repo · setup branch · ใช้ merge + deploy
└── worktrees/
    ├── pool-cashhub/                 (branch: claude/cashhub-work)
    ├── pool-clawfleet/               (branch: claude/clawfleet-prod-redesign)
    ├── pool-chairops/                (branch: claude/chairops-…)
    ├── pool-docuflow/                (branch: claude/docuflow-work)
    ├── pool-inbox/                   (branch: claude/inbox-work)
    ├── pool-playland/                (branch: claude/playland-work)
    ├── pool-recruit/                 (branch: claude/recruit-work)
    └── pool-repairs/                 (branch: claude/repairs-work)
```

**ทำไม:** 1 working tree ใน git = 1 HEAD. ถ้า Claude 2 ตัวอยู่ working tree เดียวกัน เมื่อตัวหนึ่ง `git checkout` อีกตัวเดือดร้อนทันที. Worktree แก้ปัญหานี้: แต่ละ Claude มี working tree ตัวเอง · ป้าย HEAD แยก · แต่ git history เดียวกัน.

### 5.1 Setup (ทำครั้งเดียว ต่อ module)

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy
mkdir -p worktrees
git -C pooilgroup-web worktree add ../worktrees/pool-<slug> -b claude/<slug>-work
cd worktrees/pool-<slug>
npm install                # ครั้งเดียว (ใช้เวลาสักหน่อย)
npx prisma generate        # ครั้งเดียว · เมื่อ schema เปลี่ยน รันซ้ำ
```

หรือใช้สคริปต์: `bash docs/scripts/setup-worktrees.sh` (ทำทุก slug รวด)

### 5.2 ใช้งานประจำวัน

1. **เปิด VS Code window สำหรับแต่ละ worktree** (คนละ window = คนละ Claude)
2. **ทุก session ใหม่ บอก Claude scope:**
   ```
   /goal ทำเฉพาะ <slug> ห้ามแตะอย่างอื่น
   ```
3. **Claude ต้องเช็ค branch ก่อนทุก `git` operation** (`git branch --show-current`).
4. **commit ถี่ ๆ** — commit ทุก milestone เล็ก ๆ. งานที่ committed อยู่ใน git object ไม่หาย แม้ HEAD เลื่อน.

### 5.3 Merge เมื่อจบ

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web
git checkout setup
git pull
git merge claude/<slug>-work --no-ff -m "merge: <slug> · <feature>"
# ตรวจ tsc/build แล้ว push
git push
```

### 5.4 ลบ worktree เมื่อ merge เสร็จ

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy
git -C pooilgroup-web worktree remove ../worktrees/pool-<slug>
git -C pooilgroup-web branch -d claude/<slug>-work    # ถ้า merge แล้ว
```

---

## 6. Module Checklist (เริ่มโมดูลใหม่)

ก่อนเริ่มเขียน ตรวจให้ครบ:

- [ ] **ตัดสินใจ slug + prefix** (เช่น `playland` + `pl_*` + `playland/`)
- [ ] **สร้าง 4 โฟลเดอร์:** `app/(admin)/<slug>/` · `app/api/<slug>/` · `lib/<slug>/` · `components/<slug>/`
- [ ] **เขียน `app/(admin)/<slug>/layout.tsx`** ด้วย entitlement gate ตามข้อ 4.4
- [ ] **ลงทะเบียนใน `lib/modules.ts`** (slug, name, icon, basePath, nav items + roles)
- [ ] **Prisma models** ใช้ prefix (เช่น `model PlBranch`); `@@map("pl_branches")` ใน schema
- [ ] **Migration filename:** `<yyyymmdd000000>_<slug>_<purpose>.sql`
- [ ] **R2 uploads** key เริ่มด้วย `<slug>/`
- [ ] **org_id + branch scoping** ในทุก query
- [ ] **worktree:** `git worktree add` แล้วทำงานในนั้น (อย่าทำใน main working tree)

---

## 7. Audit Findings (2026-05-30) — ของจริงที่ต้องแก้

ผลการ audit อัตโนมัติ 4 มิติ:

### ✅ 100% PASS
- **Module entitlement gates** — 8/8 modules ทำถูก (เรียก `isModuleDisabled` + `userHasModuleAccess`)
- **lib/modules.ts** — ไม่มี icon ผิด · basePath ตรง slug · MODULES_DISABLED ทำงาน
- **Schema isolation at ORM** — ไม่พบ module ใดอ่าน table ของ module อื่น

### ⚠️ ต้องแก้ — Action Items

| # | Module | ปัญหา | ผลกระทบ | วิธีแก้ |
|---|---|---|---|---|
| A | ChairOps | R2 keys ขึ้นต้นด้วย `cash/`, `cash-slip/`, `cleanliness/`, `damage/` (ไม่มี `chairops/` prefix) | โมดูลอื่นเขียนทับได้ · per-module retention ทำไม่ได้ | แก้ `lib/chairops/storage/r2.ts:36,43,50,57` ให้ขึ้นต้น `chairops/cash/...` |
| B | FuelOS | 16 tables ไม่มี prefix (`fuel_orders`, `payments`, `trucks`, ...) | ชนกับ module ใหม่ในอนาคต | ⏳ อยู่ใน `coming_soon` ยังไม่จำเป็นเร่งด่วน · ก่อน launch ค่อย rename |
| C | Playland | ตารางใช้ schema isolation (`playland.audit_logs`) ไม่ใช่ name prefix; ชนชื่อกับ public schema (`audit_logs`) | query cross-schema อาจสับสน | ใช้ Prisma client schema-aware เสมอ · ไม่ใช่ raw SQL |
| D | Recruit | `recruit-questions/` แยกจาก `recruit/` prefix | inconsistency ระหว่าง 2 R2 paths | รวมเป็น `recruit/questions/...` |
| E | modules.ts | 12 nav items ไม่มี `roles` หรือ `adminOnly` (cashhub, chairops, playland, inbox) | ทุก signed-in user เห็น nav item เหล่านี้ | เพิ่ม `roles` หรือ `adminOnly` ให้ครบ |
| F | Migrations | ~50% migration เก่าไม่มีชื่อ module ในไฟล์ name | ตรวจสอบ historical change ยาก | ไปข้างหน้า: enforce ชื่อ `<date>_<slug>_<purpose>.sql` |

---

## 8. Common Mistakes — กันไว้ก่อน

| สิ่งที่พลาดบ่อย | ผลที่ตามมา | กันยังไง |
|---|---|---|
| 2 Claude อยู่ working tree เดียวกัน | branch flip · งาน revert | ใช้ worktree (ข้อ 5) |
| Claude ทำงานแล้วไม่ commit | สลับ branch แล้วงานหาย | commit ทุก milestone เล็ก ๆ |
| ลืม `npx prisma generate` หลัง pull | tsc พังเพราะ client type ไม่ตรง | รัน `prisma generate` ทุกครั้งหลัง pull |
| ใช้ symlink `node_modules` ข้าม worktree | Turbopack build fail | `npm install` จริงในทุก worktree |
| Module X อ่าน table ของ module Y | tight coupling · merge conflict | ส่งผ่าน shared service (User/Branch/Org) เท่านั้น |
| ไม่ใส่ role/adminOnly ใน nav item | ผู้ใช้ทุกคนเห็น link | ระบุ `roles` หรือ `adminOnly` ทุก nav item |

---

## 9. Quick Reference

```bash
# เช็คก่อนทำงาน
git branch --show-current
git worktree list

# สร้าง worktree ใหม่
git worktree add ../worktrees/pool-<slug> -b claude/<slug>-work

# หลัง pull
npm install
npx prisma generate

# commit ทุก milestone
git add <specific-files>
git commit -m "feat(<slug>): <change>"

# merge เข้าหลัก
git checkout setup && git pull
git merge claude/<slug>-work --no-ff
```

---

## 10. References

- [pooil-parallel-session-branch-switch] — ปัญหาที่ memory บันทึก
- [architecture-c-separate-deploy-share-auth] — Pool + Buildly Go = 2 repos
- [module-entitlement-must-gate-all-layouts] — กฎ gate ทุก layout
- [modules-disabled-env-killswitch] — kill switch
- `prisma/schema.prisma` — ของจริง
- `lib/modules.ts` — registry
- `lib/auth/module-access.ts` — `userHasModuleAccess` impl

> ถ้าเจอเคสที่ไม่อยู่ในกฎข้างบน · อย่าเดา · ถาม CEO.
