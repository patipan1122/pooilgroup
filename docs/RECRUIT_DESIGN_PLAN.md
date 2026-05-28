# RECRUIT_DESIGN_PLAN.md — UX/UI Design Plan สำหรับ "รับสมัครพนักงาน"

> **สถานะ:** DESIGN ONLY · คู่กับ `RECRUIT_PLAN.md` (feature spec)
> **สร้าง:** 2026-05-20 · CEO ขอ UX/UI + Lean Process war-room
> **กรอบ:** Pooil DESIGN_SYSTEM.md ("พรีเมี่ยม + มืออาชีพ + ใช้ง่าย" · ฟ้า+ขาว+เทา · Anuphan 800)
> **Core CEO preference:** Multi-pane workspace (ฝั่งซ้ายเห็นฝั่งขวา · 2-3 ส่วนพร้อมกัน) — เหมือน Linear/Gmail/Notion

---

## 🎯 Executive Summary

แทน UX แบบ "list → คลิก → หน้าใหม่ → กลับ → list" (Google Sheets pattern) ที่ CEO เกลียด · เปลี่ยนเป็น **3-pane workspace** ที่:
- เห็น context รวมกันในจอเดียว (filter + list + detail)
- เปลี่ยนข้อมูลในขวา list ในซ้ายไม่กระพริบ
- Keyboard-first (J/K เลื่อน · Cmd+K ค้นหา · Cmd+Enter ส่ง)
- Mobile = collapse เป็น single pane พร้อม breadcrumb กลับ

**Reference inspirations (ที่เลือกใช้):**
- **Linear** — issue list left, detail right · keyboard shortcut culture
- **Gmail** — split view · เลือก thread → อ่านในที่เดียว
- **Notion** — sidebar + content + AI panel ขวา
- **Figma** — palette left, canvas middle, properties right (สำหรับ Form Builder)
- **Superhuman** — keyboard-first inbox · ทำงานเร็วโดยไม่ใช้ mouse

**Anti-patterns ที่หลีกเลี่ยง (ของ Pooil เดิมบางหน้ามี · ห้าม recur):**
- Modal ซ้อน modal
- ปุ่ม "บันทึก" → reload หน้า → กลับมา list
- หน้า edit ที่ไม่มี preview
- Toast notification ที่หายเร็วเกินไป

---

## 🎤 War-Room — 6+1 UX/UI + Lean เสียง

### 🎨 1. UX Lead / Information Architect

**Position:**
- โครงสร้าง information ต้องสะท้อน mental model ของ HR ที่ใช้จริง: **"ตำแหน่ง" → "คนสมัคร" → "ตัดสินใจ"**
- 3 entity หลัก → 3 hub: (1) Postings list (2) Applications inbox (3) Pipeline view · เชื่อมกันด้วย breadcrumb + cross-link
- ห้ามทำ tab > 5 ใน 1 หน้า · ถ้ามีเยอะ → แตกเป็น panel แทน
- Empty state ทุกหน้าต้องบอก next action ที่เฉพาะเจาะจง

**3 must-have:**
1. Global search (Cmd+K) ครอบคลุมทุก posting + applicant ตั้งแต่ launch
2. Breadcrumb ทุกหน้า · ไม่มี dead-end
3. Inline detail panel · ไม่ navigate ออก

---

### 🖼 2. UI Designer (Visual)

**Position:**
- ใช้ Pooil palette ตามเดิม · เพิ่ม 1 accent = พฤกษ์ฟ้าเข้ม (`brand-700`) สำหรับ "AI insight" UI ให้แยกจาก action
- Typography hierarchy ใหม่: H1 Anuphan 800 · section label `01 · INBOX` · body Sarabun 16px
- Card สำหรับ application = max-w-full · shadow soft · radius xl · spacing 24px ภายใน
- Avatar: monogram fallback (ตัวอักษรชื่อ-นามสกุล) · ไม่ใช้ stock illustration

**3 must-have:**
1. ทุก card มี hover state (border ฟ้าจาง + shadow ขึ้น) — feedback ที่ Pooil เดิมขาด
2. AI insight UI ใช้ `brand-700` background subtle (ไม่ใช่ purple/violet ที่บริษัทอื่นใช้กัน · เราเป็น Pooil Blue)
3. ไม่มี emoji ใน production UI · เก็บไว้ใช้แค่ใน admin tooltip + section icon

---

### ✋ 3. Interaction Designer (Motion + Micro)

**Position:**
- Motion duration 150-200ms · easing cubic-bezier(0.2, 0, 0, 1) (Apple-style)
- Panel slide-in 240ms · slide-out 180ms (asymmetric เพื่อรู้สึก responsive)
- ห้าม spinner > 500ms · ใช้ skeleton แทน
- Toast: "บันทึกแล้ว" 2 วินาที + undo button 5 วินาที
- Drag affordance ชัดเจน (handle dots ซ้าย · ghost preview)

**3 must-have:**
1. Optimistic UI ทุก status change (เปลี่ยนทันที · revert ถ้า fail)
2. Auto-save indicator มุมขวาบน ("บันทึกอัตโนมัติเมื่อ 14:32")
3. Keyboard hint แสดงตอน hover (เช่น hover ปุ่ม "Next" → tooltip "J")

---

### 🧹 4. Lean Process Expert

