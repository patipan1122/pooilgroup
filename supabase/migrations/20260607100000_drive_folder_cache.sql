-- Drive folder ID cache — prevents duplicate folder creation from concurrent uploads.
-- Key: (org_id, parent_id, name) → folder_id (Google Drive folder ID).
-- parent_id is the Drive folder ID of the parent (or "root" for the root-level folder).
-- The UNIQUE constraint is the distributed lock: only one row per (org, parent, name)
-- regardless of how many concurrent serverless invocations race to create it.

CREATE TABLE IF NOT EXISTS public.drive_folder_cache (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text        NOT NULL,
  parent_id   text        NOT NULL,   -- Drive folder ID of parent, or literal "root"
  name        text        NOT NULL,   -- folder name (as stored in Drive)
  folder_id   text        NOT NULL,   -- Drive folder ID of this folder
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, parent_id, name)
);

-- Index for the lookup pattern: WHERE org_id = ? AND parent_id = ? AND name = ?
CREATE INDEX IF NOT EXISTS drive_folder_cache_lookup
  ON public.drive_folder_cache (org_id, parent_id, name);

-- RLS: server-side only (prisma uses service role) — enable but allow service role through
ALTER TABLE public.drive_folder_cache ENABLE ROW LEVEL SECURITY;
