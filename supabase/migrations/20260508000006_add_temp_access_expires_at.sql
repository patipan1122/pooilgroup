-- Add temp_access_expires_at column to users (CORE_SYSTEM §2.6 Temporary Access).
-- Replaces the proxy use of `invite_expires_at` in the access-review cron.
-- NULL = permanent account; set value = auto-deactivate after that timestamp.
--
-- Idempotent: skips if column already exists.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS temp_access_expires_at TIMESTAMPTZ;

-- Helps the cron query "users whose temp access expires in the next 7 days"
-- without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_users_temp_access_expires_at
  ON public.users (temp_access_expires_at)
  WHERE temp_access_expires_at IS NOT NULL;

COMMENT ON COLUMN public.users.temp_access_expires_at IS
  'Optional auto-expiry. When NOT NULL and now() > this timestamp, the access-review cron deactivates the user. Use for auditors/contractors/temp staff per CORE_SYSTEM §2.6.';