**Position:**
- Waste ที่ Google Sheets workflow มี: navigation, search, copy-paste, lookup, context switch, manual notify
- Target: ลด click จาก 7 → 3 ต่อใบสมัคร 1 ใบ
- ทุก default action = "ทำต่อรอบหน้า" (ไม่บังคับ HR กรอกซ้ำ)
- Bulk action = first-class (ไม่ใช่ afterthought)

**8 Lean Wins ที่ HR จะรู้สึก:**
1. **Auto-open ใบล่าสุด** — เข้า inbox → cursor อยู่บนใบใหม่สุดทันที (ไม่ต้องคลิก)
2. **Quick filter chip** — กดทีเดียวเลือก status (ไม่ต้องเปิด dropdown)
3. **Bulk move status** — เลือกหลายใบ → drag เข้า column / dropdown 1 ครั้ง
4. **Reuse template** — สร้างประกาศใหม่จากเก่า 1 คลิก
5. **Smart defaults** — ใหม่ครั้งแรกใส่ field ครบ · ครั้งต่อไป suggest จากของเก่า
6. **One-shortcut interview** — เลือกใบ → กด `I` → schedule modal เปิด (ยังไม่ทำ Phase 1 แต่ออกแบบรอ)
7. **AI auto-summary** — เปิดใบใหม่ → AI summary 3 บรรทัดอยู่แล้ว (ไม่ต้องอ่านยาว)
8. **No save button** — auto-save ทุก field

**3 คำเตือน Lean:**
1. ห้ามมี "Are you sure?" modal เกินจำเป็น (มีแค่ destructive actions)
2. ห้ามทำให้ HR ต้องเลือก company (Pooil/JPSync) ทุกครั้ง · จำ context จาก URL/session
3. Form Builder ห้ามให้ HR ตั้งชื่อ slug เอง · auto-generate จาก title

---

### 🔬 5. UX Researcher

**Position:**
- Pooil HR (พี่หน่อย / ผู้ใช้จริง) อายุ 50+ · มือถือเป็นหลัก · แต่ desktop ตอนทำงานหนัก
- กลัวกดผิด → ต้องมี undo + version history
- ชอบเห็นจำนวน + สถานะตัวเลข (มันให้ความมั่นใจ)
- คุ้นกับ Google Sheets layout → grid + sticky header เป็น familiar pattern

**3 must-validate (รอบ user test):**
1. HR ใหม่หาปุ่ม "สร้างประกาศ" เจอใน 5 วินาทีไหม
2. HR เปลี่ยน status candidate ได้โดยไม่งง modal ไหน
3. ผู้สมัครจริง (อายุ 40+) กรอกใบบนมือถือจบใน 5 นาทีไหม

---

### ⚙️ 6. Frontend UX Engineer (feasibility)

**Position:**
- Multi-pane = layout grid + resizable handle · ใช้ `react-resizable-panels` (ของฟรี · เบา)
- Drag-drop = `dnd-kit` (Pooil อาจมีอยู่แล้ว · เช็คก่อน)
- Keyboard shortcut = `react-hotkeys-hook`
- URL state = pane sizes + selected ID เก็บใน searchParams (ทำให้ link sharable)
- Optimistic update = React 19 `useOptimistic` ของ Pooil ที่มีอยู่แล้ว

**3 ข้อ feasible:**
1. 3-pane layout ทำได้ภายใน Phase R0 effort เดิม (+0.5 วัน)
2. Cmd+K global search ใช้ Cmd+K component pattern (`cmdk` lib) · 0.5 วัน
3. Mobile responsive = pane ซ้ายเป็น sheet (drawer) · ใช้ shadcn/ui ที่ Pooil มี

---

### 🧑‍💼 +1. Pooil HR Lead (real user voice)

**Position (อ้าง persona พี่หน่อย):**
- ฉันใช้ Excel เก่ง · keyboard ได้ · ชอบ shortcut
- ใช้คอมที่บ้าน + iPad ที่บริษัท
- เกลียดต้องโทรถาม IT
- ชอบ tab + Tab navigation มากกว่า click

**3 must-have จาก user voice:**
1. กด Tab เลื่อน field ใน form ได้สมเหตุสมผล (ไม่กระโดดไปปุ่มถัดไปก่อน)
2. มีปุ่ม "Print" ในหน้าใบสมัคร · พิมพ์ใบสัมภาษณ์ A4 ได้
3. กรองด้วยปี/เดือนได้ (HR ทำรายงานเป็นรอบ ๆ)

---

## 🤝 ฉันทามติ 10 ข้อ

ทุกคนเห็นพ้อง · CEO ไม่ต้องตัดสิน:

1. ✅ Multi-pane workspace เป็น default layout (3-pane standard)
2. ✅ ใช้ Pooil palette เดิม · เพิ่มแค่ `brand-700` accent สำหรับ AI
3. ✅ Auto-save ทุกที่ · ไม่มีปุ่ม "บันทึก"
4. ✅ Keyboard shortcut ครบตั้งแต่ Phase 1 (J/K/Cmd+K/Cmd+Enter/Esc)
5. ✅ Optimistic UI ทุก mutation
6. ✅ URL state-able (share link ได้ พร้อม filter + selection)
7. ✅ Skeleton ไม่ใช่ spinner
8. ✅ Undo toast 5 วินาทีทุก destructive action
9. ✅ Empty state ต้องบอก next action
10. ✅ Public form (ผู้สมัคร) = single pane mobile-first (ไม่ใช่ workspace)

