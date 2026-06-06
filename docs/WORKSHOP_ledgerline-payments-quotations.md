# Workshop · LedgerLine — ใบเสนอราคา + สลิปจ่ายเงิน + กันจ่ายซ้ำ

> `/feature-workshop` (war-room 3-round) 2026-06-06 · **Status: APPROVED + building (PR1/PR2 done).**
> (สำเนาฉบับนี้เก็บใน worktree `claude/ledger-payments-quotations` หลังต้นฉบับใน main tree หายจาก parallel-session git op.)
> Sibling: WORKSHOP_ledgerline-tax-invoice.md (ใช้กลไก pending-doc/replacement ร่วมกัน · live แล้ว) · build plan: PLAN_ledgerline-payments-quotations.md

## ✅ CEO Decisions (locked)
- **D1 — ใบเสนอราคา = ค่าใช้จ่ายจริงทันที** (ได้ของ+จ่ายแล้ว) · ติดธง 🟡 "รอใบกำกับ" + กดยืนยันอีกรอบ · **ภาษีซื้อขอคืนไม่ได้** (inputVatClaimable=false) จนใบกำกับจริงมา. มี VAT (มียอด VAT 7% บนเอกสาร — D-NEW-2) → ตามใบจริง → **supersede (reuse `replacementOfId`)** → void ใบเสนอราคา (ไม่นับซ้ำ) → 🟢 + ขอคืนได้. ไม่มี VAT → ยืนยันยอดสุดท้าย → 🟢 จบ. **ไม่ใช้ status `committed`** (มันเป็น confirmed ปกติ นับยอด).
- **D2/D4 — สลิป + AUTO-MATCH v1 + กลุ่มสลิปเฉพาะ:** กลุ่ม LINE "ส่งสลิป" (กลุ่มที่ 2 บน OA เดิม · ตั้งใน /ledger/settings) ทุกรูป=สลิป → ถอด QR (transRef กันซ้ำ) + AI อ่านยอด 1 ครั้ง → **auto-match บิลค้างจ่าย (ยอด+ช่วงเวลาล่าสุด) → mark paid**. CEO รับ auto-match v1 ได้เพราะจ่ายวันต่อวัน/ทุก1-2ชม. (ยอด+เวลาแน่น) + safety net (บัญชีตรวจ + ส่งสลิปให้ supplier → ผิด supplier แย้ง). ambiguous/ไม่เจอ → "สลิปลอย" จับบนเว็บ. reply-to-bill ในกลุ่มสาขายังใช้ได้.
- **D3 — สถานะ = ป้าย TEXT-TAG** (สี่เหลี่ยม+ข้อความสั้น+สี · ไม่ใช่จุดสี · ไม่ emoji). เอกสาร/VAT: ไม่มี VAT(เขียว)/รอใบกำกับ(เหลือง)/ใบกำกับครบ(เขียว)/ขอคืนไม่ได้(แดง). จ่าย: จ่ายแล้ว(เขียว)/ยังไม่จ่าย(เทา)/บางส่วน(เหลือง)/⚠จ่ายซ้ำ?(แดง). reuse `<Badge tone>`. เปลี่ยนจุดสีของ tax-invoice feature เป็น tag นี้ด้วย.
- **D5 — ยกเลิก/เปลี่ยนใจไม่ซื้อ/ใบ error → delete-REQUEST approval** (ห้าม hard-delete). **REUSE flow จาก [[ledgerline-mobile-ux-workshop-2026-06-06]] D2** (ขอลบ→บัญชีอนุมัติ) · อย่าสร้างซ้ำ.
- **D-NEW-1=A** (ใบเสร็จ default paid · quotation default unpaid). **D-NEW-2** = ตรวจ "มี VAT" จากยอด VAT 7% บนเอกสาร (auto). **D-NEW-3** = อนุมัติติดตั้ง QR lib (jsqr+promptparse).

## 🔗 Integration (เชื่อมของเดิม)
totals/P&L กรอง status∈{confirmed,locked} แล้ว · reuse replacementOfId/gradeCompleteness/inputVatClaimable (จาก tax-invoice feature ที่ live) · TRCloud push guard กัน docType=quotation (company 31 ใช้ร่วม) · สลิป = ตารางใหม่ `ledger_payment` (RLS org · dup partial-unique index) · เงิน Decimal · ไม่ auto-post · query กรอง orgId+companyId (P0 lesson).

## 🧩 Spec (MoSCoW)
**Must v1:** quotation docType+แท็บ (นับยอด · 🟡รอใบกำกับ · VAT ขอคืนไม่ได้) + supersede · กลุ่มสลิป + auto-match + QR dup-block + AI-OCR ยอด + floating fallback · reply-to-bill · text-tag pills · mark-paid gated admin+บัญชี.
**Won't v1:** ซื้อ SlipOK/bank-verify · partial/split allocations · push quotation เข้า TRCloud.

## ➡️ Next: build PR3→PR5 (ดู PLAN doc). PR1(ฐาน)+PR2(อ่านสลิป+เช็คซ้ำ) ✅ done+verified.
