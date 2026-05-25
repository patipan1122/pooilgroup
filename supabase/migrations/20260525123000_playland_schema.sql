-- Playland module · 19 tables + 13 enums · applied 2026-05-25
CREATE SCHEMA IF NOT EXISTS playland;
GRANT USAGE ON SCHEMA playland TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA playland TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA playland TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA playland GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA playland GRANT ALL ON SEQUENCES TO postgres, service_role;

-- CreateEnum
CREATE TYPE "playland"."PlaylandMemberType" AS ENUM ('KID', 'PARENT', 'STAFF', 'CLEANER', 'VIP', 'BABYSITTER', 'GUEST');

-- CreateEnum
CREATE TYPE "playland"."PlaylandPackageType" AS ENUM ('FIXED', 'PER_MINUTE', 'DAY_PASS');

-- CreateEnum
CREATE TYPE "playland"."PlaylandSessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'EXPIRED', 'FORFEITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "playland"."PlaylandBookingStatus" AS ENUM ('PENDING', 'PAID', 'CHECKED_IN', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "playland"."PlaylandFaceEventType" AS ENUM ('RECOGNIZED', 'UNRECOGNIZED', 'TAILGATE', 'STRANGER', 'DOOR_OPEN', 'DEVICE_HEARTBEAT', 'ERROR');