---

## 🎨 Design Principles เฉพาะของ "รับสมัครพนักงาน"

1. **3-pane เป็น default** — single pane เฉพาะ form หรือ public
2. **AI = silent helper** — แสดงในขวา rail · ไม่ pop-up · กดได้เมื่ออยาก
3. **Status เป็น 1st class** — ทุกที่ที่ใบสมัครปรากฏต้องเห็น status สี + label
4. **Blacklist flag = ทันตา** — แดง + icon ตัวเล็ก แต่ unmissable
5. **Mobile = collapse not redesign** — ใช้ component เดิม collapse pane
6. **Public link = trust signal** — โลโก้ + ชื่อบริษัทใหญ่ · ไม่ดูเหมือน phishing

---

## 🏗 Layout System

### Workspace Shell

```
┌────────────────────────────────────────────────────────────────────────┐
│ Pooilgroup · รับสมัครพนักงาน                          [🔍 Cmd+K] [👤]  │ topbar 56px
├─────┬──────────────────────────────────────────────────────────────────┤
│ 🏠  │                                                                  │
│ 📋  │                                                                  │
│ 📥  │              Workspace area (multi-pane below)                   │
│ 📊  │                                                                  │
│ 🚫  │                                                                  │
│ ⚙️  │                                                                  │
└─────┴──────────────────────────────────────────────────────────────────┘
 nav 64px wide (collapsible to 240px expanded with labels)
```

**Nav items (เรียงตามใช้บ่อย):**
1. 🏠 Home (Pooil main)
2. 📋 ประกาศ (postings)
3. 📥 ใบสมัคร (applications inbox) ← default open
4. 📊 Pipeline
5. 🚫 Blacklist
6. ⚙️ Settings

---

## 📐 Screen Designs (ASCII mockups)

### Screen 1: Postings List (3-pane: nav | list | preview)

```
┌─────┬────────────────────────────┬──────────────────────────────────────┐
│ nav │ 📋 ประกาศ           [+ ใหม่] │ พนักงานขับรถ — Pooil                  │
│     │ ──────────────────────────  │ ──────────────────────────────────── │
│ 🏠  │ [🔍 ค้นหา ประกาศ...]        │ 📌 รายละเอียดประกาศ                 │
│ 📋▸ │                              │  เปิดรับ: 1-31 พ.ค. 26              │
│ 📥  │ ▾ เปิดอยู่ (3)               │  ลิ้งค์: pooilgroup.../apply/abc123 │
│ 📊  │   ✓ พนักงานขับรถ ←          │  [📋 คัดลอก]  [📱 QR]                │
│ 🚫  │     12 ใบ · Pooil           │                                      │
│ ⚙️  │   ✓ พนักงานคลัง             │ 📊 สถิติ                             │
│     │     5 ใบ · JPSync           │  เปิดอ่าน 247 · กรอกเสร็จ 12 (4.9%)│
│     │   ✓ บัญชี                   │  คะแนน AI เฉลี่ย 72 · ติด BL 1 ราย │
│     │     2 ใบ · ทั้งคู่           │                                      │
│     │                              │ 👥 ใบสมัครล่าสุด                    │
│     │ ▾ ปิดแล้ว (8)                │  • John Doe       AI 87 ★          │
│     │   พนักงานเช็คเกอร์ (Q1)     │  • Mary K.        AI 76            │
│     │   ...                        │  • Bob L.         AI 64 ⚠         │
│     │                              │  [ดูทั้งหมด 12 ใบ →]                │
│     │ ▾ ฉบับร่าง (1)               │                                      │
│     │   พนักงานขาย (ยังไม่ publish)│ [✏ แก้ไข]  [⏸ ปิดรับ]  [🗑 ลบ]    │
└─────┴────────────────────────────┴──────────────────────────────────────┘
       ← list 320px (resizable)    ← preview ขยายเต็มเหลือ (resizable)
```

**Interactions:**
- คลิก row ใน list → preview ขวาเปลี่ยน (instant · no navigation)
- กด `J/K` เลื่อน list
- กด `Enter` บนรายการ → เปิดใบสมัครรายตัวใน new pane
- กด `N` → new posting (open form in slide-over)

---

### Screen 2: Form Builder (3-pane: palette | canvas | properties)

