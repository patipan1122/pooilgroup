# 👔 Executive UX Audit — 2026-05-05

> **เพื่อ:** ผู้บริหาร (Owner / Boss / Super Admin) ดูภาพรวม Pooilgroup
> **โฟกัส:** หน้า /home + /cashhub/dashboard + /companies (3 หน้าหลักของผู้บริหาร)

---

## 🎯 Executive Journey — ทดสอบทีละสเต็ป

### Journey A: เปิดเว็บมา → ดูภาพรวม
```
1. เปิด http://localhost:3100
   ✓ Redirect → /home (ถ้า login แล้ว) หรือ /login

2. /home
   ✓ เห็น hero "สวัสดี ภัทร · วันนี้จะเริ่มที่โปรแกรมไหน?"
   ✓ เห็น 3 module cards (CashHub / FuelOS / DocuFlow)
   ✓ เห็น "MY ACTIONS" + "SYSTEM" + "QUICK ACCESS"
   ❌ MISSING: Executive overview ที่นี่ (อยู่แต่ใน /cashhub/dashboard)
       → ที่จริง Owner ควรเห็น "ยอดเดือนนี้รวม" บน /home เลย

3. คลิก CashHub → /cashhub/dashboard
   ✓ เห็น hero "ภาพรวม ยอดสาขา"
   ✓ เห็น Company filter pills (ทั้งหมด / Pooil Oil / JP Sync Group)
   ✓ Section "00 EXECUTIVE OVERVIEW" → ตารางใหม่
       ✓ Default 12 เดือน (1 ปีเต็ม)
       ✓ Sticky first column "ประเภทธุรกิจ"
       ✓ เดือนนี้ highlight ฟ้า + label "เดือนนี้"
       ✓ Trend % เขียวขึ้น/แดงลง (binary discipline)
       ✓ Footer "รวมทั้งหมด" + arrow ↑↓
```

### Journey B: ขยายดูสาขาในประเภทธุรกิจ
```
1. คลิกแถว "ปั๊มน้ำมัน" → ▼ chevron หมุน
   ✓ ขยายแสดงสาขาทั้งหมด (KKN-001, KKN-002, ...)
   ✓ Sub-row indent + "└" + ตัวเล็กลง
   ✓ Sort by latest period total desc

2. คลิกสาขาในแถวขยาย
   ✓ navigate ไป /branches/[id] (full page reload)
   ⚠️  TODO: ใช้ Next router แทน window.location.href (SPA navigation)

3. คลิกประเภทอีกครั้ง → หุบ
   ✓ ขยายหลายประเภทพร้อมกันได้

4. ปุ่ม "ขยายทั้งหมด" / "หุบทั้งหมด" มุมขวาบน
   ✓ ทำงานถูกต้อง สลับ icon ตามสถานะ
```

### Journey C: สลับมุมมอง รายเดือน ↔ รายวัน
```
1. กด "📆 รายวัน"
   ✓ URL เปลี่ยนเป็น ?view=daily
   ✓ Server reload → 30 columns (30 วันล่าสุด)
   ✓ Latest = "วันนี้"

2. กด "📅 รายเดือน"
   ✓ กลับเป็น 12 เดือน
```

### Journey D: เลื่อนซ้ายขวาดูช่วงเก่า
```
1. ตารางมี horizontal scroll
   ✓ เลื่อนเห็นเดือน/วันเก่าได้
   ✓ Sticky first column ไม่หาย
   ⚠️  TODO: เพิ่มปุ่ม "ดูเก่ากว่า 12 เดือน" สำหรับ scrollback ลึก
```

### Journey E: Filter by company
```
1. คลิก "Pooil Oil" pill ที่หัว page
   ✓ URL → ?company=<id>
   ✓ Dashboard data filter
   ⚠️  TODO: Executive table ยังไม่ filter ตาม company (ใช้ทั้ง org)
       → ต้องแก้ loadExecutiveMatrix รับ companyId
```

