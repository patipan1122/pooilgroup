-- Backfill company_id = JP Sync Group for recruit_job_postings rows that were
-- created before company_id existed on this table (never tagged, nullable by design).
-- CEO confirmed 2026-10-11 all 32 untagged rows belong to JP Sync Group.
-- Scoped to org_id to avoid touching rows outside this org.

UPDATE recruit_job_postings
SET company_id = '00000000-0000-0000-0000-0000000000a2' -- JP Sync Group
WHERE company_id IS NULL
  AND org_id = '00000000-0000-0000-0000-000000000001';