```
┌─────────────┬─────────────────────────────────┬──────────────────────┐
│ ลาก field   │ พนักงานขับรถ — Pooil              │ Field Properties     │
│ ────────────│ ─────────────────────────────── │ ──────────────────── │
│ 📝 สั้น    │ 📌 SECTION · ข้อมูลส่วนตัว     │ ┌──────────────────┐ │
│ 📄 ยาว     │  ┌─ Field [drag] ─────────────┐│ │ ⬛ ปลายเปิด สั้น │ │
│ 🔘 ปลายปิด │  │ ▎ชื่อ-นามสกุล *           ││ │                  │ │
│ ☑ MC radio │  │ [...placeholder...]         ││ │ Label:           │ │
│ ☐ MC check │  │                              ││ │ [ชื่อ-นามสกุล]   │ │
│ 🔢 ตัวเลข  │  │ ⚙ properties →            ││ │                  │ │
│ 📏 Range   │  └────────────────────────────┘│ │ Required: ☑      │ │
│ 📅 วันที่  │  ┌─ Field ───────────────────────┐│ │ Placeholder:     │ │
│ 📷 รูป     │  │ ▎เบอร์โทร *               ││ │ [เช่น 081-...]    │ │
│ 📎 ไฟล์    │  │ Format: เบอร์โทร 10 หลัก  ││ │                  │ │
│            │  └────────────────────────────┘│ │ Help text:       │ │
│ 🤖 AI suggest│ 📌 SECTION · ประสบการณ์       │ │ [ไว้ติดต่อกลับ]   │ │
│ +เพิ่ม section│ ┌─ Field ───────────────────────┐│ │                  │ │
│ +เพิ่ม IQ ข้อ│ │ ▎มีใบขับขี่ประเภทไหน      ││ │ Format: เบอร์โทร │ │
│            │  │ ◯ ส่วนตัว ◯ ท.2 ◯ ท.3      ││ │                  │ │
│            │  └────────────────────────────┘│ │ Validation:      │ │
│            │                                  │ │ Min: 10  Max: 10 │ │
│            │ [+ เพิ่ม field ที่นี่]             │ │                  │ │
│            │                                  │ │ [🗑 ลบ field]    │ │
│            │ ──── สรุปฟอร์ม ────              │ └──────────────────┘ │
│            │ 8 field · 2 บังคับ                │                      │
│            │ คะแนน UX: ดี ✓                   │ [💾 บันทึก draft]    │
│            │ เวลากรอกเฉลี่ย ~4 นาที          │ [👁 Preview ใหม่]    │
│            │                                  │ [🚀 Publish]         │
└─────────────┴─────────────────────────────────┴──────────────────────┘
  palette 200px        canvas flexible           properties 320px
```

**Interactions:**
- ลาก field type จาก palette → canvas (drop zone highlight ฟ้า)
- คลิก field ใน canvas → properties ขวาเปลี่ยน · canvas highlight border ฟ้า
- ลาก reorder ภายใน canvas (handle ซ้ายของแต่ละ field)
- กด `Cmd+P` → preview mode (canvas เต็มจอ · แสดงเหมือนผู้สมัครจะเห็น)
- กด `Cmd+S` (ไม่จำเป็น · auto-save ทุก 2 วิ · แต่รองรับ)
- ปุ่ม `🤖 AI suggest` → modal เปิด → กรอกตำแหน่ง + เงินเดือน → AI เสนอ field 8-15 ตัว → ติ๊กรับมา

**Field card structure (canvas):**
```
┌─ ⋮⋮ ──────────────────────────────────────────┐
│ ⋮⋮  ▎ Label * (required indicator)            │
│     [field input mockup ตามชนิด]              │
│     💬 help text                                │
│     ⚙ inline mini menu (ลบ · duplicate · ↑↓) │
└─────────────────────────────────────────────────┘
   handle  hover → fade in mini menu
```

---

### Screen 3: Applications Inbox ★ (4-pane: nav | filters | list | detail+rail)

**หน้าใช้บ่อยที่สุด · workhorse**

```
┌─────┬───────────┬──────────────────────────────┬──────────────────────────────┐
│ nav │ Filters   │ ใบสมัคร (12 ใหม่ · 5 รอ)     │ John Doe — พนักงานขับรถ      │
│     │ ─────     │ ──────────────────────────── │ ──────────────────────────── │
│ 🏠  │ STATUS    │ [🔍 ค้นชื่อ/เบอร์/บัตร...]  │                              │
│ 📋  │ ◉ ใหม่ 12│                              │ ┌─AI Score─┬─[Notes]─┬─[★]─┐│
│ 📥▸ │ ○ คัดกรอง5│ ─ วันนี้ ─                  │ │  87/100   │HR (2)   │ ☆4 ││
│ 📊  │ ○ สัมภาษณ์│ ⊙ John Doe          AI 87 ★ │ │ จุดแข็ง: │"เลือกเลย"│       ││
│ 🚫  │ ○ เสนอ   │   "ขับรถ 8 ปี · ราชบุรี"   │ │ • ขับรถ8ปี│ +Note   │ Status││
│ ⚙️  │ ○ รับ    │   2 ชม.ที่แล้ว              │ │ • อยู่ใกล้│         │[ใหม่ ▾]│
│     │ ○ ไม่รับ │ ○ Mary K.           AI 76    │ │ • ใบขับT2│         │       ││
│     │          │   "บัญชี 3 ปี"               │ │ จุดเสี่ยง:│         │ Bulk:││
│     │ COMPANY  │   3 ชม.ที่แล้ว              │ │ • อายุน้อย│         │ [ ]   ││
│     │ ◉ ทั้งคู่ │ ─ เมื่อวาน ─                │ └──────────┴─────────┴─────┘│
│     │ ○ Pooil  │ ⚠ Bob L.            AI 64   │                              │
│     │ ○ JPSync │   ⚠ ติด Blacklist           │ ── 📎 ไฟล์แนบ ──              │
│     │          │   "เคยมีปัญหา · 2024"        │ 📄 resume.pdf (1.2 MB) [⬇️] │
│     │ TAG      │ ⊙ Alice T.          AI 92   │ 📷 photo.jpg [👁 preview]    │
│     │ ○ ใบขับ T2│                              │ 📄 license.pdf [👁]          │
│     │ ○ ราชบุรี │ ─ 3 วันก่อน ─               │                              │
│     │          │ ⊙ Cathy M.          AI 71   │ ── 📝 คำตอบ (8 ข้อ) ──        │
│     │ DATE     │                              │ 1. ชื่อ-นามสกุล              │
│     │ 7 วันนี้  │ ...                          │    → John Doe Smith         │
│     │          │                              │ 2. เบอร์โทร                  │
│     │ [+ filter]│ [โหลดเพิ่ม...]               │    → 081-234-5678           │
│     │          │                              │ 3. มีใบขับขี่ประเภทไหน      │
│     │          │                              │    → ท.2 + ท.3              │
│     │          │                              │ 4. ประสบการณ์ขับรถบรรทุก     │
│     │          │                              │    → 8 ปี · ราชบุรี-กทม.    │
│     │          │                              │ 5. เงินเดือนที่ต้องการ       │
│     │          │                              │    → 18,000-22,000 บาท      │
│     │          │                              │ ... [แสดงทั้งหมด 8 ข้อ]      │
│     │          │                              │                              │
│     │          │                              │ ── 🏷 Tag ──                  │
│     │          │                              │ [+ ใบขับ T2] [+ ราชบุรี]   │
│     │          │                              │                              │
│     │          │                              │ Actions: [📞 โทร] [✉️ ตอบ] │
│     │          │                              │          [📅 นัด] [🖨 print]│
└─────┴───────────┴──────────────────────────────┴──────────────────────────────┘
       180px         360px (resizable)              flexible (resizable)
                                                    rail: 280px collapsible
```

