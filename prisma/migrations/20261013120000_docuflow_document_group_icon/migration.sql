-- DocuFlow · folder icon picker (CEO Pinpoint item #13, 2026-10-13) — adds
-- one nullable column on the existing document_groups table so a folder can
-- carry a small, fixed icon choice for visual priority/sorting in the
-- nested-folder drill-down tree. Purely additive — no existing row touched,
-- no existing column changed, matching the discipline of
-- prisma/migrations/20261011160000_docuflow_document_group_nesting.
--
-- icon: nullable, no backfill, no index. NULL means "no explicit choice" —
-- the UI renders the same default Folder icon it always has for every
-- pre-existing row, so this ships with zero visual change until an admin
-- actually picks something. Stores one of a small fixed app-layer enum
-- ("folder" | "star" | "lock" today) rather than a DB CHECK constraint —
-- same reasoning as DocumentType.dangerLevel/frequency elsewhere in this
-- module: the choice list is a UI/product concern that may grow, and a DB
-- constraint would require a migration every time it does. Invalid/unknown
-- values are treated as "folder" (default) at render time, never an error.
ALTER TABLE public.document_groups
  ADD COLUMN icon text;
