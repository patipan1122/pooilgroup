# PLAN · LedgerLine — โมดูลบัญชี/ใบเสร็จ ใน Pooilgroup

> โครงสร้าง + แผนสร้าง (pre-code) · 2026-06-02 · slug = `ledger`
> Source of truth ก่อนหน้า: `docs/WORKSHOP_jplink-accounting.md` · memory [[jplink-uses-trcloud-2026-06-02]] [[thai-receipt-ocr-research]] [[bainy-competitor-reference-2026-06-02]]
> Status: **Draft — รอ CEO อนุมัติเริ่ม Phase 1**

---

## 0. สรุปการตัดสินใจที่ล็อกแล้ว (กันลืม)
- **เป็นโมดูลใน Pooilgroup** (pooilgroup-web) เหมือน cashhub/chairops/inbox — ไม่ standalone, ไม่ Buildly Go
- **COMPLEMENT TRCloud** (เสริม ไม่แทน) — capture+จัดข้อมูล แล้ว **export เข้า TRCloud** (book of record เดิม)
- **Phase 1 = ค่าใช้จ่ายอย่างเดียว** (รายรับ/AR ไว้ v2)
- **2 บริษัท หลายสาขา** → `org_id` + `company_id` + `branch_id` ทุกตารางตั้งแต่ migration แรก
- **บัญชี 1 คนเป็นผู้ยืนยัน** · staff ถ่าย · CEO ดู dashboard
- **OCR = Gemini 3.1-flash-lite (หลัก) → escalate Claude/Gemini-pro** (เคสยาก) · **สลิป = SlipOK QR-verify** (ไม่ใช่ OCR)
- **ห้าม auto-post — คนยืนยันก่อนเสมอ** + **Recheck (บวกยอดเช็ก)** ก่อนเซฟ (บทเรียนจาก ILikeTax)
- **VAT = คำนวณจากยอด+สถานะผู้ขาย / เลขภาษี+ชื่อ = จากทะเบียนผู้ขาย** (ไม่พึ่ง OCR — สไปก์ยืนยันแล้ว)
- **เก็บไฟล์: ต้นฉบับ → Google Drive (2TB ของ CEO) · ข้อมูล → Supabase · thumbnail → R2** (Drive = Phase 1.5 เพราะต้องตั้ง OAuth ครั้งแรก; Phase 1 ใช้ R2 ไปก่อนเพื่อให้ ship เร็ว)

---

## 1. สถาปัตยกรรมภาพรวม

```
[หน้างาน/สาขา]  ถ่ายสลิปในกลุ่ม LINE ──┐
[หลังบ้าน]      อัปหลายไฟล์ผ่านเว็บ ─────┤
                                          ▼
                         (1) เก็บรูป + จับชนิด (สลิป? ใบเสร็จ?)
                                          │
                  สลิปมี QR ──► SlipOK verify (แม่น ~100%, ไม่ใช้ AI)
                  ใบเสร็จ   ──► Gemini 3.1-flash-lite (เคสยาก→escalate)
                                          ▼
                  (2) validator + Recheck (เลขภาษี13หลัก · ยอดย่อย+VAT=รวม · บวกยอดเช็ก)
                                          ▼
                  (3) การ์ดใน LINE / ตารางในเว็บ → "คนยืนยัน/แก้" (บัญชี)  ◄── ห้าม auto-post
                                          ▼
                  (4) บันทึก Supabase (org+company+branch, RLS) + รูปต้นฉบับ(Drive/R2) + thumbnail(R2)
                                          ▼
                  (5) Dashboard + ตรวจซ้ำ + งบเตือน + Export CSV/ฟอร์แมต → TRCloud
```

---

## 2. แผนที่ "reuse vs สร้างใหม่" (ของมีอยู่แล้วเยอะมาก)

