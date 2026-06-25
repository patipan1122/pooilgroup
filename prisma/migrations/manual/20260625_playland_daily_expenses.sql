-- Playland · ตารางต้นทุน/ค่าใช้จ่ายรายวัน (รายงานกำไร-ขาดทุนเจ้าของ) — ADDITIVE ปลอดภัย ไม่แตะข้อมูลเดิม
-- kind: labor | electricity | rent | water | supplies | marketing | other
-- period: once (ลงครั้งเดียว/วันนั้น) | monthly (ต้นทุนคงที่รายเดือน)
CREATE TABLE IF NOT EXISTS "playland"."daily_expenses" (
  "id"                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"             uuid        NOT NULL,
  "branch_id"          uuid        NOT NULL,
  "expense_date"       date        NOT NULL,
  "kind"               text        NOT NULL,
  "label"              text,
  "amount_cents"       integer     NOT NULL DEFAULT 0,
  "staff_count"        integer,
  "period"             text        NOT NULL DEFAULT 'once',
  "note"               text,
  "created_by_user_id" uuid,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "daily_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_expenses_branch_fk" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "daily_expenses_branch_date_idx" ON "playland"."daily_expenses" ("branch_id", "expense_date");
CREATE INDEX IF NOT EXISTS "daily_expenses_org_date_idx" ON "playland"."daily_expenses" ("org_id", "expense_date");
