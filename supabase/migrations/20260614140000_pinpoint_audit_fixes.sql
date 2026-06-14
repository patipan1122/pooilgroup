-- Pinpoint — /auditbigteam fixes (2026-06-14)
--
-- A1 (seq race): two concurrent/double-tap pins computed seq from a non-atomic
-- read of pin_count and could collide. Add UNIQUE(session_id, seq) so the loser's
-- INSERT fails with 23505 and the route retries with a fresh max(seq)+1.
-- Idempotent (guarded). The feature is fresh so no pre-existing duplicates exist.

DO $$ BEGIN
  ALTER TABLE public.pinpoint_pins
    ADD CONSTRAINT pinpoint_pins_session_seq_uniq UNIQUE (session_id, seq);
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint already added
  WHEN duplicate_table THEN NULL;
END $$;
