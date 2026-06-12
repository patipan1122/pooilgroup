-- 2026-06-12 — Sync user_modules.module_name CHECK with lib/modules.ts (add `ledger`)
--
-- Bug (live on prod): editing a user's program access and ticking "ระบบบัญชี"
-- (ledger) → "บันทึกการแก้ไข" failed with:
--   new row for relation "user_modules" violates check constraint
--   "user_modules_module_name_check"
--
-- Root cause: the app endpoint /api/admin/users/[id]/modules validates the
-- requested modules against z.enum(Object.keys(MODULES)) — the FULL 12-slug
-- ModuleSlug list — but the DB CHECK was last expanded 2026-06-01 to only 11
-- slugs and never got `ledger`. App allowed it, DB rejected it.
--
-- This is the 3rd time this constraint has drifted (2026-05-30 missed
-- chairops/recruit/etc · 2026-06-01 missed costctrl/hotelbook · now `ledger`).
-- Bring it to the COMPLETE current list. Source of truth: lib/modules.ts
-- ModuleSlug. Purely additive (widens the allow-list) — cannot break existing
-- rows. Idempotent — safe to re-run.

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
    'hotelbook',
    'ledger'
  ));
