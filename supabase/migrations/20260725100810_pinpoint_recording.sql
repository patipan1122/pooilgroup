-- Pinpoint — per-session screen recording (โหมดติชม: อัดวิดีโอหน้าจอ)
--
-- A recording is captured once for the whole walk-through (getDisplayMedia +
-- MediaRecorder), uploaded to R2, and its key stored here. Per-SESSION (not
-- per-pin) because one video covers navigating across many menus/pages.
-- Nullable + best-effort: a session without a recording is perfectly valid,
-- exactly like screenshots. Served via the public R2 URL (same as screenshots),
-- so no schema for signing is needed.
--
-- Column-add only — inherits the table's existing RLS. Idempotent.

ALTER TABLE public.pinpoint_sessions
  ADD COLUMN IF NOT EXISTS recording_key text;
