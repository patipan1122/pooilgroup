# BIGFEATURE · ChairOps · Persona BA (Business Analyst)

> **Created:** 2026-05-27 · Phase 3 persona output
> Anchor numbers: ~100 chairs · 30 branches · 30 maids 1:1 · revenue ~25-30K/branch/mo · 4 waves · 15-21 dev-day

---

## 1 · Stakeholders

| # | Role | Benefit | Pays / risk | Approval gate |
|---|---|---|---|---|
| 1 | **CEO (Pattipan)** | จาก 30 LINE groups → 1 dashboard · เห็นกำไรสุทธิ/สาขา/วัน · บิลห้างไม่หลุด | ทุนสร้างระบบ · เวลา review wave gate · risk = ปวดหัวกว่าเดิมถ้า rollout พัง | **Approves every wave** (per `[[chairops-p0-decisions-locked-2026-05-27]]`) |
| 2 | **Office (1-2 คน)** | จากเปิด 30 groups → เปิด 1 dashboard · reconcile XLSX แทน re-key · บิลเข้าระบบเอง | เรียนรู้ flow ใหม่ 1 สัปดาห์ · ต้อง approve AI extract ทุกบิล (manual queue) | Wave 0+1+2 |
| 3 | **Maid (30 คน)** | UI ภาษาไทย · 4 ปุ่ม · ไม่ต้องอยู่ในกลุ่ม noise | เปลี่ยน habit จาก LINE chat → form · มี Android Go users ที่อาจ stumble | Wave 1 pilot |
| 4 | **Tech (1-3 คน)** | Damage ticket queue + spare parts ledger | เพิ่ม SOP เบิกของ + escalation SLA | Wave 3 |
| 5 | **Accountant (external · ไม่ใช่ employee)** | BC/Express import 1 click · ไม่ re-key | ต้อง map COA + VAT ครั้งเดียว | **Wave 2 — ⚠ ไม่ได้นั่ง Phase 2 form** (flag below) |
| 6 | **Mall management (Robinson/Central/etc.)** | บิลถูกจ่ายตรงเวลา (less escalation) | ไม่กระทบ · zero touchpoint | ไม่ต้อง approve |
| 7 | **Internal auditor (CEO self)** | Audit log immutable · 11 filter chips · CSV export | จำลอง quarterly review | Wave 3 |
| 8 | **External auditor / สรรพากร** | Period-close lock + PeriodReopenLog + 7-year retention | ห้าม drift หลังปิดงวด | **ไม่ได้นั่ง Phase 2 form** (flag below) |

**Sponsor model:** CEO เป็นทั้ง sponsor + budget owner + primary user · ไม่มี business proxy → ทำให้ pilot acceptance ตัดสินง่าย (1 คน say-go) แต่ก็เสี่ยง confirmation bias (CEO อาจ overlook maid pain point).

---

## 2 · Business value per wave

| Wave | Quantified value | Calculation basis |
|---|---|---|
| **W0** | **CEO 5-10 ชม./สัปดาห์** ได้คืน · cash safety = block ≥ 1 ขาดสะสม/เดือน × ~3,000-8,000฿/ครั้ง = **~36-96K ฿/ปี risk avoided** | CEO ปัจจุบันรวมยอด 30 branches × 30 days manual = ~1.5 ชม./วัน · drift engine fix = catch shortage ก่อนทบ |
| **W1** | **30 LINE groups → 1 OA** · save Office ~2 ชม./วัน อ่าน chat = **~600 ชม./ปี** · maid compliance visibility +90% | 30 groups × ~5 นาที/group/วัน = 2.5 ชม./วัน Office time |
| **W2** | **บัญชี re-key 100% → 5%** · accountant fee ปกติ ~3-5K/เดือน × ปัจจุบันบวก 2-3K re-key fee = **~24-36K ฿/ปี saved** · Gmail AI = CEO save 30-60 นาที/วัน manual bill entry = **~180-360 ชม./ปี** | Accountant rates Thailand SME ~500-800฿/ชม. · re-key 30 branches × 1 minute/row × 200 rows/branch = ~100 ชม./เดือน |
| **W3** | **Damage SLA visible** = lost-revenue mitigation · ถ้าเก้าอี้พัง 1 วัน = ~800-1,000฿ revenue loss × 100 chairs × 2% downtime = **~60K ฿/ปี recoverable** · Audit polish = audit prep ลด 80% (quarterly 8 ชม. → 1.5 ชม.) | Chair revenue ~25K/mo / 30 chairs/branch = ~833฿/chair/mo |

**รวม value year-1:** ~150-250K ฿ + ~800-1,200 ชม. CEO/Office time saved · risk-avoided ~36-96K shortage + audit fail risk priceless

---

## 3 · ROI estimate

