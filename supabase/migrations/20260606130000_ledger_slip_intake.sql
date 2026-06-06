-- LedgerLine PR4 (D4) — designate a LINE group as the dedicated "ส่งสลิป" intake group.
--
-- Additive + safe: a new boolean column on ledger_line_group, default false, so
-- every existing group keeps its current behaviour (receipt capture). When an
-- admin flips this on for a group, every image in THAT group is treated as a
-- payment slip (QR-dedup → AI-OCR amount → auto-match to an unpaid bill →
-- floating slip if ambiguous) instead of a receipt to capture.
--
-- ledger_line_group already has RLS (org-scoped); a new column inherits it.

ALTER TABLE public.ledger_line_group
  ADD COLUMN IF NOT EXISTS is_slip_intake boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ledger_line_group.is_slip_intake IS
  'true = this LINE group is the slip-intake group (images = payment slips, not receipts). LedgerLine PR4/D4.';
