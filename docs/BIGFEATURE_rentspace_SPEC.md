# BIGFEATURE — RentSpace (ระบบบริหารโครงการร้านค้าเช่า)

> Pool module `rentspace` · slug `rentspace` · scoped `.rs-scope`
> Pilot: โครงการทะเลทาวน์ (commercial plaza, ~50 units A1/A2/A3 + ลานอีเว้นท์)
> Goal (CEO 2026-06-13): clone Horganice — ใช้งานจริง 100% ไม่มีบัค ครบทุกฟีเจอร์ user 9/10 + import ผู้เช่าจริงทั้งหมด + 3D map
> Pipeline: bigfeature(this) → auditbigteam → bigsolvebug → claude-design → leanux

## Goal lock

- **Feature:** RentSpace — บริหารพื้นที่เช่าเชิงพาณิชย์ (โครงการ → อาคาร → ห้อง → ผู้เช่า → สัญญา → บิล → ชำระ)
- **Who uses:** super_admin (เจ้าของ), admin (ผู้จัดการโครงการ), staff (จดมิเตอร์/รับชำระ), program_admin (rentspace-only)
- **Business goal:** เลิกพึ่ง Horganice (ค่าบริการรายเดือน) → เป็นระบบของเราเอง + ต่อยอดขาย SME
- **Success metric:** ออกบิลครบทุกห้องอัตโนมัติทุกเดือน 0 พลาด · จดมิเตอร์→บิล ไม่ต้องคีย์ซ้ำ · เห็นห้องค้างจ่ายทันทีจากผัง
- **Touches:** Pool core (users/companies/audit). ใหม่หมด standalone — ไม่แตะ ledger/cashhub/hotelbook
- **Mode:** new module
- **Company:** project.companyId nullable (ทะเลทาวน์ ไม่ผูก POOIL/JPSYNC โดยตรง — scope by orgId)

## Project consistency requirements (13-persona lens, compressed)

- **SA/QC:** Prisma models `RentalXxx` → `@@map("rental_xxx")` `@@schema("public")` · UUID id · `Decimal(15,2)` money · `orgId` ทุกตาราง · createdAt/updatedAt Timestamptz(6) · soft via `isActive` (ไม่มี deletedAt)
- **SA:** migration → `supabase/migrations/<ts>_*.sql` apply มือ (psql DIRECT_URL 5432) · regen `npx prisma generate`
- **UI:** scoped `.rs-scope` + `components/rentspace/tokens.css` (mirror `.ch-scope` palette) · sticky thead `top-14 sm:top-16 z-20` solid bg · mobile `px-4 py-6 sm:px-8` `max-w-6xl`
- **Auth (role-rank/module-entitlement):** layout `assertModuleEnabled("rentspace")` · add slug to `lib/modules.ts` ModuleSlug + MODULES + user_modules CHECK migration + org_modules row · admin-tier fast-path
- **super_admin-only:** การตั้งค่าโครงการ/เรต/เทมเพลตสัญญา + เชื่อมต่อภายนอก = super_admin (per [[ledgerline-superadmin-only-connection-gating-2026-06-12]])
- **Audit:** ทุก destructive/financial op → `audit({orgId,userId,action:"RENTSPACE_...",resourceType,resourceId,diff})`
- **CSV import (per [[pool-csv-import-must-diff-before-write]]):** parse → diff (new/same/changed/error) → preview → commit · idempotent upsert by natural key
- **Doc numbering (race-safe per [[ledgerline-arch-review-86fixes]]):** `@@unique` + retry-on-collision · ไม่ใช่ count(*)+1
- **Cron idempotency (per RULE I):** auto-bill `@@unique([contractId, period])` → re-run = no-op
- **DevilsAdvocate/QA risks:** ดู §Risks ล่าง

## Data model (14 tables)

