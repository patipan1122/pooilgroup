import "server-only";
import { prisma } from "@/lib/prisma";
import { convertExpensePoToAp, type PushableExpense } from "@/lib/ledger/trcloud-push";
import { readTrcloudDocDetail } from "@/lib/ledger/trcloud-doc-detail";
import { STANDARD_CATEGORIES } from "@/lib/ledger/coa-chart";

// LedgerLine · "ติ๊ก → ส่งเข้า AP" จากหน้าเอกสาร TRCloud (แท็บ PO).
//   บันทึกใบสั่งซื้อ (PO) เป็นค่าใช้จ่าย (AP) จริงใน TRCloud ด้วยหมวดบัญชีที่ผู้ใช้เลือก.
//   💰 นี่คือการ "เขียนเงินจริง" เข้าสมุดบัญชี → มีด่านกันพลาดหลายชั้น (ดู guard ด้านล่าง)
//   ก่อนจะยอมส่ง. reuse ตัวแปลงที่พิสูจน์แล้ว convertExpensePoToAp (ไม่พึ่ง LedgerExpense).
//
// จุดต่างจากใบ LedgerLine: ใบนี้เป็น "ใบ TRCloud ล้วน" ไม่มี LedgerExpense →
//   สร้าง PushableExpense สังเคราะห์จาก snapshot + ไส้ในสด (ยอดที่นักบัญชีเห็นจริง).
//   ❗ ไม่ส่ง poDocId → ไม่ลบ PO ต้นฉบับของลูกค้า (ต่างจาก flow ของเราที่ PO เป็น seed).

const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID ?? "";

export type SendPoToApInput = {
  trcloudId: string;
  refNo: string | null;
  categoryGl: string; // รหัสบัญชีของหมวด (ต้องเป็น 1 ใน 21 หมวดมาตรฐาน)
};

