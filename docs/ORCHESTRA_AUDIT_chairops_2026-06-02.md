# 🎼 ChairOps Orchestra Audit · 2026-06-02

## 1. Executive summary (3 bullets)

- **ระบบ reconcile โกหก CEO ทุกวัน** เพราะหลัง Wave-2 split ตาราง deposit ออกเป็น `ChairopsCashDeposit` ใหม่ แต่ 5+ surface (KPI office · ledger reconcile · P&L · sparkbar · workspace) ยังอ่านคอลัมน์เก่า `CashCollection.depositedAmount` ที่ตอนนี้ = 0 เสมอ → CEO เปิดดูเห็น "ฝากแม่บ้านวันนี้ 0 ฿ · drift หาย 22k" ทั้งที่แม่บ้านฝากครบแล้ว · ส่ง alert SHORTAGE ผิด · แม่บ้านถูกกล่าวหาผิด · นี่คือ root cause ของอาการ "sidebar -22,761 vs ledger 0" ที่ CEO ทักซ้ำ
- **กล่องแจ้งเตือนเงินขาดส่ง LINE ไม่ออกจริง** เพราะ `lib/chairops/reconcile/alerts.ts:57-58,85` ยังเรียก `sendLineNotify` ตรงไปยัง LINE Notify API ที่ปิดบริการตั้งแต่ 2025-03 · ทั้งที่ adapter `notifyChannel` ใหม่พร้อมใช้และ cron 3 ตัวอื่น migrate ไปแล้ว · ฝั่ง DB เห็นเงินขาด · LINE เงียบสนิท · ขัดนโยบาย CEO "เงินห้ามขาดสะสมเด็ดขาด" โดยตรง
- **กำแพง multi-tenant มีรอยรั่ว 5 จุด** (alerts page · reports CSV+monthly · audit log+export · reconcile actions · pos-ingest commit/cancel) ที่ลืม filter `orgId` · วันนี้ Pool มี ChairOps tenant เดียวจึงยัง "ไม่มีคนรั่ว" แต่ทันทีที่ onboard ลูกค้ารายที่ 2 (CEO ambition 1,200 เก้าอี้ = SaaS) ตัวเลขรายได้ + email พนักงาน + write-off จะรั่วข้าม tenant ทันที + ปุ่ม approve write-off ก็ใช้ข้าม org ได้ผ่าน IDOR

---

## 2. Top 10 Decisions Needing CEO Eyes