**Interactions:**
- เปิดมา → cursor อยู่บนใบใหม่สุด · detail ขวาเปิดอัตโนมัติ (0 click)
- `J/K` เลื่อน list (Linear pattern)
- `1-7` เปลี่ยน status (1=ใหม่ 2=คัดกรอง 3=สัมภาษณ์ 4=เสนอ 5=รับ 6=ไม่รับ 7=ถอน)
- `T` → focus tag input
- `Cmd+B` → toggle right rail (ซ่อน AI/notes ให้ detail กว้าง)
- `Cmd+/` → focus search
- `Esc` → close detail (เห็น list เต็มอีกครั้ง)
- Multi-select: `Shift+Click` หรือ `X` toggle · bulk action bar ปรากฏด้านล่าง

**Bulk action bar (เมื่อ select > 1):**
```
┌──────────────────────────────────────────────────────────────┐
│ 3 ใบ เลือกอยู่ │ [เปลี่ยน status ▾] [+ Tag] [📥 Export] [✕]│
└──────────────────────────────────────────────────────────────┘
```

---

### Screen 4: Pipeline Kanban (full width · drawer overlay)

```
┌────────────────────────────────────────────────────────────────────────┐
│ 📊 Pipeline · พนักงานขับรถ                       [Filter ▾] [Bulk ▾]  │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────┤
│ ใหม่     │ คัดกรอง  │ สัมภาษณ์ │ เสนอ     │ รับเข้า  │ ไม่รับ/ถอน  │
│ (12)     │ (5)      │ (3)      │ (2)      │ (8)      │ (5)          │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────────┤
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐    │
│ │John  │ │ │Mary K│ │ │Alice │ │ │Tom S │ │ │Pete  │ │ │Bob L⚠│    │
│ │AI 87★│ │ │AI 76 │ │ │AI 92 │ │ │AI 81 │ │ │AI 79 │ │ │AI 64 │    │
│ │2 ชม. │ │ │3 ชม. │ │ │นัด8/6│ │ │offer │ │ │1/6/26│ │ │BL    │    │
│ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘    │
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │          │ ┌──────┐ │ ┌──────┐    │
│ │Alice │ │ │David │ │ │Brian │ │          │ │Sam   │ │ │Cathy │    │
│ │AI 92 │ │ │AI 58 │ │ │AI 70 │ │          │ │AI 85 │ │ │AI 71 │    │
│ └──────┘ │ └──────┘ │ └──────┘ │          │ └──────┘ │ └──────┘    │
│ ...      │ ...      │          │          │ ...      │              │
│          │          │          │          │          │              │
│ [+ ใหม่] │          │          │          │          │              │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────────┘
```

**Interactions:**
- Drag card cross-column → status เปลี่ยน · optimistic UI · undo toast
- คลิก card → slide-over drawer จากขวา (detail แบบ Screen 3 ขวา) · ไม่ navigate
- Esc / กดข้างนอก drawer → ปิด
- เปลี่ยนตำแหน่ง (filter) ที่ top → board เปลี่ยน

---

### Screen 5: Blacklist (3-pane: nav | list | detail+history)