---

## 🐛 Bugs / ความไม่สมบูรณ์ที่เจอ

| # | จุด | ปัญหา | Priority |
|---|------|---------|----------|
| 1 | Executive table | ไม่ filter ตาม company filter ที่ header | High |
| 2 | Sub-row navigate | ใช้ window.location ทำให้ full reload | Med |
| 3 | /home | ไม่มี executive snapshot — Owner ต้อง 1 click ไป CashHub | High |
| 4 | Daily view | 30 columns บนมือถือต้อง scroll เยอะ — โอเค แต่อาจเสริมปุ่ม scroll quick (← →) | Low |
| 5 | Empty cells "—" | text-zinc-300 อ่านยากนิด แต่ตั้งใจให้จาง | Low |
| 6 | ไม่มี date range custom | "ดูจากวันที่ X ถึง Y" | Med |
| 7 | ไม่มี year-over-year | "พ.ค.69 vs พ.ค.68" | Med |
| 8 | Click cell → drill | ยังไม่ได้ทำ (เซลล์เฉพาะวัน → branch+date detail) | Med |

---

## ✅ สิ่งที่ดีแล้ว (per Brand DNA)

```
✓ ฟ้า + ขาว + เทา หลัก — 90% ของ table ใช้สีตามคู่มือ
✓ เขียว/แดง = binary trend ↑↓ เท่านั้น (ตรงกฎ)
✓ Compact data-dense — scan 5 วินาทีเข้าใจ
✓ Heavy Thai display ใน hero
✓ Premium hover (lift + blue shadow)
✓ Sticky first column ไม่หายเลื่อนแล้ว
✓ Latest period highlight ฟ้า — ไม่ต้องคิด
✓ Auditable trail — กดทุกแถวตามลึกได้ถึง branch
```

---

## 🎯 Lean Process — Executive Workflow

### ปัจจุบัน
```
Owner เปิดเว็บ → /home (3 cards)
              → คลิก CashHub
              → /cashhub/dashboard
              → SCROLL ผ่าน hero
              → SCROLL ผ่าน company filter
              → ถึง executive table

= 4 steps · ใช้สมอง 4 จุด ก่อนเห็นตัวเลข
```

### Lean (ที่แนะนำ)
```
Owner เปิดเว็บ → /home
              → เห็น executive table ทันที (ที่ /home)
              → กดดูรายละเอียดต่อใน /cashhub/dashboard

= 1 step ก่อนเห็นตัวเลข
```

**Action:** ย้าย ExecutiveTable (compact version) ขึ้น /home ด้วย — ทำให้เป็น "ยอดของผู้บริหาร อันแรกที่เห็น"

---

## 🔄 Roadmap ถัดไป (เรียงลำดับ priority)

### Sprint A — Executive UX completion (ครึ่งวัน)
```
1. ✅ Executive table — ขยายแถว + 12 เดือน (เสร็จ)
2. ⏳ Move ExecutiveTable → /home (เห็นทันที)
3. ⏳ Filter by company sync ลงตาราง
4. ⏳ Click cell → drill into branch+date
5. ⏳ Date range custom + year-over-year mode
```

### Sprint B — Role-based dashboards (1-2 วัน)
```
ตามที่เจ้าของบอก: "dashboard ผู้บริหาร / admin / staff / manager คนละหน้า"

- Owner       → /home มี executive table + alerts หลัก
- Branch Manager → /home มีเฉพาะสาขาที่ดูแล + pending approve
- Staff        → /home มีปุ่มกรอกรายงาน (skip ตารางใหญ่)
- Driver       → redirect ไป /driver (FuelOS)
- Viewer       → /home แบบ read-only (ดูภาพรวมได้)

ทำใน components/layout/admin-shell.tsx + /home page logic
```

---

*Updated: 2026-05-05 — Executive UX deep-dive*
*Next session: Sprint A items 2-5 + Sprint B planning*
