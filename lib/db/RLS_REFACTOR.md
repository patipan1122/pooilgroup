# `adminClient` → `serverClient` Refactor Plan

> **Goal:** ลด blast radius เมื่อ developer ลืม `.eq("org_id", session.user.org_id)`
> — บังคับให้ RLS เป็น defense-in-depth ไม่ใช่ decoration.
>
> **Status:** Documented · 0 of 62 routes converted (เริ่ม 2026-05-20 deep audit)
> **Owner:** Whoever picks up the route they touch · convert as you go

---

## The problem

ปัจจุบัน **62 API routes** ใช้ `adminClient()` (`SUPABASE_SERVICE_ROLE_KEY`) ซึ่ง bypass RLS หมด. ความปลอดภัยจึงพึ่ง:

1. Each query ต้องมี `.eq("org_id", session.user.org_id)` ด้วยมือ
2. ลืม 1 จุด = cross-tenant leak ทันที

เคยมี commit `2c5987c` "ปิด cross-org leaks" = แสดงว่าเคยหลุดจริง.

## Strategy: opt-out instead of opt-in

ปัจจุบัน routes default = `adminClient()` · ใหม่ default = `serverClient()` · adminClient เก็บไว้ใช้ใน **whitelist contexts** เท่านั้น:

| Whitelist (KEEP adminClient) | Reason |
|---|---|
| `app/api/auth/login/route.ts` | Pre-session · need to read users table |
| `app/api/auth/signup/route.ts` | Pre-session · creates user row |
| `app/api/auth/invite/accept/route.ts` | Token-based · no session yet |
| `app/api/auth/forgot-password/route.ts` | Pre-session |
| `app/api/auth/register-request/route.ts` | Pre-session |
| `app/api/auth/line-login/route.ts` | OAuth callback · no session |
| `app/api/cron/*` (6 routes) | Cron jobs · no user session |
| `app/api/telegram/webhook/route.ts` | Webhook · no session |
| `app/api/dev/*` (2 routes) | Dev tools · gated by env |
| `app/api/setup-wizard/route.ts` | First-time onboarding · creates org |
| `app/api/health/route.ts` | Public health check |
| `app/api/profile/password/route.ts` | Uses `auth.admin.updateUserById` (service_role required) |
| Audit log writes inside `lib/audit/log.ts` | Intentional — must succeed even if RLS would block |

## Categorization (62 routes total)

| Category | Count | Convert? | Priority |
|---|---|---|---|
| `admin/*` | 26 | YES | 🔴 P1 — user/branch/settings CRUD = highest leak risk |
| `cashhub/*` | 12 | YES | 🔴 P1 — financial data |
| `profile/*` | 2 | YES | 🟡 P2 — user-scoped |
| `notifications/*` | 2 | YES | 🟡 P2 |
| `docuflow/*` | 2 | YES | 🟡 P2 |
| `auth/*` | 7 | 6 keep, 1 convert | ✅ Whitelist |
| `cron/*` | 6 | KEEP | ✅ Whitelist |
| `telegram/*` | 1 | KEEP | ✅ Whitelist |
| `dev/*` | 2 | KEEP | ✅ Whitelist |
| `setup-wizard/*` | 1 | KEEP | ✅ Whitelist |
| `health/*` | 1 | KEEP | ✅ Whitelist |
| **Convert total** | **44** | | |
| **Keep total** | **18** | | |

## Conversion recipe

