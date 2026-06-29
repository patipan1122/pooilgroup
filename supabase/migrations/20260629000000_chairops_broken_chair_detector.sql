-- CEO 2026-06-29 · ChairOps "ตู้เสีย" — per-stream broken-device detection
-- (feature-workshop spec: docs/WORKSHOP_chairops-broken-chair-and-maid-inbox.md)
--
-- Additive only. Safe to run once in the Supabase SQL editor.
--   1) per-chair adjustable threshold (consecutive zero-days before a device is
--      flagged suspect-broken). Default 2; low-traffic chairs can be bumped.
--   2) new alert kind for "one payment device stopped while the chair is alive".

ALTER TABLE "chairops"."ChairopsChair"
  ADD COLUMN IF NOT EXISTS "suspectThresholdDays" INTEGER NOT NULL DEFAULT 2;

ALTER TYPE "chairops"."ChairopsAlertKind" ADD VALUE IF NOT EXISTS 'CHAIR_STREAM_DOWN';