| # | ปัญหา | กระทบใคร | suggested fix | dev-time |
|---|---|---|---|---|
| 1 | **deposit ใหม่หายจาก 5 หน้าหลัก** — 5 surface (exec-home · dashboard-pl · reconcile ledger · branches workspace sparkbar · critical-branches) อ่าน `CashCollection.depositedAmount` ที่ = 0 หลัง W2 split (`lib/chairops/queries/exec-home.ts:109-117,276-294` + `dashboard-pl.ts:139-142` + `reconcile-v2.ts:233-249` + `branches-workspace.ts:128-131,341-380`) | CEO + office ทุกวัน · ทุกหน้า KPI/ledger/sparkbar | สร้าง helper `lib/chairops/queries/_deposits.ts` รวม `ChairopsCashDeposit + bankFee + legacy collection where depositId IS NULL` แบบเดียวกับ `drift-engine.ts:120-152` ที่ทำถูกแล้ว · เรียกจาก 5 จุด · ลบ direct `c.depositedAmount` ทั้ง codebase + grep guard ใน CI | **M** |
| 2 | **LINE alert ไม่ออกเลย** — `alerts.ts:57,58,85` ยังเรียก `sendLineNotify` (EOL) แทน `notifyChannel` adapter | ทุก SHORTAGE/MISSED alert ของทุกสาขา | swap 3 บรรทัด `sendLineNotify(x, msg)` → `notifyChannel(x, msg)` · adapter จัดการ fallback+retry+token check ให้แล้ว · `ceo-digest` route ก็ต้อง migrate ด้วย | **XS** |
| 3 | **3 สูตร "drift รวม" ในจอเดียว** — exec home tile · reconcile hero · reconcile sidebar ใช้ formula ต่างกันทั้งสามที่ (positive-only sum vs signed sum vs ledger replay) ทำให้สาขาเดียวกันเห็นเลขกลับเครื่องหมายได้ (`exec-home.ts:139-142` vs `reconcile-shell.tsx:103` vs `reconcile-v2.ts:354-357`) | CEO เปิด 2 จอเทียบกันแล้วไม่เชื่อตัวเลข | สร้าง `getCumulativeShortage(orgId)` helper เดียว · ใช้ใน 3 surface พร้อมกัน · แนะนำ canonical = "sum positive driftAmount" (= "ค้างฝากรวม" ตรงกับ mental model CEO) + ปรับ label ให้เหมือนกัน | **S** |
| 4 | **WriteOff อนุมัติแล้วไม่หัก drift จริง** — `actions.ts:190-192` comment ยอมรับว่า "tracked but do NOT adjust" · UI โฆษณา "ระบบจะคิด drift ใหม่ทันที + ปลด alert" (`write-offs/page.tsx:460-462`) · CEO อนุมัติ 5,000 บาทแล้ว exec home ยังขึ้น "ขาด 5,000" + LINE Notify ขู่ critical รัวๆ → office requestWriteOff ซ้ำ | CEO + office + maker-checker flow | เพิ่ม `writeOffAgg` ใน `drift-engine.ts:148-153` และ `:282-286`: `depositTotal += SUM(WriteOff WHERE status=APPROVED AND approverAt > anchor)` · เก็บ `writeOffTotal` แยกเข้า `BranchDriftSnapshot` เพื่อโชว์แยกใน UI | **S** |
| 5 | **Cleanliness page ของ manager แสดงผล 403** — `cleanliness/layout.tsx:7` gate `requireExactRole("MAID")` แต่ `lib/modules.ts:548` เปิดเมนูให้ super_admin/org_admin/admin/area_manager/branch_manager · comment อ้าง `/dashboard/cleanliness` ที่ไม่มีจริง · ฟีเจอร์ checklist 10 ข้อที่ลงทุนสร้างไม่มี view สำหรับคนตัดสินใจ | manager 5 roles ที่คุม 30 สาขา | สร้าง `/chairops/cleanliness/page.tsx` เวอร์ชัน MANAGER+ (list ทุก report ของทุกสาขา · filter sev+branch+range) แยก MAID flow คงอยู่ที่ `/chairops/m/cleanliness` ตามเดิม · หรือถ้าไม่มีเวลา → ลบเมนูออกจาก `modules.ts:548` (Wave-1 hide) | **M** |
| 6 | **multi-tenant leak 5 จุด** — alerts page (`alerts/page.tsx:99-204`) · audit log+export (`audit/page.tsx:25-49` + `api/chairops/audit-export/route.ts:42-58`) · reports CSV+monthly (`reports/export/route.ts:48-170` + `reports/monthly/page.tsx:29-56`) ลืม filter `orgId` ทั้งหมด + IDOR ที่ alert ack/resolve · write-off approve/reject/dispute · POS commit/cancel | วันนี้ = 0 จริง (single-tenant) · ทันทีที่มี tenant 2 = trade-secret revenue leak + audit integrity พัง | scoped fix 1 รอบ: ใส่ `where.orgId = session.user.orgId` ทุก findMany/groupBy · เปลี่ยน update by id เป็น `where:{id, orgId}` composite · pattern มีอยู่แล้วใน `branches-workspace.ts` ใช้อ้างอิงได้ | **M** |
| 7 | **Timezone bug exec home** — `startOfToday()` ใน `exec-home.ts:35-46` ใช้ UTC ไม่ใช่ Asia/Bangkok · ช่วง 00:00-07:00 น. KPI วันนี้ (POS + ฝาก + missed maid + critical-branches) ทั้งหมดอ่านข้อมูลของ "เมื่อวาน UTC" labeled เป็น "วันนี้" | CEO เปิด dashboard เช้าทุกวันก่อน 7 โมง = เห็นข้อมูลผิด | swap `startOfToday()` ด้วย helper ที่ใช้ `toZonedTime(new Date(), 'Asia/Bangkok')` (`bangkokToday()` ที่ `(office)/page.tsx:105-110` มีพร้อมใช้แล้ว) | **XS** |
| 8 | **Branches workspace มือถือใช้ไม่ได้** — `branches/page.tsx:219` hardcode `data-pane="detail"` ส่งทุก viewport · CSS `@media ≤768px` ตั้ง `.co-br-list { display:none }` รอ `data-pane="list"` ที่ไม่เคยถูก set · มือถือเห็นแต่ detail สาขาแรก สลับสาขาไม่ได้ | CEO ที่ใช้ phone ตรวจร้านระหว่างเดินทาง | เพิ่ม URL param `?pane=list\|detail` (default=list บน ≤768px) · `data-pane={pane}` · เพิ่ม mobile-only sticky switch md:hidden | **S** |
| 9 | **vendor bill module ไม่มีเลย** — schema, route, cron, model ทั้งหมด 0 hit แม้ CEO sign-off เป็น Wave 2 P1 ตั้งแต่ 2026-05-27 · profit dashboard ทุกหน้าใช้ `monthlyRent` ที่ CEO กรอกประมาณการ → ถ้าห้างวางบิลจริงสูง/ต่ำกว่า dashboard โกหก CEO ทุกวัน + ไม่มี anchor reconcile invoice | CEO + ทีมบัญชี · 30 สาขา × 12 เดือน = 360 ใบบิล/ปี | Wave 2 ship: model `ChairopsVendorBill` + route `/chairops/bills` + cron Gmail bill-ingest + widget "บิลค้างจ่าย" บน exec home · ผูกกับ branch.monthlyRent เพื่อ reconcile expected vs actual | **L** |
| 10 | **P&L mobile = horizontal scroll ออกจอ** — `all-branches-pl-table.tsx:159` กำหนด `min-w-[860px]` + `critical-branches-table.tsx:96` กำหนด `min-w-[680px]` · iPhone 13 (390px) ต้อง scroll ขวา ~470px เพื่อเห็น DRIFT column ที่เป็น alert หลัก | CEO ที่ใช้ phone ตรวจสาขา (ระบุชัดใน user story) | mobile (md:hidden) render เป็น stacked card list: สาขา + DRIFT + ยอดรวม + status dot · ใช้ table เฉพาะ md: ขึ้นไป · pattern เดียวกับ branch-collect grid ที่มีอยู่แล้ว | **M** |

> **หมายเหตุ** — ข้อที่ต้องคิดมากกว่าข้ออื่น = **#5 (cleanliness manager)** เพราะต้องตัดสินใจก่อนว่า "ลบเมนูทิ้ง" (เร็ว · เสีย investment ที่สร้าง checklist 10 ข้อไป) หรือ "สร้าง manager view ใหม่" (ลงทุนเพิ่ม · ได้ oversight จริง) · CEO ต้องตัดสินใจก่อน dev เริ่มเขียน

---

## 3. Missing-feature recommendations (ranked by theme)

### Theme A · Cost & Profit accuracy (ทำให้ dashboard ไม่โกหก CEO)
- **Vendor Bill module** (MISS-01) — ไม่มี `ChairopsVendorBill` table เลย · profit dashboard ทุกหน้าใช้ค่าประมาณการ
- **Cost edit UI** (UX-11) — schema มี `monthlyRent/Utility/Staff/Other` แต่ไม่มี route ให้ ADMIN/CEO กรอกแก้
- **Weekly P&L digest** (MISS-10) — ระบบมีแค่ daily + monthly · ขาด cadence ที่ retail 30+ สาขาใช้
- **Reports monthly ไม่มี cost/profit column** (MISS-06) — รายงาน board meeting ต้อง export CSV แล้วคำนวณกำไรใน Excel

> **First step ที่ ROI สูงสุด** = สร้าง cost edit UI ก่อน (XS dev-time) · profit ที่แสดงทุกหน้าจะแม่นขึ้นทันทีโดยไม่ต้อง Vendor Bill เต็มระบบ

