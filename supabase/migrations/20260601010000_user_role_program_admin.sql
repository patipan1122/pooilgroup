-- 2026-06-01 — Add `program_admin` to the UserRole enum
--
-- Why: the per-program-admin feature originally modeled a program admin as
-- org-role `viewer` + user_modules.role='admin'. The /auditbigteam audit found
-- this overload causes a CRITICAL cross-program data leak — several module
-- guards treat `viewer` as org-wide read (ClawFleet userBranchIds → "ALL",
-- viewer ∈ EXECUTIVE_ROLES → CashHub exec P&L). A dedicated role that NO module
-- guard treats as broad-read closes the leak (CEO chose this over gate-all-layouts).
--
-- A `program_admin` lands on /home, sees ONLY granted programs (loadUserModules),
-- is NOT admin-tier, NOT executive. Access is purely via user_modules rows.
--
-- ADD VALUE IF NOT EXISTS is idempotent (PG 12+). Cannot be used in the same
-- transaction it's added — fine, this migration only adds it.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'program_admin';
