-- ChairOps bootstrap · paste into Supabase Studio SQL Editor → Run
-- Generated 2026-05-21 · safe (additive only · no DROP)
-- Order: DDL → RLS → Seed

-- ====================================================
-- PART 1: Tables (16) + enums + indexes + foreign keys
-- ====================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "chairops";

-- CreateEnum
CREATE TYPE "chairops"."ChairopsUserRole" AS ENUM ('ADMIN', 'CEO', 'MANAGER', 'OFFICE', 'MAID', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "chairops"."ChairopsAlertLevel" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "chairops"."ChairopsAlertStatus" AS ENUM ('OPEN', 'ACK', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "chairops"."ChairopsAlertKind" AS ENUM ('SHORTAGE', 'MISSED_COLLECTION', 'POS_NOT_INGESTED', 'CHAIR_OFFLINE', 'CLEANLINESS_FAIL', 'REPAIR_OVERDUE', 'WRITE_OFF_REQUESTED');

-- CreateEnum
CREATE TYPE "chairops"."ChairopsTicketStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "chairops"."ChairopsCleanlinessGrade" AS ENUM ('PASS', 'WARN', 'FAIL');

-- CreateTable
CREATE TABLE "chairops"."ChairopsBranch" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tabName" TEXT NOT NULL,
    "parenNumber" INTEGER,
    "city" TEXT,
    "region" TEXT,
    "mallGroup" TEXT,
    "floor" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChairopsBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsUser" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "lineUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "chairops"."ChairopsUserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "primaryBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChairopsUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsMaidAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChairopsMaidAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsChair" (
    "id" TEXT NOT NULL,
    "chairCode" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "generation" TEXT,
    "pricePerCycle" INTEGER,
    "isOnline" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChairopsChair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsPosImport" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "diffSummary" JSONB NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "committedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "ChairopsPosImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsPosDaily" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "chairCode" TEXT,
    "bizDate" DATE NOT NULL,
    "online" INTEGER NOT NULL DEFAULT 0,
    "cash" INTEGER NOT NULL DEFAULT 0,
    "coin" INTEGER NOT NULL DEFAULT 0,
    "totalCash" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" INTEGER NOT NULL DEFAULT 0,
    "rawSource" TEXT,
    "importId" TEXT,
    "enteredById" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "ChairopsPosDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsCashCollection" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "maidId" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countedAmount" INTEGER NOT NULL,
    "depositedAmount" INTEGER NOT NULL,
    "evidencePhotoUrl" TEXT NOT NULL,
    "slipPhotoUrl" TEXT,
    "imageHash" TEXT NOT NULL,
    "notes" TEXT,
    "lockedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChairopsCashCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsDrift" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "posTotal" INTEGER NOT NULL,
    "depositTotal" INTEGER NOT NULL,
    "driftAmount" INTEGER NOT NULL,
    "driftSince" TIMESTAMP(3),
    "lastPosDate" DATE,
    "lastCollectionAt" TIMESTAMP(3),
    "daysSinceLastCollection" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChairopsDrift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsAlert" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "kind" "chairops"."ChairopsAlertKind" NOT NULL,
    "level" "chairops"."ChairopsAlertLevel" NOT NULL,
    "status" "chairops"."ChairopsAlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contextJson" JSONB,
    "ackedById" TEXT,
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChairopsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsWriteOff" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "makerAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approverId" TEXT,
    "approverAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "ChairopsWriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsDamageTicket" (
    "id" TEXT NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "chairId" TEXT,
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photoUrls" TEXT[],
    "status" "chairops"."ChairopsTicketStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "ChairopsDamageTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsSparePart" (
    "id" TEXT NOT NULL,
    "partCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'ชิ้น',
    "unitPrice" INTEGER,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChairopsSparePart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsSparePartMovement" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "branchId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refTicketId" TEXT,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChairopsSparePartMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsCleanlinessReport" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "byMaidId" TEXT NOT NULL,
    "auditedById" TEXT,
    "auditedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checklist" JSONB NOT NULL,
    "photoUrls" TEXT[],
    "grade" "chairops"."ChairopsCleanlinessGrade" NOT NULL DEFAULT 'PASS',
    "notes" TEXT,

    CONSTRAINT "ChairopsCleanlinessReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChairopsAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairops"."ChairopsBankAccount" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "branchId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChairopsBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsBranch_slug_key" ON "chairops"."ChairopsBranch"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsBranch_tabName_key" ON "chairops"."ChairopsBranch"("tabName");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsUser_authUserId_key" ON "chairops"."ChairopsUser"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsUser_email_key" ON "chairops"."ChairopsUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsUser_phone_key" ON "chairops"."ChairopsUser"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsUser_lineUserId_key" ON "chairops"."ChairopsUser"("lineUserId");

-- CreateIndex
CREATE INDEX "ChairopsUser_role_idx" ON "chairops"."ChairopsUser"("role");

-- CreateIndex
CREATE INDEX "ChairopsUser_primaryBranchId_idx" ON "chairops"."ChairopsUser"("primaryBranchId");

-- CreateIndex
CREATE INDEX "ChairopsMaidAssignment_branchId_isActive_idx" ON "chairops"."ChairopsMaidAssignment"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "ChairopsMaidAssignment_userId_isActive_idx" ON "chairops"."ChairopsMaidAssignment"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsChair_chairCode_key" ON "chairops"."ChairopsChair"("chairCode");

-- CreateIndex
CREATE INDEX "ChairopsChair_branchId_idx" ON "chairops"."ChairopsChair"("branchId");

-- CreateIndex
CREATE INDEX "ChairopsChair_generation_idx" ON "chairops"."ChairopsChair"("generation");

-- CreateIndex
CREATE INDEX "ChairopsPosImport_uploadedAt_idx" ON "chairops"."ChairopsPosImport"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsPosImport_fileHash_key" ON "chairops"."ChairopsPosImport"("fileHash");

-- CreateIndex
CREATE INDEX "ChairopsPosDaily_branchId_bizDate_idx" ON "chairops"."ChairopsPosDaily"("branchId", "bizDate");

-- CreateIndex
CREATE INDEX "ChairopsPosDaily_bizDate_idx" ON "chairops"."ChairopsPosDaily"("bizDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsPosDaily_branchId_chairCode_bizDate_key" ON "chairops"."ChairopsPosDaily"("branchId", "chairCode", "bizDate");

-- CreateIndex
CREATE INDEX "ChairopsCashCollection_branchId_collectedAt_idx" ON "chairops"."ChairopsCashCollection"("branchId", "collectedAt");

-- CreateIndex
CREATE INDEX "ChairopsCashCollection_maidId_collectedAt_idx" ON "chairops"."ChairopsCashCollection"("maidId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsCashCollection_imageHash_key" ON "chairops"."ChairopsCashCollection"("imageHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsDrift_branchId_key" ON "chairops"."ChairopsDrift"("branchId");

-- CreateIndex
CREATE INDEX "ChairopsAlert_status_level_idx" ON "chairops"."ChairopsAlert"("status", "level");

-- CreateIndex
CREATE INDEX "ChairopsAlert_branchId_status_idx" ON "chairops"."ChairopsAlert"("branchId", "status");

-- CreateIndex
CREATE INDEX "ChairopsAlert_createdAt_idx" ON "chairops"."ChairopsAlert"("createdAt");

-- CreateIndex
CREATE INDEX "ChairopsWriteOff_branchId_status_idx" ON "chairops"."ChairopsWriteOff"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsDamageTicket_ticketCode_key" ON "chairops"."ChairopsDamageTicket"("ticketCode");

-- CreateIndex
CREATE INDEX "ChairopsDamageTicket_branchId_status_idx" ON "chairops"."ChairopsDamageTicket"("branchId", "status");

-- CreateIndex
CREATE INDEX "ChairopsDamageTicket_assignedToId_status_idx" ON "chairops"."ChairopsDamageTicket"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "ChairopsDamageTicket_priority_status_idx" ON "chairops"."ChairopsDamageTicket"("priority", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChairopsSparePart_partCode_key" ON "chairops"."ChairopsSparePart"("partCode");

-- CreateIndex
CREATE INDEX "ChairopsSparePartMovement_partId_at_idx" ON "chairops"."ChairopsSparePartMovement"("partId", "at");

-- CreateIndex
CREATE INDEX "ChairopsCleanlinessReport_branchId_reportedAt_idx" ON "chairops"."ChairopsCleanlinessReport"("branchId", "reportedAt");

-- CreateIndex
CREATE INDEX "ChairopsAuditLog_entity_entityId_idx" ON "chairops"."ChairopsAuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ChairopsAuditLog_userId_createdAt_idx" ON "chairops"."ChairopsAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChairopsAuditLog_createdAt_idx" ON "chairops"."ChairopsAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsMaidAssignment" ADD CONSTRAINT "ChairopsMaidAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsMaidAssignment" ADD CONSTRAINT "ChairopsMaidAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsChair" ADD CONSTRAINT "ChairopsChair_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsPosDaily" ADD CONSTRAINT "ChairopsPosDaily_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsPosDaily" ADD CONSTRAINT "ChairopsPosDaily_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsCashCollection" ADD CONSTRAINT "ChairopsCashCollection_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsCashCollection" ADD CONSTRAINT "ChairopsCashCollection_maidId_fkey" FOREIGN KEY ("maidId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsDrift" ADD CONSTRAINT "ChairopsDrift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsAlert" ADD CONSTRAINT "ChairopsAlert_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsAlert" ADD CONSTRAINT "ChairopsAlert_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsWriteOff" ADD CONSTRAINT "ChairopsWriteOff_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsWriteOff" ADD CONSTRAINT "ChairopsWriteOff_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsDamageTicket" ADD CONSTRAINT "ChairopsDamageTicket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsDamageTicket" ADD CONSTRAINT "ChairopsDamageTicket_chairId_fkey" FOREIGN KEY ("chairId") REFERENCES "chairops"."ChairopsChair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsDamageTicket" ADD CONSTRAINT "ChairopsDamageTicket_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsDamageTicket" ADD CONSTRAINT "ChairopsDamageTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsSparePartMovement" ADD CONSTRAINT "ChairopsSparePartMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "chairops"."ChairopsSparePart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsCleanlinessReport" ADD CONSTRAINT "ChairopsCleanlinessReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "chairops"."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsCleanlinessReport" ADD CONSTRAINT "ChairopsCleanlinessReport_byMaidId_fkey" FOREIGN KEY ("byMaidId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsCleanlinessReport" ADD CONSTRAINT "ChairopsCleanlinessReport_auditedById_fkey" FOREIGN KEY ("auditedById") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairops"."ChairopsAuditLog" ADD CONSTRAINT "ChairopsAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "chairops"."ChairopsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ====================================================
-- PART 2: RLS policies + helper SQL functions
-- ====================================================
-- ============================================================
-- ChairOps RLS — apply AFTER `npx prisma db push` (or run by hand)
-- This migration assumes the chairops schema tables have been created
-- by Prisma with the Chairops* model names (see prisma/schema.prisma).
--
-- Per memory [[multi-tenant-rls]] + [[role-rank-privilege-escalation-guard]].
-- File renumbered to 9999_ to sort after Pool's existing 001-006 migrations.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS chairops;

-- Helper: get caller's chairops.User row (cached via SECURITY DEFINER)
-- NOTE: Prisma generates String columns as Postgres `text`, not `uuid`.
-- Functions return text to match column type (avoids text=uuid operator errors in RLS policies).
CREATE OR REPLACE FUNCTION chairops.current_user_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id FROM chairops."ChairopsUser" u WHERE u."authUserId" = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION chairops.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.role::text FROM chairops."ChairopsUser" u WHERE u."authUserId" = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION chairops.current_user_branch()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u."primaryBranchId" FROM chairops."ChairopsUser" u WHERE u."authUserId" = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION chairops.role_rank(r text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'MAID' THEN 1
    WHEN 'TECHNICIAN' THEN 1
    WHEN 'OFFICE' THEN 2
    WHEN 'MANAGER' THEN 3
    WHEN 'CEO' THEN 4
    WHEN 'ADMIN' THEN 5
    ELSE 0
  END
$$;

-- ============================================================
-- Enable RLS on every table
-- ============================================================

ALTER TABLE chairops."ChairopsBranch"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsUser"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsMaidAssignment"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsChair"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsPosImport"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsPosDaily"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsCashCollection"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsDrift"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsAlert"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsWriteOff"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsDamageTicket"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsSparePart"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsSparePartMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsCleanlinessReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsAuditLog"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsBankAccount"       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Branch — everyone sees all active branches (read)
-- Only ADMIN can write
-- ============================================================

CREATE POLICY branch_read ON chairops."ChairopsBranch" FOR SELECT
  USING (chairops.current_user_role() IS NOT NULL);
CREATE POLICY branch_write ON chairops."ChairopsBranch" FOR ALL
  USING (chairops.current_user_role() = 'ADMIN')
  WITH CHECK (chairops.current_user_role() = 'ADMIN');

-- ============================================================
-- User — admin sees all · everyone reads self
-- ============================================================

CREATE POLICY user_read_self_or_admin ON chairops."ChairopsUser" FOR SELECT
  USING (
    "authUserId" = auth.uid()::text
    OR chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
  );
CREATE POLICY user_write_admin ON chairops."ChairopsUser" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'));

-- ============================================================
-- MaidAssignment — office+ read all · admin write
-- ============================================================

CREATE POLICY maid_assignment_read ON chairops."ChairopsMaidAssignment" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY maid_assignment_write ON chairops."ChairopsMaidAssignment" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'));

-- ============================================================
-- Chair — read by all auth users · admin/manager write
-- ============================================================

CREATE POLICY chair_read ON chairops."ChairopsChair" FOR SELECT
  USING (chairops.current_user_role() IS NOT NULL);
CREATE POLICY chair_write ON chairops."ChairopsChair" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'));

-- ============================================================
-- PosImport · PosDaily — office+ all · MAID/TECHNICIAN none
-- ============================================================

CREATE POLICY pos_import_office_read ON chairops."ChairopsPosImport" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY pos_import_office_write ON chairops."ChairopsPosImport" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

CREATE POLICY pos_daily_office_read ON chairops."ChairopsPosDaily" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY pos_daily_office_write ON chairops."ChairopsPosDaily" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- CashCollection — MAID sees/writes own branch · OFFICE+ sees all · MAID can't edit after 30 min
-- ============================================================

CREATE POLICY cash_read_branch ON chairops."ChairopsCashCollection" FOR SELECT
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );

CREATE POLICY cash_insert_branch ON chairops."ChairopsCashCollection" FOR INSERT
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );

CREATE POLICY cash_update_office_only ON chairops."ChairopsCashCollection" FOR UPDATE
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- Drift · Alert · WriteOff — office+ only
-- ============================================================

CREATE POLICY drift_office_all ON chairops."ChairopsDrift" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

CREATE POLICY alert_read ON chairops."ChairopsAlert" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY alert_write ON chairops."ChairopsAlert" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

CREATE POLICY writeoff_read ON chairops."ChairopsWriteOff" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY writeoff_write ON chairops."ChairopsWriteOff" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- Damage Tickets — MAID/TECH branch-scope · OFFICE+ all
-- ============================================================

CREATE POLICY damage_read ON chairops."ChairopsDamageTicket" FOR SELECT
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
    OR "assignedToId" = chairops.current_user_id()
  );

CREATE POLICY damage_insert ON chairops."ChairopsDamageTicket" FOR INSERT
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );

CREATE POLICY damage_update_office_or_assignee ON chairops."ChairopsDamageTicket" FOR UPDATE
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "assignedToId" = chairops.current_user_id()
  )
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "assignedToId" = chairops.current_user_id()
  );

-- ============================================================
-- SparePart · SparePartMovement — office+ read · manager+ write
-- ============================================================

CREATE POLICY part_read ON chairops."ChairopsSparePart" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY part_write ON chairops."ChairopsSparePart" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'));

CREATE POLICY part_movement_read ON chairops."ChairopsSparePartMovement" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY part_movement_write ON chairops."ChairopsSparePartMovement" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- Cleanliness — MAID writes/reads own branch · OFFICE+ all
-- ============================================================

CREATE POLICY clean_read ON chairops."ChairopsCleanlinessReport" FOR SELECT
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );
CREATE POLICY clean_insert ON chairops."ChairopsCleanlinessReport" FOR INSERT
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );
CREATE POLICY clean_update_office ON chairops."ChairopsCleanlinessReport" FOR UPDATE
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- AuditLog — read by ADMIN/CEO only · INSERT by anyone (via writeAudit) · NO update/delete (immutable)
-- ============================================================

CREATE POLICY audit_read ON chairops."ChairopsAuditLog" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('CEO'));
CREATE POLICY audit_insert ON chairops."ChairopsAuditLog" FOR INSERT
  WITH CHECK (chairops.current_user_role() IS NOT NULL);
