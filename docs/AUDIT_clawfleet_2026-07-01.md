# AUDIT · ClawOS (ตู้คีบ OS) · 2026-07-01

> /auditbigteam · 16 personas (core 13 + A11Y + SRE + AUD) · adversarial Workflow (74 agents · discovery→verify) · 102 findings → **1 P0 + 20 P1 verified** + 44 P2.
> SPEC-ONLY — no code written in this pass. All findings cite `file:line` + independently verified against source.
> Module state: DEPLOYED prod `setup 01cace29` (3 build rounds + polish + correctness this session). Memory `clawos-make-real-all-features-2026-06-29`.

---

## §1 · Executive Summary (อ่านบรรทัดเดียว)

ตู้คีบ OS **ใช้งานได้จริง + สวย + ข้อมูลซื่อสัตย์** (จาก 3 รอบก่อน) และ**แกนกันโกงหลักแข็งแรง** (มิเตอร์เหรียญ/ตุ๊กตา server อ่านเอง spoof ไม่ได้ · trigger `cf_update_machine_mirror` เขียนค่ากลับจริง · 3-way reconcile + netting-guard ทำงาน). **แต่ทีมตรวจ 16 คนเจอ "รูโหว่กันโกงรอบนอก" ที่ผม (ผู้สร้าง) พลาด — และมัน LIVE บน prod แล้ว:**

1. 🔴 **ใครก็ได้ในสาขากด "อนุมัติรอบผิดปกติ" ได้** — ปุ่มอนุมัติ/ปิดล็อกรอบ ANOMALY ไม่เช็คตำแหน่ง (พนักงานเก็บเงินอนุมัติกันเองปิดคดีได้) ทั้งที่โค้ดกันไว้แล้วแต่ลืมเรียก
2. 🔴 **ตุ๊กตา "หาย" ปลอมได้** — ตอน submit เซิร์ฟเวอร์เชื่อ "สต๊อกก่อนเติม" ที่ส่งจากมือถือ แทนค่าจริงในระบบ → คนขโมยตุ๊กตาแก้เลขให้ "หาย=0" ผ่านการตรวจได้ (ขาเหรียญกันได้ แต่ขาตุ๊กตายังปลอมได้)
3. 🔴 **เปิดรอบทิ้งไว้ 24 ชม. = รอดการตรวจฟรี** — cron ปิดรอบค้างเป็น "ปิดแล้ว" เฉย ๆ ไม่คำนวณเงินขาด/ตุ๊กตาหาย
4. 🔴 **"อนุมัติปรับราคาตู้" เป็นตราประทับลม** — กดอนุมัติแล้วราคาตู้ไม่เปลี่ยนจริง (ไม่แตะ loadout)

**ยังพิสูจน์เงินฝากไม่ได้:** ระบบพิสูจน์ว่า "พนักงานเก็บครบ" แต่ไม่มีที่บันทึกว่า "เอาเงินไปฝากธนาคารครบไหม" (custody→deposit blind spot — ChairOps มีแล้ว ClawOS ไม่มี).

→ ส่วนใหญ่เป็น **BUILDABLE_NOW** (แก้โค้ดได้เลย ไม่ติดฮาร์ดแวร์) และหลายจุดยืนยัน CHALLENGE-OK flag ที่ผมเคยรับไว้ = เป็น gap จริง.

---

## §2 · Scope

- **IN:** 10 admin pages (dashboard/branches/collections/config/matrix/reports/settings/staff/stock/app-mobile) + LIFF collect + 2 crons + upload API + lib/clawfleet 20 files + 17 Cf* models + supabase triggers.
- **OUT:** โมดูลอื่น (ChairOps/DC/Playland) · การ rebuild UI (เพิ่ง polish approved 8.5 — audit นี้ validate ไม่รื้อ).
- **DEFERRED-HW:** ไม่มี — ทุก finding เป็น BUILDABLE_NOW (ไม่มีอันติดฮาร์ดแวร์).

## §3 · Sitemap (ยืนยันตรงกับ code · 0 drift)

10 os routes + `/liff/clawfleet` + `/api/clawfleet/upload` + 2 crons. 17 Cf* models. ตรงกับ memory ทุกจุด — ไม่มี plan↔schema↔route drift.

