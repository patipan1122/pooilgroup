-- DocuFlow · "ย้ายไปที่..." move-document-to-group audit log (Workshop Must #5,
-- docs/WORKSHOP_docuflow-org-structure-2026-10-10.md Section 4) — append-only,
-- one row per move. NEW TABLE ONLY — no existing column touched, no existing
-- row affected.
--
-- Moves Document.documentGroupId (the real "group placement" column —
-- verified against lib/docuflow/data.ts / upload-form.tsx / document-groups.ts
-- / upload-proxy/route.ts, every live read+write call site). This is NOT
-- DocumentOwnership.level='group' — that column is an unrelated org-hierarchy
-- ownership scope (whole-Pooilgroup vs company vs branch vs business_type vs
-- person), not the folder/taxonomy "DocumentGroup" concept this feature moves.
--
-- RLS added day-1 (same org-isolation policy pattern as every other table
-- created this way recently, e.g. playland.printers in
-- 20261001_playland_printers.sql) — this module was flagged for RLS gaps in
-- a separate security audit, so a brand-new table here gets it from the start
-- rather than added later.
CREATE TABLE public.document_group_move_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  from_group_id    uuid REFERENCES public.document_groups(id) ON DELETE SET NULL,
  to_group_id      uuid NOT NULL REFERENCES public.document_groups(id) ON DELETE RESTRICT,
  moved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  moved_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_group_move_log_org_doc_idx ON public.document_group_move_log (org_id, document_id);
CREATE INDEX document_group_move_log_to_group_idx ON public.document_group_move_log (to_group_id);

ALTER TABLE public.document_group_move_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_group_move_log_isolation" ON public.document_group_move_log;
CREATE POLICY "document_group_move_log_isolation" ON public.document_group_move_log FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