| ชิ้นส่วน | มีอยู่แล้ว (reuse) | ไฟล์อ้างอิง |
|---|---|---|
| **AI OCR (Gemini+Claude) + budget guard** | ✅ **มีแล้ว!** CashHub ใช้ Gemini Vision อ่านสลิปอยู่แล้ว | `app/api/cashhub/ocr-slip/route.ts` · `app/api/cashhub/ai/route.ts` · `lib/ai/cost-cap.ts` (`ai_usage` table) |
| **LINE omnichannel (webhook+HMAC+เข้ารหัส token+rehost รูป→R2)** | ✅ | `app/api/webhooks/inbox/line/[channelId]/route.ts` · `lib/recruit/channel-crypto.ts` · `lib/inbox/crypto.ts` |
| **R2 เก็บรูป + presign + key naming** | ✅ | `lib/r2/client.ts` · `lib/chairops/storage/r2.ts` |
| **Auth/session/role + RLS + multi-company/branch** | ✅ | `lib/auth/session.ts` · `lib/auth/role-guards.ts` · `lib/auth/module-access.ts` · RLS `current_org_id()` |
| **Module registry + nav + entitlement** | ✅ | `lib/modules.ts` (เพิ่ม slug `ledger`) |
| **Recheck (บวกยอดเช็ก)** | บทเรียนจาก ILikeTax → สร้างเอง (เบาๆ) | ใหม่ |
| **SlipOK QR-verify สลิป** | ต้องต่อใหม่ (มี key) | ใหม่ |
| **ตาราง ledger_* + dashboard + export** | สร้างใหม่ | ใหม่ |
| **Google Drive sync ต้นฉบับ** | ยังไม่มีในโค้ด (Phase 1.5) | ใหม่ |

> 🎯 **ของจริงที่ต้องเขียนใหม่มีแค่:** ตาราง ledger + prompt อ่านใบเสร็จ + Recheck/validator + หน้าจอ (LINE card + เว็บตาราง multi-pane) + export TRCloud + (1.5) Drive sync. **ที่เหลือ reuse หมด**

---

## 3. โครงสร้างไฟล์ (วางตรงแพทเทิร์น Pool)

```
lib/modules.ts                         # + เพิ่ม "ledger" ใน ModuleSlug + MODULES

prisma/schema.prisma                   # + models: LedgerExpense, LedgerExpenseItem,
                                       #   LedgerCategory, LedgerBudget, LedgerLineChannel, LedgerExportBatch

supabase/migrations/
  20260602xxxxxx_ledger_module_init.sql  # tables + RLS (current_org_id) + RPC เลขที่เอกสาร + indexes

app/(admin)/ledger/
  layout.tsx                           # assertModuleEnabled("ledger") + เลือกบริษัท/สาขา
  page.tsx                             # หน้าหลัก (KPI ย่อ)
  dashboard/page.tsx + _components/    # รายจ่ายตามหมวด/สาขา/เดือน + งบ
  expenses/page.tsx + _components/     # ตาราง multi-pane: list ซ้าย + รูป+ฟอร์มแก้ ขวา + bulk-confirm
  budgets/page.tsx                     # ตั้งงบรายหมวด + เตือนเกิน
  settings/page.tsx                    # ผูกกลุ่ม LINE · ตั้งค่าบริษัท/สาขา/หมวด · export config

app/api/ledger/
  ocr/route.ts                         # POST รูป → reuse cost-cap → Gemini → JSON + confidence
  expenses/route.ts                    # CRUD (server actions ก็ได้)
  slip-verify/route.ts                 # POST → SlipOK QR verify
  export/route.ts                      # GET → CSV/ฟอร์แมต TRCloud
  r2/presign/route.ts                  # presign อัปรูป

app/api/webhooks/ledger/line/[channelId]/route.ts   # รับรูปจากกลุ่ม LINE (reuse inbox pattern)

lib/ledger/
  types.ts                             # Expense, ExpenseItem, ParsedReceipt, Confidence
  queries.ts                           # Prisma scope org_id+company_id+branch_id (+ React cache)
  actions.ts                           # server actions: create/confirm/void/export
  ai-parse.ts                          # เรียก OCR (reuse lib/ai/cost-cap) + prompt ใบเสร็จไทย
  recheck.ts                           # validator: 13หลัก · ยอดย่อย+VAT=รวม · บวกยอดเช็ก
  slipok.ts                            # client SlipOK
  trcloud-export.ts                    # map → ฟอร์แมต TRCloud
  storage.ts                           # R2 (P1) / Drive (P1.5) + thumbnail + dedup(sha256)

components/ledger/
  _kit/ (StatusBadge, AmountInput, ConfidenceTag)
  ExpenseReviewPane.tsx · ReceiptThumb.tsx · LineConfirmCard.tsx (flex)
```

---

## 4. Data model (Phase 1)

