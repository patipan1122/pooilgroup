-- 2026-06-28 — Stop user_modules.module_name CHECK from drifting behind the app
--
-- Bug (live on prod · 4th recurrence): assigning a program admin on a NEWER
-- module (rentspace / clawhub / dc) failed with:
--   new row for relation "user_modules" violates check constraint
--   "user_modules_module_name_check"
--
-- Root cause: the CHECK enumerated a FIXED list of module slugs that had to be
-- hand-edited every time a module shipped. It drifted 4 times (2026-05-30,
-- 2026-06-01, 2026-06-12, now) — each drift = a prod outage the moment someone
-- tried to grant access/admin on the new module. The DB list trailed
-- lib/modules.ts (currently 15 slugs); the DB only knew 12.
--
-- Fix (permanent · kills the bug class): the app already validates module_name
-- against z.enum(Object.keys(MODULES)) in /api/admin/users/[id]/modules BEFORE
-- inserting, and user_modules is only ever written by trusted server routes.
-- The enumerating CHECK was redundant defense whose ONLY real-world effect was
-- recurring outages. Replace it with a loose sanity guard (non-empty) so adding
-- a module never again requires a DB migration. lib/modules.ts stays the single
-- source of truth for which slugs are valid.
--
-- Purely loosening — every existing row already satisfies non-empty, so this
-- cannot break existing data. Idempotent — safe to re-run.

ALTER TABLE "user_modules" DROP CONSTRAINT IF EXISTS "user_modules_module_name_check";
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_module_name_check"
  CHECK ("module_name" IS NOT NULL AND length(trim("module_name")) > 0);
