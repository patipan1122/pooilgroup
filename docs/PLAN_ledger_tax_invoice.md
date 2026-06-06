# PLAN · LedgerLine — ภาษีซื้อ (Input-VAT Claimability)

> Implementation plan แปลงจาก `docs/WORKSHOP_ledgerline-tax-invoice.md` (2026-06-05)
> Grounded ในโค้ดจริง · plan-only · ยังไม่ build · รอ CEO อนุมัติ
> Related: [[ledgerline-tax-invoice-workshop-2026-06-05]] · [[trcloud-api-ap-create-2026-06-05]] · [[trcloud-shared-company-warning]]

---

## 🦋 สรุปสำหรับ CEO (ภาษาคน)

แผนแบ่งเป็น **7 เฟส แบบ "ทำ  1 ใบให้ครบก่อน แล้วค่อยขยาย"** (vertical slice) — เปิดมา 1 ใบ → ตรวจผู้ซื้อ → ให้ไฟสถานะสี → โชว์จุดเล็ก ๆ ในรายการ ก่อน แล้วค่อยต่อ filter / แนบใบทดแทน / แยกภาษีซื้อ / ต่อ TRCloud

- ✅ **เกือบทั้งหมด (เฟส 0–6) สร้างได้เลยวันนี้** ไม่ต้องรออะไร
- ⏳ **3 อย่างที่ขอจาก CEO** ก่อนจะ "ครบ 100%": (1) รายการเลขภาษีบริษัทในเครือ (2) TRCloud มีช่อง "ภาษีซื้อขอคืนไม่ได้" แยกไหม (3) ยืนยันเลขภาษีเจพีซิ้งค์ใน prod — **แต่ build เริ่มได้โดยไม่ต้องรอ** (ใช้เลข 0305564001581 จากสเปคไปก่อน)
- 🔒 **กฎความปลอดภัยที่ฝังในแผน:** ตัดสินด้วย**เลขภาษี 13 หลักเป๊ะ** (ไม่เดาชื่อ) · ตรวจแบบ deterministic (ตรวจย้อนได้) · migration ปลอดภัย ไม่ทับของเก่า ไม่ชน session อื่น
- 🧪 **ทดสอบ:** 20 ใบจริง + แอบใส่ใบ "ออกผิดชื่อ" 2-3 ใบ → ระบบต้องจับใบผิดได้ **100%** ก่อนปล่อย

**เวลาประเมิน:** core (เฟส 0–6 + test) ~ครึ่งวัน–1 วัน build · TRCloud realtime (เฟส 7) รอ field spec แล้วต่อทีหลัง

---

## 1. Phasing

| เฟส | ทำอะไร | ทดสอบได้เมื่อ |
|---|---|---|
| **0 · Config** | `lib/ledger/group-identity.ts` — SSoT ของผู้ซื้อ (เจพีซิ้งค์ taxId `0305564001581`) + `GROUP_TAX_IDS` whitelist | `isOurBuyer()` / `isGroupEntity()` ถูกต้อง |
| **1 · Vertical slice** | schema+migration · prompt หาเลขผู้ซื้อ · `gradeCompleteness()` engine · จุดสีในรายการ + panel "ผิดตรงไหน" ในหน้าแก้ไข | 1 ใบ → ได้สถานะสี + เหตุผล |
| **2 · Filter + summary** | backfill ปลอดภัย · filter ตามสี · แถบสรุปนับสถานะ + ยอด VAT ที่ยังติด | `?cc=yellow` กรองได้ · แถบสรุปโชว์ |
| **3 · 2-bucket VAT** | toggle "ขอคืนได้?" + เหตุผล (เฉพาะนักบัญชี) | นักบัญชีพลิก claimable ได้ |
| **4 · Replacement** | แนบใบใหม่ทดแทน เก็บ 2 ใบ flip เขียว + audit | ใบเหลือง+แนบใบเต็ม → เขียว |
| **5 · Override + audit** | นักบัญชี/แอดมิน override + log | non-accountant ถูกบล็อก |
| **6 · LINE card status** | บรรทัดสถานะสีบนการ์ด LINE (optional) | ถ่ายใบ → การ์ดโชว์สถานะ |
| **7 · TRCloud realtime** | push ผู้ซื้อ + แยก VAT ขอคืนได้/ไม่ได้ (behind flag) | รอ field spec |

---

## 2. Data Model (เพิ่มบน `LedgerExpense`)