### Theme B · Anti-fraud & maid trust (ตรงกับนโยบาย "เงินห้ามขาดสะสม")
- **Event-table read-side** (MISS-02) — ingest `PosCashEvent/CoinEvent` timestamped วินาทีเรียบร้อย · ไม่มี query/UI ใช้ → noon-window reconcile · peak-hour heatmap · intra-day anti-skim ใช้ได้ทันที
- **Maid Roster/Leave** (MISS-03) — 5 สาขา active ไม่มี maid · maid ลา = false alarm รัวๆ · scale 100 maid = chaos
- **Maid Pay/Commission** (MISS-08) — 30 แม่บ้าน × ~15k/เดือน = ~450k/เดือนหายไปจากระบบ tracking
- **Diff > 100 ฿ ไม่บังคับเหตุผล** (MAID-04) — เปิดทางให้แม่บ้านพิมพ์ผิด/ยักยอกได้เงียบๆ
- **Office collect แทน → ฝากไม่ได้** (MAID-03) — orphan collection · maid ลา = flow ตันสมบูรณ์

> **First step** = เพิ่ม gate "diff > 100 บาท บังคับ notes ≥ 10 ตัวอักษร" + LINE Notify office (XS dev-time) · ปิด anti-fraud hole ใหญ่ที่สุดทันที

### Theme C · Alert completeness (CEO เห็นปัญหาครบ)
- **4 ใน 6 Alert kinds ไม่มี detector** (MISS-04) — `POS_NOT_INGESTED · CHAIR_OFFLINE · CLEANLINESS_FAIL · REPAIR_OVERDUE` มีแค่ enum + label · ไม่มี cron สร้าง
- **WRITE_OFF_REQUESTED ไม่ ping LINE** (OFC-03) — maker-checker pause เพราะ MGR/CEO ไม่รู้ว่ามีคิว
- **Spare parts low-stock ไม่ alert proactive** (MISS-09) — มี badge ในหน้า /parts แต่ไม่มี home widget หรือ LINE push

> **First step** = ทำ POS_NOT_INGESTED detector ก่อน (XS) · ตอนนี้ POS upload ล่าสุดคือ April 1-10 (ค้าง 2 เดือน) ระบบเงียบสนิท · นี่คือ business-critical สุด

### Theme D · Search & navigation (CEO หาของไม่เจอ)
- **Global search ไม่มี** (UX-05) — 30 สาขา × 91 เก้าอี้ × 7 entity = ~19k record · ต้องเดาว่าค้นที่หน้าไหน
- **Chair list page ไม่มี** (MISS-05) — `/chairops/chairs` = 404 · มีแค่ `[chairCode]` ที่ไม่มีลิงก์เข้า
- **Branch compare side-by-side ไม่มี** (MGR-04) — manager weekly review ต้อง click 3 รอบจดใส่กระดาษ
- **Date preset ขาด last_week/last_month/30d** (MGR-05) — Monday review ต้องกรอกมือทุกครั้ง
- **Area manager scope ไม่มี** (MGR-01) — เห็นทุกสาขาของ org ปนกัน · ไม่มี "my area" view

> **First step** = เพิ่ม preset `last_week/last_month/30d` ใน `date-range-filter.tsx` (XS) · เป็น quick win ใช้ได้ทุก Monday

---

## 4. Cross-screen conflicts table

| screen A | shows | screen B | shows | which is right | fix |
|---|---|---|---|---|---|
| Exec home KPI "ฝากแม่บ้านวันนี้" | 0 ฿ (อ่าน legacy column) | Maid home "เงินค้างรอฝาก" | ยอดจริง (อ่าน CashDeposit) | **B (Maid)** ถูก | DATA-01: union `CashDeposit + bankFee + legacy fallback` |
| Branches workspace "POS วันนี้" | lifetime cash sum (drift.posTotal) | Exec dashboard "POS วันนี้" | today gross (cash+online) | **B (Dashboard)** ถูก | CONF-03: workspace ใช้ today aggregate จาก `BranchDailyRevenue` แทน |
| Reconcile sidebar "drift" | -22,761 (signed) | Exec dashboard tile "ค้างฝากรวม" | +22,761 (positive-only) | **ทั้งคู่ใช้คนละสูตร · CEO เลือก canonical** | CONF-05: helper `getCumulativeShortage(orgId)` |
| Attention strip "drift รวมวันนี้" | lifetime cumulative | KPI tile ใต้ลงไป "ค้างฝากรวมทุกสาขา" | ตัวเลขเดียวกัน (label ถูก) | tile ถูก · strip โกหก | CONF-07: เปลี่ยน strip → "drift ค้างสะสมรวม" |
| Reconcile sidebar "เก็บล่าสุด 3d" | cached daysSinceLastCollection | Branches workspace "4 วันก่อน" | live ageDays() | ทั้งคู่ถูกตอน cache สด · ต่างกันข้ามเที่ยงคืน | CONF-10/DATA-09: live calc ทุก surface · drop cached field |
| Branches workspace "กำไร 30 วัน" | depositTotal − cost (cash only) | Dashboard PL "กำไร" | revenue − cost (รวม online) | **B (PL)** ถูก · workspace ตัด online ออก | DATA-10: workspace ใช้ `BranchDailyRevenue.grossTotal` |
| Critical Branches row click | → `/chairops/reconcile/[id]` (full page) | All Branches PL row click | → `/chairops/branches?branch=[id]` (3-pane) | workspace ถูก (CEO mockup decision) | OWN-07: critical/leaderboard/missed-maids ทั้ง 3 ส่งไป workspace ด้วย |
| Reconcile ledger "ฝาก" col | 0 + diff=−pending ทุกวัน | Drift engine cache | คำนวณถูก (รวม CashDeposit) | drift engine ถูก | DATA-02: buildLedger bucket จาก `CashDeposit.depositedAt` |
| Manager exec home KPI "กำไร 30 วัน" | profit จริง (มี cost) | Branches detail "กำไร" | "ซ่อน" (canViewCost=false) | inconsistent gate · cost leak ทางอ้อม | MGR-06: ลบ KPI tile manager หรือเปิด cost ทั้งคู่ |
| Branches sort "กำไรสูงสุด" | enable ให้ manager (rank order leak) | All-Branches PL chip | filter adminOnly | PL ถูก | MGR-03: SortLinks รับ canViewCost prop |