```
┌─────┬────────────────────────────────┬──────────────────────────────────┐
│ nav │ 🚫 Blacklist (47 คน)           │ Bob Smith                         │
│     │ ──────────────────────────────  │ ──────────────────────────────── │
│ 🏠  │ [🔍 ค้นชื่อ/เบอร์/บัตร...]    │ 🚫 อยู่ใน Blacklist              │
│ 📋  │                                  │                                  │
│ 📥  │ ▾ active (42)                   │ Reason:                          │
│ 📊  │   • Bob S. — ขโมยของ ←        │ ┌────────────────────────────┐  │
│ 🚫▸ │     หมดอายุ 2031-01            │ │ ขโมยของในคลัง 2024-08-15 │  │
│ ⚙️  │   • Mike R. — ขาดงาน          │ │ พบของหายต่อเนื่อง 3 สัปดาห์│  │
│     │     หมดอายุ 2029-03            │ │ เห็นจากกล้องวงจรปิดชัดเจน │  │
│     │   • Jane K. — โกหก resume     │ │                              │  │
│     │     หมดอายุ 2028-12            │ │ — รายงานโดย สมชาย (HR Lead) │  │
│     │   ...                            │ └────────────────────────────┘  │
│     │                                  │                                  │
│     │ ▾ expired (5)                   │ Scope: Pooil + JPSync ทั้งคู่   │
│     │                                  │ บันทึก: 2026-01-15 14:32        │
│     │ ▾ removed (3)                   │ หมดอายุ: 2031-01-15 (5 ปี)     │
│     │                                  │                                  │
│     │                                  │ ── 📜 ประวัติ ──                │
│     │                                  │ • 2026-01-15 บันทึกครั้งแรก    │
│     │                                  │ • 2026-03-22 พยายามสมัครใหม่ ⚠│
│     │                                  │   "พนักงานคลัง" → ตัด           │
│     │                                  │ • 2026-04-10 พยายามสมัครใหม่ ⚠│
│     │                                  │   "พนักงานขับรถ" → ตัด          │
│     │                                  │                                  │
│     │                                  │ [✏ แก้ไข reason] [🗑 ถอน BL]  │
└─────┴────────────────────────────────┴──────────────────────────────────┘
```

---

### Screen 6: Public Apply Page (`/apply/[slug]`) — Single Pane Mobile-First

**Mobile (390px width baseline · ยึด iPhone 12 size):**
```
┌────────────────────────────┐
│ [Pooil logo]               │ Header sticky 64px
├────────────────────────────┤
│                            │
│ พนักงานขับรถ                │ H1 Anuphan 800 28px
│ Pooil · ราชบุรี            │ subtle ฟ้า
│                            │
│ ⏰ เปิดรับ 1-31 พ.ค. 26   │ chip ฟ้า
│ 📍 ราชบุรี                 │ chip ฟ้า
│                            │
├────────────────────────────┤
│ 01 · ข้อมูลส่วนตัว         │ section label
│                            │
│ ชื่อ-นามสกุล *             │
│ [_____________________]    │
│                            │
│ เบอร์โทร *                 │
│ [081-_____________]        │ format hint inline
│                            │
│ อายุ                       │
│ [____] ปี                  │
│                            │
├────────────────────────────┤
│ 02 · ประสบการณ์            │
│                            │
│ มีใบขับขี่ประเภทไหน *      │
│ ◯ ส่วนตัว                  │
│ ◯ ท.2                      │
│ ◯ ท.3                      │
│ ◯ ไม่มี                    │
│                            │
│ ประสบการณ์ขับรถ            │
│ [____________________      │
│  ____________________      │
│  ____________________]     │
│                            │
├────────────────────────────┤
│ 03 · ไฟล์เอกสาร            │
│                            │
│ รูปถ่าย *                  │
│ ┌────────────────────┐    │
│ │ 📷 แตะเพื่อถ่าย/    │    │
│ │    เลือกรูป         │    │
│ │                     │    │
│ └────────────────────┘    │
│                            │
│ Resume (PDF)               │
│ ┌────────────────────┐    │
│ │ 📎 แตะเพื่อเลือก    │    │
│ │    ไฟล์ (max 5MB)   │    │
│ └────────────────────┘    │
│                            │
├────────────────────────────┤
│ ☐ ฉันยินยอมให้บริษัทเก็บ  │
│   ใช้ข้อมูลนี้ตามนโยบาย   │
│   ความเป็นส่วนตัว [อ่าน]   │
│                            │
│ ┌────────────────────────┐│
│ │ ✓ ส่งใบสมัคร            ││ ปุ่ม primary h-14
│ └────────────────────────┘│
│                            │
│ บันทึกอัตโนมัติเมื่อ 14:32 │ tiny gray
└────────────────────────────┘
```

**Desktop (max-w-2xl center):**
- เหมือน mobile แต่ wider · 2 column ตอน "ชื่อ + อายุ" ใน row เดียวกัน
- Logo + breadcrumb เต็มกว่า

---

### Screen 7: AI Support Chat (floating button + slide panel)

```
                                              ┌──────────────────────┐
                                              │ 🤖 ผู้ช่วย AI     [✕]│
                                              ├──────────────────────┤
                                              │                      │
                                              │ สวัสดีพี่หน่อย       │
                                              │ ผมช่วยอะไรได้บ้าง?  │
                                              │                      │
                                              │ คำถามที่พบบ่อย:      │
                                              │ • ช่วยร่าง JD       │
                                              │ • เปรียบเทียบคน 3 คน│
                                              │ • สรุปใบสมัครให้ฟัง│
                                              │ • แนะนำคำถามสัมภาษณ์│
                                              │                      │
                                              │ ──────────────────  │
                                              │                      │
                                              │ คุณ:                 │
                                              │ "ใครเหมาะกับ         │
                                              │  พนักงานขับรถสุด?"   │
                                              │                      │
                                              │ AI:                  │
                                              │ จาก 12 ใบสมัคร       │
                                              │ ผมเลือก 3 คนนี้:    │
                                              │ 1. John Doe (87)    │
                                              │    ขับรถ 8 ปี       │
                                              │ 2. Alice T. (92)    │
                                              │    มีใบ ท.3 + ท.2   │
                                              │ 3. Sam C. (81)      │
                                              │    ราชบุรีตรงพอดี   │
                                              │                      │
                                              │ [👤 เปิดดูทั้ง 3]    │
                                              │                      │
                                              │ ─────────────────   │
                                              │ [______________] [➤]│
                                              └──────────────────────┘
                                                  width 380px slide-in
                                                  จากขวา · 240ms
                                              ┌────┐
                                              │ 🤖 │ FAB มุมขวาล่าง
                                              └────┘ (ปกติเห็นเสมอ)
```