**Build cost (rough):**
- 18 dev-day × ~5,000-8,000฿/วัน internal cost (or 0฿ if Claude-assisted by CEO) = **~90-145K ฿** OR **~0฿ + 18 days CEO time**
- Ongoing: LINE OA Pro ~1,500฿/mo + Anthropic API ~500-2,000฿/mo + R2 ~100-500฿/mo = **~25-50K ฿/ปี**

**Break-even:**
- Year-1 saved value ~150-250K ฿ vs build ~90-145K ฿ → **break-even ~6-9 เดือนหลัง pilot live**
- ถ้านับ CEO time saved (5-10 ชม./สัปดาห์ × ~1,000฿/ชม. opportunity cost) → **break-even ~2-3 เดือน**

**Recommendation:** ROI positive จริง · แต่เน้น Wave 0 ก่อนเพราะมี risk avoidance ที่ทดแทนไม่ได้ (zero cumulative shortage promise per `[[chairops-no-cumulative-shortage]]`).

---

## 4 · Acceptance criteria per wave

**Wave 0** — CEO ทำ 1 รอบ end-to-end:
- AC0.1: Upload sample XLSX (ของจริง 8 branches × 30 days) → diff preview แสดง "+N new · M same · K changed" → click commit → row count exactly correct in DB
- AC0.2: `/chairops` exec home แสดง gross + net profit per branch per day · click sparkline → drilldown
- AC0.3: Drift engine = window-based · re-upload เดือนเดิม = idempotent (zero duplicate row, zero double-count)
- AC0.4: `loadUserModules()` admin tier returns 8 modules (chairops/clawfleet/playland included) — verify via /dashboard nav
- AC0.5: 3 cron endpoints hit `/api/chairops/cron/*` returns 200 with valid CRON_SECRET (cron audit log row created)

**Wave 1** — 1 maid × 1 branch × 5 days:
- AC1.1: Maid completes all 4 task types (collect / cleanliness / damage / supply) via LINE OA Rich Menu in <60s each
- AC1.2: Office dashboard real-time grid: 30 × 4 = 120 cells, status ✓/✗/⏳ accurate within 30s of maid submit
- AC1.3: 0 LINE Notify usage by Day 5 (zero outbound from `notify-api.line.me` in logs)
- AC1.4: Offline test: airplane mode → submit → reconnect → IndexedDB outbox flush · exactly-once delivery
- AC1.5: CEO can manually push template to specific branch via dashboard button (no copy-paste to LINE)

**Wave 2** — Accountant + CEO joint test เมษา 2026:
- AC2.1: BC/Express CSV export from `/chairops/audit/export` opens in BC software with 0 manual-fix rows · row diff <5%
- AC2.2: Gmail label `ChairOps/Bills` → 4-hour cron picks up → bill appears in `/chairops/bills` with PDF preview · CEO 1-click approve
- AC2.3: Period-close lock blocks new POS imports for closed month · adjustment workflow requires CEO approval · PeriodReopenLog immutable
- AC2.4: VAT mark/rate + companyId visible on every export row · audit trail self-audits the export action itself

**Wave 3** — CEO quarterly review simulation:
- AC3.1: 11 audit filter chips work + diff drawer shows before/after JSON
- AC3.2: Leaderboard top/worst 5 branches accurate vs raw data
- AC3.3: KPI tiles match brand tokens (no Thai uppercase per `[[section-component-eyebrow-rootcause]]`, sticky thead solid per `[[sticky-bg-inherit-anti-pattern]]`)
- AC3.4: Damage SLA cron escalates URGENT > 24h to LINE OA push

---

## 5 · Success metrics (Phase 2 + BA additions)

**From Phase 2 GOAL:**
1. แม่บ้านใช้ LINE OA แทน group 100% ภายใน Wave 1 (5 วัน)
2. เงินขาดสะสม = 0 บาททุกสาขาทุกวัน
3. บัญชี import เมษา 2026 > 95% no re-key
4. Audit trail self-audited

**BA-added (recommended track):**
5. **Time-to-detect shortage** — median ที่เคย "หาวันถัดไป" → target <5 นาทีหลัง maid commit (window-aligned)
6. **Bill aging average** — บิลใหม่ที่ status=RECEIVED ไม่เกิน 7 วันก่อนเข้าสู่ APPROVED → measure mean days
7. **Maid task completion rate** — % maids ที่ complete 4-task set ครบทุกวัน · target ≥85% Week 4

---

## 6 · Hidden costs

| Item | Year-1 cost | Note |
|---|---|---|
| LINE OA Messaging API | ~18-30K ฿/ปี (Pro plan + push >1K msg/mo) | ปัจจุบัน LINE Notify ฟรี · OA Pro ~1,500-2,500฿/mo |
| Anthropic API (Gmail parser) | ~6-24K ฿/ปี | 30 bills/mo × ~5,000 input + 500 output tokens × Sonnet rate ~$3/$15 per M = ~$1-3/บิล → ~30-100฿/บิล × 30/mo |
| R2 storage growth | ~1-6K ฿/ปี | Bill PDFs ~500KB × 30/mo × 12 = ~180MB + maid photos ~2MB × 4 tasks × 30 days × 30 branches = ~7GB/ปี · R2 = $0.015/GB |
| Vercel Pro tier | ~7K ฿/ปี ($20/mo) | จำเป็น (cron 300s cap · hobby 60s ไม่พอ per audit §10.3) |
| Twilio SMS (BR2 step 4 escalation) | ~3-12K ฿/ปี | ~50 critical SHORTAGEs × ~3-6฿/SMS |
| **Total ongoing** | **~35-79K ฿/ปี** | ยังคุ้มเทียบ value 150-250K ฿/ปี |