---

## 5. Full punch list by lens

### OWN · CEO landing
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| OWN-01 | P0 | Alerts page ไม่กรอง orgId (cross-tenant leak) | `(office)/alerts/page.tsx:99-204` | เพิ่ม `where.orgId` ทุก findMany/groupBy |
| OWN-03 | P0 | "ฝากแม่บ้านวันนี้" KPI = 0 หลัง W2 | `exec-home.ts:109-117,276-294` | union CashDeposit + bankFee + legacy |
| OWN-04 | P1 | Timezone bug · KPI วันนี้ผิด 00:00-07:00 | `exec-home.ts:35-46` | swap เป็น `bangkokToday()` |
| OWN-02 | P1 | ack/resolve alert IDOR cross-tenant | `lib/chairops/reconcile/alerts.ts:93-105` + `alerts/actions.ts:14-105` | composite where `{id, orgId}` |
| OWN-06 | P1 | Sidebar "ภาพรวม" ชี้ /chairops/dashboard (redirect stub) | `lib/modules.ts:506` | href = `/chairops` ตรง |
| OWN-08 | P2 | KPI ขาด "สาขาเข้าเนื้อ" — CEO มองภาพ aggregate ไม่ได้ | `(office)/page.tsx:411-478` | tile count(rows where net<0) |
| OWN-07 | P2 | Critical-branches → /reconcile, All-Branches → /branches (flow ขัด) | `critical-branches-table.tsx:117` | ส่งทุก row ไป workspace |
| OWN-05 | P2 | "ส่งเตือนทั้งหมด" ใช้ sms: comma · desktop ไม่ทำงาน + 5 no-maid hidden | `missed-maids-card.tsx:55-83` | LINE OA push + CTA "office-collect แทน" |
| OWN-10 | P2 | Header Export ส่งไป hub ไม่ใช่ download ตรง | `(office)/page.tsx:370-374` | href `/chairops/reports/export?from=...&to=...&type=daily` |
| OWN-09 | P3 | OfficeTopNav dead code 78 LOC | `(office)/_components/office-top-nav.tsx` | ลบไฟล์ |

### OFC · Office / Reconcile staff
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| OFC-01 | P1 | คอลัมน์สลิป Ledger เป็น badge ตาย คลิกดูรูปไม่ได้ | `reconcile-views.tsx:307-315` + `reconcile-v2.ts:248` | wrap `<a href={d.slip}>` + drop string fallback |
| OFC-02 | P1 | WriteOff อนุมัติแล้วไม่หัก drift จริง | `reconcile/actions.ts:188-194` + `drift-engine.ts:153` | subtract `SUM(WriteOff APPROVED)` ใน depositTotal |
| OFC-03 | P1 | WriteOff request ไม่ ping LINE | `reconcile/actions.ts:73-139` | เพิ่ม sendLineNotify หลัง create alert |
| OFC-04 | P2 | disputeCollection dead code · ribbon รอ ?disputed= ไม่มี trigger | `reconcile/actions.ts:28-63` | wire ปุ่ม "คัดค้าน" ใน Periods tab + collect detail |
| OFC-05 | P1 | Periods "ทุกสาขารวม" รวม collection ข้าม branch = phantom diff | `reconcile-v2.ts:545-605` | hide Periods เมื่อ branchId=null · หรือ calc per-branch แล้ว aggregate |
| OFC-06 | P2 | Write-offs + Alerts ไม่มี date filter → monthly close ทำใน UI ไม่ได้ | `write-offs/page.tsx:104-128` + `alerts/page.tsx:153-216` | reuse LedgerDateFilter |
| OFC-07 | P2 | Audit log ปิด OFFICE ไว้ · OFC หา trail ไม่ได้ | `audit/page.tsx:25` | downgrade gate เป็น OFFICE + scope entity whitelist |
| OFC-08 | P2 | Sidebar 30 สาขา flat list ไม่มี group/collapse | `reconcile-v2.ts:610-655` + `reconcile-sidebar.tsx` | section divider "ต้องตรวจ vs OK" |
| OFC-09 | P3 | branch-collect comment โฆษณา multi-select แต่ UI single-click | `(office)/branch-collect/page.tsx:81-153` | ลบ/แก้ copy ให้ตรง spec |
| OFC-10 | P3 | Trend arrow direction ทำให้สับสน | `reconcile-views.tsx:128-160` | TrendingDown when crit + relabel |

### MGR · Branch Manager (area)
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| MGR-02 | P0 | Reports หน้า MANAGER เปิดได้ แต่ไม่ filter orgId | `reports/page.tsx:21-36` + `reports/monthly/page.tsx:29-56` | เพิ่ม orgId ทุก findMany |
| MGR-01 | P1 | ไม่มี "area scoping" model → manager เห็นทุกสาขา org | `schema.prisma:2917-3007` + `role-guards.ts:30-37` | model `ChairopsManagerAssignment` + filter |
| MGR-06 | P1 | Manager เห็น KPI "กำไร 30 วัน" บน home แต่ใน per-branch lock = cost-leak ทางอ้อม | `(office)/page.tsx:457-477` + `branches/page.tsx:608-633` | (a) Manager เห็น KPI ฝากแทน · (b) หรือเปิด cost ในสาขาที่ assigned |
| MGR-03 | P2 | Sort "กำไรสูงสุด" leak rank order ให้ manager | `branches/page.tsx:147` + `branches-workspace.ts:227-228` | SortLinks รับ canViewCost prop + filter "profit" |
| MGR-04 | P2 | ไม่มี view "เปรียบเทียบ branch A vs B vs C" | `branches/page.tsx` + `all-branches-pl-table.tsx` | route `/chairops/branches/compare?ids=a,b,c` |
| MGR-05 | P2 | Date preset ขาด last_week/last_month/30d | `date-range-filter.tsx:33-41` + `(office)/page.tsx:138-247` | เพิ่ม 3 preset + resolveRange case |
| MGR-08 | P2 | ปุ่ม MoreHorizontal บน workspace → legacy dashboard ซ้อน | `branches/page.tsx:522` | dropdown context menu หรือ redirect ไป workspace |
| MGR-09 | P2 | "ส่งเตือนทั้งหมด" sms: comma → Android เปิดแค่เบอร์แรก | `missed-maids-card.tsx:55-61` | LINE OA push หรือ modal "ส่งทีละคน" |
| MGR-10 | P2 | Filter rail มีแต่ "ห้าง" ไม่มี region/cluster | `mall-groups.ts:15-36` + `branches/page.tsx:253-279` | rail section ใหม่ "ภูมิภาค" จาก ChairopsBranch.region |
| MGR-11 | P3 | Footer hardcode "ดู 30 สาขาทั้งหมด" | `critical-branches-table.tsx:192` | prop totalBranchCount + template literal |