1. **RentalProject** — โครงการ. id, orgId, companyId?, name, slug, address, description, planImageUrl, view3dEnabled, electricRate Decimal, waterRate Decimal, lateFeeType, lateFeeValue, lateFeeGraceDays, billDueDay, vatEnabled, isActive, ts. (rate/late-fee/due = ค่า default ของโครงการ override ได้ที่สัญญา)
2. **RentalUnit** — ห้อง. id, orgId, projectId, code(A1), name(SHABU ZEED), building(A1/A2/A3), floor, zone, areaSqm?, baseRentThb, status(vacant/occupied/reserved/inactive), mapX,mapY,mapW,mapH (2D plan %), mapColor, sortOrder, isActive, ts. @@unique([projectId, code])
3. **Tenant** — ผู้เช่า. id, orgId, prefix, firstName, lastName, nickname, bizName(ชื่อร้าน), phones String[], idCardNo, birthDate?, nationality, taxId?, address, email?, facebook?, lineId?, idCardUrl?, docUrls String[], note, isActive, ts.
4. **ContractTemplate** — เทมเพลตสัญญา. id, orgId, name, bodyHtml(มี {{placeholder}}), isDefault, isActive, ts.
5. **RentalContract** — สัญญา. id, orgId, projectId, unitId, tenantId, contractNo(unique), templateId?, startDate, endDate?, rentAmountThb, rentDueDay, depositAmountThb, depositMonths, vatPercent, lateFeeType, lateFeeValue, lateFeeGraceDays, electricRate?, waterRate?, rentSchedule Json?(escalation), customTermsHtml?, status(draft/active/expiring/expired/terminated), signedAt?, tenantSigned bool, signatureDataUrl?, signerName?, contractPdfUrl?, note, createdBy, ts. @@unique([orgId, contractNo])
6. **DepositMovement** — เงินประกัน. id, orgId, contractId, kind(collect/refund/deduct/forfeit), amountThb, occurredOn, method, slipUrl?, note, createdBy, ts.
7. **Meter** — มิเตอร์. id, orgId, unitId, kind(electric/water), meterNo?, initialReading Decimal, isActive, ts. @@unique([unitId, kind])
8. **MeterReading** — จดเลข. id, orgId, unitId, meterId, kind, period(YYYY-MM), prevReading, currReading, usage, ratePerUnit, amountThb, photoUrl?, note, readBy, readAt, ts. @@unique([meterId, period])
9. **RentalBill** — บิล/ใบแจ้งหนี้. id, orgId, projectId, unitId, contractId, tenantId, billNo(INV-YYYYMM-NNNN unique), period(YYYY-MM), issueDate, dueDate, status(draft/issued/partial/paid/overdue/void), rentAmount, electricAmount, waterAmount, otherAmount, lateFeeAmount, discountAmount, subtotal, vatAmount, totalAmount, paidAmount, note, pdfUrl?, createdBy, ts. @@unique([contractId, period]) (idempotent auto-bill) · @@unique([orgId, billNo])
10. **RentalBillItem** — รายการในบิล. id, billId, kind(rent/electric/water/late_fee/discount/other), label, qty, unitPrice, amount, sort.
11. **RentalPayment** — ชำระเงิน. id, orgId, billId, contractId, amountThb, paidOn, method(cash/transfer/qr/card), reference?, slipUrl?, note, receivedBy, ts.
12. **DiscountRequest** — ขอ/อนุมัติส่วนลด. id, orgId, billId, kind(amount/percent), value Decimal, computedAmount, reason, status(pending/approved/rejected), requestedBy, decidedBy?, decidedAt?, decisionNote?, ts. (discount apply กับบิลเฉพาะหลัง approved)
13. **RentalDocument** — เอกสารแนบทั่วไป (สัญญาสแกน/บัตร/รูป). id, orgId, ownerType(tenant/contract/unit), ownerId, label, url, mime, sizeBytes, uploadedBy, ts.
14. **RentalSettings/RateOverride** — (รวมใน RentalProject + RentalContract override; ไม่ต้องตารางแยกใน MVP)

Enums (snake_case, @@schema public): RentalUnitStatus, RentalContractStatus, RentalBillStatus, MeterKind, DepositKind, DiscountStatus, LateFeeType(fixed/percent_total/per_day), DiscountKind.

## Routes (app/(admin)/rentspace/)

