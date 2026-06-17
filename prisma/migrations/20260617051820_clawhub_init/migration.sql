-- ClawHub (JOLLY PLAY) — initial schema (ADDITIVE ONLY).
-- 6 tables + 6 enums, all in the "public" schema. Touches NO existing object.
-- Idempotent: enums use duplicate_object guards; tables/indexes use IF NOT EXISTS.
-- The CEO applies this manually (e.g. `npx prisma db execute --file <this>`),
-- or it is picked up by `prisma migrate deploy`.

-- ===========================================================
-- Enums
-- ===========================================================
DO $$ BEGIN
  CREATE TYPE "public"."ClawhubPointKind" AS ENUM ('EARN_REFUND', 'REDEEM', 'EXPIRE', 'ADJUST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ClawhubRefundStatus" AS ENUM ('AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ClawhubRedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ClawhubConvStatus" AS ENUM ('OPEN', 'SNOOZED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ClawhubMsgDirection" AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ClawhubMsgKind" AS ENUM ('TEXT', 'IMAGE', 'STICKER', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===========================================================
-- CH.1 — clawhub_members
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "external_line_id" TEXT NOT NULL,
    "display_name" TEXT,
    "picture_url" TEXT,
    "phone" TEXT,
    "member_code" TEXT NOT NULL,
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "refund_count" INTEGER NOT NULL DEFAULT 0,
    "first_refund_at" TIMESTAMPTZ(6),
    "last_refund_at" TIMESTAMPTZ(6),
    "consent_at" TIMESTAMPTZ(6),
    "retention_until" TIMESTAMPTZ(6),
    "blocked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clawhub_members_pkey" PRIMARY KEY ("id")
);

-- ===========================================================
-- CH.2 — clawhub_point_entries
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_point_entries" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" "public"."ClawhubPointKind" NOT NULL,
    "remaining_points" INTEGER NOT NULL DEFAULT 0,
    "ref_type" TEXT,
    "ref_id" UUID,
    "note" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "expired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clawhub_point_entries_pkey" PRIMARY KEY ("id")
);

-- ===========================================================
-- CH.3 — clawhub_refund_requests
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_refund_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "machine_id" UUID,
    "machine_code" TEXT,
    "machine_qr_token" TEXT,
    "branch_id" UUID,
    "claimed_baht" INTEGER NOT NULL,
    "ai_read_baht" INTEGER,
    "ai_add_up" INTEGER,
    "ai_price" INTEGER,
    "ai_credit" INTEGER,
    "ai_raw_text" TEXT,
    "ai_confidence" DECIMAL(4,3),
    "screenshot_r2_key" TEXT NOT NULL,
    "screenshot_sha256" TEXT NOT NULL,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."ClawhubRefundStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "decision_reason" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clawhub_refund_requests_pkey" PRIMARY KEY ("id")
);

-- ===========================================================
-- CH.4 — clawhub_redemptions
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_redemptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "product_id" UUID,
    "product_sku" TEXT,
    "product_name" TEXT,
    "product_image_url" TEXT,
    "points_spent" INTEGER NOT NULL,
    "status" "public"."ClawhubRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "pickup_code" TEXT NOT NULL,
    "fulfilled_by_id" UUID,
    "fulfilled_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clawhub_redemptions_pkey" PRIMARY KEY ("id")
);

-- ===========================================================
-- CH.5 — clawhub_conversations
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_conversations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "member_id" UUID,
    "display_name" TEXT,
    "picture_url" TEXT,
    "last_message_text" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "bot_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."ClawhubConvStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clawhub_conversations_pkey" PRIMARY KEY ("id")
);

-- ===========================================================
-- CH.6 — clawhub_messages
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "external_id" TEXT,
    "direction" "public"."ClawhubMsgDirection" NOT NULL,
    "kind" "public"."ClawhubMsgKind" NOT NULL DEFAULT 'TEXT',
    "text" TEXT,
    "r2_key" TEXT,
    "by_bot" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clawhub_messages_pkey" PRIMARY KEY ("id")
);

-- ===========================================================
-- Indexes
-- ===========================================================
CREATE UNIQUE INDEX IF NOT EXISTS "clawhub_members_member_code_key" ON "public"."clawhub_members"("member_code");
CREATE INDEX IF NOT EXISTS "clawhub_members_org_id_idx" ON "public"."clawhub_members"("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "clawhub_members_org_id_external_line_id_key" ON "public"."clawhub_members"("org_id", "external_line_id");

CREATE INDEX IF NOT EXISTS "clawhub_point_entries_org_id_member_id_idx" ON "public"."clawhub_point_entries"("org_id", "member_id");
CREATE INDEX IF NOT EXISTS "clawhub_point_entries_expires_at_idx" ON "public"."clawhub_point_entries"("expires_at");

CREATE INDEX IF NOT EXISTS "clawhub_refund_requests_org_id_status_idx" ON "public"."clawhub_refund_requests"("org_id", "status");
CREATE INDEX IF NOT EXISTS "clawhub_refund_requests_org_id_created_at_idx" ON "public"."clawhub_refund_requests"("org_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "clawhub_refund_requests_member_id_screenshot_sha256_key" ON "public"."clawhub_refund_requests"("member_id", "screenshot_sha256");

CREATE INDEX IF NOT EXISTS "clawhub_redemptions_org_id_status_idx" ON "public"."clawhub_redemptions"("org_id", "status");

CREATE INDEX IF NOT EXISTS "clawhub_conversations_org_id_last_message_at_idx" ON "public"."clawhub_conversations"("org_id", "last_message_at");
CREATE UNIQUE INDEX IF NOT EXISTS "clawhub_conversations_org_id_line_user_id_key" ON "public"."clawhub_conversations"("org_id", "line_user_id");

CREATE INDEX IF NOT EXISTS "clawhub_messages_conversation_id_created_at_idx" ON "public"."clawhub_messages"("conversation_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "clawhub_messages_conversation_id_external_id_key" ON "public"."clawhub_messages"("conversation_id", "external_id");

-- ===========================================================
-- Foreign keys (ONLY among ClawHub tables — soft refs to org/machine/product
-- are intentionally NOT enforced, per the additive/soft-reference design).
-- Guarded so re-running does not error if the constraint already exists.
-- ===========================================================
DO $$ BEGIN
  ALTER TABLE "public"."clawhub_point_entries"
    ADD CONSTRAINT "clawhub_point_entries_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."clawhub_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."clawhub_refund_requests"
    ADD CONSTRAINT "clawhub_refund_requests_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."clawhub_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."clawhub_redemptions"
    ADD CONSTRAINT "clawhub_redemptions_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."clawhub_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."clawhub_messages"
    ADD CONSTRAINT "clawhub_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."clawhub_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===========================================================
-- CH.7 — clawhub_rewards (reward catalog) — ADDITIVE
-- + clawhub_redemptions.reward_id (soft ref to clawhub_rewards)
-- ===========================================================
CREATE TABLE IF NOT EXISTS "public"."clawhub_rewards" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "points_price" INTEGER NOT NULL,
    "stock" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clawhub_rewards_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clawhub_rewards_org_id_is_active_idx" ON "public"."clawhub_rewards"("org_id", "is_active");

ALTER TABLE "public"."clawhub_redemptions" ADD COLUMN IF NOT EXISTS "reward_id" UUID;