**Interactions:**
- FAB เห็นทุกหน้า admin · กดเปิด panel slide-in จากขวา
- Esc / กด ✕ → close
- Cmd+/ → toggle
- Context-aware: รู้ว่าหน้าไหน · ส่ง context เข้า prompt (ไม่ต้องอธิบายซ้ำ)

---

## 🧩 Component Patterns

### A. Multi-pane Layout primitive

```tsx
// components/layout/workspace.tsx (สร้างใหม่)
<Workspace>
  <Workspace.Nav />            {/* 64-240px */}
  <Workspace.SidePane size={320}>
    <Filters />
  </Workspace.SidePane>
  <Workspace.MainPane>
    <List />
  </Workspace.MainPane>
  <Workspace.DetailPane size="auto" collapsible>
    <Detail />
  </Workspace.DetailPane>
  <Workspace.Rail size={280} collapsible>
    <AIPanel />
  </Workspace.Rail>
</Workspace>
```

ใช้ `react-resizable-panels` ภายใน · sizes persist ใน localStorage · URL state สำหรับ collapsed/expanded

### B. Status Pill

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ ● ใหม่        │   │ ● สัมภาษณ์   │   │ ● รับเข้า    │
└──────────────┘   └──────────────┘   └──────────────┘
   ฟ้า                อำพัน              เขียว
```
- ทุก status มี dot สี + label
- ใช้ semantic palette Pooil เดิม (ฟ้า=info · อำพัน=pending · เขียว=ผ่าน · แดง=ไม่ผ่าน)

### C. AI Insight Card

```
┌─────────────────────────────────────┐
│ 🤖 ผู้ช่วย AI              [⟳ rerun]│
├─────────────────────────────────────┤
│ คะแนน: 87 / 100                     │
│                                      │
│ จุดแข็ง:                            │
│  • ขับรถบรรทุก 8 ปี (เกิน req 5)  │
│  • บ้านอยู่ราชบุรี (ใกล้)          │
│  • ใบ ท.2 + ท.3 (ครบ)             │
│                                      │
│ จุดเสี่ยง:                          │
│  • เคยเปลี่ยนงาน 5 ที่ใน 8 ปี      │
│  • ขอเงินเดือนสูงกว่า budget       │
│                                      │
│ เวลาประเมิน: 14:32 (รอบนี้)         │
└─────────────────────────────────────┘
   background: brand-50 (ฟ้าจาง)
   border: brand-200
```

### D. File Attachment Card

```
┌──────────────────────────────────┐
│ 📷 photo.jpg                     │
│ 1.2 MB · เพิ่ม 14:32              │
│ [👁 ดู] [⬇️ โหลด]                │
└──────────────────────────────────┘
```

### E. Blacklist Flag Banner

```
┌──────────────────────────────────────────────┐
│ 🚫 ผู้สมัครนี้อยู่ใน Blacklist                │
│ เหตุผล: ขโมยของในคลัง 2024-08             │
│ ผู้บันทึก: สมชาย (HR) · 2026-01-15          │
│ [ดูประวัติเต็ม]                              │
└──────────────────────────────────────────────┘
   background: red-50
   border-left: red-500 width-4
