# ตู้คีบ OS (ClawOS) — BUILD CONTRACT

> Pinned contract สำหรับ build agents. ทุก agent อ่านไฟล์นี้ก่อนเริ่ม. ห้ามแตะไฟล์นอก scope ของตัวเอง.

## เป้าหมาย
Rebuild UI ของโมดูล `clawfleet` (ตู้คีบ) ให้ตรง design ใหม่ (claude.ai/design 2026-06-28) เป๊ะ ๆ —
ภาษาดีไซน์ **ขาวบนน้ำเงิน indigo `#4F46E5`** สะอาดตา. **Backend เดิมสมบูรณ์แล้ว → reuse, อย่าเขียนใหม่.**

## DESIGN SOURCE (อ่าน section ของตัวเอง เต็ม ๆ)
`/Users/patipantantikul/Downloads/untitled 5/project/ระบบตู้คีบ.dc.html` — เป็น HTML prototype (inline styles + `{{ }}` placeholders + `sc-for/sc-if`).
- DASHBOARD 106–241 (สร้างแล้ว = ตัวอย่างอ้างอิง pattern)
- BRANCHES 243–358
- STOCK/WAREHOUSE 359–597 (overview tab + distribution tab + 2 modals: shipment detail, warehouse item detail)
- AUDIT/COLLECTIONS 599–696 (list + drill-down: เส้นทางตุ๊กตา/เงิน + รูปมิเตอร์ + ปุ่ม review)
- MACHINE CONFIG 698–748 (คำขอตั้งค่าตู้ + อนุมัติ/ตีกลับ)
- MATRIX 750–862 (ตาราง ตู้×วัน + drill modal รายตู้)
- REPORTS 864–900 (ตู้ปัญหา + สินค้าใกล้หมด + คุณภาพพนักงาน)
- STAFF 902–917 (ตารางพนักงาน)
- SETTINGS 919–985 (role cards + perm matrix + system toggles + users table)
- FRONT/MOBILE 987–2225 (phone: home/route/tour/drafts + panels + collect 6-step wizard)
- JS state model 2226–2412 (ดูชื่อ field/ค่าตัวอย่าง)

**กฎการแปล:** recreate visual เป๊ะ (สี/ระยะ/radius/ฟอนต์) แต่เขียนเป็น React สะอาด. ใช้ Tailwind สำหรับ layout grid (responsive)
+ inline style สำหรับรายละเอียด visual. ทุกหน้า **ต้อง responsive** (desktop grid → stack บนมือถือ ด้วย `grid-cols-1 lg:grid-cols-...`).

## FOUNDATION KIT (import ได้เลย — อย่าสร้างซ้ำ)

### `@/components/clawfleet/os/format` (server-safe, pure)
- `baht(cents)` → "฿1,234" (อินพุต = สตางค์)
- `bahtN(n)` → "฿1,234" (อินพุต = บาทเต็ม) ← **P&L queries คืนค่าเป็นบาท ใช้ bahtN**
- `num(n)` → "1,234" · `compact(n)` → "12.3k"
- `TONE: Record<Tone,{bg,text,border,soft}>` · `type Tone = "brand"|"green"|"red"|"amber"|"neutral"|"dark"`
- `pnlTone(flag)` → `{tone, label}` · `type PnlFlagKey = "LOW"|"GOOD"|"AMBER"|"HIGH"|"LOSS"|"NODATA"`
- `avgWinMarkerPct(avg)` → "62.5%" · `deltaColor(n)` → hex (+เขียว −แดง)
- `thDate(d)` `thWeekday(d)` `TH_MON` `TH_WD`

