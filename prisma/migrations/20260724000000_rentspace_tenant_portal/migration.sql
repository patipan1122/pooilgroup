-- RentSpace tenant portal (ลิงก์เชิญ + ผูก LINE/อีเมล + ผู้เช่าจ่าย+แนบสลิป + ข่าวสาร) · 2026-07-24
-- Additive/nullable/มี default เท่านั้น → ปลอดภัยกับแถวเดิม · idempotent (re-run ได้)

-- 1) RentalTenant: ลิงก์เชิญพอร์ทัล + ผูก LINE จริง + รับบิลทางอีเมล
ALTER TABLE "public"."rental_tenant"
  ADD COLUMN IF NOT EXISTS "portal_token"       TEXT,
  ADD COLUMN IF NOT EXISTS "portal_token_at"    TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "portal_revoked"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "line_user_id"       TEXT,
  ADD COLUMN IF NOT EXISTS "line_display_name"  TEXT,
  ADD COLUMN IF NOT EXISTS "line_linked_at"     TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "email_bill_opt_in"  BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "rental_tenant_portal_token_key" ON "public"."rental_tenant"("portal_token");
CREATE UNIQUE INDEX IF NOT EXISTS "rental_tenant_line_user_id_key" ON "public"."rental_tenant"("line_user_id");

-- 2) RentalPayment: สถานะรอตรวจ/ยืนยัน/ปฏิเสธ + แหล่งที่มา + การตรวจ
--    แถวเก่าทั้งหมด default = confirmed/staff (เดิมแอดมินบันทึก=จ่ายจริง) → paidAmount เดิมไม่เปลี่ยน
ALTER TABLE "public"."rental_payment"
  ADD COLUMN IF NOT EXISTS "status"      TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS "source"      TEXT NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS "reviewed_by" UUID,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "review_note" TEXT;

CREATE INDEX IF NOT EXISTS "rental_payment_org_id_status_idx" ON "public"."rental_payment"("org_id", "status");

-- 3) RentalAnnouncement: ข่าวสาร/หนังสือแจ้งผู้เช่า (โชว์ในพอร์ทัล)
CREATE TABLE IF NOT EXISTS "public"."rental_announcement" (
  "id"              UUID NOT NULL,
  "org_id"          UUID NOT NULL,
  "project_id"      UUID,
  "title"           TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "attachment_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pinned"          BOOLEAN NOT NULL DEFAULT false,
  "is_published"    BOOLEAN NOT NULL DEFAULT false,
  "published_at"    TIMESTAMPTZ(6),
  "created_by"      UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rental_announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rental_announcement_org_id_project_id_is_published_idx"
  ON "public"."rental_announcement"("org_id", "project_id", "is_published");
