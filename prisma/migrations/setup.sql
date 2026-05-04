-- ============================================================
-- Pool Group ERP — Combined Setup SQL
-- Paste this entire file into Supabase SQL Editor and run.
-- URL: https://supabase.com/dashboard/project/gockzhprlylabpurvhoz/sql/new
--
-- This creates: 8 tables + indexes + foreign keys + enums
--             + RLS policies + custom JWT claim hook
-- Idempotent where possible; safe to re-run.
-- ============================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'org_admin', 'branch_manager', 'staff', 'driver', 'viewer');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('fuel_station', 'lpg_station', 'bottling_plant', 'hotel', 'convenience_store', 'ev_station', 'cafe', 'transport', 'gas_fleet');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('morning', 'midday', 'evening', 'all');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "line_oa_id" TEXT,
    "telegram_chat_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL,
    "line_user_id" TEXT,
    "telegram_user_id" TEXT,
    "telegram_chat_id" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "invited_by" UUID,
    "invite_token" TEXT,
    "invite_expires_at" TIMESTAMPTZ(6),
    "invite_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_type" "BusinessType" NOT NULL,
    "province" TEXT,
    "region" TEXT,
    "address" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "manager_id" UUID,
    "phone" TEXT,
    "line_group_id" TEXT,
    "report_deadline" TEXT NOT NULL DEFAULT '21:00',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "business_type" "BusinessType" NOT NULL,
    "has_shifts" BOOLEAN NOT NULL DEFAULT false,
    "shifts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_reconcile" BOOLEAN NOT NULL DEFAULT true,
    "fields" JSONB NOT NULL,
    "reconcile_formula" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "shift" "Shift" NOT NULL DEFAULT 'all',
    "total_sales" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "qty1" DECIMAL(12,3),
    "qty1_unit" TEXT,
    "qty2" DECIMAL(12,3),
    "qty2_unit" TEXT,
    "cash" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transfer" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "card" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "shortage" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_spike" BOOLEAN NOT NULL DEFAULT false,
    "is_off_hours" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReportStatus" NOT NULL DEFAULT 'submitted',
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_reason" TEXT,
    "unlock_by_id" UUID,
    "unlock_reason" TEXT,
    "unlock_at" TIMESTAMPTZ(6),
    "telegram_message_id" TEXT,
    "telegram_chat_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_shortages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "person_id" UUID,
    "person_name" TEXT,
    "is_identified" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_shortages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "diff" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_line_user_id_key" ON "users"("line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_invite_token_key" ON "users"("invite_token");

-- CreateIndex
CREATE INDEX "users_org_id_is_active_idx" ON "users"("org_id", "is_active");

-- CreateIndex
CREATE INDEX "users_org_id_role_idx" ON "users"("org_id", "role");

-- CreateIndex
CREATE INDEX "users_line_user_id_idx" ON "users"("line_user_id");

-- CreateIndex
CREATE INDEX "branches_org_id_is_active_idx" ON "branches"("org_id", "is_active");

-- CreateIndex
CREATE INDEX "branches_org_id_business_type_idx" ON "branches"("org_id", "business_type");

-- CreateIndex
CREATE UNIQUE INDEX "branches_org_id_code_key" ON "branches"("org_id", "code");

-- CreateIndex
CREATE INDEX "user_branches_org_id_idx" ON "user_branches"("org_id");

