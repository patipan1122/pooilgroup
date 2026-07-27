-- DC · เอกสารแนบในใบสั่งซื้อ (po_documents) — additive · schema "dc" · ไม่กระทบตารางเดิม.
-- อัปเอกสาร (ใบกำกับ/Packing/ใบเสร็จ) เข้าใบ PO ได้ทุกเมื่อ แม้ใบจบแล้ว.

-- CreateTable
CREATE TABLE "dc"."po_documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "r2_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "label" TEXT,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "po_documents_org_id_po_id_idx" ON "dc"."po_documents"("org_id", "po_id");

-- AddForeignKey
ALTER TABLE "dc"."po_documents" ADD CONSTRAINT "po_documents_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "dc"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
