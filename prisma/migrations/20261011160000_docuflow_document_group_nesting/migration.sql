-- DocuFlow · nested document-group folders (CEO feedback 2026-10-11) — adds
-- unlimited-depth folder nesting scoped per company, replacing the derived
-- "ประเภทธุรกิจ" buckets in the "ตามบริษัท" tree view. Purely additive —
-- two nullable columns on the existing document_groups table, no existing
-- row touched, no existing column changed.
--
-- company_id: nullable because pre-existing top-level groups (Phase 1,
-- quick-create shortcut) aren't scoped to any one company — they stay
-- org-wide. New folders created via the per-company drill-down UI always
-- set this. ON DELETE SET NULL — if a company is ever deactivated, its
-- folders fall back to "unscoped" rather than cascading.
--
-- parent_group_id: self-reference for nesting. ON DELETE RESTRICT — deleting
-- a folder that still has children must fail loudly (the app layer already
-- blocks this before it would ever reach the DB), never silently orphan or
-- mass-delete a subtree. No re-parenting (move an existing folder under a
-- different parent) is supported yet, so no cycle-prevention logic is
-- needed at this stage.
ALTER TABLE public.document_groups
  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN parent_group_id uuid REFERENCES public.document_groups(id) ON DELETE RESTRICT;

CREATE INDEX document_groups_company_parent_idx
  ON public.document_groups (org_id, company_id, parent_group_id);

-- The old blanket UNIQUE(org_id, name) is dropped — nesting means the same
-- folder name ("เอกสาร", "ก่อสร้าง") is expected to repeat under different
-- parents/companies. Duplicate-sibling checking (same org_id + company_id +
-- parent_group_id + name) is enforced at the application layer in
-- lib/docuflow/document-groups.ts instead of a DB constraint — a composite
-- UNIQUE including the two new nullable columns would silently fail to
-- catch top-level duplicates anyway, since Postgres treats NULL <> NULL
-- (two existing top-level groups, both company_id/parent_group_id NULL,
-- would never collide on a naive composite unique index).
ALTER TABLE public.document_groups
  DROP CONSTRAINT document_groups_org_name_unique;

-- RLS policy unchanged — document_groups already has org-isolation RLS
-- (document_groups_org_isolation, using auth.jwt()->>'org_id') from when
-- the table was first created; these two new columns don't open any new
-- access path, the existing policy's org_id check already covers rows
-- regardless of company_id/parent_group_id values. (Per today's separate
-- company-scoping audit: this module reads exclusively through Prisma,
-- which uses a DB role that bypasses RLS entirely — the real enforcement
-- is the application-layer `where: { orgId }` on every query, same as the
-- rest of this module; RLS stays enabled for defense-in-depth only.)
