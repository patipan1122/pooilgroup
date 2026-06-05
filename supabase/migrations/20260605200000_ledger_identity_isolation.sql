-- LedgerLine — identity isolation + dual-id resolve (audit 2026-06-05).
--
-- Root cause fixed here: a LINE Login/LIFF channel and the Messaging OA under
-- DIFFERENT providers issue the SAME human TWO different userIds. The bot gate
-- matches the Messaging-API userId (users.line_user_id); the LIFF/line-login
-- matches the Login-channel id_token `sub`. Storing only one id meant the owner
-- worked in the bot but was blocked in the LIFF ("บัญชียังไม่เปิดใช้งานสำหรับคุณ").
--
-- 1) users.line_login_sub — the Login/LIFF identity, distinct from line_user_id.
--    line-login resolves a ledger login by EITHER id, so both channels map to the
--    same Pool user. Unique (a Login sub belongs to one Pool user).
-- 2) ledger_line_invite.target_pool_user_id + kind — top-down: an admin (or the
--    owner self-claim) pre-binds an invite to a Pool user; accepting binds that
--    user's line_login_sub + (kind='admin_claim') grants ledger admin. No more
--    "type in group → web → claim" dance, and no guessing someone else's LINE id.
-- Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS line_login_sub text;

-- Partial unique: many users have NULL; only non-null login subs must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS users_line_login_sub_key
  ON public.users (line_login_sub)
  WHERE line_login_sub IS NOT NULL;

ALTER TABLE public.ledger_line_invite
  ADD COLUMN IF NOT EXISTS target_pool_user_id uuid;

ALTER TABLE public.ledger_line_invite
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'member';

COMMENT ON COLUMN public.users.line_login_sub IS
  'LINE Login/LIFF channel id_token sub (distinct from line_user_id = Messaging-API userId). Lets bot + LIFF resolve the same Pool user across different LINE providers.';
COMMENT ON COLUMN public.ledger_line_invite.target_pool_user_id IS
  'Top-down bind: accepting this invite sets users.line_login_sub for THIS Pool user (+ ledger admin when kind=admin_claim).';
