-- CEO 2026-06-29/30 · maid LINE group chats into the unified Inbox.
-- ADDITIVE + idempotent. 1:1 chats (external_user_id non-null) are untouched:
-- the existing unique index inbox_conversations_channel_user_uniq keeps
-- dedupping them (Postgres treats NULLs as distinct, so group rows with a NULL
-- external_user_id never collide there). Groups dedup via a NEW partial unique
-- index on (channel_id, line_group_id).

ALTER TABLE "public"."inbox_conversations"
  ALTER COLUMN "external_user_id" DROP NOT NULL;

ALTER TABLE "public"."inbox_conversations"
  ADD COLUMN IF NOT EXISTS "line_group_id" TEXT,
  ADD COLUMN IF NOT EXISTS "group_name" TEXT,
  ADD COLUMN IF NOT EXISTS "branch_ref_id" TEXT,
  ADD COLUMN IF NOT EXISTS "branch_label" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_conversations_channel_group_uniq"
  ON "public"."inbox_conversations" ("channel_id", "line_group_id")
  WHERE "line_group_id" IS NOT NULL;

ALTER TABLE "public"."inbox_messages"
  ADD COLUMN IF NOT EXISTS "sender_line_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "sender_display_name" TEXT,
  ADD COLUMN IF NOT EXISTS "via_push" BOOLEAN;