- `/rentspace` — ภาพรวม: KPI (ห้องเช่า/ว่าง · ค้างจ่าย · รายได้เดือนนี้) + ผังโครงการ interactive (2D + toggle 3D isometric) คลิกห้อง→drawer
- `/rentspace/units` — รายการห้อง + จัดการ (super_admin) + วางตำแหน่งบนผัง
- `/rentspace/units/[id]` — รายละเอียดห้อง: ผู้เช่า · สัญญา · มิเตอร์ · บิล · ประวัติชำระ (เหมือนแท็บ Horganice)
- `/rentspace/tenants` + `/rentspace/tenants/[id]` — ทะเบียนผู้เช่า + เอกสาร
- `/rentspace/contracts` + `/[id]` — สัญญา + ทำสัญญาใหม่ (เลือก template) + เซ็นออนไลน์ + PDF
- `/rentspace/contracts/templates` — จัดการเทมเพลต (super_admin)
- `/rentspace/meters` — หน้ารวมจดมิเตอร์ (ตารางทั้งโครงการ กรอกเลข + รูป)
- `/rentspace/bills` + `/[id]` — บิล + ออกบิล (manual + รอ cron) + PDF + อนุมัติส่วนลด
- `/rentspace/payments` — บันทึก/ประวัติการชำระ + แนบสลิป
- `/rentspace/import` — นำเข้าผู้เช่า/ห้องจาก CSV (diff-before-write)
- `/rentspace/settings` — ตั้งค่าโครงการ/เรตน้ำไฟ/ค่าปรับ/วันครบกำหนด/VAT (super_admin)
- `/sign/rentspace/[token]` — public e-sign สัญญา (ผู้เช่าเซ็นออนไลน์ ไม่ต้อง login)
- API: `/api/cron/rentspace-monthly-bills` (Bearer CRON_SECRET, "0 1 1 * *"), `/api/rentspace/import`

## Auto-billing logic (cron 1st of month)

For each `active` contract whose project bills this month:
1. period = current YYYY-MM. Skip if Bill(contractId, period) exists (idempotent).
2. rent = effective rentAmount (apply rentSchedule escalation by date).
3. electric/water = latest MeterReading(period) → usage × rate (ถ้ายังไม่จด → 0, flag "รอจดมิเตอร์").
4. lateFee = ถ้ามีบิลก่อนหน้า status overdue → ตามสูตร contract.
5. create RentalBill(status=issued/draft per setting) + items. dueDate = issueDate + due rule.
6. audit RENTSPACE_BILL_AUTO_CREATED. Telegram/log summary.

## Acceptance criteria (BA)

- เพิ่มห้อง+ผู้เช่า+สัญญา → ออกบิลเดือนนี้ได้ → บันทึกชำระ → สถานะ paid → เห็นในประวัติ
- จดมิเตอร์ทั้งโครงการหน้าเดียว กรอกเลข+แนบรูป → คำนวณหน่วย×เรตอัตโนมัติ → เด้งเข้าบิล
- คลิกห้องบนผัง → เห็นผู้เช่า/สัญญา/ค้างจ่าย ทันที · ห้องค้างจ่าย=แดง ว่าง=เทา ปกติ=เขียว
- ทำสัญญาจาก template → ส่งลิงก์เซ็น → ผู้เช่าเซ็นออนไลน์ → ได้ PDF
- ขอส่วนลด → super_admin/admin อนุมัติ → ยอดบิลลด (ก่อนอนุมัติ=ไม่ลด)
- import CSV ผู้เช่าจริง 30+ ราย → preview diff → commit ครบ ไม่ซ้ำ
- ทุกหน้าใช้บนมือถือได้ · gate ถูก role · destructive ops มี audit

## Risks (DevilsAdvocate + PM, ranked)

1. **3D map over-scope** → MVP = interactive 2D plan (clickable, status color) + CSS-3D isometric view (preserve-3d, no Three.js) = "3D สวย" ที่ไม่มีบัค/ไม่อืด. Full Three.js = phase 2 ถ้า CEO ต้อง.
2. **Auto-bill double/missing** → @@unique([contractId,period]) + cron idempotent + manual "ออกบิล" fallback.
3. **Doc-number race** → unique constraint + retry, ไม่ใช่ count+1.
4. **Migration not applied to prod** (per postmortem) → write SQL + verify via psql + แจ้ง CEO ลิงก์ Supabase.
5. **e-sign legality** → MVP = signature image + timestamp + audit trail (เพียงพอเชิงพาณิชย์ภายใน) ไม่ใช่ digital cert.
6. **VAT/หัก ณ ที่จ่าย** → รองรับ vatPercent ต่อสัญญา; ไม่ดัน TRCloud ใน MVP (manual).

## Build order

schema → module-register → tokens/layout → data-layer → units+map → tenants → contracts+templates+esign → meters → bills+cron → payments+discount → import real data → 3D → pipeline skills → verify+deploy.
