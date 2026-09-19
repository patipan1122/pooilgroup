-- Pooilgroup ERP — Recruit: shareable, public applicant-list link per posting
-- Date: 2026-09-19 (revised same day — CEO switched from login-required to
-- fully public, no re-migration needed since the column shape is identical)
--
-- CEO-approved feature: a share link scoped to ONE job posting that anyone
-- with the link can open to view that posting's applicant list, read-only —
-- no login required. Adds a nullable unique token column to
-- recruit_job_postings — the token is generated lazily by
-- generateApplicantShareLink() (lib/recruit/actions.ts) and cleared by
-- revokeApplicantShareLink(). Consumed by app/recruit-share/[token] (public
-- route, deliberately outside the (admin) auth-gated route group).
--
-- Mirrors the rental_bill.public_token pattern
-- (supabase/migrations/20260614160000_rentspace_batch2.sql) exactly — same
-- token-column + unique-index shape, same fully-public trust model (the
-- random token itself is the credential).
--
-- Idempotent — safe to re-run.

ALTER TABLE public.recruit_job_postings
  ADD COLUMN IF NOT EXISTS applicant_share_token text;

CREATE UNIQUE INDEX IF NOT EXISTS "recruit_job_postings_applicant_share_token_key"
  ON public.recruit_job_postings(applicant_share_token);

COMMENT ON COLUMN public.recruit_job_postings.applicant_share_token IS
  'Random UUID share token for the public, read-only applicant-list view (/recruit-share/<token>). NULL = sharing not enabled / revoked.';
