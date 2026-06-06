# Implementation Plan · LedgerLine — ใบเสนอราคา + สลิปจ่ายเงิน + กันจ่ายซ้ำ

> From `/feature-workshop` spec [[WORKSHOP_ledgerline-payments-quotations]] (APPROVED · D1/D2/D3) → architect plan (code-grounded) 2026-06-06.
> Status: **PLAN READY · รอ CEO ตอบ D-NEW-1/2/3 ก่อนเขียนโค้ด.** Effort ~10.5 dev-days · 5 PRs.

## Branch & flags
- **Base = current `origin/setup`** (`2afcc84` — already มี tax-invoice feature + mobile). branch `claude/ledger-payments-quotations` ใน worktree แยก.
- Flags (env): `LEDGER_QUOTATION_V1`, `LEDGER_SLIP_V1` (v2 reserved `LEDGER_SLIP_AUTOMATCH`). Migration ships un-flagged (additive); code paths flag-gated → flag-off = byte-equivalent to today.
- Helper `lib/ledger/flags.ts`.

## Code-grounded facts (verified)
- `gradeCompleteness()` = `lib/ledger/recheck.ts:197` · supersede = `attachReplacementInvoice()` `_actions.ts:552` · replacement self-relation `schema.prisma:5350-5366` (REUSE, 0 new link cols).
- TRCloud push choke point = `pushExpenseToTrcloud()` `trcloud-push.ts:359`, called only from `_actions.ts:1064/1095`. Company 31 SHARED.
- default-paid bug: `schema.prisma:5323` + `lib/ledger/actions.ts:237` (`?? "paid"`).
- colour DOT to replace = `components/ledger/_kit/CompletenessDot.tsx`; text-tag idiom already = `StatusBadge.tsx` on `<Badge tone>` (`components/ui/badge.tsx`).
- LINE webhook `app/api/webhooks/ledger/line/[channelId]/route.ts` — **ไม่มี `quotedMessageId` ที่ไหนเลย** → ต้อง wire ใหม่ (เก็บ `line_confirm_message_id` + อ่าน `sentMessages[].id` จาก LINE reply API).
- migrations อยู่ `supabase/migrations/` (template = `20260605210000_ledger_input_vat_claimability.sql`). **`status` เป็น Postgres enum → เพิ่มค่า `committed` ต้อง `ALTER TYPE ... ADD VALUE` แยก statement ก่อนใช้** (Postgres restriction).
- role gate money = `ledgerWebCanForRole(...,"expense.confirm")` (admin+accountant) = "super_admin+บัญชี" ที่ spec ต้องการ.
- totals/P&L sum `status in (confirmed,locked)` แล้ว → `committed` ถูกกันออกอัตโนมัติ.

## PR sequence

| PR | Goal | Key files | Flag | Days |
|---|---|---|---|---|
| **PR1 ✅ BUILT+VERIFIED** (tsc 0 · worktree `/private/tmp/pl-ledger-pay` · uncommitted) | Foundation: `ledger_payment` table + guard (พิสูจน์ "quotation push/นับซ้ำไม่ได้" ก่อนมี UI). **ปรับจากแผน:** ไม่ใช้ status `committed` (D1=ใบเสนอราคานับเป็นค่าใช้จ่ายจริง → เป็น confirmed ปกติ · "รอใบกำกับ"=docType=quotation+inputVatClaimable=false+void ตอน supersede) → migration additive ล้วน ไม่แตะ enum/default | `supabase/migrations/20260606120000_*` (`ledger_payment` table + RLS + partial-unique dup index + `line_confirm_message_id` col); `schema.prisma`; `_actions.ts` (push guard reject quotation ×2); `types.ts` (+quotation); `actions.ts` (quotation→unpaid) | OFF (safety) | 1.5 |
| **PR2 ✅ BUILT+VERIFIED** (tsc 0 · promptparse round-trip OK) | Slip QR decoder + dedup libs (pure, no UI). Deps via **pnpm** add jsqr+promptparse+sharp (pnpm canonical; package-lock.json stale/ignore) | `lib/ledger/slip-qr.ts` (`decodeSlipQr`: sharp→jsQR→promptparse slipVerify → {transRef,sendingBank} · **never throws** · amount from AI-OCR fallback later); `lib/ledger/slip-match.ts` (`checkSlipDuplicate` per-org transRef BLOCK + image silent-block; `checkFuzzyPaymentWarning` reuse dedup.ts WARN-only) | n/a | 2.0 |
| **PR3** | Quotation docType + `committed` + supersede (D1) | `ai-parse.ts` (normalizeDocType+prompt); `queries.ts` (docType/paymentStatus filter); `expenses/page.tsx` (tab); `_actions.ts` (`confirmQuotation`, `supersedeQuotation`=reuse replacement→**void quotation on supersede** กันนับซ้ำ; invariant: confirmExpense reject `committed`); `ExpenseReviewPane`+`AttachReplacementButton` | `LEDGER_QUOTATION_V1` | 2.5 |
| **PR4** | Reply-to-bill + mark-paid + dedup wiring (D2) | webhook `route.ts` (+`quotedMessageId`, slip branch, `replyFlex` return sent id); `_actions.ts` (`markBillPaid`/`markBillPaidCash`, P2002→"⚠จ่ายซ้ำ?" override); `LedgerExpense.line_confirm_message_id` | `LEDGER_SLIP_V1` | 3.0 |
| **PR5** | D3 text-tag pills (แทนจุดสี ทั้ง 2 มิติ + ของ tax-invoice ที่ live แล้ว) | `_kit/DocTag.tsx` + `PaymentTag.tsx` (on `<Badge tone>`); swap in `ExpenseList.tsx:365`, `ExpenseReviewPane`, `LineConfirmCard.tsx` | DocTag on · PaymentTag gated | 1.5 |
| | **รวม v1** | | | **~10.5** |

