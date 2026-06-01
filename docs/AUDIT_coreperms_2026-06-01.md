# AUDIT — Core Permissions / Per-Program-Admin (2026-06-01)

> /auditbigteam · 7-persona security/correctness audit (SEC·SA·BE·BA·QA·DEVIL·OWN)
> Target: per-program-admin entitlement feature shipped commit `3f095b7` (setup/prod)
> Mode: no-question batch (CEO pre-authorized via /goal). No feature code written here.

## §1 Executive summary

The feature ships the **"see only my programs"** half correctly (hub filters by `loadUserModules`, sidebar admin-zones hidden, granted-module access works) — but has a **CRITICAL isolation hole** and is a **half-feature**:

1. 🔴 **CRITICAL — cross-program data leak via `viewer` overload.** A program-admin is modeled as org-role `viewer` + `user_modules.role='admin'`. But **8/10 module layouts do NOT call `assertModuleEnabled`** (only hotelbook does), and several modules treat `viewer` as broad org-wide read (ClawFleet `role-guard.ts:51` → viewer = ALL branches; `viewer ∈ EXECUTIVE_ROLES` → CashHub exec P&L). A program-admin scoped to *chairops only* can type `/clawfleet` or `/cashhub/dashboard` and see another business's data. The hub `canSee()` only HIDES cards; it does not block routes. **This defeats the entire point (business isolation).**
2. 🔴 **HALF-FEATURE — "program-admin invites their own team" does not exist.** `userIsModuleAdmin()` has **0 callers** in the repo. The invite form's label promises it. Worse, a fresh program-admin granted `chairops` gets `/403?reason=chairops_access_pending` on click (ChairOps needs a separate `ChairopsUser` row, no auto-bootstrap). So they often can't even *enter* their program.
3. 🔴 **Prisma schema drift (P0).** `role` column added via raw SQL but missing from `prisma/schema.prisma` `UserModule` model → next `prisma db push` may drop it (known risk `[[pool-schema-drift-2026-05-21]]`).
4. 🟡 **Silent half-success.** `grantAdminModules` swallows the upsert error → API returns `success` even if program access wasn't granted.
5. 🟡 **No edit-after-invite UI** + **costctrl grantable via API** (UI-only hidden) + **PUT /modules silently drops `role`**.

**Verdict: the feature is NOT safe to use for real outsider program-admins until finding #1 is fixed.** Internal trusted users are lower risk but still over-exposed.

## §2 Sign-off table

| Persona | Status | Blocker / condition |
|---|---|---|
| SEC | 🔴 BLOCKED | cross-program leak (SEC-03), costctrl API grant (SEC-04), PUT drops role (SEC-02) |
| SA | 🔴 BLOCKED | Prisma drift (SA-1), `userIsModuleAdmin` dead reader (SA-2) |
| BE | 🟡 CONDITIONAL | silent half-success (BE-1), no txn (BE-3). *(BE-2 migration-apply now RESOLVED — CEO applied it.)* |
| BA | 🟡 CONDITIONAL | no edit-after-invite UI (BA-01), half-feature label (BA-03), no empty-state (BA-05) |
| QA | 🔴 BLOCKED | chairops 403 on entry (C1), no write/admin inside modules (C2), API allows empty adminModules (C3) |
| DEVIL | 🔴 BLOCKED | viewer-overload leak (DEVIL-01), half-feature dead-end (DEVIL-02) |
| OWN | 🟡 PARTIAL | meets "see only my programs"; misses "invite own team"; isolation "hides not locks" |

## §3 Findings ledger (severity-ordered)

| ID | Sev | Title | Where | Fix direction |
|---|---|---|---|---|
| P0-1 | 🔴 CRIT | Cross-program leak: viewer reaches non-granted modules by URL | 8 module layouts lack `assertModuleEnabled`; `clawfleet/role-guard.ts:51`; `viewer ∈ EXECUTIVE_ROLES` | Introduce dedicated `program_admin` org-role NOT treated as broad-read by any module guard; OR add `assertModuleEnabled` to every module layout (regression risk: existing staff lack user_modules rows) |
| P0-2 | 🔴 CRIT | `userIsModuleAdmin` 0 callers — "invite own team" not built | `module-access.ts` helper unused | Build in-program member UI (start chairops) OR remove the promise from invite copy until shipped |
| P0-3 | 🔴 | Prisma drift: `role` not in schema.prisma | `prisma/schema.prisma` UserModule | Add `role String @default("member")` + index to model |
| P0-4 | 🟡→🔴 | ChairOps blocks granted program-admin (`chairops_access_pending`) | chairops access guard needs ChairopsUser row | Auto-create ChairopsUser (admin) when user_modules chairops role=admin granted |
| P1-1 | 🟡 | grantAdminModules swallows upsert error → silent half-success | `api/admin/users/route.ts` grantAdminModules | check error, fail or report |
| P1-2 | 🟡 | costctrl grantable via API despite UI hiding | `api/admin/users/route.ts` enum + `[id]/modules` | reject costctrl unless super_admin at API layer |
| P1-3 | 🟡 | PUT /modules drops `role` (demotes admin→member silently) | `api/admin/users/[id]/modules/route.ts` | accept+preserve role per module |
| P1-4 | 🟡 | No UI to edit a user's programs after invite | edit-form/PATCH | add program picker to edit-form |
| P1-5 | 🟡 | No empty-state on hub for 0-program viewer (+ existing-viewer regression) | `home/page.tsx` | empty-state card; backfill/verify existing viewers |
| P2-1 | ⚪ | SQL CHECK hardcodes 11 slugs (will reject module #12) | migration | drop CHECK, validate app-layer |
| P2-2 | ⚪ | user_branches insert in POST lacks org validation | `api/admin/users/route.ts` | reuse PATCH validation |

## §4 Key design decision for CEO (highest blast radius)

**The root cause of the CRITICAL leak is overloading org-role `viewer` for program-admins.** Two ways forward:

- **(A) Dedicated `program_admin` org-role** (SA + DEVIL recommend) — clean, no module guard treats it as broad-read; access purely via `user_modules`. Cost: one migration + add role to enum/guards/session. Permanent fix.
- **(B) Keep `viewer`, add `assertModuleEnabled` to all 8 ungated layouts** — closes the leak but risks locking out existing staff who access modules without a user_modules row (they were never backfilled). Needs careful per-module backfill.

Recommendation: **(A)** — it's the durable fix and avoids the staff-lockout regression. /bigsolvebug will fix the mechanical P0/P1s; the role-model choice is yours.

## §5 Handoff
- Next: `/bigsolvebug` (running now per /goal) auto-fixes P0-3, P1-1, P1-2, P1-3, P0-4 + flags P0-1/P0-2 for CEO design decision.
- Persona detail files: `/tmp/audit_coreperms_phase1_{SEC,SA,BE,BA,QA,DEVIL,OWN}.md`