```mermaid
erDiagram
  LEDGER_EXPENSE ||--o{ LEDGER_EXPENSE_ITEM : has
  LEDGER_CATEGORY ||--o{ LEDGER_EXPENSE : classifies
  LEDGER_BUDGET }o--|| LEDGER_CATEGORY : caps
  LEDGER_LINE_CHANNEL ||--o{ LEDGER_EXPENSE : source
  LEDGER_EXPORT_BATCH ||--o{ LEDGER_EXPENSE : includes
  LEDGER_EXPENSE {
    uuid id  uuid org_id  uuid company_id  uuid branch_id
    string doc_code  string status "draft|confirmed|locked|void"
    string source "line|web|email"
    string vendor  string vendor_tax_id  date doc_date
    money subtotal  money vat  money wht  money total
    uuid category_id  string payment_method
    string original_url "Drive/R2"  string thumb_url "R2"  string sha256 "dedup"
    string ocr_model  jsonb ocr_confidence  string slip_ref
    uuid created_by  uuid confirmed_by  timestamptz created_at confirmed_at
  }
```
- ทุกตาราง: `org_id` + `company_id` + `branch_id` · RLS `org_id = current_org_id()` · unique `(org_id, company_id, doc_code)`
- RPC `ledger_next_doc_code(org, company, branch)` (แพทเทิร์นเดียวกับ `repair_next_ticket_code`)
- `status` lock: staff แก้ `draft` ได้ · `confirmed/locked` แก้ได้เฉพาะบัญชี + เก็บ audit

## 5. Roles (reuse module-access)
- **staff** = ถ่าย/อัป + แก้ draft (ยอด/หมวด) · ไม่เห็นรายงานรวม
- **accountant** = ยืนยัน/แก้/lock + export · เห็นทั้งบริษัทที่ดูแล
- **CEO/admin** = ดู dashboard ทุกบริษัท (read) + ตั้งค่า
- gate: `assertModuleEnabled("ledger")` + role ใน nav + RLS per company

---

## 6. Phases

**Phase 1 — MVP (capture→confirm→export):** module registry+nav · migration ledger_* · LINE webhook รับรูป (reuse inbox) · OCR ใบเสร็จ (reuse CashHub Gemini+cost-cap) · validator+Recheck · การ์ดยืนยันใน LINE + ตาราง multi-pane เว็บ · เก็บ R2+Supabase · dedup · **export CSV เข้า TRCloud** · 2 บริษัท+สาขา+roles. *(เก็บใน R2 ก่อนเพื่อ ship เร็ว)*

**Phase 1.5 — Drive + งบ:** Google Drive sync ต้นฉบับ (ใช้ 2TB, จัดตามบริษัท/เดือน) + thumbnail R2 · งบรายหมวด+เตือน · dashboard เต็ม

**Phase 2 — สลิป + ลดงานคน:** SlipOK QR-verify สลิปโอน · Gmail/อีเมลดูดใบเสร็จ (แบบ Paypers) · ใบแทนใบเสร็จ (substitute) · export ฟอร์แมต TRCloud เป๊ะ/API

**Phase 3 — template เอกสารซ้ำ (บทเรียน ILikeTax):** template อ่านเอกสาร layout ตายตัวที่มาประจำ (เช่น invoice ซัพพลายเออร์น้ำมันเจ้าเดิม) แทน Gemini เพื่อแม่น+ถูก · (เอกสาร statement/ภาษีทั่วไป → แนะนำใช้ ILikeTax ฟรีแบบ manual ไม่ต้องสร้างเอง)

---

## 7. ⚠️ ก่อนเริ่ม Phase 1 — CEO/ของที่ต้องเตรียม
1. **ยืนยัน slug `ledger` + ชื่อโชว์** ("LedgerLine" / "บัญชี-ใบเสร็จ")
2. **ฟอร์แมต import ของ TRCloud** (CSV คอลัมน์อะไร / มี API import ไหม) — ตัวกำหนด export
3. **รายชื่อสาขาจริง 2 บริษัท** + ชุดหมวดค่าใช้จ่าย (ให้ map กับ TRCloud)
4. **SlipOK/EasySlip key** (Phase 2) · **Google OAuth** สำหรับ Drive (Phase 1.5)
5. เพิ่ม pricing `gemini-3.1-flash-lite` ใน `lib/ai/cost-cap.ts`