### MAID
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| MAID-01 | P1 | เก็บย้อนหลังไม่ได้ · collectedAt ล็อก now() | `m/collect/new/form.tsx` + `collect/actions.ts:222` | DatePicker + min/max + banner เตือน |
| MAID-03 | P1 | Office เก็บแทน → maid ฝากไม่ได้ (orphan) | `collect/actions.ts:375-415` | gate `OFFICE+` + ปลด filter maidId · เพิ่ม `/chairops/branch-deposit/[id]` |
| MAID-04 | P1 | Diff > 100 ฿ ไม่บังคับเหตุผล | `m/deposit/form.tsx:194-200` | bind notes required + > 500 ฿ requires_review + LINE Notify |
| MAID-02 | P2 | Offline outbox เป็น stub · เน็ตหลุด = ข้อมูลหาย | `lib/chairops/utils/maid-outbox.ts` | IDB persist draft ทุก 5 วินาที + drain on online |
| MAID-05 | P2 | Damage + Cleanliness ส่งรูปดิบ ไม่ compress | `m/damage/new/form.tsx:84-113` + `m/cleanliness/new/form.tsx:80-121` | reuse `compressImage()` จาก collect form |
| MAID-07 | P2 | Damage + Cleanliness ไม่มี offline check | `m/damage/new/form.tsx` + `m/cleanliness/new/form.tsx` | copy isOnline pattern จาก collect form |
| MAID-09 | P2 | 100+ chairs scroll ไม่มี sticky submit / jump | `m/collect/new/form.tsx:413-578` | sticky bottom + "ปกติทั้งหมด" + jump-to-problem |
| MAID-06 | P3 | Home KPI undercount เมื่อ pending > 20 | `m/page.tsx:113-130` | take 100 หรือ aggregate แยก |
| MAID-08 | P2 | dayStart timezone bug 00:00-07:00 | `m/page.tsx:67,99-101` | `toZonedTime` แทน `new Date().getFullYear/Month/Date` |
| MAID-10 | P3 | Cut-off countdown ไม่ live · ต้อง refresh | `m/page.tsx:31-43` | client island `<CutoffCountdown>` + setInterval(60s) |

### UX · UX / IA / nav
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| UX-05 | P2 | ไม่มี global search ทั่วโมดูล | ไม่มีไฟล์ search | cmd-k palette หรือ `/chairops/search?q=` |
| UX-01 | P2 | เมนู "ภาพรวม" ชี้ URL redirect | `lib/modules.ts:506` + `chairops/dashboard/page.tsx` | href ตรง `/chairops` |
| UX-03 | P2 | คำ "ภาพรวม" 3 ความหมายในจอเดียว | `lib/modules.ts:507,509` + `branches/page.tsx:45` | (a) sidebar "หน้าหลัก" · (b) ลบ section header · (c) tab "สรุปสาขา" |
| UX-06 | P2 | loading.tsx ครอบไม่ครบ · /branches /collections /damage ไม่มี | 6 หน้าหลักไม่มี loading.tsx | สร้าง 3-pane skeleton ตาม pattern (office)/loading.tsx |
| UX-07 | P2 | Branch detail tabs ไม่มี keyboard nav (Arrow/Home/End) | `branches/page.tsx:528-550` | role=tablist + roving tabIndex |
| UX-11 | P2 | CostTab/CostCard locked state ไม่มี CTA เปิด cost edit | `branches/page.tsx:737-779,1111-1158` | CTA "+ ตั้งต้นทุนเดือน" + route edit |
| UX-02 | P2 | OfficeTopNav dead code มี nav 6 ขัดกับ sidebar 14 | `(office)/_components/office-top-nav.tsx` | ลบไฟล์ |
| UX-09 | P3 | ป้ายเมนูผสมไทย-อังกฤษ-สแลง | `lib/modules.ts:528,585,592` | normalize เป็นไทยล้วน |
| UX-04 | P3 | 10 จุด pin `/chairops/branch-collect` literal | `(maid)/layout.tsx:45` + 8 จุดอื่น | const `CHAIROPS_PATHS` |
| UX-10 | P3 | Branches list ไม่มี j/k keyboard nav | `branches/page.tsx:333-411` | client island + onKeyDown |

