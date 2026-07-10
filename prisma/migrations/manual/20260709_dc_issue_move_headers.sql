-- DC · หัวเอกสาร "ใบเบิกออก" + "ใบย้ายที่" (ให้พิมพ์เป็นเอกสารได้ · CEO 2026-07-09)
-- เดิม เบิก/ย้าย เก็บเป็น dc.stock_movements แถวลอย (ไม่มีเลขที่ใบ). เพิ่มหัวใบ 2 ตาราง
-- รายการในใบ = stock_movements ที่ ref_type='dc_issue'/'dc_move' และ ref_id = หัวใบ (ไม่มี line table).
-- batch_key = idempotency (กดเบิก/ย้ายซ้ำ = ใบเดิม ไม่สร้างซ้ำ).
-- ปลอดภัย: additive ล้วน · ไม่แตะ stock_movements/balance เดิม · IF NOT EXISTS ทั้งหมด.

CREATE TABLE IF NOT EXISTS dc.issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  issue_code    text NOT NULL,
  warehouse_id  uuid NOT NULL,
  batch_key     text NOT NULL,
  note          text,
  actor_user_id uuid,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dc_issues_org_code_uq  ON dc.issues (org_id, issue_code);
CREATE UNIQUE INDEX IF NOT EXISTS dc_issues_org_batch_uq ON dc.issues (org_id, batch_key);
CREATE INDEX        IF NOT EXISTS dc_issues_org_issued_ix ON dc.issues (org_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS dc.moves (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  move_code     text NOT NULL,
  warehouse_id  uuid NOT NULL,
  batch_key     text NOT NULL,
  note          text,
  actor_user_id uuid,
  moved_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dc_moves_org_code_uq  ON dc.moves (org_id, move_code);
CREATE UNIQUE INDEX IF NOT EXISTS dc_moves_org_batch_uq ON dc.moves (org_id, batch_key);
CREATE INDEX        IF NOT EXISTS dc_moves_org_moved_ix ON dc.moves (org_id, moved_at DESC);
