-- Pooilgroup ERP — Recruit Onboarding: "ระบบรับพนักงานใหม่ออนไลน์"
-- Date: 2026-09-22
--
-- New, standalone feature — NOT linked to recruit_applications/recruit_applicants
-- (CEO decision, confirmed twice via /feature-workshop then /bigfeature). A single
-- permanent public link collects real employee data + ID documents + an e-signed
-- employment contract after HR has already decided (offline) to hire someone.
-- HR reviews + approves each submission manually; only at approval does a real
-- `users` row get created (atomic, application-layer transaction — see
-- docs/BIGFEATURE_recruit-onboarding_SPEC.md).
--
-- Additive only — 3 new tables, 2 new enum types, zero changes to existing tables.
-- Idempotent — safe to re-run.

-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public."RecruitOnboardingStatus" AS ENUM ('SUBMITTED', 'HR_REVIEWING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RecruitOnboardingDocType" AS ENUM ('ID_CARD', 'HOUSE_REGISTRATION', 'BANK_BOOK', 'PHOTO', 'EDUCATION', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ TABLES ============

CREATE TABLE IF NOT EXISTS public.recruit_onboarding_submissions (
  id                                     UUID PRIMARY KEY,
  org_id                                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  company_id                             UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id                              UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  position_applied                       TEXT NOT NULL,
  desired_start_date                     DATE NOT NULL,
  desired_salary                         DECIMAL(10,2) NOT NULL,

  title_prefix                           TEXT NOT NULL,
  full_name_th                           TEXT NOT NULL,
  full_name_en                           TEXT,
  nickname                                TEXT NOT NULL,
  national_id                            TEXT NOT NULL,
  birth_date                             DATE NOT NULL,
  nationality                            TEXT NOT NULL,
  military_status                        TEXT,
  phone                                  TEXT NOT NULL,
  line_id                                TEXT,
  email                                  TEXT,
  marital_status                         TEXT,

  address_json                           JSONB NOT NULL DEFAULT '{}',
  emergency_contacts_json                JSONB NOT NULL DEFAULT '[]',
  education_json                         JSONB NOT NULL DEFAULT '{}',
  work_history_json                      JSONB NOT NULL DEFAULT '[]',
  bank_name                              TEXT NOT NULL,
  bank_account_no                        TEXT NOT NULL,
  bank_account_name                      TEXT NOT NULL,

  consent_truthful_at                    TIMESTAMPTZ(6),
  consent_privacy_read_at                TIMESTAMPTZ(6),
  consent_emergency_contact_notified_at  TIMESTAMPTZ(6),
  consent_reference_check_at             TIMESTAMPTZ(6),

  schema_version                         INTEGER NOT NULL DEFAULT 1,
  answers_json                           JSONB NOT NULL DEFAULT '{}',

  status                                 public."RecruitOnboardingStatus" NOT NULL DEFAULT 'SUBMITTED',
  reviewed_by_id                         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at                            TIMESTAMPTZ(6),
  reject_reason                          TEXT,
  result_user_id                         UUID, -- plain pointer, NOT a FK — matches register_requests.result_user_id precedent exactly

  submitted_ip                           INET,
  submitted_user_agent                   TEXT,

  created_at                             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recruit_onboarding_submissions_org_id_status_created_at_idx
  ON public.recruit_onboarding_submissions(org_id, status, created_at);
CREATE INDEX IF NOT EXISTS recruit_onboarding_submissions_national_id_idx
  ON public.recruit_onboarding_submissions(national_id);

CREATE TABLE IF NOT EXISTS public.recruit_onboarding_documents (
  id              UUID PRIMARY KEY,
  submission_id   UUID NOT NULL REFERENCES public.recruit_onboarding_submissions(id) ON DELETE CASCADE,
  doc_type        public."RecruitOnboardingDocType" NOT NULL,
  drive_file_id   TEXT NOT NULL,
  drive_folder_id TEXT NOT NULL, -- private per-submission folder (ChairOps pattern) — NEVER made public-link-readable
  file_name       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recruit_onboarding_documents_submission_id_idx
  ON public.recruit_onboarding_documents(submission_id);

-- Immutable (WORM-triggered below) — the legal evidence trail for the signed
-- contract. Content-hash pattern copied from chairops_maid_contracts, not
-- DocuFlow's document_signature_placements (which has no content-hash).
CREATE TABLE IF NOT EXISTS public.recruit_onboarding_consents (
  id                    UUID PRIMARY KEY,
  submission_id         UUID NOT NULL UNIQUE REFERENCES public.recruit_onboarding_submissions(id) ON DELETE CASCADE,
  signed_at             TIMESTAMPTZ(6) NOT NULL,
  signed_ip             INET,
  signed_user_agent     TEXT,
  contract_content_hash TEXT NOT NULL, -- sha256 of the exact rendered contract text shown at signing
  scrolled_to_end       BOOLEAN NOT NULL DEFAULT false,
  signature_doc_id      UUID NOT NULL, -- plain pointer → recruit_onboarding_documents, no FK (dodges cascade-delete ordering hazard)
  selfie_doc_id         UUID NOT NULL, -- plain pointer → recruit_onboarding_documents, no FK
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ WORM ENFORCEMENT (recruit_onboarding_consents) ============
-- Same pattern as audit_logs (supabase/migrations/20260520000006_audit_log_immutable.sql).
-- This table IS the legal proof the employee read + agreed to the contract —
-- must be append-only even from service-role calls.

CREATE OR REPLACE FUNCTION recruit_onboarding_consents_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'recruit_onboarding_consents is immutable (WORM) — UPDATE/DELETE not allowed.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recruit_onboarding_consents_no_update ON public.recruit_onboarding_consents;
CREATE TRIGGER recruit_onboarding_consents_no_update
  BEFORE UPDATE ON public.recruit_onboarding_consents
  FOR EACH ROW EXECUTE FUNCTION recruit_onboarding_consents_block_mutation();

DROP TRIGGER IF EXISTS recruit_onboarding_consents_no_delete ON public.recruit_onboarding_consents;
CREATE TRIGGER recruit_onboarding_consents_no_delete
  BEFORE DELETE ON public.recruit_onboarding_consents
  FOR EACH ROW EXECUTE FUNCTION recruit_onboarding_consents_block_mutation();

COMMENT ON FUNCTION recruit_onboarding_consents_block_mutation() IS
  'WORM enforcement — recruit_onboarding_consents is append-only: it is the legal evidence trail proving informed consent to the employment contract.';