```

---

## ⌨️ Keyboard Shortcut Map (Phase 1 ครบ)

| Shortcut | Where | Action |
|----------|-------|--------|
| `Cmd+K` | global | Quick search anywhere |
| `Cmd+/` | global | Toggle AI chat |
| `J / K` | lists | Next / Previous |
| `Enter` | lists | Open selected |
| `Esc` | detail | Close detail/drawer |
| `1-7` | applications | Set status (1=new ... 7=withdrawn) |
| `X` | applications | Toggle select (for bulk) |
| `Cmd+A` | applications | Select all visible |
| `T` | applications | Focus tag input |
| `N` | postings list | New posting |
| `Cmd+Enter` | forms | Submit |
| `Cmd+S` | form builder | Save draft (optional · auto-save anyway) |
| `Cmd+P` | form builder | Preview mode |
| `Cmd+B` | inbox | Toggle right rail |
| `Cmd+\` | layout | Toggle nav collapse |
| `?` | any | Show shortcut help overlay |

**Help overlay (กด `?`):**
```
┌──────────────────────────────────┐
│ ⌨ Keyboard Shortcuts             │
├──────────────────────────────────┤
│ Cmd+K  ค้นหาที่ใดก็ได้           │
│ J/K    เลื่อน list                │
│ ...                              │
└──────────────────────────────────┘
```

---

## 🎬 Motion + Micro-interactions

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Panel slide-in | translateX | 240ms | apple-out |
| Panel slide-out | translateX | 180ms | apple-in |
| Hover card | shadow + border | 150ms | linear |
| Status change | bg color | 200ms | apple-out |
| Skeleton pulse | opacity | 1200ms loop | ease-in-out |
| Toast in | slide-up + fade | 200ms | apple-out |
| Toast out | fade | 150ms | linear |
| Drag preview | scale 1.02 + shadow | 100ms | apple-out |
| Optimistic flash | bg flash | 600ms | linear |

**`apple-out`** = `cubic-bezier(0.0, 0.0, 0.2, 1)`
**`apple-in`** = `cubic-bezier(0.4, 0.0, 1.0, 1)`

---

## 📱 Mobile Adaptation

| Workspace | Mobile behavior |
|-----------|-----------------|
| Nav | Bottom tab bar (5 tabs · ตัด settings ออก) |
| Postings list | Single pane · tap → push detail (with back button) |
| Form Builder | Edit on desktop only · mobile = preview + status |
| Applications inbox | Single pane stack · swipe right → next · swipe left → status menu |
| Pipeline | Horizontal scroll columns |
| Blacklist | Single pane stack |
| Public apply | Mobile-first (original design) |
| AI chat | Full-screen overlay |

---

## 🧹 Lean Wins Summary (Before → After)

| Task | Google Sheets (now) | New design |
|------|---------------------|------------|
| สร้างประกาศใหม่ | 7 click + copy link manually | 3 click + auto link + QR |
| ดูใบสมัครใหม่ | เปิด Sheet → scroll → find | 0 click (auto-open) |
| เปลี่ยน status | แก้ cell · save · ปิดทุกอย่าง | 1 click หรือ 1 keystroke |
| ค้นใบเก่า | ไป Sheet เก่า · ค้นทีละไฟล์ | Cmd+K ครั้งเดียว |
| ส่งใบให้คนอื่นดู | screenshot + LINE | คัดลอก URL · ระบบ permission |
| รู้คะแนน candidate | คิดเอง | AI auto-score · เห็นทันที |
| รู้ว่าคนนี้เคยมีปัญหา | ถามทีม · ดู note ส่วนตัว | Blacklist flag แดง · auto |
| Export ใบสมัคร | คัดลอกทีละเซลล์ | 1 click PDF/CSV |
| สรุป candidates ให้ executive | print หลายแผ่น | AI summary 3 บรรทัด |

**Estimated time savings:** 60-70% ของเวลา HR ทำงาน admin (จาก 4 ชม./วัน → ~1.5 ชม./วัน)

---

## ⚠️ Risks / Gotchas (จาก UX)

1. **3-pane บน laptop เล็ก (1280px)** — บีบเกินไป · มีโหมด 2-pane fallback · auto detect viewport
2. **CEO อายุ 50+ ไม่รู้ keyboard shortcut** — ทุก action ต้องมีปุ่มด้วย · ห้าม keyboard-only
3. **Drag-drop บน touchscreen ยาก** — ทุก drag มี dropdown/menu alternative
4. **Pop-up เปิดเสียง / animation รำคาญ** — animation < 250ms · ไม่มีเสียง
5. **AI ตอบช้า** — แสดง streaming + skeleton · ไม่ block UI
6. **Form Builder ซับซ้อนเกิน** — ครั้งแรกเปิดให้ template wizard 3 ขั้น (เลือกตำแหน่ง · AI suggest · review)

---

## ❓ Open Decisions (4 ข้อขอ CEO ตัดสิน)

### D1: Nav placement
- **A:** Side nav (64px collapsible) เหมือน Notion/Linear ✅ แนะนำ
- **B:** Top nav เหมือน Pooil module เดิม

ผลกระทบ: side nav ประหยัดพื้นที่แนวตั้ง (ดี Sat data-heavy) · top nav consistent กับ Pooil module เดิม

### D2: Default landing เมื่อเข้า "รับสมัครพนักงาน"
- **A:** Applications inbox (ใบสมัคร) ✅ แนะนำ — งานหลักของ HR
- **B:** Postings list (ประกาศ)
- **C:** Dashboard analytics

### D3: AI Chat trigger
- **A:** FAB มุมขวาล่าง ทุกหน้า ✅ แนะนำ (Intercom-style)
- **B:** ปุ่มใน top bar
- **C:** Slash command `/ai` ใน search box

### D4: Pipeline view เป็น default หรือ tab?
- **A:** Pipeline เป็น separate nav item · default view = list ✅ แนะนำ
- **B:** Pipeline เป็น tab ภายในหน้า applications

---

## 🎯 Next Step (รออนุมัติ CEO)

1. CEO อ่านไฟล์นี้ + ดู ASCII mockups ตรง Screen 1-7
2. ตอบ 4 ข้อ D1-D4 (หรือ "OK ทั้งหมด" ถ้าเห็นด้วย default)
3. ผม build Phase R0 พร้อม **workspace shell + nav** ตามที่ออกแบบ (เผื่อ Phase R1+ จะใช้ pattern เดียวกัน)
4. หลัง R0 เสร็จ → CEO test layout บน preview URL → ปรับก่อนเริ่ม R1

---

## 📚 References

- `RECRUIT_PLAN.md` — feature spec คู่กัน
- `DESIGN_SYSTEM.md` — Pooil Brand DNA + palette + typography (ผูกพันที่นี่)
- `EXECUTIVE_UX_AUDIT.md` — past audit findings (avoid recurrence)
- [[ceo-prefers-multi-pane-workspace]] — memory เรื่อง CEO preference
- [[recruit-module-pooil-2026-05-20]] — initiative memory
