# CafeOrder — 6 หน้าที่เติมเพิ่มให้แผนครบ (2026-07-25)

> CEO 2026-07-25: "เติมแผน 6 หน้าที่ขาดให้ครบก่อน แล้วค่อยออกแบบ"
> ต่อจาก [WORKSHOP_CafeOrder.md](./WORKSHOP_CafeOrder.md) §8 (เดิม 19 หน้า → **25 หน้า**) · ยังเป็น plan-only ไม่เขียนโค้ด
> ทุก `file:line` = ของเดิมที่ยืมได้ (ตรวจแล้ว 2026-07-25)

## สรุปเข้า MoSCoW
เพิ่ม **M25-M30** เข้า MUST ของ v1 · ทุกหน้าเป็นของที่ตาราง/journey/DoD เดิมพึ่งอยู่แล้วแต่ไม่มีใครวาด (เหมือนกรณี M19-M24)

| หน้า | แอป | reuse หลัก | ของใหม่จริง |
|---|---|---|---|
| M25 login เบอร์+OTP | ลูกค้า | LINE login เดิม | 🔴 **SMS provider (ยังไม่มีในระบบ)** |
| M26 บัตรสมาชิกเซฟได้ | ลูกค้า | `lib/dc/doc-image.tsx` (next/og) + `lib/dc/qr.ts` + Playland wristband | รหัสสมาชิก |
| M27 จัดการพนักงาน+สิทธิ์ | หลังบ้าน | `clawfleet/os/staff` + `lib/auth/module-access.ts` | — (ยืมเกือบหมด) |
| M28 รายงาน | หลังบ้าน | `kpi-tile` + `heatmap-v2` + `api/cashhub/reports` | — |
| M29 ตั้งค่ากติกาแต้ม | หลังบ้าน | settings page pattern (`ledger/settings`) | ตาราง `cafe_point_policies` |
| M30 dashboard วันนี้ | หลังบ้าน | `kpi-tile` + branch-access | — |

---

## M25 · [LIFF/WEB] หน้า Login เบอร์ + OTP (ลูกค้า · web fallback)

**ทำไมต้องมี:** CEO 2026-07-21 สั่ง "login เบอร์ได้ + ทั้ง ก(OTP) และ ข(ผูก LINE)" · และแต้มแลกของได้จริง = **เบอร์ = เงิน** → ต้องยืนยันตัวตน ไม่งั้นกรอกเบอร์คนอื่นใช้แต้มเขาได้ ([money-feature-client-preview-must-match-server] ขยายผล)

```
มาจาก LINE (LIFF):  รู้ userId อัตโนมัติ → เข้าเลย ไม่ต้อง OTP
                     + แบนเนอร์ "ผูกเบอร์เพื่อสะสมแต้มข้ามช่องทาง" (ทางเลือก)

มาจากเว็บ (ไม่มี LINE):
┌─ เข้าสู่ระบบ CafeOrder ──────────┐   ┌─ ยืนยันเบอร์ ────────────────┐
│  เบอร์มือถือ                     │   │  ส่งรหัสไป 08x-xxx-1234 แล้ว   │
│  [08x-xxx-xxxx____]              │──►│  [ _ _ _ _ _ _ ]  (6 หลัก)     │
│                                  │   │  ขอรหัสใหม่ได้ใน 0:59          │
│  [ ส่งรหัส OTP ]                 │   │  [ ยืนยัน ]                    │
└──────────────────────────────────┘   └───────────────────────────────┘
```