### `@/components/clawfleet/os/kit` ("use client")
- `<Pill tone children/>` — status pill
- `<IconBox tone size radius bg color>{svg/icon}</IconBox>` — กล่องไอคอนสี
- `<Kpi icon label value delta deltaColor valueColor iconTone/>` — KPI card
- `<Card title sub right pad children/>` — section card (pad=false ถ้าใส่ table เต็ม)
- `<Modal open onClose title sub badge width footer children/>` — modal กลาง
- `<Toggle on onChange/>` — switch
- `<ProgressBar pct color track height/>`
- `<AvgWinBar markerPct/>` — แถบสุขภาพการตั้งค่าตู้ (gradient + marker)
- `<PhoneFrame time children/>` — กรอบมือถือ (สำหรับ mobile preview)
- `<EmptyState icon title sub/>`

ไอคอน: ใช้ `lucide-react` (เหมือนทั้งแอป). สี/ฟอนต์/scrollbar มาจาก `.clawos` scope ของ layout แล้ว (ไม่ต้องตั้งเอง).

### Layout/Shell — มีแล้ว ห้ามแตะ
`app/(admin)/clawfleet/os/layout.tsx` ครอบทุกหน้าใต้ `os/` ด้วย `<ClawOsShell>` (sidebar + header title อัตโนมัติจาก `SCREEN_META` ใน `nav.tsx`).
**แต่ละ page แค่ return เนื้อหา (ไม่ต้องใส่ shell/sidebar/header เอง).** Header title/sub มาจาก `nav.tsx` `SCREEN_META[key]` แล้ว — ถ้าต้องการ action ขวาบน ให้วางเป็นแถบบนสุดของเนื้อหาแทน.

## BACKEND (reuse — `@/lib/clawfleet/*`)
- **P&L** `pnl-queries`: `getBranchPnl()→BranchPnl[]`, `getMachinePnl(branchId)→...`, `getBranchSessionHistory(branchId,take)→BranchSessionRow[]`, `summarizeBranchPnl(branches)→PnlSummary`, `pnlFlag()`, const `AVG_LOW_MAX=180/AVG_GOOD_MAX=280/AVG_AMBER_MAX=350`. **revenue/cost/profit/avgBahtPerDoll เป็นบาท.** `BranchPnl={branchId,name,code,area,revenue,dollsOut,cost,profit,avgBahtPerDoll,hasCost,flag:{flag,tone,label,severity},riskyMachines,sessions}`.
- **Loaders** `v2-loaders`: `loadBranches()`, `loadAnomalies(filter)→Anomaly[]`, `loadSessionDetail(code)`, `loadHubData(filter)`, `loadInsights(filter,days)→InsightRow[]`, `loadNavCounts()→{openSessions,anomalies}`, `loadBranchStock(branchId)`.
- **Queries** `v2-queries`: `getV2Branches()`, `getV2ManageBranches()`, `listV2Anomalies(filter)`, `getV2Anomaly(code)`, `getV2SessionDetail(code)`, `getV2HubData(filter)`, `getV2Insights(filter,days)`, `getV2BranchStock(branchId)`.
- **Actions** `v2-actions` ("use server"): `reviewV2Session`, `createBranch/renameBranch/deleteBranch`, `createCfMachine/renameCfMachine/retireCfMachine`, `createDelivery`, `startBranchSession/submitBranchEvent/closeBranchSession`, `startGroupSession/submitExchangerEvent/closeGroupSession`, `seedClawFleetDemo`, `clearClawFleetDemo`.
- **Stock** `stock-queries`: `getCfStockOverview(orgId,branchId)`, `getCfBranchStockProducts(...)`, `getCfReceipts(orgId,branchId)`, `getCfCounts`, `getCfLosses`, `getCfMovements`, `getCfProductsForForms(orgId)`. `stock-actions` ("use server"): `receiveStock`, `submitStockCount`, `recordLoss`, `transferStock`, `withdrawStock`, `lookupCfProductByBarcode`.
- **Team/Settings** `v2-admin-queries`: `getTeamData()→TeamData`, `getAuditFeed(limit)`, `getSettingsData()→SettingsData`. `team-actions`: `inviteCfStaff`, `updateCfStaffRole`, `removeCfStaff`, `regenInviteLink`.
- **Anti-cheat/derive** `validation`: `deriveBranchCrossCheck(...)`, `deriveEvent(...)`, `formatTHB(cents)`, `severityLight(cents)`.
- **Roles** `role-guard`: `CF_ADMIN_ROLES`, `requireCfSession()`, `isCfAdmin(role)`, `assertCfAdmin()`.