### DATA · Data integrity / financial accuracy
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| DATA-01 | P0 | 4 หน้าอ่าน deposit จาก legacy column = 0 หลัง W2 | `exec-home.ts:111,195,283` + `dashboard-pl.ts:142` + `reconcile-v2.ts:247` + `branches-workspace.ts:130,343` | helper `sumDepositsByBranch` union ทั้ง 2 ตาราง |
| DATA-02 | P0 | Ledger ผูกกับ CashCollection · ฝากแล้วยัง diff=−pending | `reconcile-v2.ts:233-249` | bucket เงินตาม `CashDeposit.depositedAt` · collected = มี deposit row |
| DATA-04 | P1 | 3 ขนบสัญลักษณ์ drift ในจอเดียว (engine/ledger/sidebar) | `reconcile-v2.ts:294,638` + `drift-engine.ts:153` + `exec-home.ts:139` | branded type `EngineDrift/CellDrift` + converter |
| DATA-03 | P1 | WriteOff approved ไม่ลด drift cache | `drift-engine.ts:153` + `reconcile/actions.ts:190` | subtract WriteOff APPROVED ใน depositTotal |
| DATA-05 | P1 | "แม่บ้านไม่ส่ง" นับจาก collectedAt + start-of-today ไม่ใช่ cutoff 17:00 | `exec-home.ts:148-152,361-376` | source = `CashDeposit.depositedAt` + cutoff = today + MAID_CUTOFF_HOUR |
| DATA-06 | P1 | Exec home ใช้ PosDaily · ภาพรวม PL ใช้ BranchDailyRevenue → totals ไม่ตรง | `exec-home.ts:100-132` vs `dashboard-pl.ts:123-138` | helper `sumRevenue()` + validatePosDivergence cron |
| DATA-08 | P1 | buildLedger ดึง CashCollection อย่างเดียว · period stuck open | `reconcile-v2.ts:233-249,487-508` | join CashDeposit ใน bucket |
| DATA-10 | P1 | profit30d 3 หน้า 3 สูตร (workspace ใช้ deposit · PL ใช้ revenue) | `branches-workspace.ts:192,429` vs `dashboard-pl.ts:195` | canonical = revenue − cost · workspace ใช้ BranchDailyRevenue |
| DATA-07 | P2 | POS commit recompute drift fire-and-forget → revenue สด drift เก่า 10-30s | `pos-ingest/actions.ts:1092-1103` | await recompute ใน tx หรือ banner "กำลังคำนวณ" |
| DATA-09 | P2 | daysSinceLastCollection cached vs live ต่างกันข้ามเที่ยงคืน | `reconcile-v2.ts:639` vs `branches-workspace.ts:160` | drop cached field + live calc |

### SEC · Security / multi-tenant
| ID | severity | title | surface | suggested_fix |
|---|---|---|---|---|
| SEC-01 | P1 | Audit Log viewer ไม่ filter orgId | `audit/page.tsx:25-49` + `audit/[entity]/[entityId]/page.tsx:13-20` | add `where.orgId = session.user.orgId` |
| SEC-02 | P1 | Audit CSV export stream ทุก tenant + ไม่ writeAudit | `api/chairops/audit-export/route.ts:42-58` | filter orgId + tighten role + writeAudit |
| SEC-03 | P1 | Reports CSV + Monthly รั่ว POS/ฝาก/write-off ข้าม tenant | `reports/export/route.ts:48-170` + `reports/monthly/page.tsx:29-56` | filter orgId ทั้ง 4 findMany |
| SEC-04 | P1 | Dispute/approve/reject WriteOff IDOR (ไม่ check orgId) | `reconcile/actions.ts:38-94,143-219` | findFirst `{id, orgId}` ก่อน update |
| SEC-05 | P1 | ack/resolve alert (รวม bulk) IDOR | `alerts/actions.ts:13-105` + `alerts.ts:93-104` | ackAlert รับ orgId · composite where |
| SEC-06 | P2 | commitImport / cancelImport ไม่ verify orgId | `pos-ingest/actions.ts:644-650,1331-1379` | guard `imp.orgId !== session.user.orgId` |
| SEC-07 | P2 | Debug endpoint GET ไม่มี auth · leak maid census | `api/debug/chairops-maids/route.ts:18-86` | x-debug-key gate เหมือน POST |
| SEC-08 | P2 | Cron jobs ไม่ filter orgId · LINE ช่องเดียวข้าม tenant | `eod-reminder` + `ceo-digest` + `sop-check` | env CHAIROPS_CRON_ORG_ID + per-org channel |
| SEC-10 | P2 | Reports hub ไม่ filter orgId + ไม่ requireRole ที่ page | `reports/page.tsx:19-36` | requireRole + orgId ทุก query |
| SEC-11 | P2 | canSeeBranch ไม่ตรวจ branch.orgId (defense-in-depth) | `role-guards.ts:30-37` + `session.ts:144-151` | รับ `{id, orgId}` + reject ถ้าไม่ตรง |

### MISS · Missing features
| ID | severity | title | suggested_fix |
|---|---|---|---|
| MISS-01 | P2 | ไม่มี Vendor Bill module | model + route + cron Gmail bill-ingest |
| MISS-02 | P2 | PosCashEvent/CoinEvent ingest แล้วไม่มี reader | intra-day query + noon-window + heatmap |
| MISS-03 | P2 | ไม่มี Maid Roster/Leave/Substitute | model `ChairopsMaidLeave` + sop-check skip leave |
| MISS-04 | P1 | 4/6 Alert kinds ไม่มี detector | cron `chairops-anomaly-check` รัน 4 detector |
| MISS-05 | P2 | ไม่มี chair list page · /chairops/chairs = 404 | page + leaderboard rank chairs |
| MISS-06 | P2 | รายงานรายเดือนไม่มี cost/profit | เพิ่ม column ใช้ getBranchPL |
| MISS-08 | P2 | ไม่มี Maid Pay/Commission tracking | model `ChairopsMaidPayoutPeriod` + Wave 2-3 |
| MISS-09 | P3 | LOW_STOCK ไม่ proactive alert (badge เห็นในหน้า /parts แต่ไม่มี LINE/widget) | enum LOW_STOCK + home widget |
| MISS-10 | P3 | ไม่มี Weekly P&L digest | cron weekly-digest จันทร์เช้า |
| MISS-07 | P2 | (refuted บางส่วน) Multi-floor pairing — CEO ตัดสินใจให้แยกแล้ว | ใช้ mallGroup+city aggregate แทน |