**Data:** `cafe_members(id, lineUserId?, phone?, phoneVerifiedAt?, displayName, consentAt, marketingConsentAt?)` · `cafe_otp_challenges(phone, codeHash, expiresAt, attempts, lastSentAt)`
**Reuse:** LINE login = `app/api/auth/line-login/` + `app/api/auth/line-complete/` (มีแล้ว) · rate-limit = `prisma/migrations/004_rate_limit_attempts.sql` pattern
**🔴 ของใหม่:** SMS provider — grep ทั้ง repo **ไม่มี** → ต้องเลือกเจ้า (ThaiBulkSMS/SMSMKT ~0.25-0.40฿/ข้อความ) · env `CAFEORDER_SMS_API_KEY` + `CAFEORDER_SMS_SENDER` (namespaced ตาม RULE J) · ⚠️ **ต้องขอ CEO อนุมัติลง provider ใหม่**
**Edge:** OTP หมดอายุ 5 นาที · cooldown 60 วิ กันสแปม (ค่า SMS ออกทุกครั้ง) · เดาผิด 5 ครั้ง = ล็อก 15 นาที · เบอร์ตรงกับ LINE member อื่น = **ผูกเข้าบัญชีเดียว (link) ไม่สร้างซ้ำ** · consent PDPA 2 ช่อง (สมัคร vs รับโปรโมชั่น) แยกกันตั้งแต่ migration แรก

---

## M26 · [LIFF] บัตรสมาชิกดิจิทัล + เซฟรูปได้ (ลูกค้า)

**ทำไมต้องมี:** CEO 2026-07-21 "ลูกค้ามีสมาชิกของตัวเอง · เห็นจำนวนแก้ว+แต้ม · **เซฟรูปบัตรไว้ได้** · กดเอามาใช้ได้"

