// Insert ONE labeled TEST draft so CEO can SEE the ghost + click "ใช้หมวดนี้".
// status=draft (never posts to TRCloud) · clearly labeled · deleted after CEO confirms.
import { readFileSync } from "node:fs";
import pg from "pg";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const raw = env.DIRECT_URL || env.DATABASE_URL;
const url = new URL(raw); url.searchParams.delete("sslmode");
const pool = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
const ORG = "00000000-0000-0000-0000-000000000001";
const CO = "00000000-0000-0000-0000-0000000000a2";
const DOC = "TEST-GHOST-0724";

// delete any leftover test bill first (idempotent)
await pool.query(`DELETE FROM public.ledger_expense WHERE company_id=$1 AND doc_code=$2`, [CO, DOC]);

const r = await pool.query(
  `INSERT INTO public.ledger_expense
     (id, org_id, company_id, doc_code, status, source, vendor, vendor_tax_id,
      doc_date, subtotal, vat, wht, total, doc_type, category_id, suggested_category_name,
      buyer_tax_id_on_doc, buyer_tax_id_snapshot, buyer_name_snapshot, buyer_match_status,
      completeness_status, input_vat_claimable, needs_review, created_at, updated_at)
   VALUES
     (gen_random_uuid(), $1, $2, $3, 'draft', 'web',
      '🧪 ทดสอบ AI Ghost + ภาษีซื้อ (ลบได้)', '0105561000001',
      CURRENT_DATE, 1000, 70, 0, 1070, 'tax_invoice', NULL, 'ค่าไฟฟ้า',
      '0305564001581', '0305564001581', 'บริษัท เจพีซิ้งค์ กรุ๊ป จำกัด', 'matched',
      'green_full', true, true, now(), now())
   RETURNING id, doc_code`,
  [ORG, CO, DOC],
);
console.log(`✅ ใส่ใบทดสอบแล้ว: ${r.rows[0].doc_code} (id ${r.rows[0].id})`);
console.log(`   หมวด=ว่าง (category_id NULL) · AI แนะนำ='ค่าไฟฟ้า' → ควรเห็น ghost จาง`);
console.log(`   buyer=เจพีซิ้งค์ · green_full · ขอคืนได้=true → ควรเห็นสถานะ 'ขอคืนได้'`);
await pool.end();
