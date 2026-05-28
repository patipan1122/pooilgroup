-- CreateEnum
CREATE TYPE "playland"."PlaylandWristbandStatus" AS ENUM ('ISSUED', 'ACTIVE', 'RETURNED', 'LOST');

-- CreateTable
CREATE TABLE "playland"."wristbands" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "member_id" UUID,
    "session_id" UUID,
    "status" "playland"."PlaylandWristbandStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_user_id" UUID NOT NULL,
    "bound_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "returned_at" TIMESTAMPTZ(6),
    "last_scan_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wristbands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playland"."wristband_scans" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "wristband_id" UUID NOT NULL,
    "scanned_by_user_id" UUID,
    "scanType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "metadata" JSONB,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wristband_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wristbands_code_key" ON "playland"."wristbands"("code");

-- CreateIndex
CREATE INDEX "wristbands_org_id_branch_id_idx" ON "playland"."wristbands"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "wristbands_member_id_idx" ON "playland"."wristbands"("member_id");

-- CreateIndex
CREATE INDEX "wristbands_status_idx" ON "playland"."wristbands"("status");

-- CreateIndex
CREATE INDEX "wristband_scans_wristband_id_scanned_at_idx" ON "playland"."wristband_scans"("wristband_id", "scanned_at");

-- AddForeignKey
ALTER TABLE "playland"."wristbands" ADD CONSTRAINT "wristbands_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "playland"."members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."wristbands" ADD CONSTRAINT "wristbands_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "playland"."sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playland"."wristband_scans" ADD CONSTRAINT "wristband_scans_wristband_id_fkey" FOREIGN KEY ("wristband_id") REFERENCES "playland"."wristbands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
