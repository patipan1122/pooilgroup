# BugSolve · core-perms (per-program-admin) · 2026-06-01

## §summary (Thai)
- Status: ✅ 4 bugs fixed + pushed (P0-3, P1-1, P1-2, P1-3) · 🔴 3 need CEO design decision (P0-1 CRITICAL leak, P0-2 half-feature, P0-4 chairops bootstrap)
- ทำงานต่อจาก `/auditbigteam` (audit doc `docs/AUDIT_coreperms_2026-06-01.md`) — ใช้ findings เป็น triage แทนการ re-crawl 25 sims (ประหยัด token)
- แก้ที่แก้ได้เชิงกลไกแล้ว commit `caf3f35` → setup (prod) · build เขียว · ตัวที่เหลือพึ่ง "เลือก role-model" ซึ่งต้องให้ CEO ตัดสิน

## §bugs-fixed (commit caf3f35)
| # | file | fix |
|---|---|---|
| P0-3 | prisma/schema.prisma | add `role` + index to UserModule (sync model to DB · drift fix) |
| P1-1 | api/admin/users/route.ts | grantAdminModules returns error → `moduleGrantWarning` (no silent half-success) |
| P1-2 | api/admin/users/route.ts + [id]/modules | reject costctrl grant unless super_admin (server-side) |
| P1-3 | api/admin/users/[id]/modules/route.ts | write `role` explicitly per module (adminModules subset) — no silent demote |

## §bugs-deferred — CEO design decision (🔴 high stakes)
| # | sev | issue | why deferred |
|---|---|---|---|
| P0-1 | 🔴 CRIT | cross-program leak: `viewer` reaches non-granted modules by URL (8/10 layouts ungated + clawfleet/cashhub treat viewer as org-wide) | fix = dedicated `program_admin` role OR gate-all-layouts; both have blast radius — needs CEO choice (see §next) |
| P0-2 | 🔴 | `userIsModuleAdmin` 0 callers — program-admin can't invite own team | needs in-program member UI per module (start chairops) |
| P0-4 | 🟡→🔴 | granted chairops program-admin hits /403 (needs ChairopsUser row) | tied to P0-1/P0-2 role-model |

## §next-actions (CEO must decide)
1. **Role model for P0-1** (the critical one):
   - (A) dedicated `program_admin` org-role — clean, no module guard treats it broadly, access purely via user_modules. 1 migration + enum/guard edits. **RECOMMENDED.**
   - (B) keep `viewer` + add `assertModuleEnabled` to all 8 ungated layouts — risks locking out existing staff lacking user_modules rows.
2. Until P0-1 fixed: **do NOT invite real outsider program-admins** (latent leak). Internal trusted users only.
3. P0-2/P0-4: build in-program member management (pilot chairops) so program-admins can actually run their program.

## §regression-pass
build + tsc clean post-fix. No automated persona re-walk (used audit findings as source).