-- no UPDATE or DELETE policy = blocked

-- ============================================================
-- BankAccount — office+ read · admin write
-- ============================================================

CREATE POLICY bank_read ON chairops."ChairopsBankAccount" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY bank_write ON chairops."ChairopsBankAccount" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'));

-- ============================================================
-- Sequence helper for damage ticket codes (CH-YYYY-NNNN)
-- ============================================================

CREATE OR REPLACE FUNCTION chairops.next_damage_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  buddhist_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int + 543;
  next_n int;
BEGIN
  SELECT COALESCE(MAX((REGEXP_MATCH(d."ticketCode", '^CH-' || buddhist_year || '-(\d+)$'))[1]::int), 0) + 1
  INTO next_n
  FROM chairops."ChairopsDamageTicket" d
  WHERE d."ticketCode" LIKE 'CH-' || buddhist_year || '-%';

  RETURN 'CH-' || buddhist_year || '-' || LPAD(next_n::text, 4, '0');
END;
$$;

-- ====================================================
-- PART 3: Seed (30 branches + 57 chairs + 8 parts + CEO user + drift rows)
-- ====================================================
-- Seed 30 branches
-- Generated from prisma/seed-chairops.ts
INSERT INTO chairops."ChairopsBranch" (id, slug, name, "tabName", "parenNumber", city, region, "mallGroup", floor, "isActive", "createdAt", "updatedAt") VALUES
  ('00ecff07-10c7-40b5-9359-16e612125273', 'mpark', 'mpark', 'mpark(150)', 150, NULL, NULL, 'mpark', NULL, true, NOW(), NOW()),
  ('2883c330-1666-4170-8052-3a43ccf9837b', 'central-korat-thos', 'centralโคราช(ธอส)', 'centralโคราช(ธอส)(870)', 870, 'นครราชสีมา', 'อีสาน', 'central', NULL, true, NOW(), NOW()),
  ('43efe252-f114-4cac-9b23-b8b4169e23ce', 'central-korat-blood', 'centralโคราช(บริจาคเลือด)', 'centralโคราช(บริจาคเลือด)(550)', 550, 'นครราชสีมา', 'อีสาน', 'central', NULL, true, NOW(), NOW()),
  ('79445b6f-afed-48ed-91e0-7e201932a3ff', 'central-ayutthaya', 'Centralอยุธยา', 'Centralอยุธยา', NULL, 'พระนครศรีอยุธยา', 'กลาง', 'central', NULL, true, NOW(), NOW()),
  ('645e613e-3d56-4962-ae21-b853cf4d2493', 'robinson-prachin', 'robinsonปราจีน', 'robinsonปราจีน(550)', 550, 'ปราจีนบุรี', 'ตะวันออก', 'robinson', NULL, true, NOW(), NOW()),
  ('79e0c62b-59bf-438c-a804-4e73109357c1', 'robinson-kanchanaburi', 'robinsonกาญ', 'robinsonกาญ (900)', 900, 'กาญจนบุรี', 'ตะวันตก', 'robinson', NULL, true, NOW(), NOW()),
  ('1f4726a5-3add-448d-bb86-5d404d994a7b', 'robinson-buriram', 'robinsonบุรีรัมย์', 'robinsonบุรีรัมย์(700)', 700, 'บุรีรัมย์', 'อีสาน', 'robinson', NULL, true, NOW(), NOW()),
  ('67f660ab-9ddd-4fc4-82f5-99502b349730', 'lotus-ayutthaya', 'lotusอยุธยา', 'lotusอยุธยา(300)', 300, 'พระนครศรีอยุธยา', 'กลาง', 'lotus', NULL, true, NOW(), NOW()),
  ('2f31d7dc-4093-483e-bc19-744b7ef12aca', 'robinson-roiet', 'robinson ร้อยเอ็ด', 'robinson ร้อยเอ็ด(1300)', 1300, 'ร้อยเอ็ด', 'อีสาน', 'robinson', NULL, true, NOW(), NOW()),
  ('ccdca398-7546-496d-b31f-ff8fee7f67e8', 'top-nonghan', 'TOPหนองหาน', 'TOPหนองหาน', NULL, 'อุดรธานี', 'อีสาน', 'top', NULL, true, NOW(), NOW()),
  ('d94bea9d-5137-4026-b99a-0e166c3521d3', 'wishko-huathale', 'วิชโก้หัวทะเล', 'วิชโก้หัวทะเล', NULL, 'นครราชสีมา', 'อีสาน', NULL, NULL, true, NOW(), NOW()),
  ('c9ab295d-41bb-4dd3-9685-7ad6a21d1bb1', 'index-bangna', 'INDEX บางนา', 'INDEX บางนา', NULL, 'กรุงเทพ', 'กลาง', 'index', NULL, true, NOW(), NOW()),
  ('2ec9b01e-9720-4b7b-a677-f5973beba021', 'huamak-center', 'หัวหมาก เซ็นเตอร์', 'หัวหมาก เซ็นเตอร์', NULL, 'กรุงเทพ', 'กลาง', NULL, NULL, true, NOW(), NOW()),
  ('7141d932-bb22-48f0-885e-a00b34b9e118', 'condo-suparai-9', 'Condo suparai 9', 'Condo suparai 9 (200)', 200, 'กรุงเทพ', 'กลาง', NULL, NULL, true, NOW(), NOW()),
  ('ff42da00-a82d-4e6a-b37d-8ae1c73790c4', 'central-sriracha', 'เซนทรัล ศรีราชา', 'เซนทรัล ศาีราชา (350)', 350, 'ชลบุรี', 'ตะวันออก', 'central', NULL, true, NOW(), NOW()),
  ('3711344c-5351-46f4-ac8c-4d39a300d1d2', 'ck-plaza', 'Ck plaza', 'Ck plaza (200)', 200, NULL, NULL, NULL, NULL, true, NOW(), NOW()),
  ('589982be-bba2-468e-91bf-fe5fc9690b8d', 'lotus-chonburi', 'โลตัสชลบุรี', 'โลตัสชลบุรี (200)', 200, 'ชลบุรี', 'ตะวันออก', 'lotus', NULL, true, NOW(), NOW()),
  ('c444c225-e3f4-4a04-a01d-2b2d087f1a07', 'lotus-rama-2', 'lotus พระราม 2', 'lotus พระราม 2', NULL, 'กรุงเทพ', 'กลาง', 'lotus', NULL, true, NOW(), NOW()),
  ('f6531029-08a5-41d0-9608-a947b641ca8d', 'pantip-ngamwong', 'พันธ์ุทิพย์ งามวงศ์วาน', 'พันธ์ุทิพย์ งามวงศ์วาน', NULL, 'นนทบุรี', 'กลาง', NULL, NULL, true, NOW(), NOW()),
  ('800def0c-13f5-44d1-aa53-608c7901a864', 'royal-garden-khonkaen', 'Royal garden ขอนแก่น', 'Royal gardenขอนแก่น (700)', 700, 'ขอนแก่น', 'อีสาน', NULL, NULL, true, NOW(), NOW()),
  ('ed49a24d-390c-4a40-b1c6-6eb111d46beb', 'itsquare-floor-2', 'ไอทีแสควร์', 'ไอทีแสควร์ ชั้น2', NULL, 'กรุงเทพ', 'กลาง', 'itsquare', 'ชั้น 2', true, NOW(), NOW()),
  ('efb357de-d743-4bdc-ae5a-87bd7a068696', 'itsquare-floor-3', 'ไอทีแสควร์', 'ไอทีแสควร์ ชั้น3', NULL, 'กรุงเทพ', 'กลาง', 'itsquare', 'ชั้น 3', true, NOW(), NOW()),
  ('cf9ff990-96b8-4d14-8423-e1f3b228de4a', 'central-khonkaen', 'Central ขอนแก่น', 'Central ขอนแก่น', NULL, 'ขอนแก่น', 'อีสาน', 'central', NULL, true, NOW(), NOW()),
  ('aca3a80e-cba3-4a19-b344-1c620618697c', 'passion-rayong-1', 'แพชชั่น ระยอง', 'แพชชั่น ระยอง ชั้น1', NULL, 'ระยอง', 'ตะวันออก', 'passion', 'ชั้น 1', true, NOW(), NOW()),
  ('0a6db460-a3d1-490c-8de7-d77f3559e2f2', 'passion-rayong-2', 'แพชชั่น ระยอง', 'แพชชั่น ระยอง ชั้น2', NULL, 'ระยอง', 'ตะวันออก', 'passion', 'ชั้น 2', true, NOW(), NOW()),
  ('5d46ca96-6306-45a9-9f56-a8428f4a4e58', 'lotus-pathum', 'โลตัสปทุม', 'โลตัสปทุม', NULL, 'ปทุมธานี', 'กลาง', 'lotus', NULL, true, NOW(), NOW()),
  ('4cb406e8-8631-4f6f-b9a0-b0dcff38810f', 'lamplaimat', 'ลำปลายมาศ', 'ลำปลายมาศ', NULL, 'บุรีรัมย์', 'อีสาน', NULL, NULL, true, NOW(), NOW()),
  ('12d79118-89c4-4b71-bbf4-0ecf9d422c27', 'lotus-chaiyaphum', 'lotus ชัยภูมิ', 'lotus ชัยภูมิ(250)', 250, 'ชัยภูมิ', 'อีสาน', 'lotus', NULL, true, NOW(), NOW()),
  ('8349d2df-f6be-46aa-8389-854b0fe54a52', 'phoenix-pratunam', 'ฟินิกซ์ ประตูน้ำ', 'ฟินิกซ์ ประตูน้ำ', NULL, 'กรุงเทพ', 'กลาง', NULL, NULL, true, NOW(), NOW()),
  ('3f8579e8-c778-45ee-8e93-b6f5827f43be', 'robinson-sakon', 'robinsonสกลนคร', 'robinsonสกลนคร', NULL, 'สกลนคร', 'อีสาน', 'robinson', NULL, true, NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- Seed 57 chairs at robinsonกาญ (only branch confirmed in source data)
INSERT INTO chairops."ChairopsChair" (id, "chairCode", "branchId", generation, "isOnline", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), code, b.id,
       CASE WHEN code LIKE 'G0310%' THEN 'G0310' WHEN code LIKE 'G0318%' THEN 'G0318' WHEN code LIKE 'G0321%' THEN 'G0321' WHEN code LIKE 'FC%' THEN 'FC' ELSE 'UNKNOWN' END,
       code NOT LIKE 'FC%', true, NOW(), NOW()
FROM unnest(ARRAY['G0310370','G0310371','G0310372','G0310373','G0310374','G0310375','G0310376','G0310377','G0310378','G0310380','G0310381','G0310382','G0310383','G0310384','G0310385','G0310386','G0310387','G0310388','G0310389','G0310390','G0310391','G0310392','G0310393','G0310394','G0310395','G0310396','G0310397','G0310398','G0310399','G0310400','G0310401','G0310402','G0310403','G0310404','G0310405','G0310406','G0310407','G0310408','G0310409','G0310410','G0310411','G0310412','G0310413','G0310414','G0310415','G0310416','G0310417','G0310418','G0310419','G0310420','G0310421','G0310422','G0310423','G0310424','G0310425','G0310426','G0310429']) AS t(code)
CROSS JOIN chairops."ChairopsBranch" b WHERE b.slug = 'robinson-kanchanaburi'
ON CONFLICT ("chairCode") DO NOTHING;

-- Seed 8 spare parts
INSERT INTO chairops."ChairopsSparePart" (id, "partCode", name, category, unit, "unitPrice", "stockOnHand", "reorderLevel", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'ROLLER-S', 'ลูกกลิ้งเล็ก', 'มอเตอร์', 'ชิ้น', 250, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'ROLLER-L', 'ลูกกลิ้งใหญ่', 'มอเตอร์', 'ชิ้น', 450, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'MOTOR-A', 'มอเตอร์หลัก', 'มอเตอร์', 'ชิ้น', 3500, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'BELT', 'สายพาน', 'ขับเคลื่อน', 'ชิ้น', 350, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'FABRIC', 'เบาะ', 'ภายนอก', 'ชิ้น', 1200, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'REMOTE', 'รีโมท', 'อิเล็กทรอนิกส์', 'ชิ้น', 850, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'QR-MOD', 'โมดูล QR Code', 'อิเล็กทรอนิกส์', 'ชิ้น', 1500, 0, 2, NOW(), NOW()),
  (gen_random_uuid(), 'COIN-MECH', 'กลไกหยอดเหรียญ', 'อิเล็กทรอนิกส์', 'ชิ้น', 800, 0, 2, NOW(), NOW())
ON CONFLICT ("partCode") DO NOTHING;

-- Initialize drift rows for every active branch
INSERT INTO chairops."ChairopsDrift" (id, "branchId", "posTotal", "depositTotal", "driftAmount", "daysSinceLastCollection", "lastComputedAt")
SELECT gen_random_uuid(), b.id, 0, 0, 0, 0, NOW() FROM chairops."ChairopsBranch" b
WHERE NOT EXISTS (SELECT 1 FROM chairops."ChairopsDrift" d WHERE d."branchId" = b.id);

-- Seed CEO user (authUserId will be linked on first login)
INSERT INTO chairops."ChairopsUser" (id, email, "displayName", role, "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'patipan@jpsyncgroup.com', 'Pattipan (CEO)', 'CEO', true, NOW(), NOW())
ON CONFLICT (email) DO NOTHING;