export type SendPoToApResult = {
  trcloudId: string;
  ok: boolean;
  apDocNo?: string | null;
  error?: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ส่งใบ PO เดียว → AP. คืน error ภาษาคนถ้าติด guard (ไม่ throw · ให้ batch เดินต่อได้).
export async function sendPoDocToAp(orgId: string, input: SendPoToApInput): Promise<SendPoToApResult> {
  const fail = (error: string): SendPoToApResult => ({ trcloudId: input.trcloudId, ok: false, error });

  // ── guard 1: หมวดต้องเป็น 1 ใน 21 หมวดมาตรฐาน (มี c-slot สูตร LL → ลงบัญชีถูกต่อหมวด) ──
  const cat = STANDARD_CATEGORIES.find((c) => c.glCode === input.categoryGl);
  if (!cat) return fail("ยังไม่ได้เลือกหมวดบัญชี หรือหมวดไม่ถูกต้อง (ต้องเลือกจาก 21 หมวดมาตรฐาน)");

  if (!COMPANY_ID) return fail("ยังไม่ได้ตั้งค่ากุญแจ TRCloud (TRCLOUD_JPS_COMPANY_ID)");

  // ── guard 2: หา snapshot ของใบ (scope ด้วย orgId → กันข้าม tenant) · ต้องเป็น PO ──
  const row = await prisma.ledgerTrcloudDoc.findFirst({
    where: { orgId, kind: "PO", trcloudId: input.trcloudId },
  });
  if (!row) return fail("ไม่พบใบสั่งซื้อนี้ (ลองรีเฟรชจาก TRCloud)");

  // ── guard 3: ห้ามแปลงซ้ำ — TRCloud แปลง PO→AP ไปแล้ว (status_ap > 0) ──
  if (row.statusAp && Number(row.statusAp) > 0) {
    return fail("ใบนี้ถูกแปลงเป็น AP ไปแล้วใน TRCloud — ไม่ต้องส่งซ้ำ");
  }

  // ── guard 4: ต้องมีรหัสแผนก (นิติบุคคล) → รู้ว่าลงบัญชีบริษัทไหน ──
  const department = row.department;
  if (!department) return fail("ใบนี้ไม่มีรหัสแผนก (นิติบุคคล) ใน TRCloud — เปิดใบเติมก่อน");

  // ── guard 5: มีภาษีหัก ณ ที่จ่าย → ยังไม่รองรับ (ตัวแปลง LL ตั้งเจ้าหนี้ยอดเต็ม ต้องบันทึก WHT ตอนจ่าย) ──
  const snapWht = row.wht != null ? Number(row.wht) : 0;
  if (snapWht > 0) {
    return fail(`ใบนี้มีภาษีหัก ณ ที่จ่าย ฿${snapWht.toLocaleString("th-TH")} — ยังไม่รองรับแปลง AP อัตโนมัติ (บันทึกใน TRCloud เอง)`);
  }

  // ── อ่านไส้ในสดจาก TRCloud → ใช้ยอดที่นักบัญชีเห็นจริง (net/VAT/รวม) ──
  const detail = await readTrcloudDocDetail("PO", input.trcloudId, input.refNo);
  if (!detail.ok || !detail.header) {
    return fail(`อ่านรายละเอียดใบจาก TRCloud ไม่สำเร็จ${detail.error ? ` (${detail.error})` : ""}`);
  }
  const h = detail.header;
  const subtotal = h.total; // ก่อน VAT (net)
  const vat = h.tax ?? 0;
  const grand = h.grandTotal;
  const liveWht = h.wht ?? 0;

  if (liveWht > 0) {
    return fail(`ใบนี้มีภาษีหัก ณ ที่จ่าย ฿${liveWht.toLocaleString("th-TH")} — ยังไม่รองรับแปลง AP อัตโนมัติ`);
  }
  if (subtotal == null || subtotal <= 0) {
    return fail("ยอดก่อน VAT ของใบไม่ถูกต้อง — ตรวจใน TRCloud ก่อน");
  }

  // ── guard 6: ยอดต้องลงตัว (ก่อน VAT + VAT = ยอดรวม) — กันทั้งข้อมูลเพี้ยน
  //    และกันความกำกวม net/gross ของฟิลด์ (ถ้า map ผิด สมการจะไม่ลงตัว → บล็อกแทนลงบัญชีผิด). ──
  if (grand != null) {
    const expected = round2(subtotal + vat);
    if (Math.abs(expected - grand) > 0.1) {
      return fail(
        `ยอดเงินไม่ลงตัว (ก่อน VAT ${subtotal.toLocaleString("th-TH")} + VAT ${vat.toLocaleString("th-TH")} ≠ รวม ${grand.toLocaleString("th-TH")}) — ตรวจใน TRCloud ก่อน`,
      );
    }
  }

  // ── สร้าง PushableExpense สังเคราะห์ → ส่งเข้าตัวแปลงที่พิสูจน์แล้ว ──
  const e: PushableExpense = {
    id: `poap-${input.trcloudId}`,
    orgId,
    companyId: COMPANY_ID,
    docCode: `POAP-${input.trcloudId}`, // 🔑 คีย์กันซ้ำ deterministic → ap/search เจอถ้าเคยสร้าง
    docType: null,
    vendor: row.vendorName ?? row.organization ?? null,
    vendorTaxId: row.taxId ?? null, // ไม่มี → ตัวแปลงลงเป็น "เจ้าหนี้เบ็ดเตล็ด" (เตือนใน UI ก่อนกด)
    vendorAddress: null,
    docDate: row.issueDate ?? (h.issueDate ? new Date(h.issueDate) : null),
    subtotal,
    vat,
    wht: 0, // guard 5/6 บล็อก WHT ไปแล้ว
    discount: 0, // ใบที่มีส่วนลดแยกจะตกด่านยอดไม่ลงตัว (guard 6) → ที่ผ่านมาถือว่า net รวมส่วนลดแล้ว
    total: grand ?? round2(subtotal + vat),
    paymentStatus: "unpaid", // ตั้งเป็นเจ้าหนี้ (AP) — ให้ไปจ่าย/กระทบยอดทีหลัง
    note: row.invoiceNote ?? null,
    categoryName: cat.name,
    categoryAccCode: cat.glCode,
    trcloudProductCode: cat.sku, // SKU ตายตัวตามหมวด (JPS-100/101/103)
    purchaseType: null,
    inputVatClaimable: cat.vatClaimable,
    branchTrcloudProject: row.project ?? null,
    branchTrcloudDepartment: department,
    items: [], // สรุปเป็นบรรทัดเดียวตามหมวดที่เลือก (ปลอดภัยสุด · ไม่แตกบรรทัดจาก PO)
  };

  // creditForm:true → บังคับเส้น LL (เครดิต/ตั้งเจ้าหนี้) → journal ลงบัญชีถูกต่อหมวดในตัวใบ.
  // ❗ ไม่ส่ง poDocId → ไม่ลบ PO ต้นฉบับ (เป็นเอกสารของลูกค้า ไม่ใช่ seed ของเรา).
  const res = await convertExpensePoToAp(e, { creditForm: true });
  if (!res.ok) return fail(res.error);
  return { trcloudId: input.trcloudId, ok: true, apDocNo: res.apDocNo };
}

// ส่งหลายใบ (ตามลำดับ กัน 429 + กัน race สร้าง AP ซ้ำ). คืนผลรายใบ.
export async function sendPoDocsToAp(orgId: string, inputs: SendPoToApInput[]): Promise<SendPoToApResult[]> {
  const results: SendPoToApResult[] = [];
  for (const input of inputs) {
    results.push(await sendPoDocToAp(orgId, input));
  }
  return results;
}
