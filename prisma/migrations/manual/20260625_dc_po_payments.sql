-- DC payment-gates migration (ADDITIVE · hand-written to avoid migrate-diff drift trap)
-- Apply to prod with: prisma db execute --file <this> (DIRECT_URL) · CEO-approved.
-- Safe: only ADDs to dc schema. Touches NO other schema. Idempotent guards throughout.
-- CEO 2026-06-25: ด่านจ่ายเงิน 2 จุด (ค่าของ@ถึงไทย · ค่าขนส่งไทย@ถึงโกดังเรา) + บันทึกยอด.

-- 1. ชนิดการจ่ายเงิน (ค่าของ / ค่าขนส่งในไทย)
DO $$ BEGIN
  CREATE TYPE "dc"."DcPoPaymentKind" AS ENUM ('GOODS', 'THAI_FREIGHT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. ตารางบันทึกการจ่ายเงินต่อใบสั่งซื้อ (ledger · audit-trail)
CREATE TABLE IF NOT EXISTS "dc"."po_payments" (
  "id"              UUID PRIMARY KEY,
  "org_id"          UUID NOT NULL,
  "po_id"           UUID NOT NULL,
  "kind"            "dc"."DcPoPaymentKind" NOT NULL,
  "amount_satang"   INTEGER NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'THB',
  "paid_at"         TIMESTAMPTZ(6) NOT NULL,
  "paid_by_user_id" UUID NOT NULL,
  "note"            TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "po_payments_po_fk" FOREIGN KEY ("po_id")
    REFERENCES "dc"."purchase_orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "po_payments_org_po_idx"
  ON "dc"."po_payments" ("org_id", "po_id");