| Prisma field | DB column | type | default |
|---|---|---|---|
| `buyerTaxIdSnapshot` | `buyer_tax_id_snapshot` | String? | null (จาก master) |
| `buyerNameSnapshot` | `buyer_name_snapshot` | String? | null |
| `buyerTaxIdOnDoc` | `buyer_tax_id_on_doc` | String? | null (OCR เจอบนใบ — เพื่อ audit) |
| `buyerMatchStatus` | `buyer_match_status` | String | `"undecided"` |
| `completenessStatus` | `completeness_status` | String | `"undecided"` (green_full/yellow_partial/red_invalid) |
| `completenessMissing` | `completeness_missing` | Json? | null (string[] element ที่ขาด) |
| `completenessCheckedAt` | `completeness_checked_at` | DateTime? | null (snapshot audit) |
| `inputVatClaimable` | `input_vat_claimable` | Boolean? | null (=undecided) |
| `inputVatBlockReason` | `input_vat_block_reason` | String? | null |
| `replacementOfId` / `replacedById` | `replacement_of_id` / `replaced_by_id` | uuid? | null (self-relation, เก็บ 2 ใบ) |
| `overrideBy/At/Reason` | `override_*` | uuid?/ts?/text? | null |

- Enums = plain `String` + TS union ใน `lib/ledger/types.ts` (ตามขนบโมดูล — docType/status เป็น String หมด)
- Audit actions ใหม่ (เพิ่มใน TS union `lib/audit/log.ts`, DB เป็น free String): `LEDGER_EXPENSE_REPLACEMENT_ATTACHED` · `LEDGER_EXPENSE_VAT_OVERRIDDEN` · `LEDGER_EXPENSE_RECHECKED`
- Migration: `supabase/migrations/20260605210000_ledger_input_vat_claimability.sql` — **additive (`ADD COLUMN IF NOT EXISTS`) + idempotent** (ปลอดภัย ไม่ชน migration `...180000` ของ TRCloud session) · backfill = DEFAULT only (ไม่ recompute ใบ confirmed/locked) · guarded `UPDATE companies SET tax_id='0305564001581' WHERE code='JPSYNC' AND tax_id IS NULL`

---

## 3. Completeness Engine (`lib/ledger/recheck.ts` — deterministic, ไม่ใช้ AI)

```ts
export function gradeCompleteness(p: CompletenessInput): {
  status: CompletenessStatus;       // green_full | yellow_partial | red_invalid
  buyerMatch: BuyerMatchStatus;     // matched | mismatch | not_found_on_doc
  missing: string[];                // ["vat_line","buyer_taxid",...]
  blockReason: InputVatBlockReason | null;
  suggestedClaimable: boolean;
}
```

**Buyer match (เลข 13 หลักเป๊ะ — ไม่ใช้ชื่อ/confidence):**
```
buyerDigits = stripNonDigit(buyerTaxIdOnDoc)
len≠13 → not_found_on_doc · ===เจพีซิ้งค์ → matched · อยู่ใน GROUP_TAX_IDS แต่คนละตัว → mismatch(wrong entity) · อื่น/ผิด 1 หลัก → mismatch
```

**Rule table (บนลงล่าง เจอก่อนชนะ):**
| # | เงื่อนไข | สี | blockReason |
|---|---|---|---|
| R1 | เลขภาษีผู้ขายไม่ครบ 13 | 🔴 | incomplete_invoice |
| R2 | ผู้ซื้อ = บริษัทอื่นในเครือ | 🔴 | wrong_entity |
| R3 | ผู้ซื้อ = นอกเครือ/ผิด 1 หลัก | 🔴 | buyer_mismatch |
| R4 | ไม่มีบรรทัด VAT แยก (vat≤0) | 🔴 | incomplete_invoice |
| R5 | ใบกำกับอย่างย่อ (ม.86/6) | 🟡 | abbreviated_86_6 |
| R6 | ไม่เจอเลขผู้ซื้อบนใบ (แต่อย่างอื่นครบ) | 🟡 | incomplete_invoice |
| R7 | ขาดของรอง (ที่อยู่/สาขา) | 🟡 | incomplete_invoice |
| R8 | เต็มรูป + ผู้ซื้อตรง + VAT แยก | 🟢 | null |

- **ใบย่อ heuristic:** rawText มี "อย่างย่อ" / (docType≠tax_invoice แต่มี VAT) → YELLOW (keyword pre-empt R4; ถ้าไม่มี keyword vat≤0 = RED)
- ชื่อผู้ซื้อพิมพ์ผิดแต่เลขภาษีตรง → ยัง GREEN-eligible (ตัดสินที่เลข) · นักบัญชี downgrade เองได้ผ่าน override
- **Wiring:** เรียกข้าง `recheckReceipt` ที่ `actions.ts:182` (create) + `_actions.ts` confirmExpense (web edit) — **ทั้ง 2 path** ไม่งั้น snapshot เก่า

---

## 4. AI Prompt (`lib/ledger/ai-parse.ts` — เพิ่ม 1 ฟิลด์ ไม่เพิ่ม cost)

