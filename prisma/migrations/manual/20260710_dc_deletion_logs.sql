-- DC · "ประวัติการลบเอกสาร" (deletion log) — CEO 2026-07-10.
-- เก็บ snapshot เต็มก่อน hard-delete เอกสาร DC ทุกใบ (PO/ใบรับ/ใบโอน/ใบเบิก/ใบย้าย) +
-- สรุปการคืนสต๊อก/TRCloud. ลบได้เฉพาะ super_admin (CEO) ช่วง trial · ตรวจย้อน/กู้คืนได้.
-- Additive only · idempotent (IF NOT EXISTS) · apply to prod BEFORE deploy (schema-applied gate).

CREATE TABLE IF NOT EXISTS "dc"."deletion_logs" (
  "id"                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"              uuid        NOT NULL,
  "doc_type"            text        NOT NULL,             -- po | grn | transfer | issue | move | shipment
  "doc_id"              uuid        NOT NULL,
  "doc_code"            text        NOT NULL,
  "snapshot"            jsonb       NOT NULL,             -- header+lines+related ก่อนลบ
  "reversal"            jsonb,                            -- สรุปคืนสต๊อก/TRCloud
  "cascaded_from_type"  text,                             -- ถูกลบตามใบแม่ (เช่น GRN เพราะลบ PO)
  "cascaded_from_id"    uuid,
  "note"                text,
  "deleted_by_user_id"  uuid        NOT NULL,
  "deleted_by_name"     text,
  "deleted_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deletion_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "deletion_logs_org_id_deleted_at_idx"
  ON "dc"."deletion_logs" ("org_id", "deleted_at" DESC);
CREATE INDEX IF NOT EXISTS "deletion_logs_org_id_doc_type_idx"
  ON "dc"."deletion_logs" ("org_id", "doc_type");