### CONFLICT · Cross-screen
| ID | severity | title | suggested_fix |
|---|---|---|---|
| CONF-01 | P0 | 5 surface office อ่าน deposit จาก legacy column = 0 | helper getDepositsInRange union 2 tables |
| CONF-03 | P1 | branches "POS วันนี้" = lifetime · exec "POS วันนี้" = today | workspace ใช้ today aggregate |
| CONF-04 | P1 | org-level ledger รวม pending ข้ามสาขา math ผิด | iterate per-branch แล้ว merge |
| CONF-05 | P1 | 3 widget "drift รวม" 3 formula ต่างกัน | helper getCumulativeShortage + label sync |
| CONF-07 | P1 | Attention strip "drift รวมวันนี้" คือ lifetime | swap copy เป็น "drift ค้างสะสมรวม" |
| CONF-09 | P2 | Toggle "7d/today" critical-branches เป็น dead UI | ลบปุ่ม หรือ wire timeframe จริง |
| CONF-10 | P2 | daysSinceLastCollection cache vs live ขัดกัน | drop field + live calc |

### PERF
| ID | severity | title | suggested_fix |
|---|---|---|---|
| PERF-02 | P2 | recomputeAllDrifts sequential 30+ สาขา | Promise.all chunked หรือ aggregate SQL เดียว |
| PERF-03 | P2 | Alerts loop findFirst 2 ครั้ง/สาขา + LINE per-alert | pre-fetch + Map<(branchId,kind)> + createMany |
| PERF-04 | P3 | Missing (orgId, collectedAt) + (orgId, bizDate) index | migration index-only · safe |
| PERF-05 | P3 | PosDaily updates ทำทีละ row ใน tx | bulk UPDATE FROM VALUES หรือ deleteMany+createMany |
| PERF-06 | P3 | Exec home 15+ prisma calls + getDashboardRows × 3 | รวม 4 range-aggregate เป็น 1 query · move costRows เข้า Promise.all |
| PERF-08 | P2 | Add-branch flow โหลด diffSummary JSON ทุก pending | jsonb_set $executeRaw หรือ unknownBranches relation table |

### MOBILE
| ID | severity | title | suggested_fix |
|---|---|---|---|
| MOBILE-01 | P1 | Branches 3-pane hardcode pane=detail · มือถือเลือกสาขาไม่ได้ | URL param ?pane + mobile switch |
| MOBILE-04 | P1 | P&L table min-w-860 → CEO iPhone scroll ขวาหา DRIFT | stacked card md:hidden |
| MOBILE-02 | P2 | AdminShell topbar z-40 ทับ MaidShell green header z-30 | ซ่อน topbar เมื่อ pathname /chairops/m หรือ MaidShell top-14 |
| MOBILE-03 | P2 | Collect form touch target 40px ต่ำกว่า 44pt | h-11 + gap-3 |
| MOBILE-05 | P2 | Green header ไม่ใช้ safe-area-inset-top · iPhone notch ทับ | paddingTop env(safe-area-inset-top) |
| MOBILE-06 | P2 | Profile avatar 36px กดยาก | size-11 + hit area |
| MOBILE-08 | P2 | Deposit "เลือกทั้งหมด/ล้างเลือก" h-9 ต่ำ | h-11 text-sm + segmented control |
| MOBILE-09 | P2 | "เก็บเงินสาขานี้" py-2 ต่ำ + กดผิดสาขาเสี่ยง drift ผิดที่ | min-h-11 + branch confirmation toast |
| MOBILE-07 | P3 | iOS Safari date input text-sm trigger auto-zoom | text-base + h-10 หรือ custom picker |
| MOBILE-10 | P3 | Reconcile sidebar mobile max-h 320px scroll หลายหน้า | max-h 50vh + accordion |