```
┌─ บัตรสมาชิก ───────────────────────┐
│  ☕ CafeOrder Member                │
│  คุณ สมชาย ใจดี                     │
│  ▉▉▉▉ QR ▉▉▉▉   รหัส: CAF-7K4P9M    │ ← QR = member code (Playland-style)
│  ▉▉▉▉▉▉▉▉▉▉▉▉                       │
│  แต้ม 47  ·  สะสม 47/60 แก้ว        │
│  ┌───────────────────────────────┐ │
│  │ [ 💾 เซฟรูปบัตร ] [ + เพิ่มลง LINE ]│ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Reuse:** สร้างรูป PNG = `lib/dc/doc-image.tsx` (next/og + Satori + ฟอนต์ไทย — ยืมได้เลย) · QR = `lib/dc/qr.ts` · barcode = `lib/dc/barcode.ts` · รหัสสมาชิก = Playland `lib/playland/wristband.ts` (alphabet ไม่กำกวม ACDEFHJKLMNPQRTUVWXY3479) · เก็บรูป = `lib/r2/upload.ts:23`
**Data:** `cafe_members.memberCode` (unique · gen ตอนสมัคร)
**สำคัญ — ปลอดภัย:** QR โชว์แค่ **รหัสสมาชิก** (ระบุว่าเป็นใคร) · **การแลก/ตัดแต้มยังต้องยืนยันในแอปฝั่ง server** → รหัสหลุด = ดูแต้มได้ แต่แลกแทนไม่ได้ (ไม่ใช่ bearer)
**หน้าร้าน:** บาริสต้าสแกน QR = ระบุตัวลูกค้า/ดูแต้ม (reuse `components/dc/scan-box.tsx`) · ⚠️ **ยิงแต้ม walk-in ตอนซื้อ ยังอยู่ WON'T v1** (คิวเช้า) — บัตร v1 ใช้ระบุตัว+โชว์แต้ม+แลกบนออเดอร์เดลิเวอรี
**Edge:** ยังไม่ verify เบอร์/ไม่มี LINE = บัตรยัง gen ได้แต่ธง unverified · แต้ม 0 = โชว์ empty state "สั่งแก้วแรกเริ่มสะสม"

---

## M27 · [ADMIN] จัดการพนักงาน + สิทธิ์ (หลังบ้าน)

**ทำไมต้องมี:** ต้องเชิญบาริสต้า/ไรเดอร์/ผจก. เข้าสาขา — ไม่มีหน้านี้ = เปิดใช้จริงไม่ได้

```
┌─ พนักงาน · สาขา 5157 ▾ ──────────── [+ เชิญพนักงาน] ┐
│  สมชาย   บาริสต้า   ●ใช้งาน   [แก้] [ปิด]           │
│  สมหญิง  ไรเดอร์    ●ใช้งาน   [แก้] [ปิด]           │
│  วิชัย    ผจก.สาขา  ●ใช้งาน   [แก้] [ปิด]           │
└──────────────────────────────────────────────────────┘
[+ เชิญ] → เลือก: ตำแหน่ง(บาริสต้า/ไรเดอร์/ผจก.) + สาขา → สร้างลิงก์เชิญ
```

**Reuse:** หน้า = `app/(admin)/clawfleet/os/staff/staff-client.tsx` · คำสั่ง = `lib/clawfleet/team-actions.ts` · ให้สิทธิ์ = `lib/auth/module-access.ts` (grant) + `lib/auth/branch-access.ts` · role 9 ตัวมี `driver` อยู่แล้ว
**🔴 กฎบังคับ (memory):** เชิญต้องให้ครบ **3 อย่าง: role + branch + `user_modules`** ([clawfleet-invite-grants-role-branch-not-module-entitlement]) · ทำ self-heal ให้สาขา cafe/cafe_punthai อัตโนมัติแบบ `grantClawfleetIfBranchAssigned` (`module-access.ts:66`)
**Edge:** ห้าม role ต่ำแต่งตั้ง role สูงกว่าตัวเอง ([role-rank-privilege-escalation-guard]) · ไรเดอร์ต้องได้ role `driver` เท่านั้น · ปิดพนักงาน = ปิด session ทันที ไม่ลบประวัติ

---

## M28 · [ADMIN] หน้ารายงาน (หลังบ้าน)

**ทำไมต้องมี:** §1.2 ตั้งตัววัด 7 ตัว แต่ไม่มีหน้าจอให้ดู

```
┌─ รายงาน · [วันนี้][เดือนนี้] · สาขา 5157 ▾ ───────────┐
│ ┌ยอดขาย┐ ┌ออเดอร์┐ ┌เวลาส่งเฉลี่ย┐ ┌ตกหล่น/ยกเลิก┐   │ ← kpi-tile
│ │฿12,450│ │  84   │ │  28 นาที    │ │   3 (3.6%)  │   │
│ └───────┘ └───────┘ └─────────────┘ └─────────────┘   │
│ เวลาส่งแยก 3 ช่วง:  ชง 6' · รอไรเดอร์ 9' · เดินทาง 13'│
│ แต้ม:  ออก 84  ·  แลก 6 แก้วฟรี  ·  คงค้าง 1,240      │
│ ปฏิทินสถานะ (สาขา×วัน 1-31 · dot):  ▓▓░▓▓▓░...        │ ← CEO ชอบ
└────────────────────────────────────────────────────────┘
```

**Reuse:** `components/ui/kpi-tile.tsx` + `stat-block.tsx` · ปฏิทิน/heatmap = `components/cashhub/redesign/heatmap-v2.tsx` ([feedback-ceo-likes-calendar-checklist-grid-reports]) · โครง report = `app/api/cashhub/reports` / `app/(admin)/docuflow/reports/page.tsx`
**สำคัญ:** เวลาส่งคำนวณจาก `cafe_order_events` (event จริง ไม่ใช่ column) · ตัวเลขเงิน/แต้ม = server 100% ([money-feature-client-preview-must-match-server]) · ตั้ง SLA หลังเก็บ baseline 2 สัปดาห์
**Edge:** ผจก.พื้นที่เห็นหลายสาขา · ผจก.สาขาเห็นสาขาตัวเอง (branch-access) · เดือนที่ยังไม่มีข้อมูล = empty state ไม่ใช่ 0 หลอก

---

## M29 · [ADMIN] ตั้งค่ากติกาแต้ม (หลังบ้าน setting)

**ทำไมต้องมี:** อัตราแต้ม/เกณฑ์แลก ตอนนี้อยู่แค่ในคำเคาะ CEO — ต้องมีที่ตั้งค่าจริง (และเป็นตาราง `cafe_point_policies` ที่ §17 ข้อ 0-ข บล็อก migration แรกอยู่)

```
┌─ ตั้งค่ากติกาแต้ม · JPSYNC ────────────────────┐
│ ได้แต้ม:     [1] แต้ม ต่อ [1 แก้ว ▾]           │ ← CEO เคาะ 1แก้ว=1แต้ม
│ แลกแก้วฟรี:  ใช้ [10] แต้ม ต่อ 1 แก้ว          │ ← CEO เคาะ 10แต้ม
│ แต้มหมดอายุ: [●เปิด] หลัง [24] เดือน           │
│ ใช้ข้ามแบรนด์ (Amazon↔พันธุ์ไทย): [●เปิด]      │
│ เพดานแก้วฟรี/สาขา/เดือน:  [50] แก้ว           │ ← กันความเสียหาย
│ แก้วฟรีไม่ได้แต้ม: ●ล็อกไว้ (แก้ไม่ได้)         │
│                                    [บันทึก]    │
└─────────────────────────────────────────────────┘
```

**Reuse:** settings page = `app/(admin)/ledger/settings/` pattern · gate = admin tier เท่านั้น
**Data:** `cafe_point_policies(orgId, earnPerCup, redeemPointsPerCup, expiryMonths?, crossBrand, freeCupCapPerBranchMonth, effectiveFrom)`
**🔴 กฎ:** หนี้สินแต้ม = **JPSYNC** (CEO เคาะ) · เปลี่ยนอัตรากลางคัน = **forward-only** (ไม่ย้อนแต้มเก่า · effectiveFrom) · **บัญชีต้องเซ็นตัวเลขก่อนเปิด** (RULE I · [feedback-accounting-finance-skills-on-numbers]) · แก้วฟรีไม่ได้แต้ม (ล็อก)
**Edge:** ต้องมีค่า default ตั้งแต่ migration แรก (กันจอ ⑥ คำนวณ "อีกกี่แต้ม" ไม่ได้)

---

## M30 · [ADMIN] Dashboard รวมออเดอร์วันนี้ (หลังบ้าน)

**ทำไมต้องมี:** ผจก.ต้องเห็นภาพรวมสด ๆ ว่าวันนี้มีอะไรค้าง — กันออเดอร์ตกหล่น/ส่งช้า (ปัญหาหลัก CEO)

```
┌─ วันนี้ · สาขา 5157 ─────────────────────────────┐
│ รับใหม่ 3 │ กำลังชง 5 │ กำลังส่ง 4 │ เสร็จ 72 │ยกเลิก 3│
│ 🔴 ค้างนานเกิน 15 นาที: 1 ออเดอร์ (#1183 — 22')  │ ← เตือน
│ ไรเดอร์:  ว่าง 1 · กำลังส่ง 2                     │
│ ยอดวันนี้ ฿12,450                                 │
└────────────────────────────────────────────────────┘
```

**Reuse:** `components/ui/kpi-tile.tsx` · realtime = polling/SSE ตามผลวิจัย order-status (Supabase Realtime vs polling — เลือกตอน build) · branch scope = `branch-access.ts`
**Edge:** multi-branch (ผจก.พื้นที่เลือกสาขา) · ออเดอร์ค้าง = คำนวณจาก `cafe_order_events` timestamp · ไม่มีออเดอร์ = empty state

---

## เก็บพ่วง (thin — เติมในรอบเดียวกัน ราคาน้อย)
- **ประวัติออเดอร์ลูกค้า** (แท็บ "ออเดอร์" ①) + **ประวัติออเดอร์สาขา** (จาก ⑧) — reuse `data-table`
- **สมุดที่อยู่ (saved place)** — เดิม COULD → ควรขึ้น v1 เพราะแก้ "ส่งผิดที่" ที่ต้นทาง (CEO เน้น) · `cafe_saved_places(memberId, label, lat, lng, note)`
- **จัดการไรเดอร์** — รวมใน M27 (ไรเดอร์ = พนักงาน role driver)

## ✅ ผลรวม
แผน CafeOrder ตอนนี้ **25 หน้า ครบทั้ง 4 แอป + หลังบ้าน/setting ครบ** · พร้อมเข้าขั้นออกแบบภาพ (design) ทั้งระบบ
⚠️ ของใหม่ที่ต้องขอ CEO ก่อน build: **SMS provider** (M25) — นอกนั้นยืมของเดิมหมด
