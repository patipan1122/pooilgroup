-- Follow-up to 20260922_enable_rls_43_gap_tables.sql.
-- A full public-schema sweep (not just Prisma-model-derived table names)
-- found 2 more tables with RLS off that the Prisma-schema-based scan missed:
--   - _branch_name_backup_20260607 (63 rows, one-off manual backup snapshot,
--     not a Prisma model, branch code/name history only)
--   - rentspace_permission (0 rows, org/role/capability permission matrix,
--     not yet wired into app code — locking down before first use)
-- Same safety basis as the previous migration: no app code anywhere imports
-- the browser/anon Supabase client with a .from() call, so RLS with no
-- policy is a pure close-the-hole change with zero app impact.
ALTER TABLE public."_branch_name_backup_20260607" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentspace_permission            ENABLE ROW LEVEL SECURITY;
