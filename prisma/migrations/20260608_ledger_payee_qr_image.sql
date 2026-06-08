-- LedgerLine ขอโอน: attach a QR image (พร้อมเพย์/bank) so the executive scans to
-- pay straight from the LINE card. Nullable TEXT (R2 public URL) — additive, no
-- backfill, no lock concern. Mirrors Prisma: payeeQrImageUrl String? @map(...).
ALTER TABLE ledger_payment_request
  ADD COLUMN IF NOT EXISTS payee_qr_image_url TEXT;