---

## §4 · Verified Findings (จัดกลุ่มตามธีม · ทุกข้อ BUILDABLE_NOW)

### 🔴 กลุ่ม A · ความสมบูรณ์ของ "กันโกง" (สำคัญสุด — แกนของทั้งโปรแกรม)

| # | Sev | ที่ | ปัญหา (สั้น) | แก้ |
|---|---|---|---|---|
| A1 | **P0** | `lib/clawfleet/actions.ts:32-89` reviewV2Session · `role-guard.ts:139` | อนุมัติ/LOCK รอบ ANOMALY ใช้แค่ `requireSession` — **ไม่เช็คตำแหน่ง** → staff/viewer อนุมัติกันเองได้ · `assertCanReviewSession` (มี branch_manager+admin guard) **ไม่เคยถูกเรียก** (grep ยืนยัน) | เปลี่ยนให้เรียก `assertCanReviewSession(cf.id)` · คง F2 self-approve guard |
| A2 | P1 | `actions.ts:210,241` submitBranchEvent | server เชื่อ `data.stockBefore` จาก client แทน `machine.lastDollStock` (มีจริงจาก trigger) → ปั่น "ตุ๊กตาหาย=0" ผ่าน reconcile ได้ (ขาตุ๊กตาไม่ spoof-proof เหมือนขาเหรียญ) | ใช้ `machine.lastDollStock` เป็น baseline · client stockBefore ไว้ display เท่านั้น |
| A3 | P1 | `actions.ts:203-216` | ไม่เทียบ stockBefore กับ stockAfter รอบก่อน → ตุ๊กตาหาย**ระหว่างรอบ** (ตอนตู้ว่าง) ไม่มีธง | drift = lastDollStock − stockBefore · ผิดเกณฑ์ → ANOMALY_REVIEW |
| A4 | P1 | `cron/clawfleet-session-autoclose:44-54` (pm/sa/qa/sre 4 คนชี้) | ปิดรอบค้าง >24ชม เป็น CLOSED ตรง ๆ ไม่เรียก `deriveBranchCrossCheck` · trigger คำนวณแค่ token-3way ของ "กลุ่ม" ไม่ใช่ cash/prize 2-way ของ "สาขา" → เปิดรอบทิ้ง = หนีตรวจ | cron เรียก logic เดียวกับ closeBranchSession (แยกเป็น helper) · หรือ force ANOMALY_REVIEW ทุกรอบที่ auto-close |
| A5 | P1 | `actions.ts:186-216` · `liff/clawfleet:28-35` | policy `photoRequired` บังคับแค่ฝั่ง client · server ไม่เคยเรียก `getClawfleetPolicy` → ยิง action ตรง/bypass = ส่งไม่มีรูปได้ (toggle ให้ความมั่นใจผิด) | server validate รูปครบก่อนสร้าง event เมื่อ policy=on |
| A6 | P1 | `photo.ts:14-34` · `upload/route.ts:41-43` | key รูป deterministic + PutObject ธรรมดา = อัปทับหลักฐานได้ · upload เช็คแค่ orgId ไม่เช็คสาขา/รอบ LOCK → ใครใน org อัปทับรูปทุกสาขาได้ แม้รอบปิดแล้ว | random suffix/IfNoneMatch · เก็บ sha256 ตอน submit · เช็ค branch + ปฏิเสธถ้า LOCKED · watermark |

### 🔴 กลุ่ม B · ความถูกต้องเงิน / P&L