-- CreateEnum
CREATE TYPE "playland"."PlaylandFaceDirection" AS ENUM ('IN', 'OUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "playland"."PlaylandAlertType" AS ENUM ('TIME_WARNING', 'TIME_EXPIRED', 'STRANGER', 'TAILGATE', 'MISMATCH', 'REENTRY_EXPIRED', 'DEVICE_OFFLINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "playland"."PlaylandAlertSeverity" AS ENUM ('INFO', 'WARNING', 'DANGER');

-- CreateEnum
CREATE TYPE "playland"."PlaylandPaymentMethod" AS ENUM ('CASH', 'STRIPE', 'PROMPTPAY', 'KBANK', 'SCB', 'TRUEMONEY', 'LINEPAY', 'CHARGE_TO_MEMBER', 'COMPLIMENTARY');

-- CreateEnum
CREATE TYPE "playland"."PlaylandPromoType" AS ENUM ('COUPON', 'LOYALTY_POINTS', 'BIRTHDAY', 'WEEKDAY', 'HAPPY_HOUR', 'PACKAGE_DISCOUNT');

-- CreateEnum
CREATE TYPE "playland"."PlaylandShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "playland"."PlaylandDeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ERROR', 'PAIRING', 'DISABLED');

-- CreateEnum
CREATE TYPE "playland"."PlaylandFaceSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'DELETE_PENDING', 'DELETED');

-- CreateTable
CREATE TABLE "playland"."branches" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "opening_hours" JSONB,
    "settings" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."devices" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'acs-auto',
    "model" TEXT NOT NULL DEFAULT 'ACS-F606',
    "device_id" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "base_url" TEXT,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "modelVersion" TEXT NOT NULL DEFAULT 'C',
    "secret_encrypted" TEXT,
    "webhook_secret" TEXT,
    "status" "playland"."PlaylandDeviceStatus" NOT NULL DEFAULT 'PAIRING',
    "last_seen_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),
    "firmware_version" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."family_groups" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "family_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."family_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "family_group_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'relative',
    "can_pick_up" BOOLEAN NOT NULL DEFAULT true,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "member_code" TEXT,
    "type" "playland"."PlaylandMemberType" NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "date_of_birth" DATE,
    "gender" TEXT,
    "photo_r2_path" TEXT,
    "photo_url" TEXT,
    "face_id" TEXT,
    "external_line_id" TEXT,
    "registered_by_id" UUID,
    "consent_at" TIMESTAMPTZ(6),
    "consent_revoked_at" TIMESTAMPTZ(6),
    "retention_until" TIMESTAMPTZ(6),
    "last_visit_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "metadata" JSONB,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."packages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "playland"."PlaylandPackageType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minutes" INTEGER,
    "price" INTEGER NOT NULL,
    "per_minute_rate" INTEGER,
    "member_types_allowed" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."sessions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "package_id" UUID,
    "booking_id" UUID,
    "package_minutes" INTEGER NOT NULL,
    "package_price_cents" INTEGER NOT NULL,
    "minutes_used" INTEGER NOT NULL DEFAULT 0,
    "total_paused_seconds" INTEGER NOT NULL DEFAULT 0,
    "status" "playland"."PlaylandSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "check_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_at" TIMESTAMPTZ(6),
    "resumed_at" TIMESTAMPTZ(6),
    "check_out_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "reentry_deadline_at" TIMESTAMPTZ(6),
    "extended_count" INTEGER NOT NULL DEFAULT 0,
    "cashier_user_id" UUID,
    "closed_by_user_id" UUID,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."face_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "session_id" UUID,
    "member_id" UUID,
    "face_id" TEXT,
    "type" "playland"."PlaylandFaceEventType" NOT NULL,
    "direction" "playland"."PlaylandFaceDirection" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" INTEGER,
    "snapshot_r2_path" TEXT,
    "raw_payload" JSONB,
    "webhook_id" TEXT NOT NULL,
    "event_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."bookings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "member_id" UUID,
    "package_id" UUID NOT NULL,
    "booking_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_email" TEXT,
    "party_size" INTEGER NOT NULL DEFAULT 1,
    "slot_start" TIMESTAMPTZ(6) NOT NULL,
    "slot_end" TIMESTAMPTZ(6) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payment_method" "playland"."PlaylandPaymentMethod",
    "payment_ref" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "qr_code_url" TEXT,
    "status" "playland"."PlaylandBookingStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6),
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."products" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "category" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "cost_cents" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "image_r2_path" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."sales" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "shift_id" UUID,
    "session_id" UUID,
    "sale_code" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "promo_id" UUID,
    "paymentMethod" "playland"."PlaylandPaymentMethod" NOT NULL,
    "payment_ref" TEXT,
    "cashier_user_id" UUID NOT NULL,
    "sold_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."sale_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cents" INTEGER NOT NULL,
    "line_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."promos" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "playland"."PlaylandPromoType" NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discount_percent" INTEGER,
    "discount_cents" INTEGER,
    "conditions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "uses_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."loyalty" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points" INTEGER NOT NULL DEFAULT 0,
    "last_earned_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "loyalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."loyalty_ledger" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "loyalty_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."waivers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature_r2_path" TEXT,
    "signature_type" TEXT NOT NULL DEFAULT 'tablet',
    "signed_by_name" TEXT NOT NULL,
    "signed_by_phone" TEXT,
    "scanned_r2_path" TEXT,
    "metadata" JSONB,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "waivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."alerts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID,
    "type" "playland"."PlaylandAlertType" NOT NULL,
    "severity" "playland"."PlaylandAlertSeverity" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."shifts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "shift_code" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "opening_cash_cents" INTEGER NOT NULL DEFAULT 0,
    "closing_cash_cents" INTEGER,
    "expected_cash_cents" INTEGER,
    "variance_cents" INTEGER,
    "total_sales_cents" INTEGER NOT NULL DEFAULT 0,
    "total_sessions_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "playland"."PlaylandShiftStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "closed_by_user_id" UUID,
    "is_day_close" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."daily_reports" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "entry_revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "product_revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "total_revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "sessions_completed" INTEGER NOT NULL DEFAULT 0,
    "sessions_expired" INTEGER NOT NULL DEFAULT 0,
    "sessions_forfeited" INTEGER NOT NULL DEFAULT 0,
    "products_sold" INTEGER NOT NULL DEFAULT 0,
    "alerts_count" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "cash_scanned_in" INTEGER NOT NULL DEFAULT 0,
    "cash_scanned_out" INTEGER NOT NULL DEFAULT 0,
    "fraud_variance" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by_user_id" UUID,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."face_sync" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "playland"."PlaylandFaceSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "face_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."audit_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "category" TEXT NOT NULL DEFAULT 'general',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_slug_key" ON "playland"."branches"("slug");

-- CreateIndex
CREATE INDEX "branches_org_id_idx" ON "playland"."branches"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_id_key" ON "playland"."devices"("device_id");

-- CreateIndex
CREATE INDEX "devices_org_id_branch_id_idx" ON "playland"."devices"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "family_groups_org_id_branch_id_idx" ON "playland"."family_groups"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "family_members_org_id_idx" ON "playland"."family_members"("org_id");

-- CreateIndex
CREATE INDEX "family_members_member_id_idx" ON "playland"."family_members"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_family_group_id_member_id_key" ON "playland"."family_members"("family_group_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_member_code_key" ON "playland"."members"("member_code");

-- CreateIndex
CREATE INDEX "members_org_id_branch_id_idx" ON "playland"."members"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "members_branch_id_type_idx" ON "playland"."members"("branch_id", "type");

-- CreateIndex
CREATE INDEX "members_face_id_idx" ON "playland"."members"("face_id");

-- CreateIndex
CREATE INDEX "members_phone_idx" ON "playland"."members"("phone");

-- CreateIndex
CREATE INDEX "packages_org_id_branch_id_idx" ON "playland"."packages"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "packages_branch_id_active_sort_order_idx" ON "playland"."packages"("branch_id", "active", "sort_order");

-- CreateIndex
CREATE INDEX "sessions_org_id_branch_id_idx" ON "playland"."sessions"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "sessions_branch_id_status_idx" ON "playland"."sessions"("branch_id", "status");

-- CreateIndex
CREATE INDEX "sessions_member_id_check_in_at_idx" ON "playland"."sessions"("member_id", "check_in_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "playland"."sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "face_events_webhook_id_key" ON "playland"."face_events"("webhook_id");

-- CreateIndex
CREATE INDEX "face_events_org_id_branch_id_idx" ON "playland"."face_events"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "face_events_branch_id_event_at_idx" ON "playland"."face_events"("branch_id", "event_at");

-- CreateIndex
CREATE INDEX "face_events_member_id_event_at_idx" ON "playland"."face_events"("member_id", "event_at");

-- CreateIndex
CREATE INDEX "face_events_type_event_at_idx" ON "playland"."face_events"("type", "event_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "playland"."bookings"("booking_code");

-- CreateIndex
CREATE INDEX "bookings_org_id_branch_id_idx" ON "playland"."bookings"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "bookings_branch_id_slot_start_idx" ON "playland"."bookings"("branch_id", "slot_start");

-- CreateIndex
CREATE INDEX "bookings_status_expires_at_idx" ON "playland"."bookings"("status", "expires_at");

-- CreateIndex
CREATE INDEX "bookings_customer_phone_idx" ON "playland"."bookings"("customer_phone");

-- CreateIndex
CREATE INDEX "products_org_id_branch_id_idx" ON "playland"."products"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "products_branch_id_active_sort_order_idx" ON "playland"."products"("branch_id", "active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "products_branch_id_barcode_key" ON "playland"."products"("branch_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "sales_sale_code_key" ON "playland"."sales"("sale_code");

-- CreateIndex
CREATE INDEX "sales_org_id_branch_id_idx" ON "playland"."sales"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "sales_branch_id_sold_at_idx" ON "playland"."sales"("branch_id", "sold_at");

-- CreateIndex
CREATE INDEX "sales_shift_id_idx" ON "playland"."sales"("shift_id");

-- CreateIndex
CREATE INDEX "sales_session_id_idx" ON "playland"."sales"("session_id");

-- CreateIndex
CREATE INDEX "sale_lines_sale_id_idx" ON "playland"."sale_lines"("sale_id");

-- CreateIndex
CREATE INDEX "sale_lines_product_id_idx" ON "playland"."sale_lines"("product_id");

-- CreateIndex
CREATE INDEX "promos_org_id_idx" ON "playland"."promos"("org_id");

-- CreateIndex
CREATE INDEX "promos_type_active_idx" ON "playland"."promos"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "promos_code_org_id_key" ON "playland"."promos"("code", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_member_id_key" ON "playland"."loyalty"("member_id");

-- CreateIndex
CREATE INDEX "loyalty_ledger_loyalty_id_created_at_idx" ON "playland"."loyalty_ledger"("loyalty_id", "created_at");

-- CreateIndex
CREATE INDEX "waivers_org_id_idx" ON "playland"."waivers"("org_id");

-- CreateIndex
CREATE INDEX "waivers_member_id_signed_at_idx" ON "playland"."waivers"("member_id", "signed_at");

-- CreateIndex
CREATE INDEX "alerts_org_id_branch_id_idx" ON "playland"."alerts"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "alerts_branch_id_resolved_at_idx" ON "playland"."alerts"("branch_id", "resolved_at");

-- CreateIndex
CREATE INDEX "alerts_type_created_at_idx" ON "playland"."alerts"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_shift_code_key" ON "playland"."shifts"("shift_code");

-- CreateIndex
CREATE INDEX "shifts_org_id_branch_id_idx" ON "playland"."shifts"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "shifts_branch_id_started_at_idx" ON "playland"."shifts"("branch_id", "started_at");

-- CreateIndex
CREATE INDEX "shifts_cashier_user_id_started_at_idx" ON "playland"."shifts"("cashier_user_id", "started_at");

-- CreateIndex
CREATE INDEX "daily_reports_org_id_report_date_idx" ON "playland"."daily_reports"("org_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_branch_id_report_date_key" ON "playland"."daily_reports"("branch_id", "report_date");

-- CreateIndex
CREATE INDEX "face_sync_org_id_idx" ON "playland"."face_sync"("org_id");

-- CreateIndex
CREATE INDEX "face_sync_status_last_attempt_at_idx" ON "playland"."face_sync"("status", "last_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "face_sync_device_id_member_id_key" ON "playland"."face_sync"("device_id", "member_id");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_branch_id_idx" ON "playland"."audit_logs"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "playland"."audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "playland"."audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_category_created_at_idx" ON "playland"."audit_logs"("category", "created_at");

-- AddForeignKey
ALTER TABLE "playland"."devices" ADD CONSTRAINT "devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."family_groups" ADD CONSTRAINT "family_groups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."family_members" ADD CONSTRAINT "family_members_family_group_id_fkey" FOREIGN KEY ("family_group_id") REFERENCES "playland"."family_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."family_members" ADD CONSTRAINT "family_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."members" ADD CONSTRAINT "members_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."packages" ADD CONSTRAINT "packages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sessions" ADD CONSTRAINT "sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sessions" ADD CONSTRAINT "sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sessions" ADD CONSTRAINT "sessions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "playland"."packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sessions" ADD CONSTRAINT "sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "playland"."bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."face_events" ADD CONSTRAINT "face_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."face_events" ADD CONSTRAINT "face_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "playland"."devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."face_events" ADD CONSTRAINT "face_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "playland"."sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."face_events" ADD CONSTRAINT "face_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."bookings" ADD CONSTRAINT "bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."bookings" ADD CONSTRAINT "bookings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "playland"."packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."products" ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sales" ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sales" ADD CONSTRAINT "sales_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "playland"."shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sales" ADD CONSTRAINT "sales_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "playland"."sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sales" ADD CONSTRAINT "sales_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "playland"."promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "playland"."sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."sale_lines" ADD CONSTRAINT "sale_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "playland"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."promos" ADD CONSTRAINT "promos_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."loyalty" ADD CONSTRAINT "loyalty_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_loyalty_id_fkey" FOREIGN KEY ("loyalty_id") REFERENCES "playland"."loyalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."waivers" ADD CONSTRAINT "waivers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."alerts" ADD CONSTRAINT "alerts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."alerts" ADD CONSTRAINT "alerts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "playland"."sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."daily_reports" ADD CONSTRAINT "daily_reports_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."face_sync" ADD CONSTRAINT "face_sync_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "playland"."devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."face_sync" ADD CONSTRAINT "face_sync_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
