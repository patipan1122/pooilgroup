-- F4b · แม่บ้าน: บัตรประชาชน + ที่อยู่ + ตารางสัญญาจ้าง (CEO 2026-07-12)
--
-- เพิ่มช่องบัตร ปชช./ที่อยู่ บน ChairopsUser (ให้แม่บ้านกรอกเอง · แนบรูปบัตร)
-- + ตารางสัญญาจ้าง ChairopsMaidContract (กรอก → พรีวิว → เซ็นออนไลน์ฝ่ายเดียว).
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS) — รันซ้ำได้.
-- ตารางอยู่ schema `chairops` (multiSchema · ดู pooilgroup-db-multischema memory).

-- 1) ID card + address บน ChairopsUser (nullable · snake_case ตาม @map)
ALTER TABLE chairops."ChairopsUser" ADD COLUMN IF NOT EXISTS id_card_number   text NULL;
ALTER TABLE chairops."ChairopsUser" ADD COLUMN IF NOT EXISTS id_card_image_url text NULL;
ALTER TABLE chairops."ChairopsUser" ADD COLUMN IF NOT EXISTS id_card_file_name text NULL;
ALTER TABLE chairops."ChairopsUser" ADD COLUMN IF NOT EXISTS home_address      text NULL;

-- 2) enum สถานะสัญญา (idempotent)
DO $$ BEGIN
  CREATE TYPE chairops."ChairopsContractStatus" AS ENUM ('DRAFT', 'SIGNED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) ตารางสัญญาจ้าง (PascalCase · ไม่มี @@map → double-quoted · คอลัมน์ camelCase)
CREATE TABLE IF NOT EXISTS chairops."ChairopsMaidContract" (
  id                   text NOT NULL,
  "orgId"              text NOT NULL,
  "maidId"             text NOT NULL,
  status               chairops."ChairopsContractStatus" NOT NULL DEFAULT 'DRAFT',
  "maidName"           text NOT NULL,
  "idCardNumber"       text,
  address              text,
  phone                text,
  "monthlyWage"        integer,
  "payDayOfMonth"      integer,
  "salaryBankName"     text,
  "salaryAccountNo"    text,
  "salaryAccountName"  text,
  "companyBankName"    text,
  "companyAccountNo"   text,
  "companyAccountName" text DEFAULT 'บริษัท เจพีซิงค์กรุ๊ป จำกัด',
  "companyAccountType" text,
  "startDate"          date,
  "endDate"            date,
  "idCardImageUrl"     text,
  "signatureImageUrl"  text,
  "signedName"         text,
  "signedAt"           timestamp(3),
  "signedIp"           text,
  "documentUrl"        text,
  "documentName"       text,
  "createdById"        text,
  "createdAt"          timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"          timestamp(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ChairopsMaidContract_pkey" PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS "ChairopsMaidContract_orgId_maidId_idx"
  ON chairops."ChairopsMaidContract" ("orgId", "maidId");
CREATE INDEX IF NOT EXISTS "ChairopsMaidContract_orgId_status_idx"
  ON chairops."ChairopsMaidContract" ("orgId", status);

-- FK → ChairopsUser (maid = RESTRICT กันลบแม่บ้านที่มีสัญญา · createdBy = SET NULL)
DO $$ BEGIN
  ALTER TABLE chairops."ChairopsMaidContract"
    ADD CONSTRAINT "ChairopsMaidContract_maidId_fkey"
    FOREIGN KEY ("maidId") REFERENCES chairops."ChairopsUser"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chairops."ChairopsMaidContract"
    ADD CONSTRAINT "ChairopsMaidContract_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES chairops."ChairopsUser"(id)
    ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