| # | Sev | ที่ | ปัญหา | แก้ |
|---|---|---|---|---|
| B1 | P1 | `actions.ts:218-222,491-495` · schema CfCollectionEvent | dup-guard = read-then-write **ไม่มี unique constraint** → กดส่ง 2 ครั้ง/retry = นับเงิน+ตัดสต๊อก 2 เท่า | `@@unique([sessionId,machineId,eventType])` + จับ P2002 |
| B2 | P1 | `stock-actions.ts:87,145,207` receiveStock (fe+devil ยืนยัน CHALLENGE-OK #4) | รับของ unitCost=0 ได้ (`.min(0)`) → เจือจางต้นทุนเฉลี่ยเงียบ ๆ · **ขัดกับใบกระจาย** (`confirmShipmentReceived:785` block 0 แล้ว) = กฎ 2 เส้นทางไม่ตรง | เปลี่ยน `typed>0` + block 0 เหมือนใบกระจาย |
| B3 | P1 | `stock-actions.ts:99-110,168-210` | weighted-avg cost อ่านยอดเดิมไม่ล็อกแถว → รับ 2 ใบพร้อมกัน = ต้นทุน lost-update เพี้ยน | `SELECT FOR UPDATE`/`pg_advisory_xact_lock(productId)` (pattern pooil-6program) |
| B4 | P1 | `config-requests.ts:150-176` approve (devil) | อนุมัติคำขอปรับราคา/ความแรง = แค่ flip status **ไม่เขียน loadout** → ราคาตู้ไม่เปลี่ยน (approval theater) · ราคาเดิมคือตัวหาร reconcile | approve → สร้าง loadout ใหม่ในทรานแซกชันเดียว · **หรือตัดหน้าออก (YAGNI) ถ้ายังไม่มีใครใช้** |

### 🔴 กลุ่ม C · เงินขาออก (custody→deposit) — ช่องบอดใหญ่

| # | Sev | ที่ | ปัญหา | แก้ |
|---|---|---|---|---|
| C1 | P1 | `actions.ts:291-386,534-667` | วงจรเงินจบที่ "นับตอนเก็บ" · ไม่มี model/action บันทึก "เงินอยู่ในมือใคร" + "ฝากธนาคารแล้วกี่บาท/วันไหน" (grep custody/deposit = 0) → พิสูจน์ "เก็บครบ" ได้ แต่ "ฝากครบ" ไม่ได้ · ChairOps มีแล้ว (`depositId=null` + drill-down) | เพิ่ม holderUserId + depositedAt + depositSlipUrl บน CfCollectionSession + หน้า "เก็บแล้วยังไม่ฝาก" (ยืม pattern ChairOps) |

### 🟡 กลุ่ม D · Maker-checker / audit trail

| # | Sev | ที่ | ปัญหา | แก้ |
|---|---|---|---|---|
| D1 | P1 | `stock-actions.ts:412 recordLoss · 262 submitStockCount · 112 receiveStock` (aud) | ตัดขาดทุน/ปรับยอดนับ/ตั้งต้นทุน = guard แค่ branch membership **ไม่เช็ค role rank + ไม่มีอนุมัติ** · CfLossDoc ไม่มี reviewedBy/status → staff คนเดียวจบ ซ่อน shrinkage ได้ · ChairOps มี PENDING→approve | เพิ่ม status+reviewedBy ให้ CfLossDoc · เกิน threshold เข้าคิว admin/mgr อนุมัติ (คนละคน) · role-rank guard · เขียน CfAuditLog |

### 🟡 กลุ่ม E · ความน่าเชื่อถือ (SRE) — LIVE risk

| # | Sev | ที่ | ปัญหา | แก้ |
|---|---|---|---|---|
| E1 | P1 | `cron/clawfleet-photo-retention:49-113` (be+qa) | เขียนรูป 5 คอลัมน์ แต่ cron ลบแค่ 4 — **ลืม `photoPrizeMeterUrl`** → รูปมิเตอร์ตุ๊กตาค้าง R2 ตลอดกาล (ผิด retention 30 วัน · PDPA + ค่าเก็บบวม) · แถวที่มีเฉพาะรูปนี้ scan ซ้ำทุกวัน | เพิ่ม photoPrizeMeterUrl ทั้ง where/select/urlToKey/null ให้ครบ 5 |
| E2 | P1 | `cron/clawfleet-session-autoclose:44-58` (sre) | รอบเปิดแล้วไม่มี event → trigger G7 RAISE → catch → ข้าม → **ค้าง OPEN ถาวร** ลองซ้ำทุกคืน ไม่มี alert | จัดการรอบว่างเป็นกรณีพิเศษ (VOID/CANCELLED) + alert เมื่อ errored>0 หรือค้าง >N คืน |

### 🟡 กลุ่ม F · ความซื่อสัตย์ข้อมูล (residual จากรอบ correctness ที่ตกหล่น) + Field UX

| # | Sev | ที่ | ปัญหา | แก้ |
|---|---|---|---|---|
| F1 | P1 | `dashboard-client.tsx:67,105` (own) | org จริงที่ "สะอาด" (0 anomaly) → dashboard fallback `SAMPLE_ALERTS` 5 ธงปลอม + KPI "ธงแดง=5" (banner ตัวอย่างผูกแค่ branches.length===0) → เจ้าของเปิดเช้าเห็นปัญหาที่ไม่มีจริง | เอา fallback ออกเมื่อไม่ empty จริง · empty-state "วันนี้ไม่มีธงแดง" · KPI=0 |
| F2 | P1 | `collections-client.tsx:133,185` (fe) | org สะอาด (loadAnomalies=[]) → โชว์ SAMPLE_ROWS (ขโมยปลอม 4 รายการ) + banner บอกผิด "ยังไม่มีรอบจริง" | แยก "ไม่เคยเก็บ" ออกจาก "เก็บแล้วไม่มี anomaly" (hasAnyRounds flag) |
| F3 | P1 | `staff-app-client.tsx:360,459` (staff) | draft (นับ+ถ่ายเสร็จ รอกรอกมิเตอร์) เก็บใน React state ล้วน → refresh/LINE-kill/สลับแอป = หายหมด ต้องเดินกลับนับใหม่ (ผิด mandate offline) | persist localStorage ต่อ user/สาขา · hydrate ตอน mount · ล้างเมื่อ submit สำเร็จ |
| G1 | P1 | `actions.ts:118-144 startBranchSession` · migration | รอบ "สาขา" ไม่มี partial unique index (รอบ "กลุ่ม" มี) → 2 คนเปิดรอบสาขาพร้อมกัน = 2 OPEN → ตู้ถูกแบ่งข้ามรอบ ปิดไม่ได้ทั้งคู่ + denominator reconcile เพี้ยน | `CREATE UNIQUE INDEX ... ON cf_collection_sessions(branch_id) WHERE status='OPEN' AND group_id IS NULL` + จับ P2002 → resume |

### 🟢 ยืนยันว่า "ไม่พัง" (adversarial verify กัน P0 ปลอม)
- **มิเตอร์เขียนกลับ** — trigger `cf_update_machine_mirror_trg` เขียน last_meter/stock หลังทุก event จริง (BE persona ตื่นเกิน · verify + grep ยืนยัน) → กันโกงเหรียญ/มิเตอร์ **ยัง spoof-proof**
- org-scoping (ไม่มี RLS) แน่นสม่ำเสมอ (SA ยืนยัน) · ราคามือถือ ฿10 เป็น advisory จริง · atomic-claim กันรับใบกระจายซ้ำ

---

## §5 · Hardware Dependency Matrix

ทุก finding = 🟢 **BUILDABLE_NOW** (แก้โค้ด/migration ได้เลย · ไม่มี HW_BLOCKED · ไม่มี MOCKABLE). ไม่มีอะไรรอฮาร์ดแวร์.

## §6 · Design Tokens

ClawOS ใช้ระบบของตัวเอง (`.co-*` ใน clawos.css + `components/clawfleet/os/kit.tsx`) ไม่ใช่ `tokens.md` กลาง — QC ผ่าน (primitives สม่ำเสมอ · สีจองความหมายชัด) เหลือ P2: ตัวอักษรไทย <11px หลายจุด (matrix 8.5px แย่สุด) · letterSpacing บวกบนไทย 2 จุด · ป้าย "ตัวอย่าง" 5 แบบไม่เหมือนกัน · Skeleton primitive สร้างแล้วไม่มีใคร import · radius scale กระจาย 20+ ค่า.

## §7 · Persona Sign-off

| Persona | Status | เงื่อนไข |
|---|---|---|
| AUD | 🔴 BLOCKED | A1 (P0 approve no role-gate) + D1 (write-off no maker-checker) + A6 (photo tamper) ต้องแก้ก่อนเชื่อว่า audit-trail สมบูรณ์ |
| QA | 🟡 CONDITIONAL | A2/A3 (doll spoof + cross-round) + B1 (dup double-count) + A4 (autoclose) |
| BE / SA | 🟡 CONDITIONAL | B1/B3 race · G1 branch-lock · A4 cron reconcile |
| SRE | 🟡 CONDITIONAL | E1 (PDPA photo) + E2 (stuck-open) |
| PM / OWN | 🟡 CONDITIONAL | C1 (deposit custody) + F1 (fake red flags) |
| DEVIL | 🟡 CONDITIONAL | B4 (config zombie — apply หรือ ตัดออก) |
| FE / IA / MGR / STAFF / A11Y / UX / QC / BA | ✅ / ⚠ | UX/QC ผ่าน design (validate ไม่รื้อ) · เหลือ P2 polish · STAFF ติด F3 (draft) |

→ 1 BLOCKED (AUD) · 6 CONDITIONAL. ทั้งหมด BUILDABLE_NOW.

## §8 · 🎯 Top 5 Decisions Needing CEO Eyes

1. **A1 · ใครอนุมัติรอบผิดปกติได้บ้าง?** — owner: AUD · cost-if-wrong: **สูง** (พนักงานปิดคดีโกงกันเอง) · CEO: ☐ จำกัด = ผจก.สาขา+แอดมิน (แนะนำ) ☐ ปล่อยชั่วคราว
2. **C1 · จะติดตามเงินฝากธนาคารไหม?** — owner: PM/OWN · cost-if-wrong: **สูง** (เงินหายช่วงมือ→แบงก์ พิสูจน์ไม่ได้) · CEO: ☐ เพิ่มชั้น "เก็บแล้วยังไม่ฝาก" (ยืม ChairOps) ☐ ยังไม่ทำ
3. **B4 · คำขอปรับราคาตู้ = ทำจริงหรือตัดทิ้ง?** — owner: DEVIL · CEO: ☐ ต่อสายให้อนุมัติแล้วแก้ราคาจริง ☐ ตัดหน้าออก (ยังไม่ได้ใช้) ☐ คงไว้แต่ติดป้าย "ยังไม่เชื่อมตู้"
4. **D1 · ตัดขาดทุน/ปรับยอดนับ ต้องมีคนอนุมัติไหม?** — owner: AUD · cost-if-wrong: กลาง-สูง (ซ่อน shrinkage) · CEO: ☐ เกิน X บาทต้องอนุมัติ 2 ชั้น ☐ staff ทำเองได้
5. **A4/E2 · cron ปิดรอบค้าง — ปิดเงียบ หรือบังคับให้คนตรวจ?** — owner: SRE/QA · CEO: ☐ auto-close = เข้า ANOMALY_REVIEW เสมอ (แนะนำ) ☐ ปิดเงียบ

## §9 · Recommended Actions (จัดลำดับ)

**ชุด "แก้โค้ดได้เลย ไม่ต้อง CEO ตัดสิน" (BUILDABLE_NOW · เสนอทำผ่าน /bigsolvebug หรือแก้ตรง):**
A1 (เรียก assertCanReviewSession) · A2 (stockBefore server-side) · B1 (unique index dup) · E1 (photo 5th col) · E2 (empty-session cron) · B2 (cost-0 block) · G1 (branch open-lock) · F1/F2 (เอา fake alerts ออก) · F3 (draft localStorage).

**ชุด "รอ CEO เคาะก่อน" (§8 Top-5):** A4 · C1 · B4 · D1 · A6/A3 (anti-tamper depth).

## §10 · Open Questions / Risks
- trigger `cf_session_close_crosscheck` version บน prod = อันไหน? (worktree มี 2 migration · A4 fix ต้องรู้ว่า trigger ครอบ branch session แค่ไหน)
- CfLossDoc/config-request มีคนใช้จริงแล้วหรือยัง (กำหนด B4/D1 = build vs ตัด)

## §11 · Pilot / Hotfix
Day-1 hotfix budget: ~0.5 dev-day. ชุด BUILDABLE_NOW ข้างบน ~1-1.5 dev-day รวม (ส่วนใหญ่ 1-10 บรรทัด/จุด). ไม่มี migration ใหญ่ ยกเว้น G1 (1 index) + B1 (1 unique) + C1/D1 (ถ้า CEO เอา = +field/table).

---
_16 personas · 74 agents · 5.24M subagent tokens · verified P0×1 + P1×20 + P2×44 · spec-only._
