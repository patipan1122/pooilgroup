-- Pooilgroup ERP — Migration: RentSpace meter reading room order
-- Date: 2026-09-26
--
-- CEO feedback: on the meter-reading page (จดมิเตอร์), room order should
-- match the physical walking route staff actually take when reading meters,
-- which does not match the room code/matrix order. Wants a dedicated,
-- reorderable, org-wide-shared order for this page — separate from
-- rental_unit.sort_order (the default room order) and matrix_sort_order
-- (the CEO's own Excel-matrix layout), since these three are independent
-- concerns even though today's data may coincidentally match.
--
-- Additive, nullable — NULL = not yet custom-ordered, falls back to the
-- existing sort_order/code ordering (unchanged behavior for every room
-- until someone explicitly reorders on the meters page).
--
-- Idempotent — safe to re-run.

ALTER TABLE "rental_unit"
  ADD COLUMN IF NOT EXISTS "meter_sort_order" INTEGER;
