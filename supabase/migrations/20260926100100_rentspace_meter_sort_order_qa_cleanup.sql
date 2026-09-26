-- Pooilgroup ERP — One-off data cleanup (not a schema change)
-- Date: 2026-09-26
--
-- While QA-testing the new meter-reading room-reorder feature (see
-- 20260926100000_rentspace_meter_sort_order.sql) against real production
-- data through the actual admin UI, the test run itself wrote real
-- meter_sort_order values to all 41 rooms of the one live project (a
-- reorder save always writes the full room list, not just the moved
-- rows). That test order was never a real request from the CEO — just a
-- mechanism check — so this resets it back to the pre-test state (all
-- NULL / not yet custom-ordered), matching what every room had before
-- this feature existed.
--
-- Safe to re-run — a no-op once every row is already NULL.

UPDATE "rental_unit"
  SET "meter_sort_order" = NULL
  WHERE "meter_sort_order" IS NOT NULL;
