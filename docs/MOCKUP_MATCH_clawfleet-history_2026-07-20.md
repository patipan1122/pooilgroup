# Mockup-Match · ClawFleet ประวัติการเก็บเงิน (collection history) · 2026-07-20

Mockup: claude.ai/design `1050db4c-e115-4416-ae74-0428994b8ac7` → `เก็บเงิน Flow (ออกแบบใหม่).dc.html` (panel `history`)
Target file: `app/(admin)/clawfleet/os/app/staff-app-client.tsx` → `HistoryPanel` (line ~1819)
Data: read-only. Money wire (`submitBranchEvent` actions.ts:274, `closeBranchSession` :682) — **DO NOT TOUCH**.

Legend: ✅ ตรง · ❌ ต่าง/ขาด · ➕ ของจริงมีเกิน mockup · 💰 แตะเงิน · 🧩 data-gap

## LIST view (HL)
| ID | องค์ประกอบ | mockup ว่าไง | ของจริงตอนนี้ | 👁️ | ⚙️ |
|---|---|---|---|---|---|
| HL-01 | หัวแถบ "ประวัติการเก็บ" + ปุ่มย้อน | มี | มี (panel title) | ✅ | ✅ |
| HL-02 | แท็บวัน (scroll) label+N รอบ+จุดแดงถ้ายอดไม่ตรง · active=indigo | มี | ❌ ใช้ปฏิทินเลือกวัน | ❌ | ❌ |
| HL-03 | การ์ดสรุป (indigo gradient) 2×2: เก็บได้รวม/ตุ๊กตาออกรวม/จำนวนรอบ/เปลี่ยนตุ๊กตา | มี | ❌ ไม่มี | ❌ | ❌ |
| HL-04 | แถบเตือน "มี N รอบยอดไม่ตรง — ตรวจแล้ว" | มี (ถ้ามี bad) | ❌ ไม่มี | ❌ | ❌ |
| HL-05 | ป้าย section "รายการรอบเก็บ" | มี | ❌ ไม่มี | ❌ | — |
| HL-06 | แถวรอบ: ไอคอนสถานะ(✓/⇄/✗) กล่องสี + code + ชนิด + "ตุ๊กตาออก N · note" + เงิน(ขวา,สี) + เวลา + chevron | มี | 🟡 มีแถว แต่ layout ต่าง (ไม่มีไอคอนสถานะ/ตุ๊กตาออก) | ❌ | ✅ |
| HL-07 | แตะแถว → เปิดหน้ารายละเอียด | มี | ❌ แตะแล้วไม่มีอะไรเกิด | ❌ | ❌ |
| HL-08 | empty state วันที่ไม่มีรอบ | (mockup ไม่โชว์) | ✅ มี (ซื่อสัตย์) | ➕ | ➕ |
| HL-09 | ปฏิทินเลือกวันย้อนหลัง (45 วัน) | ❌ mockup มีแค่ 3 แท็บ | ✅ มี date-picker | ➕ | ➕ |
| HL-10 | ป้าย "การตั้งค่าครั้งแรก" (baseline) | ❌ ไม่มี | ✅ มี | ➕ | ➕ |
| HL-11 | ป้าย "รูปยังไม่ครบ" + ปุ่ม "แนบรูปเพิ่ม" | ❌ ไม่มี | ✅ มี (useful) | ➕ | ➕ |

## DETAIL view (HD) — **ใหม่ทั้งหมด (real app ยังไม่มี)**
| ID | องค์ประกอบ | mockup ว่าไง | ของจริง | 👁️ | ⚙️ |
|---|---|---|---|---|---|
| HD-01 | หัวแถบ "รายละเอียดรอบเก็บ" + ย้อนกลับ list | มี | ❌ | ❌ | ❌ |
| HD-02 | การ์ดหัว: code badge + ชนิด·สาขา + วัน·เวลา + โดย staff | มี | ❌ | ❌ | ❌ |
| HD-03 | แถบสถานะสี (ยอดตรง/ยอดไม่ตรง·ตรวจแล้ว/เปลี่ยนตุ๊กตา·ไม่เก็บเงิน) | มี | ❌ | ❌ | ❌ |
| HD-04 | กล่องแดง badReason (ถ้า bad) | มี | ❌ | ❌ | ❌ |
| HD-05 | 2 การ์ดสถิติ: เงินที่เก็บได้(สี) · ตุ๊กตาออก | มี | ❌ | ❌ | ❌ |
| HD-06 | นับตุ๊กตา: ก่อนเติม / เติมเพิ่ม +N / หลังเติม | มี | ❌ | ❌ | ❌ |
| HD-07 | สินค้าในตู้: แถว SKU (icon+ชื่อ+ราคา/ตัว+ออก N ตัว) | มี | ❌ | ❌ | 🧩 per-SKU "ออก" ไม่ถูกเก็บ |
| HD-08 | มิเตอร์ (ถ้ามี): ตุ๊กตา prev→now(delta) · เหรียญ prev→now(delta) · ป้ายตรง/ไม่ตรง | มี | ❌ | ❌ | ❌ |
| HD-09 | รูปที่แนบ: N รูป + grid 3 คอลัมน์ (แตะดูรูปจริง) | มี | ❌ | ❌ | ❌ |