**Anomaly type** (`v2-data.ts`): `{id,branchId,branchName?,branchCode?,machineName?,severity:"P0"|"P1"|"P2",type,typeLabel,reason,expectedCash,actualCash,gap,gapPct,prizeExpected,prizeActual,prizeGap,timeAgo,staff,machines}`.

## DATA STRATEGY (สำคัญ)
- **READ screens**: เรียก query จริงใน server `page.tsx` ใน try/catch → ส่งให้ client. **ถ้า array ว่าง → client ใช้ SAMPLE fallback** (กำหนด const ในไฟล์ client) เพื่อไม่ให้หน้าโล่ง + โชว์แบนเนอร์ "กำลังแสดงตัวอย่าง". (ดู dashboard-client.tsx เป็นแบบ)
- **WRITE paths** (collect wizard, config approve/reject, stock receive/count, transfer): wire เข้า server action จริง. ถ้าเป็น demo/sample id (ขึ้นต้น "s"/"demo-") ให้จำลองใน client (optimistic) ไม่เรียก action จริง.
- เงิน: query P&L เป็นบาท→`bahtN`; field `*Cents`→`baht`.

## CONVENTIONS / กันบั๊ก
- ทุก client component ขึ้นต้น `"use client"`. page.tsx เป็น server component (`export const dynamic="force-dynamic"`).
- ห้าม `any`/`@ts-ignore`. ห้าม import server action เข้า client แบบ value ถ้าไม่ได้เรียก (import เฉพาะที่ใช้).
- ตรวจ tsc ของไฟล์ตัวเอง: `cd /Users/patipantantikul/Code/pooilgroup/legacy/clawos-wt && ./node_modules/.bin/tsc --noEmit 2>&1 | grep "<your path>"` = 0 error. **อย่ารัน `next build`** (parent ทำให้ทีหลัง — lock ตัวเดียว).
- Prisma 7 import (ถ้าจำเป็น): enums `@/lib/generated/prisma/enums`, `Prisma` namespace `@/lib/generated/prisma/client`. แต่ปกติ reuse query ที่มีอยู่แล้ว ไม่ต้องแตะ prisma.
- Responsive: desktop grid → `grid-cols-1 lg:grid-cols-...`. ตารางกว้าง → `overflow-x-auto`. หน้าต้องดูดีทั้งคอม+มือถือ.

## FILE OWNERSHIP (disjoint — ห้ามแตะของคนอื่น)
- branches → `app/(admin)/clawfleet/os/branches/page.tsx` (+ `branches-client.tsx`)
- stock → `app/(admin)/clawfleet/os/stock/{page.tsx,stock-client.tsx}`
- collections → `app/(admin)/clawfleet/os/collections/{page.tsx,collections-client.tsx}`
- config → `app/(admin)/clawfleet/os/config/{page.tsx,config-client.tsx}`
- matrix → `app/(admin)/clawfleet/os/matrix/{page.tsx,matrix-client.tsx}`
- reports → `app/(admin)/clawfleet/os/reports/{page.tsx,reports-client.tsx}`
- staff → `app/(admin)/clawfleet/os/staff/{page.tsx,staff-client.tsx}`
- settings → `app/(admin)/clawfleet/os/settings/{page.tsx,settings-client.tsx}`
- mobile app → `app/(admin)/clawfleet/os/app/{page.tsx,staff-app-client.tsx}`

ห้ามแก้: layout.tsx, clawos.css, nav.tsx, shell.tsx, kit.tsx, format.ts, dashboard/*, modules.ts, admin-shell.tsx.