-- CreateIndex
CREATE INDEX "user_branches_branch_id_is_active_idx" ON "user_branches"("branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_user_id_branch_id_key" ON "user_branches"("user_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_business_type_key" ON "report_templates"("business_type");

-- CreateIndex
CREATE INDEX "report_templates_org_id_idx" ON "report_templates"("org_id");

-- CreateIndex
CREATE INDEX "daily_reports_org_id_report_date_idx" ON "daily_reports"("org_id", "report_date");

-- CreateIndex
CREATE INDEX "daily_reports_org_id_status_idx" ON "daily_reports"("org_id", "status");

-- CreateIndex
CREATE INDEX "daily_reports_branch_id_report_date_idx" ON "daily_reports"("branch_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_branch_id_report_date_shift_key" ON "daily_reports"("branch_id", "report_date", "shift");

-- CreateIndex
CREATE INDEX "cash_shortages_org_id_report_date_idx" ON "cash_shortages"("org_id", "report_date");

-- CreateIndex
CREATE INDEX "cash_shortages_person_id_report_date_idx" ON "cash_shortages"("person_id", "report_date");

-- CreateIndex
CREATE INDEX "cash_shortages_branch_id_report_date_idx" ON "cash_shortages"("branch_id", "report_date");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_created_at_idx" ON "audit_logs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_resource_type_resource_id_action_user_id_created_key" ON "audit_logs"("resource_type", "resource_id", "action", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_unlock_by_id_fkey" FOREIGN KEY ("unlock_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shortages" ADD CONSTRAINT "cash_shortages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shortages" ADD CONSTRAINT "cash_shortages_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shortages" ADD CONSTRAINT "cash_shortages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shortages" ADD CONSTRAINT "cash_shortages_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- RLS + JWT hook
-- ============================================================
-- Pool Group ERP — RLS Policies + JWT Custom Claim
-- Run after `prisma migrate deploy` to apply RLS to Prisma-created tables
-- Multi-tenant: every query is scoped to org_id from JWT

-- ============================================================
-- 1. Helper function: read current user's org_id from JWT
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'org_id',
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public.current_org_id() IS
  'Returns the org_id from the JWT custom claim. NULL when no JWT (anon).';

-- ============================================================
-- 2. Helper: check if current user is super_admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND is_active = true
  );
$$;

-- ============================================================
-- 3. Auth hook: inject org_id + role into JWT custom claims
-- Supabase calls this for every JWT mint
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_record record;
BEGIN
  claims := event -> 'claims';

  SELECT id, org_id, role
  INTO user_record
  FROM public.users
  WHERE id = (event ->> 'user_id')::uuid
    AND is_active = true;

  IF user_record.org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(user_record.org_id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(user_record.role::text));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- After running this migration, in Supabase Dashboard:
-- Authentication → Hooks → Custom Access Token Hook → Enable + select custom_access_token_hook

-- ============================================================
-- 4. Enable RLS on all tenant tables
-- ============================================================
ALTER TABLE public.organizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shortages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Policies — org isolation pattern
--    Every authenticated user can only see rows in their own org.
--    super_admin bypasses (sees all orgs — for support/debug only).
-- ============================================================

-- organizations: user can read their own org
DROP POLICY IF EXISTS org_self_read ON public.organizations;
CREATE POLICY org_self_read ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_org_id() OR public.is_super_admin());

-- users: same-org read, self-update
DROP POLICY IF EXISTS users_same_org_read ON public.users;
CREATE POLICY users_same_org_read ON public.users
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- branches
DROP POLICY IF EXISTS branches_org_isolation ON public.branches;
CREATE POLICY branches_org_isolation ON public.branches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- user_branches
DROP POLICY IF EXISTS user_branches_org_isolation ON public.user_branches;
CREATE POLICY user_branches_org_isolation ON public.user_branches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- report_templates
DROP POLICY IF EXISTS report_templates_org_isolation ON public.report_templates;
CREATE POLICY report_templates_org_isolation ON public.report_templates
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- daily_reports
DROP POLICY IF EXISTS daily_reports_org_isolation ON public.daily_reports;
CREATE POLICY daily_reports_org_isolation ON public.daily_reports
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- cash_shortages
DROP POLICY IF EXISTS cash_shortages_org_isolation ON public.cash_shortages;
CREATE POLICY cash_shortages_org_isolation ON public.cash_shortages
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- audit_logs: same-org read; insert allowed but immutable
DROP POLICY IF EXISTS audit_logs_org_read ON public.audit_logs;
CREATE POLICY audit_logs_org_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id());

-- ============================================================
-- 6. Index for fast JWT claim lookup
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_auth_lookup
  ON public.users (id, is_active);

-- ============================================================
-- Done. Service role (used in server-side admin endpoints) bypasses RLS.
-- All client/RPC calls go through anon or authenticated → RLS enforced.
-- ============================================================