## ⚙️ Function plan — REVISED (deployed baseline reveal)
🔑 **The deployed `origin/setup` (5525 lines) is FAR ahead of the WIP first read.** `StaffHistoryRow` already carries EVERYTHING: `kind: collect|swap|baseline` (real swap flag → D3 heuristic UNNEEDED), `expectedCashBaht/cashDiffBaht/ok`, `stockBefore/After/dollsOut`, `refillQty`, `sellPriceCents`, `refillSkus[]`, `coinMeter/coinMeterBefore/dollMeter/meter{Money,Doll}{Top,Bottom}`, real `photos[]{url,label}`, swap SKUs, `canEditNumbers`, `eventId`.
- History query already loads **~45 days grouped client-side** (page.tsx `HISTORY_SINCE`, take 150). Day-tabs have data. **Calendar now redundant** (everything preloaded) → day-tabs cover full retention, scrollable.
- Deployed detail = **bottom-sheet fix-form**; already renders เงิน/ตุ๊กตา/มิเตอร์4/SKU/photos/swap. → RESTYLE to mockup's full-screen sectioned view.
- **PURE client-side restyle of `HistoryPanel` (2144-2414). NO new query. Money wire untouched.** Keep extras: attach-photos, edit-numbers (canEditNumbers), zoom lightbox.
- Build in worktree `/private/tmp/pg-wt-clawhist` (branch `claude/clawfleet-history-mockup` off origin/setup).

## ✅ RESULT — DEPLOYED `4fcef4b2` → setup · proven on prod (pooilgroup.com) · 2026-07-20
📊 ✅ ทุกแถวตรง · ⬜ 0 · ⏸ 0 · CEO อนุมัติ deploy → verify 5 ด่านผ่าน → push setup → พิสูจน์บน prod จริง (PROD-*.png)
Evidence: `/tmp/mockup-match_clawfleet-history_2026-07-20/real/*.png` (mockup อ้างอิงใน `../mockup/`)
- **LIST** (HISTORY-list.png · HISTORY-list-6.png): แท็บวัน 18/16/13 ก.ค. + จุดแดงวันมี bad ✓ · การ์ดสรุป indigo 2×2 (฿135/2/6รอบ/3swap) + แถบเตือน "มี 1 รอบยอดไม่ตรง" ✓ · แถวไอคอน ✗แดง(bad)/ธงอำพัน(baseline)/⇄น้ำเงิน(swap) ✓ · แตะ→detail ✓
- **DETAIL collect bad** (HISTORY-detail-collect.png): หัว+แถบแดง "ยอดไม่ตรง·ตรวจแล้ว" ✓ · ฿135 แดง + 2 ตุ๊กตาออก ✓ · นับตุ๊กตา 8/+2/8 ✓ · สินค้าในตู้ "หมี · ออก 2" (1 SKU→ออก N · D2) ✓ · มิเตอร์เหรียญ 5→9(+4)+"ไม่ตรงกับที่นับ" ✓ · รูปที่แนบ 4 รูปจริง ✓
- **DETAIL swap** (HISTORY-detail.png): หัว+แถบ "เปลี่ยนตุ๊กตา·ไม่เก็บเงิน" ✓ · 0 คืน/+2 เติม ✓ · ราย SKU จริง+รูปสินค้า ✓
- tsc --noEmit: clean (0 error ในไฟล์ · เหลือ 1 pre-existing ใน pinpoint route ที่ setup มีอยู่แล้ว)
- 🔒 money wire ไม่แตะ · ไม่เพิ่ม query · ยังไม่ deploy (รอ CEO อนุมัติ + บัญชี/วันที่ prod)

## Decisions LOCKED (CEO 2026-07-20)
- D1 → day-tabs + summary hero (calendar redundant — 45d preloaded)
- D2 → 1-SKU round shows "ออก N" exact; multi-SKU shows "เติม N"
- D3 → **use real `kind==='swap'` flag** (better than the approved heuristic — no money touch)
- D4 → verify vs real staff account + date (await CEO's account/date at prove time)