---

## 7 · Wave reorder analysis — ฿ value per dev-day

| Wave | Dev-day | Value/ปี | Value/dev-day |
|---|---|---|---|
| W0 | 3-4 | ~100K + risk avoided 50-100K | **~33-50K/dev-day** ← highest |
| W2 | 4-6 | ~60-90K | ~10-20K/dev-day |
| W1 | 5-7 | ~50-80K (mostly time saved · not cash) | ~8-15K/dev-day |
| W3 | 3-4 | ~30-60K (delight + risk) | ~7-15K/dev-day |

**BA recommendation:** Keep current order. W0 is correctly first (highest ฿/day + unblocks everything). **But consider swapping W1 ↔ W2 IF** CEO's bigger pain right now is accountant re-key (cash) vs LINE noise (time). CEO previously confirmed LINE pain is more visceral · keep W1 second.

---

## 8 · Flag — Stakeholders missing from Phase 2

⚠ **Accountant ไม่ได้นั่ง Phase 1 form.** Wave 2 ships BC/Express format · COA mapping · VAT rules — แต่ accountant คือคนเดียวที่จะใช้จริง. **BA recommendation:** ก่อน Wave 2 implementation start, CEO โทรหา accountant 30 นาที + ส่ง CSV mock-up → ขอ sign-off format. Risk = ship format ผิด · 4-6 dev-day wasted.

⚠ **External auditor / สรรพากร ไม่ได้นั่ง Phase 1 form** — period-close + retention design assumes 7-year accounting standard. หากในอนาคต SOX-style audit เกิดขึ้น (CEO ขายธุรกิจ · IPO) ต้อง revisit immutability proof. **BA recommendation:** ตอนนี้ acceptable risk · note ไว้ใน decision register.

---

## 9 · Validate Q5 metrics

**"0 LINE Notify usage by Day 5"** — ⚠ **ทำได้แค่ technically** (no `notify-api.line.me` outbound calls in logs) แต่ business reality = 30 LINE groups ยังคงอยู่ 3 เดือน overlap per Wave 1 plan. **BA recommendation:** เปลี่ยน metric เป็น **"0 NEW LINE Notify code path used + maid traffic ใน LINE OA channel ≥80%/day"** · sharper.

**"BC/Express import > 95% rows"** — Baseline today = **100% re-key** (accountant manual ลง BC แต่ละ row). ดังนั้น 95% automated = 5% manual = **20x faster**. **Baseline confirm:** CEO ต้อง verify accountant currently does NOT use any auto-import. ถ้า accountant มี macro หรือ template อยู่แล้ว · baseline จะสูงกว่า expected.

---

## 10 · Open business questions (need CEO lock before Wave start)

| # | Question | Why critical |
|---|---|---|
| **OQ-B1** | Accountant ปัจจุบันมี macro/template ใน BC ไหม? Baseline re-key คือ 100% จริงหรือไม่? | Validates W2 success metric · could be 80% not 95% if macro exists |
| **OQ-B2** | Security deposit history หรือ current-only? | If history needed → +1 table · +0.5 dev-day Wave 0 |
| **OQ-B3** | Bill dispute workflow ใคร approve? CEO หรือ Office? | UI flow Wave 2 · default CEO-only · BA recommend Office propose · CEO approve (maker/checker) |
| **OQ-B4** | LINE OA channel = 1 ตัวเดียวสำหรับ ChairOps ใหม่ หรือ tenant-per-channel? | Default 1 (CEO owns 1 biz) · per `[[recruit-omnichannel-prod-2026-05-23]]` pattern allows tenant-level scaling later |
| **OQ-B5** | After 3-month overlap · ใครปิด 30 old LINE groups · maids consent? | Change management risk · BA recommend CEO + Office co-sign communication script · Wave 1 exit gate |
| **OQ-B6** | Profit-sharing model ไหม? เก้าอี้สาขา A กำไรมาก vs สาขา B ขาดทุน — CEO take all? | Affects leaderboard semantic Wave 3 · ถ้ามี share → ต้อง split per-branch P&L correctly |

---

**END · BA sign-off:** 🟡 **CONDITIONAL_PASS** — Wave order correct · ROI positive · 6 open business questions ต้อง lock ก่อน Wave 2 start · stakeholder gap (accountant + external auditor) ต้อง mitigate ก่อน W2 ship.
