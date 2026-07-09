-- Recruit — HR first-pass triage verdict + applicant gender.
-- Additive only · nullable columns · safe + idempotent (IF NOT EXISTS).
-- ไม่แตะข้อมูลเดิม · แถวเก่าจะเป็น NULL (โชว์ "—" ในตาราง)

-- คัดกรองเร็ว (น่าสนใจ/พอใช้ได้/ไม่สนใจ) — per application
ALTER TABLE public.recruit_applications
  ADD COLUMN IF NOT EXISTS screening_verdict text;  -- INTERESTING | MAYBE | NOT_INTERESTED

-- เพศผู้สมัคร — per applicant (คงอยู่ข้ามใบสมัคร · dedup ตามเบอร์)
ALTER TABLE public.recruit_applicants
  ADD COLUMN IF NOT EXISTS gender text;  -- male | female | other
