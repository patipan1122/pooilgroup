-- Pooilgroup ERP — ChairOps maid contract: selfie snapshot column
-- Date: 2026-09-23
--
-- CEO asked to embed the maid's selfie (already captured at onboarding, stored
-- on ChairopsUser.selfieImageUrl) into the signed contract's top-right corner.
-- Snapshotted at sign time onto ChairopsMaidContract, matching the existing
-- idCardImageUrl pattern (so a signed contract's photo can't drift if the
-- maid's profile selfie is ever re-captured later).
--
-- Additive only — one new nullable column, zero changes to existing rows.
-- Idempotent — safe to re-run.

ALTER TABLE chairops."ChairopsMaidContract" ADD COLUMN IF NOT EXISTS "selfieImageUrl" TEXT;