## Data model — `ledger_payment` (ตารางใหม่)
`id · org_id · company_id · matched_expense_id?(FK→ledger_expense SET NULL) · amount_satang(BigInt) · currency · method(transfer|cash|qr) · sending_bank? · trans_ref? · slip_sha256? · slip_url? · qr_raw? · qr_decoded(bool) · paid_at? · marked_by? · dup_override_by?/reason? · timestamps`
- `UNIQUE(org_id, sending_bank, trans_ref) WHERE trans_ref NOT NULL` = กันจ่ายซ้ำ (partial index idiom เดิม) · `UNIQUE(org_id, slip_sha256) WHERE NOT NULL` = silent same-image · RLS copy `ledger_trcloud_contact`.
- `LedgerExpense`: REUSE replacement + claimable/completeness fields · `payment_status` default→`unpaid` · enum +`committed` · NEW `line_confirm_message_id?` · (optional) `quotation_final_no_vat?`.

## Flows
**Slip (reply-to-bill v1):** reply สลิปบนการ์ดบิล → webhook อ่าน `quotedMessageId` → หา bill ด้วย `line_confirm_message_id` (ไม่เจอ=ตกเป็น capture ปกติ ไม่เดา) → rehost+sha256 → `decodeSlipQr` → gates: same-image=silent · transRef ซ้ำ=**BLOCK+override** · vendor+amount 7d=**WARN** → `markBillPaid` (satang, audit, **ไม่ push TRCloud**).
**Quotation (D1):** AI→docType quotation→draft → บัญชี confirm(1)→`confirmQuotation`(2nd)→`committed`+🟡รอใบกำกับ+claimable=false (นับเป็นค่าใช้จ่าย accrual แต่กันออก TRCloud/VAT) → มี VAT: ตามใบจริง→`supersedeQuotation`(reuse replacement, **void quotation**)→ใบกำกับครบ+claimable / ไม่มี VAT: ยืนยันยอดสุดท้าย→ไม่มี VAT(จบ). invariant: `committed`→`confirmed` ตรงๆ ไม่ได้.

## Test checklist (money)
wrong-match=ผูกบิลที่ reply เท่านั้น · dup-slip(silent) vs dup-transfer(block) vs monthly-same-amount-diff-ref(warn เท่านั้น) · supersede นับครั้งเดียว (quotation void) · VAT claimable timing · TRCloud guard reject committed/unpaid/quotation · default-flip ไม่ทำใบจริง push พลาด · decoder ไม่ throw (webhook ไม่ 500) · role gate · tags เป็น pill ทุกแถว.

## Deploy order + rollback
1) **apply migration prod ก่อน** (ส่งลิงก์ · enum `committed` เป็น statement แยกก่อนใช้) 2) merge PR1 (flag off) 3) PR2 4) PR3/4/5 flag off 5) เปิด `LEDGER_QUOTATION_V1` แล้ว `LEDGER_SLIP_V1` หลัง smoke-test 1 channel. **Rollback = ปิด flag** (code no-op · migration additive ไม่ต้อง down).

## ✅ CEO เคาะแล้ว (2026-06-06)
- **D-NEW-1 = A:** ใบเสร็จ (docType receipt) default `paid` · ใบเสนอราคา/ใบแจ้งหนี้/quotation default `unpaid` จนมีสลิป/กดจ่าย. → `lib/ledger/actions.ts:237` เขียนตาม docType.
- **D-NEW-2 = auto ด้วยยอด VAT 7%:** ตรวจ "มี VAT ไหม" จาก **ยอด VAT บนเอกสาร** (`expense.vat > 0` / ~7% ของ subtotal · OCR ดึงมาแล้ว) — มี VAT→ตามใบกำกับจริง (chase+supersede) · ไม่มี VAT→no-VAT-final (กดยืนยันยอดจบ). ไม่ต้องมีปุ่มกดเอง · ใช้ `vendorTaxId` เป็น hint รอง. → ไม่ต้องเพิ่ม column `quotation_final_no_vat` (derive ได้).
- **D-NEW-3 = อนุมัติ:** ติดตั้ง QR-decode lib (ฟรี open-source · server-side เท่านั้น) ใน PR2.
- Operational (ตามทีหลังได้): whitelist เลขภาษีเครือ (`GROUP_TAX_IDS`) · คำใน override "จ่ายซ้ำ".
