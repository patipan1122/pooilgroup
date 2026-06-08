# LedgerLine — Design (v2) vs Live Implementation Audit
**Date:** 2026-06-08 · **Skill:** /claude-design (review mode, read-only) · 4 parallel comparison agents
**Design:** `/tmp/ld2/untitled/project/*.jsx` (CEO v2 handoff `1Cf4YQlEmAmO7F_QlRizRg`) · **Impl:** `pooilgroup-web` (prod = setup)

> Headline: the live app is a **real DB-backed, multi-tenant, race-proof, role-gated** rebuild — on data-correctness/permissions/money-safety it is *ahead* of the prototype. The remaining debt is concentrated in: **price popup** (~40% of design), **reconcile view** (no slip-vs-request diff column, LIFF-only detail), **LINE in-chat actions** (deliberate trade-off), and **2 dashboard tax KPIs**.

## Legend: ✅ done · 🟡 partial · ❌ not done · ⛔ can't-do / intentionally different

---

## 1. หน้ารายจ่าย — List / Filter / Card
✅ 5 status tabs (รอตรวจ/รอยืนยัน/ยืนยันแล้ว/ส่ง TRCloud/ทั้งหมด) w/ DB-accurate counts · ✅ single ตัวกรอง popover · ✅ source/cc/หมวด filters · ✅ search · ✅ เรียงลำดับ (date/amount, desktop+mobile) · ✅ cleaner card (source dot, category chip, status) · ✅ per-row hover ขอโอน · ✅ bulk bar (ยืนยัน/ส่ง/ลบ/ขอโอนรวม/ตั้งหมวด-สาขา)
🟡 branch filter lives on header (not in popover) · 🟡 search needs submit button (not live) · 🟡 issues shown as discrete chips not "N" badge · 🟡 missing-category shows amber warning not clickable "ตั้งหมวด" pill
❌ **J/K/↑↓ nav + Enter-confirm + `/`-search** (the prototype's speed thesis) · ❌ account-code chip beside category

## 2. หน้ารายละเอียดใบ (detail pane)
✅ ลงบัญชี (หมวด/สาขา) ขึ้นบนสุด · ✅ required-field red flagging · ✅ editable line items (+/−, auto-calc) · ✅ VAT summary (editable) + recheck · ✅ 3-slot evidence + เปิด Google Drive · ✅ red ม.86/4 banner (ย้ายลงล่างติดปุ่ม — ตั้งใจ) · ✅ sticky footer (ขอลบ/ขอโอน/บันทึกร่าง/ยืนยัน + disabled-when-incomplete) · ✅ "ประวัติผู้ขายรายนี้" button · ✅ ภาษีซื้อ override toggle (เกินดีไซน์)
🟡 line items collapsed in accordion (design open) · 🟡 evidence slot 2 (สลิป) = placeholder→reconcile, ไม่ render สลิปจริง/แนบใหม่ในใบ · 🟡 ที่อยู่ผู้ขาย = input (design textarea) · 🟡 ออกใบสำคัญจ่าย = print-tab (design = in-app preview+PDF)
❌ **per-line-item price chip (▲/▼%)** → popup รายสินค้า · ❌ "N รายการราคาสูงกว่าปกติ" banner · ❌ เบอร์ติดต่อ/เงื่อนไขชำระ ผู้ขาย · ❌ "AI อ่านใหม่/เพิ่มหน้า" buttons under receipt

## 3. popup ดูราคา/ประวัติผู้ขาย  ← **debt ใหญ่สุด (~40% ของดีไซน์)**
✅ popup เปิดจากใบ (vendor button) · ✅ ราคาล่าสุด + tint แพง/ปกติ + ประวัติซื้อ (vendor/date/price) · ✅ responsive (มือถือ bottom-sheet)
🟡 verdict มีแต่ tint ไม่มี %-ตัวเลข/Δ-จากครั้งก่อน
❌ **2 แท็บ "ตามชื่อสินค้า / ตามผู้ขาย"** (impl = view เดียวแบน) · ❌ **เทียบผู้ขายอื่น "ถูกสุด"** (สินค้าเดียวกันหลายเจ้า — team comment ชัด) · ❌ sparkline · ❌ per-item chip trigger · ❌ ไม่ mount ในหน้าสมุดค่าใช้จ่าย (มี search แทน)

## 4. หน้ากระทบยอด (reconcile)
✅ 4 KPI cards (count+total, click=filter) · ✅ status pills (6 states) · ✅ row → ขยาย (bills + audit + ดูสลิป + ยกเลิก) · ✅ export · ✅ month filter (เกินดีไซน์)
🟡 KPI card #3 = "จ่ายบางส่วน" (design = "มีผลต่าง") · 🟡 single-branch + vendor text-search (design = **multi-select**) · 🟡 detail = inline accordion (design = drawer)
❌ **"ยอดขอโอน vs ยอดในสลิป + ผลต่าง (โอนเกิน/ขาด)" column/tab** (CEO ขอชัด — logic อยู่ที่ slip-intake แต่ไม่โชว์บนหน้า) · ❌ desktop drawer (copy บัญชี / ดู QR / บิล+สลิปคู่กัน / timeline = LIFF-only) · ❌ sort control · ❌ "remembered" autofill hint
⛔ "กระทบยอด (รับผลต่าง)" button — ตั้งใจแทนด้วย exact-match-or-flag (ปลอดภัยกว่า)

## 5. ขอโอน modal + QR
✅ trigger per-row/bulk · ✅ payee autofill จากประวัติจริง · ✅ name/bank/acct/promptpay · ✅ **แนบรูป QR จริง** (R2→card→LIFF) · ✅ batch รวมหลายใบ + same-vendor guard · ✅ anti-double-request (partial-unique) · ✅ QR พร้อมเพย์จริง (LIFF, promptparse) · ✅ copy บัญชีจริง (LIFF)
🟡 dialog ไม่โชว์ยอดสรุป + แก้ยอดโอนไม่ได้ (design แก้ได้) · 🟡 ไม่มี success-panel celebratory
⛔ "สร้าง QR จากเลขบัญชี" — เป็นไปไม่ได้ (PromptPay ต้องพร้อมเพย์) → omit ถูกต้อง · ⛔ copy button ในการ์ด LINE — LINE flex ไม่มี clipboard → ใช้ text กดค้าง (ถูกต้อง)

## 6. LINE bot
✅ การ์ดใบเสร็จ (mascot/amount/meta/ยืนยัน-แก้ไข) · ✅ multi-photo carousel (เกินดีไซน์) · ✅ "จด ค่ากาแฟ 45" → ร่าง · ✅ ขอโอน card (push, NET-of-WHT, bills) + QR image inline · ✅ slip-scan (over/under/payee-mismatch + dup guard — เกินดีไซน์)
🟡 VAT-can't-claim warning ไม่ขึ้นบนการ์ด (อยู่บนเว็บ) · 🟡 "ยังไม่ตั้งสาขา" ไม่เป็น meta row (อยู่ใน banner รวม) · 🟡 paid-state card (สลิป thumb+diff+ดึงสลิป) = text แทน
❌ **in-chat ตั้งหมวด/ตั้งสาขา/ยืนยัน (quick-reply postback pickers)** — ฟีเจอร์เด่นของดีไซน์ · ❌ status pill บนการ์ด
⛔ in-chat confirm = ตั้งใจไม่ทำ (GOLDEN RULE: LINE ไม่ auto-post → บัญชียืนยันบนเว็บ)

## 7. หน้าหลัก / Dashboard / ตั้งค่า / bottom-nav
- **Home:** ✅ hero + "งานที่ต้องทำ" task-list (ตรงเป๊ะ) + สมุดค่าใช้จ่าย teaser (เกินดีไซน์) · 🟡 recent = "รอยืนยันล่าสุด" (drafts) ไม่ใช่ mixed feed · 🟡 ไม่มี tile "เสี่ยง VAT" (อยู่ใน task list แทน)
- **Dashboard:** ✅ 6-เดือน trend / by-category / by-branch / budget-vs-actual + AI insights (เกินดีไซน์) · ❌ **KPI "VAT ขอคืนได้" + "หัก ณ ที่จ่าย (WHT)"** (ดีไซน์เน้น งานภาษีรายเดือน) · ❌ ปุ่มส่งออกรายงาน
- **Settings:** ✅ เกือบสมบูรณ์/ดีกว่าดีไซน์ (กลุ่ม+icon+count จริง+route จริง+สถานะเชื่อมต่อ+pending badge)
- **Bottom-nav:** ✅ FAB + role-filtered + collision-guard · 🟡 cell ต่างดีไซน์ (impl ดัน สมุด/งบ เป็น primary, Dashboard/reconcile ใน overflow)

---

## 🎯 Prioritized GAP list (ของที่ดีไซน์มี แต่ยังไม่ได้ทำ)
**🔴 P0 (CEO/team ขอชัด · คุ้มสุด)**
1. **Price popup จัดเต็ม:** 2 แท็บ (สินค้า/ผู้ขาย) + **เทียบผู้ขายอื่น "ถูกสุด"** + sparkline + %-Δ + per-line-item chip
2. **Reconcile: คอลัมน์ "ยอดขอโอน vs ยอดในสลิป + ผลต่าง"** + tab/มุมมอง "มีผลต่าง" (โชว์โอนเกิน/ขาดบนหน้า)

**🟠 P1**
3. Reconcile multi-select สาขา+ผู้ขาย + sort + desktop detail drawer (copy/QR/บิล+สลิปคู่กัน)
4. Dashboard KPI: VAT ขอคืนได้ + หัก ณ ที่จ่าย (WHT)
5. LINE in-chat ตั้งหมวด/ตั้งสาขา (postback picker) — ⚠️ บอท live + ต้อง webhook handler ใหม่ (ยืนยันคงให้ทำบนเว็บตาม golden rule)

**🟡 P2**
6. Detail: render สลิปจริง+แนบใหม่ใน evidence · account-code chip · J/K shortcuts · "N รายการราคาสูงกว่าปกติ" banner · เบอร์/เงื่อนไขชำระ ผู้ขาย
7. LINE card: VAT-can't-claim warning + status pill

**🟢 P3 (polish):** voucher preview modal+PDF · live search · recent-activity feed · "เคลียร์หมดแล้ว 🎉" empty state · ขอโอน dialog amount summary/edit

## ⛔ Can't-do / ตั้งใจต่าง (ไม่ใช่ bug)
- "สร้าง QR จากเลขบัญชี" = เป็นไปไม่ได้ (PromptPay ต้องพร้อมเพย์) · copy button ในการ์ด LINE = LINE ไม่รองรับ (ใช้ text กดค้างแทน) · "กระทบยอดรับผลต่าง" = ตั้งใจแทนด้วย exact-match-or-flag (ปลอดภัยกว่า) · in-chat confirm = golden rule

## ✅ จุดที่ impl เหนือดีไซน์
DB จริง + companyId scope · กันจ่ายซ้ำ (partial-unique + reject settled) · atomic close + row-lock · QR/upload จริง · payee autofill จากประวัติ · slip verify (over/under/payee/dup) · role-gating · counts แม่นจาก DB · saved books แชร์บริษัท · settings route จริง · multi-photo carousel · payee-mismatch + dup guard
