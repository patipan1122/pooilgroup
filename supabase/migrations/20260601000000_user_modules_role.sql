-- 2026-06-01 — Per-program admin: add `role` to user_modules + expand module CHECK
--
-- Why:
--   CEO wants to invite people scoped to a SPECIFIC program (e.g. "admin of
--   ChairOps only"). Today user_modules only says WHICH modules a user can
--   reach (binary). There is no notion of "admin OF this module" — global
--   org_admin/admin sees everything, and everyone else is just a member.
--
--   This adds a per-row `role` so a user can be the ADMIN of one program
--   (manage its sub-members from inside the module) without being a global
--   admin who sees every program.
--
-- Also: the module_name CHECK was last updated 2026-05-30 and is missing the
--   newer slugs `costctrl` + `hotelbook`. Bring it to the full current list so
--   those programs can be granted too. Source of truth: lib/modules.ts MODULES.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. role column — 'admin' (program admin) | 'member' (plain access)
--    Existing rows default to 'member' (preserves current behaviour).
-- ============================================================
ALTER TABLE "user_modules"
  ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'member';

ALTER TABLE "user_modules" DROP CONSTRAINT IF EXISTS "user_modules_role_check";
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_role_check"
  CHECK ("role" IN ('admin', 'member'));

-- ============================================================
-- 2. Expand module_name CHECK to the full current module list
-- ============================================================
ALTER TABLE "user_modules" DROP CONSTRAINT IF EXISTS "user_modules_module_name_check";
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_module_name_check"
  CHECK ("module_name" IN (
    'cashhub',
    'fuelos',
    'docuflow',
    'recruit',
    'repairs',
    'clawfleet',
    'chairops',
    'playland',
    'inbox',
    'costctrl',
    'hotelbook'
  ));

-- ============================================================
-- 3. Index to find a program's admins fast (in-module member mgmt)
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_user_modules_module_role"
  ON "user_modules"("org_id", "module_name", "role", "is_active");