For each route to convert (in order: P1 admin/* → P1 cashhub/* → P2 ...):

```typescript
// BEFORE
import { adminClient } from "@/lib/db/server";
// ...
const admin = adminClient();
const { data } = await admin.from("users").select("*").eq("org_id", session.user.org_id);

// AFTER
import { serverClient } from "@/lib/db/server";
// ...
const supabase = await serverClient();  // ← async!
const { data } = await supabase.from("users").select("*");  // RLS auto-applies org_id
```

**Steps per route:**

1. Replace import `adminClient` → `serverClient`
2. Replace `adminClient()` → `await serverClient()` (note: now async)
3. Remove redundant `.eq("org_id", ...)` (RLS handles it)
4. Test the route manually:
   - As user with same org → should work
   - As user with different org → should get empty / 403
5. Run `npm run build` → must pass
6. Commit with message `refactor(route-name): adminClient → serverClient (RLS enforce)`

## Pitfalls to watch

- **Service role queries that intentionally cross orgs** (e.g., super_admin viewing other orgs' data) → these need to stay on adminClient + explicit permission check
- **Insert into tables where session.user might not exist yet** (e.g., creating user during invite accept) → keep adminClient
- **Cross-resource writes inside one transaction** where RLS would block one but not others → check carefully · may need adminClient with manual org check
- **Service role bypasses both SELECT and INSERT RLS** → after conversion, INSERTs need WITH CHECK passing too

## Progress tracker

When you convert a route, add a check next to it here:

### admin/* (26 to convert)
- [ ] `app/api/admin/users/route.ts`
- [ ] `app/api/admin/users/[id]/route.ts`
- [ ] `app/api/admin/users/[id]/branches/route.ts`
- [ ] `app/api/admin/users/[id]/modules/route.ts`
- [ ] `app/api/admin/users/bulk/route.ts`
- [ ] `app/api/admin/users/import/route.ts`
- [ ] `app/api/admin/branches/route.ts`
- [ ] `app/api/admin/branches/[id]/route.ts`
- [ ] `app/api/admin/branches/[id]/rentals/route.ts`
- [ ] `app/api/admin/branch-groups/route.ts`
- [ ] `app/api/admin/branch-groups/[id]/route.ts`
- [ ] `app/api/admin/branch-groups/[id]/members/route.ts`
- [ ] `app/api/admin/companies/route.ts`
- [ ] `app/api/admin/companies/[id]/route.ts`
- [ ] `app/api/admin/holidays/route.ts`
- [ ] `app/api/admin/holidays/[id]/route.ts`
- [ ] `app/api/admin/register-requests/route.ts`
- [ ] `app/api/admin/register-requests/[id]/route.ts`
- [ ] `app/api/admin/permission-templates/route.ts`
- [ ] `app/api/admin/settings/org/route.ts`
- [ ] `app/api/admin/settings/security/route.ts`
- [ ] `app/api/admin/settings/backup/route.ts`
- [ ] `app/api/admin/settings/notifications/route.ts`
- [ ] `app/api/admin/access-review/route.ts`
- [ ] `app/api/admin/access-review/[id]/route.ts`
- [ ] `app/api/admin/access-review/all/route.ts`

### cashhub/* (12 to convert)
- [ ] `app/api/cashhub/approve/route.ts` (already has explicit org check + audit · low risk to convert)
- [ ] `app/api/cashhub/approve-bulk/route.ts`
- [ ] `app/api/cashhub/unlock/route.ts`
- [ ] `app/api/cashhub/reports/route.ts`
- [ ] `app/api/cashhub/reports/[id]/route.ts`
- [ ] `app/api/cashhub/reports/[id]/edit/route.ts`
- [ ] `app/api/cashhub/export/route.ts`
- [ ] `app/api/cashhub/missing/route.ts`
- [ ] `app/api/cashhub/notes/route.ts`
- [ ] `app/api/cashhub/quick-fill/route.ts`
- [ ] `app/api/cashhub/templates/route.ts`
- [x] `app/api/cashhub/drafts/route.ts` ← converted 2026-05-20 (first working example)

### profile/* notifications/* docuflow/* (6 to convert)
- WHITELIST `app/api/profile/password/route.ts` (uses auth.admin.updateUserById)
- [ ] `app/api/profile/sessions/route.ts`
- [x] `app/api/notifications/route.ts` ← converted 2026-05-20
- [x] `app/api/notifications/[id]/route.ts` ← converted 2026-05-20
- [ ] `app/api/docuflow/...` (2 routes)

## Future: ESLint guard

Once whitelist stabilizes, add ESLint rule:

```js
// .eslintrc.js
{
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{
        name: "@/lib/db/server",
        importNames: ["adminClient"],
        message: "adminClient bypasses RLS. Use serverClient() unless this route is in the whitelist. See lib/db/RLS_REFACTOR.md",
      }],
    }],
  },
  overrides: [
    // Whitelist paths can re-import adminClient
    {
      files: [
        "app/api/auth/login/**",
        "app/api/auth/signup/**",
        "app/api/auth/invite/accept/**",
        "app/api/auth/forgot-password/**",
        "app/api/auth/register-request/**",
        "app/api/auth/line-login/**",
        "app/api/cron/**",
        "app/api/telegram/**",
        "app/api/dev/**",
        "app/api/setup-wizard/**",
        "app/api/health/**",
        "lib/audit/log.ts",
      ],
      rules: { "no-restricted-imports": "off" },
    },
  ],
}
```

(Add when conversion is ~70% done · จะได้ไม่ break PRs ที่อยู่ในระหว่างทำ)
