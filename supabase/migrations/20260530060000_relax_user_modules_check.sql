-- 2026-05-30 — Relax user_modules.module_name CHECK constraint
--
-- The original constraint only allowed cashhub | fuelos | docuflow (created
-- when those were the only Pool modules). Self-registered ChairOps maids
-- need a row with module_name='chairops', and Recruit / Repairs / ClawFleet /
-- Playland / Inbox each got modules added without ever updating this check.
-- ensurePoolMembership in /api/auth/line-login was hitting "violates check
-- constraint user_modules_module_name_check" and returning 502.
--
-- Drop the old constraint and recreate it with the full current module list.
-- Source of truth for module slugs: lib/modules.ts MODULES + ModuleSlug type.

ALTER TABLE user_modules DROP CONSTRAINT IF EXISTS user_modules_module_name_check;

ALTER TABLE user_modules ADD CONSTRAINT user_modules_module_name_check
  CHECK (module_name IN (
    'cashhub',
    'fuelos',
    'docuflow',
    'recruit',
    'repairs',
    'clawfleet',
    'chairops',
    'playland',
    'inbox'
  ));