## 8. FULL PROJECT SCOPE (locked 2026-06-02 — clone Bainy fully, whole-project plan)

CEO ตัดสินใจ: วางทั้งโปรเจกต์ก่อน (ไม่ใช่ MVP เฟสเดียว) · ก๊อปฟีเจอร์ Bainy ให้ครบ

**ทำ (IN):** รายจ่ายเท่านั้น · LINE central group + web upload + **Gmail auto-ingest (กรอง→คนยืนยัน)** · Gemini OCR + **SlipOK เช็คสลิป** + Recheck/validator + คนยืนยัน (ห้าม auto-post) · **3-ชั้น Company→Branch→Category** + auto-categorize · **งบรายหมวด+เตือน** · Dashboard + **AI business-insights** · **Q&A ใน LINE** (เหมือน Bainy) · เอกสาร **PV/JV/PCV + ใบแทนใบเสร็จ** · **Google Drive (folder ราย เดือน, รูป+Excel)** + Supabase + thumbnail R2 · **export เข้า TRCloud ผ่าน API** · 2 บริษัท (เริ่ม เจพีซิ้งค์ 45) · roles 3-tier (staff/accountant/CEO)

**ไม่ทำ (OUT):** รายรับ/AR · RV(ฝั่งรับ) · แทนที่ TRCloud · e-Tax/ยื่นภาษีเอง · งบการเงิน audit-grade · สร้าง template 26 ชนิดแข่ง ILikeTax

**Users:** บัญชี 2-3 คน (ยืนยัน) + พนักงานหน้างาน/ขาย ~6 คน (ถ่าย) + CEO (ดู)

**หมวดค่าใช้จ่ายตั้งต้นที่เสนอ (เจพีซิ้งค์ กรุ๊ป — แก้ได้):** เงินเดือน/ค่าแรง · ค่าวัตถุดิบ/สินค้า · ค่าเช่า · ค่าน้ำ-ไฟ-เน็ต · ค่าน้ำมัน/ขนส่ง · ค่าการตลาด/โฆษณา · ค่าซ่อมบำรุง · อุปกรณ์/เครื่องใช้สำนักงาน · ค่าบริการ/ค่าธรรมเนียม · ภาษี/ค่าธรรมเนียมราชการ · ค่ารับรอง · เบ็ดเตล็ด/จิปาถะ

## 9. TIMELINE ทั้งโปรเจกต์ (ประมาณการ)

| Milestone | ได้อะไร | เวลา (ประมาณ) |
|---|---|---|
| **M0 · ฐานราก** | scaffold module + DB (3-ชั้น) + RLS + roles + เจพีซิ้งค์+สาขา+หมวด + ตั้งค่า | ~3-4 วัน |
| **M1 · แกนหลัก (spine)** | LINE group รับรูป + web upload + Gemini OCR (reuse CashHub) + Recheck + คนยืนยัน (LINE card + เว็บ multi-pane) + Drive(รายเดือน,รูป+Excel)+Supabase + dedup | ~1 สัปดาห์ |
| **M2 · จัดระเบียบ+รายงาน** | 3-ชั้น categories + auto-categorize + งบ+เตือน + Dashboard + **export เข้า TRCloud (API)** | ~1 สัปดาห์ |
| **M3 · ลูกเล่นแบบ Bainy** | Q&A ใน LINE + AI insights + Gmail auto-ingest + SlipOK + เอกสาร PV/JV/PCV+ใบแทนใบเสร็จ | ~1-1.5 สัปดาห์ |
| **M4 · ตรวจ+pilot+ขยาย** | /bigsolvebug + /auditbigteam + security/RLS review + pilot จริงกับบัญชี+หน้างาน → ขยายบริษัทที่ 2 | ~3-5 วัน |
| **รวม** | | **~4-5 สัปดาห์** |

**Dependencies จาก CEO (กั้น M0/M1):** สร้าง LINE OA ใหม่ · ตั้ง Google OAuth (Drive) · ยืนยัน TRCloud มี API สร้าง AP (create endpoint) · ส่งรายชื่อสาขา 2 บริษัท

## 10. Next
- รอ CEO เคาะ timeline → จากนั้นเริ่ม M0
- หมายเหตุ: spec เดิม `WORKSHOP_jplink-accounting.md` ถูก consolidate มาที่ไฟล์นี้ (full scope + timeline)