เพิ่ม key เดียวใน prompt: `"buyer_tax_id": "<เลขภาษี 13 หลักของผู้ซื้อบนเอกสาร หรือ null — มองบล็อก 'ลูกค้า/ผู้ซื้อ/ในนาม' ไม่ใช่เลขร้านผู้ขาย · ห้ามเดา>"` + `RawParsed.buyer_tax_id` + normalize digit-strip + `ParsedReceipt.buyerTaxIdOnDoc`. ไม่เพิ่ม confidence (ตัดสิน exact-match)

---

## 5. UI

- **List:** `components/ledger/_kit/CompletenessDot.tsx` (จุดสี 8px + tooltip) ใน `ExpenseList.tsx` · `CompletenessSummaryStrip.tsx` (นับสี + VAT ติด) · color-filter tab (mirror `STATUS_TABS`, param `?cc=`)
- **Edit pane** (`ExpenseReviewPane.tsx`): panel "สถานะใบกำกับ — ผิดตรงไหน" ด้านบน · toggle ขอคืนได้?+เหตุผล (section ยอดเงิน, gated accountant) · ปุ่มแนบใบทดแทน + override (เมื่อ ≠ เขียว) · โชว์ 2 รูปเมื่อมีใบทดแทน (`ReceiptThumb`)
- **Server actions:** `attachReplacementInvoice()` · `overrideClaimability()` (gate `isAccountant`/`can(expense.confirm)`) · `summarizeCompleteness()` query · ใช้ `zUUID()` ไม่ใช่ `.uuid()` (seed ids ไม่ RFC-strict)

---

## 6. TRCloud (เฟส 7, Should-have, แตะเบา ไม่ชน session อื่น)

- ผู้ซื้อ = บริษัทเราเอง = TRCloud company เอง → ไม่ใส่ใน `customer` block (นั่นคือผู้ขาย) · แค่ **กันไม่ให้ push ใบที่ buyerMatch≠matched** เข้า book ของเจพีซิ้งค์
- จุดเปลี่ยนสำคัญ = `tax_report` (ตอนนี้ hardcode `"1"` ใน `trcloud-push.ts:393`): claimable→"1" · ไม่ claimable→"0" + ลง VAT เป็นต้นทุน — **field จริงรอ Open#1** → ใส่ behind `FLAG_VAT_SPLIT`
- แตะ**เฉพาะ payload builder** ไม่แตะ `authFields/post/contact-product` ของ session TRCloud · CSV export เพิ่มคอลัมน์ buyer+claimable เป็น fallback ปลอดภัย

---

## 7. Test (`lib/ledger/__tests__/completeness.test.ts` — pure, ไม่ต้อง DB/AI)

- fixtures 20 ใบจริง (จาก `ParsedReceipt.raw`) + 2-3 ใบล่อ (ผู้ซื้อ = บริษัทเครืออื่น / เลขผิด 1 หลัก จาก 0305564001581)
- **Pass bar (hard gate):** ใบล่อทุกใบต้อง **RED 100%** (zero false-accept) · vat=0 ห้ามเขียว · ใบย่อ→เหลือง · ชื่อผิดแต่เลขตรง→ไม่แดง

---

## 8. Open items (block อะไร / build อะไรได้เลย)

**ขอจาก CEO (ไม่ block การเริ่ม build):**
1. **whitelist เลขภาษีเครือ** → ทำให้ R2 (ผิดบริษัทในเครือ) แม่น · ไม่มีก็ยัง RED (ปลอดภัย) แค่เหตุผลหยาบกว่า
2. **TRCloud field spec** (ช่องภาษีซื้อขอคืนไม่ได้) → gate เฉพาะ push split (เฟส 7) · CSV split ทำได้เลย
3. **เลขภาษีเจพีซิ้งค์ใน prod** (seed เป็น null) → migration backfill ให้

**Build ได้เลยทั้งหมด (core):** schema+migration · engine · buyer-verify · จุดสี · filter · summary · 2-bucket · replacement · override+audit · LINE card · CSV split · test harness

---

## 9. Risks / sequencing

- Migration idempotent + guard → ปลอดภัยทุกลำดับ apply, ไม่ชน `...180000`
- **2 จุด enum** (TS union types.ts + audit union log.ts) ลืม = build error (จับได้ตอน verify)
- **2 recheck path** (actions.ts + _actions.ts) ต้องเติม gradeCompleteness ทั้งคู่
- **Summary projection** ต้องเพิ่มคอลัมน์ใน `EXPENSE_SUMMARY_SELECT` + 2 serializers ไม่งั้นจุดสีว่าง
- **Parallel session:** จำกัดการแก้ TRCloud ที่ payload builder + flag เท่านั้น · build core (0–5) แยกอิสระจากเฟส 7
- หลัก anti-hallucination: ตัดสินที่เลข 13 หลักเสมอ ไม่ใช่ชื่อ/confidence

---

## ➡️ Next: CEO อนุมัติ → build (vertical slice เฟส 1 ก่อน หรือ `/bigfeature` ทีมใหญ่)