### DEVIL · Devil's advocate
| ID | severity | title | suggested_fix |
|---|---|---|---|
| DEVIL-04 | P1 | reconcile/alerts.ts ยังใช้ LINE Notify EOL (alert ส่งไม่ออก) | swap sendLineNotify → notifyChannel 3 จุด |
| DEVIL-02 | P1 | Cleanliness sidebar เปิดให้ manager แต่หน้า gate MAID-only · คลิก 403 | สร้าง manager view หรือลบเมนูจาก modules.ts |
| DEVIL-03 | P1 | "เบิกของ" maid form เขียน DB ได้ · ไม่มีหน้า office รับคิว | ลบ flow หรือ /chairops/parts?selected=requests |
| DEVIL-01 | P2 | dashboard/[branchSlug] legacy + branches workspace ซ้อนกัน | ลบปุ่ม MoreHorizontal + redirect legacy ไป workspace |
| DEVIL-07 | P1 | /chairops/branch-collect ไม่มีใน sidebar · office หาไม่เจอ | เพิ่ม nav entry "เก็บเงินแทนแม่บ้าน" OFFICE+ only |
| DEVIL-10 | P2 | AdminShell wrap /damage /parts /accounts /audit มี top-nav ซ้อน sidebar | ลบ features/admin-shell.tsx + 4 layouts ตาม (office) pattern |
| DEVIL-05 | P3 | OfficeTopNav + BranchesLeaderboard dead 235 LOC | ลบไฟล์ |
| DEVIL-06 | P2 | Chair detail page ไม่มีลิงก์เข้า · ROI = 0 | wrap ChairCodeChip เป็น Link |
| DEVIL-09 | P2 | Legacy /chairops/collect/* stubs ค้างเลย +1 สัปดาห์ | ย้าย maid-shell + ลบ stubs |
| DEVIL-08 | P3 | Cron backfill-pool-plumbing ค้าง schedule ทั้งที่ heal แล้ว | ลบบรรทัด vercel.json + route.ts |
| DEVIL-11 | P3 | "เบิกของ" card status hardcode idle · ไม่เคยขึ้น "เสร็จ" | query SparePartMovement หรือลบ card |

---

## 6. Refuted/false-positive log

orchestra ตรวจแล้ว · พบว่าไม่ใช่ปัญหา (หรือเป็น design decision ที่ CEO sign-off แล้ว):

- **MGR-07** · ไม่มี handover flow เมื่อ Manager คนเดิมลาออก
- **UX-08** · Sidebar active highlight ไม่จับ sub-path
- **SEC-09** · LINE webhook fall-back ack 200 เมื่อไม่ตั้ง secret
- **CONF-02** · Exec home + Critical-branches อ่าน POS legacy table
- **CONF-06** · Branches workspace MoreHorizontal ลิงค์ออก legacy DRIFT sign สลับ
- **CONF-08** · Cost prorate ไม่ตรงกัน KPI vs tfoot
- **PERF-01** · buildLedger เรียก 3 ครั้ง pull 365 วัน
- **PERF-07** · information_schema probe ทุก preview
- **PERF-09** · Branches workspace pull collection rows ดิบ 7d
- **PERF-10** · Hash dedup batch 1000 IN query
- **MOBILE-11** · Office top-nav overflow-x-auto บน mobile ไม่มี scroll indicator

---

## 7. Sequencing recommendation

**ถ้า CEO มี 1 dev-week ใส่ ChairOps ต่อไป · นี่คือ 5 รายการที่ควรทำตามลำดับนี้:**

### 🥇 Day 1 morning · "หยุด lying ที่ใหญ่สุดก่อน" (ROI สูงสุด)
**ทำ #1 (deposit หายจาก 5 หน้า) + #2 (LINE alert ตาย) พร้อมกัน — รวม XS+M ≈ ครึ่งวัน**

- **เหตุผล** — ทั้งคู่คือเหตุที่ CEO บ่นซ้ำว่า "ตัวเลขไม่ตรง" และ "ไม่มีใครเตือนเงินขาด" · ไม่แก้สองข้อนี้ก่อน · ทำอะไรใหม่ก็ไร้ความหมายเพราะ CEO เปิดจอเห็น 0 ทุกวันอยู่ดี
- **dependency** — #1 + #4 (write-off ไม่หัก drift) สอง bug นี้รวมกันเป็น root cause ของอาการ "drift ค้างไม่หาย" ที่ทำให้ CEO ไม่เชื่อระบบ · แก้พร้อมกันจะเห็นผลทันที
- **risk ต่ำสุด** — fix อยู่ในตาราง/sql ระดับ helper · ไม่ต้องเปลี่ยน schema · ไม่กระทบ flow user

### 🥈 Day 1 afternoon · "ปิดรอยรั่ว multi-tenant ทั้งหมดในชุดเดียว" (S-M)
**ทำ #6 + SEC-01..05 พร้อมกัน — รวม M ≈ ครึ่งวัน**

- **เหตุผล** — pattern เดียวกันทุกข้อ (เพิ่ม `where.orgId = session.user.orgId`) · ทำพร้อมกันได้ใน 1 PR · ใช้ pattern ที่ `branches-workspace.ts` มีอยู่แล้วเป็น reference
- **timing** — ต้องปิดก่อน CEO onboard tenant 2 (ChairOps SaaS ambition 1,200 chair) · วันนี้ leak = 0 จริง แต่ทันทีที่มี tenant ที่สอง = catastrophic data breach
- **risk ต่ำ** — เป็น additive guard ไม่ลบ feature ใด · ทำ smoke test แค่ดูว่า single-tenant ยังทำงานปกติ

### 🥉 Day 2 · "ปิด anti-fraud hole ใหญ่สุด" (XS+S)
**ทำ #7 (timezone) + MAID-04 (diff ≥ 100 ฿ บังคับ notes) + DATA-05 (missed-maid ใช้ cutoff 17:00) — รวม S ≈ ครึ่งวัน**

- **เหตุผล** — 3 ข้อนี้คือ "CEO เห็นข้อมูลเช้าทุกวันแล้วตัดสินใจผิด" + "แม่บ้านพิมพ์ผิด/ยักยอกได้เงียบๆ" — กระทบนโยบาย [[chairops-no-cumulative-shortage]] ตรง
- **dependency** — ต้องทำหลัง #1 เพราะ KPI deposit ที่ถูกแล้วเท่านั้นถึงจะเช็ค missed-maid ได้ตรง

### 🏅 Day 3 · "ทำ Mobile Branches workspace ใช้งานได้" (S)
**ทำ MOBILE-01 (pane toggle) + MOBILE-04 (P&L stacked card) — รวม S+M ≈ 1 วัน**

- **เหตุผล** — CEO ใช้ phone ตรวจร้านระหว่างเดินทาง (ระบุชัดใน user story) · 2 surface นี้คือที่ CEO เปิดบ่อยที่สุด · วันนี้บนมือถือใช้ไม่ได้เลย
- **timing** — ก่อนเริ่มสัปดาห์ใหม่ CEO จะได้ลองใช้ phone จริง

### 🎯 Day 4-5 · "ปิด user-visible regression สำคัญ" (S+S+S)
- **OFC-01** · คอลัมน์สลิป ledger ทำให้กดดูได้ (XS)
- **OFC-03** · WriteOff request ping LINE → MGR/CEO รู้ว่าต้องอนุมัติ (XS)
- **MAID-03** · Office เก็บแทน → ฝากได้ · ปลด orphan collection (S)
- **MISS-04** · POS_NOT_INGESTED detector — เพราะ POS ค้างมา 2 เดือนแล้วระบบเงียบสนิท (XS)

---

### สิ่งที่ **อย่าเพิ่งทำ** ใน 1 dev-week แรก
- **#5 (Cleanliness manager view)** — รอ CEO sign-off ก่อนว่าลบหรือสร้าง · อย่าให้ dev เดา
- **MGR-01 (Area scoping model)** — schema change ใหญ่ · ตอนนี้ manager จริงๆ ยังไม่มีคนใช้
- **MISS-01 (Vendor bill)** — L dev-time · CEO ตามด้วย LINE/Email มือยังพอที่ 30 สาขา · ไม่ block ปัจจุบัน
- **Refactor PERF-02/03 (sequential loops)** — 30 สาขายังไหว · ทำเมื่อใกล้ 100+ ค่อยกลับมา

---

**สิ่งที่ต้องตอบ CEO ก่อน Day 1 เริ่ม:**
1. Cleanliness manager — สร้าง view ใหม่หรือลบเมนู? (ตัดสินใจ business value · ไม่ใช่ tech)
2. "เบิกของ" maid form — เก็บแล้วสร้าง office queue หรือลบทิ้งตามนโยบาย "maid ONLY collect cash"?
3. canonical "drift รวม" formula — positive-only sum (ตรง mental model) หรือ signed net? · ต้องเลือก 1