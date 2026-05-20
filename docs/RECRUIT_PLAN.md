# RECRUIT_PLAN.md — โปรแกรม "รับสมัครพนักงาน"

> **สถานะ:** PLAN ONLY · ยังไม่เริ่มเขียน code
> **สร้าง:** 2026-05-20 · CEO อนุมัติชื่อ + scope · รัน war-room 6+1 เสียง
> **Updated:** 2026-05-20 (round 2) — CEO ตอบ Q1-Q6 → ลด scope · AI manual-only · ไม่เก็บ ID
> **Owner:** Pattipan (CEO/Founder, JP Sync Group)
> **สังกัด:** Pooilgroup (`pooilgroup/legacy/pooilgroup-web/`) · เพิ่มเป็น module ใหม่
> **Footprint:** ไม่แตะ module เดิม · ใช้ Prisma + RLS + audit + R2 + Resend ของ Pooil ตามเดิม

---

## 🔄 Changelog
- **2026-05-20 (round 2):** CEO ตอบ Q1-Q6
  - Multi-company = soft (ไม่ strict isolation) · Pooil + JPSync ใช้รวม
  - File types = PDF + Word (.doc/.docx) + image (jpg/png)
  - AI scoring = **manual trigger ONLY** (ปุ่มกดรายคน · ไม่ auto)
  - National ID = **ไม่เก็บตอนสมัคร** (ตอน onboarding offline ค่อยยื่น)
  - Status change = ส่ง notification + มี follow-up task list
  - ลดต้นทุนเหลือ ~300-500 บาท/เดือน (จาก ~1,100)

---

## 🎯 Executive Summary

โปรแกรม "รับสมัครพนักงาน" คือระบบรับใบสมัครงานออนไลน์สำหรับ **Pooil + JPSync** เพื่อแทน Google Sheets ที่กระจัดกระจาย · ข้อมูลปนกัน · หาลิ้งค์เก่าไม่เจอ · ไม่มีระบบ Blacklist

**Core value proposition (CEO language):**
1. กดสร้างประกาศ → ได้ลิ้งค์ทันที → แปะ Facebook/LINE/QR code ได้
2. ใบสมัครทุกใบเก็บถาวรในที่เดียว · ค้นหาย้อนหลังได้ตลอดชีพ
3. AI ช่วยร่าง JD + แนะนำคำถาม + ให้คะแนนผู้สมัคร
4. Blacklist เตือนทันทีเมื่อคนเก่าที่มีปัญหาสมัครกลับมา
5. รองรับ 2 บริษัท (Pooil + JPSync) ในระบบเดียว

**Estimated:** 6-8 วันทำงาน (1.5-2 อาทิตย์) · 5 ตารางใหม่ · 1 module ใหม่ · ไม่กระทบ module เดิม

---

## 🎤 War-Room — 6+1 เสียง

### 👑 1. Owner / CEO (Pattipan)

**มุมมอง:**
- ตอนนี้ทำเองทุกครั้งใน Google Sheets · เสียเวลาไปกับการ admin มากกว่าเลือกคน
- ต้องการให้ HR ใช้งานได้เองโดยไม่มี IT
- กังวล: PDPA + ข้อมูลรั่ว · ห้ามให้ลิ้งค์โหลดเข้าผิดมือ
- ความสำเร็จ = ภายใน 1 เดือนหลัง launch ลด time-to-hire จาก 14 วัน → 7 วัน
- ห้ามทำให้ผู้สมัครกรอกยาก · ขึ้น mobile ใน 3 วินาที

**3 must-have จาก Owner:**
1. ลิ้งค์ 1 คลิก สร้างได้ · QR code ทันที
2. AI ช่วยคิด field ที่ต้องถาม (CEO ไม่อยากนั่งคิดเอง)
3. Blacklist + duplicate check (เจอคนเก่าทันที)

---

### 💼 2. Business Domain Expert (SME ไทย / Recruitment)

**Context จากตลาด:**
- SME ไทย 90% ยังใช้ LINE OA + Google Form · ไม่มีระบบ ATS (Applicant Tracking System)
- ตำแหน่งที่ Pooil/JPSync รับสมัครหลัก: คนขับรถ · พนักงานคลัง · บัญชี · ขาย
- ผู้สมัครส่วนใหญ่อายุ 30-55 · ใช้มือถือเป็นหลัก · ไม่มีอีเมล แต่มี LINE/เบอร์ทุกคน
- Pain ของ HR ไทย: ต้องโทรเช็คอ้างอิงเอง · ไม่มีฐานข้อมูลคนเก่า · ไม่รู้ว่าพนักงานคนนี้เคยทำงานที่ไหนมาก่อน

**3 คำเตือนจาก Business:**
1. ห้ามบังคับมีอีเมล · ใช้เบอร์โทรเป็น primary identifier
2. ฟอร์มต้องสั้นที่สุด · 5-10 ข้อพอ · ยาวกว่านี้คนกรอกไม่จบ
3. ต้องมี LINE notification ส่งกลับให้ผู้สมัครว่าได้รับใบสมัครแล้ว (มากกว่าอีเมล)

---

### 📊 3. Business Analyst (BA)

**User stories ที่สกัดได้:**

**Persona 1: HR / Admin (Pooil + JPSync)**
- US-1.1: ฉันต้องการสร้างประกาศใหม่ภายใน 3 นาทีโดยเลือก template
- US-1.2: ฉันต้องการเลือก field 5-15 ข้อแบบลาก-วาง
- US-1.3: ฉันต้องการ preview ก่อน publish
- US-1.4: ฉันต้องการได้ short link + QR code อัตโนมัติ
- US-1.5: ฉันต้องการดู applications แบบ Kanban (ใหม่/คัดกรอง/สัมภาษณ์/รับ/ไม่รับ)
- US-1.6: ฉันต้องการ search ผู้สมัครด้วยชื่อ/เบอร์/บัตร ข้ามทุกประกาศย้อนหลัง
- US-1.7: ฉันต้องการเพิ่ม note ภายในเกี่ยวกับผู้สมัครแต่ละคน
- US-1.8: ฉันต้องการกด "ดูคะแนน AI" แล้วได้เหตุผล 3 บรรทัด
- US-1.9: ฉันต้องการเพิ่มคนเข้า Blacklist พร้อมเหตุผล
- US-1.10: ฉันต้องการ export ใบสมัครเป็น PDF/CSV

**Persona 2: ผู้สมัครงาน (public)**
- US-2.1: ฉันต้องการเปิดลิ้งค์บนมือถือแล้วกรอกได้เลย
- US-2.2: ฉันต้องการแนบรูปหน้า + รูปเอกสาร + ไฟล์ PDF
- US-2.3: ฉันต้องการเห็นว่า field ไหนบังคับ field ไหนไม่บังคับ
- US-2.4: ฉันต้องการได้รับการยืนยันว่าใบสมัครส่งเรียบร้อย
- US-2.5: ฉันต้องการให้ระบบ save ไว้ถ้าฉันออกระบบกลางคันแล้วกลับมากรอกต่อ

**Persona 3: Executive / Owner**
- US-3.1: ฉันต้องการดู dashboard ภาพรวม (จำนวนใบสมัคร/ตำแหน่ง · อัตรารับเข้า · เวลาเฉลี่ย)
- US-3.2: ฉันต้องการเปรียบเทียบ 3-5 candidates แบบ side-by-side

---

### 🏗 4. Solutions Architect (SA)

**Integration map:**
- **Auth:** ใช้ session ของ Pooil เดิม (NextAuth + Supabase) · role guard ผ่าน `lib/auth/role-guards.ts` (เพิ่ม `RECRUIT_ROLES`)
- **DB:** Prisma + Supabase Postgres · ตารางใหม่ใน schema เดียว · RLS policies ใหม่ตาม pattern เดิม
- **File storage:** R2 bucket `pooilgroup` ที่ใช้อยู่ · prefix `recruit/<job_slug>/<applicant_id>/`
- **Email:** Resend (ของเดิม) · template ใหม่ "applicant-confirmation"
- **LINE OA:** **ยังไม่มี** ใน Pooil → Phase 2 (ใช้ LINE Messaging API)
- **AI:** Anthropic SDK (ของ Buildly Go) ผ่าน proxy endpoint ใน Pooil · ใช้ `claude-sonnet-4-5` สำหรับ scoring · `claude-haiku-4-5` สำหรับ field suggest
- **Audit:** เพิ่ม audit events `recruit.*` ทุก action (RULE B ของ Pooil)
- **Public form:** route `/apply/[slug]` อยู่นอก `(admin)` group · ไม่ต้อง auth · มี rate limit + CAPTCHA

**3 คำเตือนจาก SA:**
1. ห้ามให้ public form (`/apply/[slug]`) query Prisma ด้วย adminClient โดยตรง · ต้องผ่าน server action + RLS service-role ที่ check slug + status
2. AI calls ต้องผ่าน budget guard ใหม่ของ Pooil (ยังไม่มี — ต้องสร้าง mini version) · cap 50 calls/วัน
3. R2 upload ต้องตรวจ MIME type + ขนาดไฟล์ฝั่ง server · ไม่เชื่อ client

---

### 📅 5. Project Manager (PM)

**Critical path:**
```
R0 (0.5 วัน) → R1 (1 วัน) → R2 (2 วัน) → R3 (1 วัน) → R4 (1.5 วัน) → R5 (1.5 วัน) → R6 (1 วัน)
                ↓ migration ทุก phase ต้อง verify ก่อนต่อ
```

**Dependencies ที่อาจ block:**
- R3 ต้องรอ R2 (form builder จบก่อนคนสมัครจริงได้)
- R5 (AI) ต้องรอ R3 (มี data ผู้สมัครก่อน)
- LINE OA = future phase · ไม่ block อะไร

**3 risk จาก PM:**
1. CEO อาจขอเพิ่ม scope กลางทาง (เช่น LINE notification, signature pad) → ล็อก scope ใน Phase 1 · feature ใหม่ → Phase 2
2. PDPA compliance อาจต้อง legal review → reserve buffer 1 วัน
3. R2 + Anthropic billing อาจ surprise → set alert ที่ 80% quota

**Milestones:**
- M1 (วันที่ 1.5): สร้างประกาศ + เก็บลง DB ได้ (R0+R1)
- M2 (วันที่ 3.5): form builder เสร็จ · publish ได้ลิ้งค์ (R2)
- M3 (วันที่ 4.5): ผู้สมัครกรอกได้จริง · มี applications ใน DB (R3)
- M4 (วันที่ 6): pipeline + review เสร็จ (R4)
- M5 (วันที่ 7.5): AI + Blacklist เสร็จ (R5)
- M6 (วันที่ 8.5): Analytics + polish (R6)

---

### ⚙️ 6. Technical Architect

**Data model (5 tables ใหม่):**

```
JobPosting (ประกาศ)
  - id, company_id (Pooil/JPSync), title, description (rich text), slug (unique)
  - status (draft/open/closed/archived), field_schema (JSON), settings (JSON)
  - opens_at, closes_at, created_by_id, created_at, updated_at

Applicant (ผู้สมัคร · normalize ข้าม postings)
  - id, full_name, phone (primary key for dedup), email, line_id
  - national_id_hash (sha256 · ไม่เก็บ plain), created_at

Application (ใบสมัคร 1 ใบ)
  - id, posting_id, applicant_id, answers (JSON), files (JSON array)
  - status (new/screening/interview/offered/hired/rejected/withdrawn)
  - ai_score (0-100), ai_summary, ai_evaluated_at
  - submitted_at, updated_at, source (utm)
  - draft (boolean · for autosave)

ApplicationNote (HR internal)
  - id, application_id, user_id, body, rating (1-5), created_at

Blacklist
  - id, phone (indexed), national_id_hash, full_name
  - reason (required, > 20 chars), added_by_id, added_at, expires_at
  - company_scope (Pooil/JPSync/both)
```

**Tech choices:**
- Form builder UI: react-hook-form + zod + dnd-kit (drag-drop) · ไม่ใช้ library ใหญ่
- Field schema = JSON ที่ validate ด้วย zod runtime · render โดย switch component
- AI calls = Anthropic SDK ฝั่ง server action เท่านั้น · ห้าม client เรียก
- File upload = signed URL ของ R2 · client uploads ตรง · server verify หลังจาก
- Rate limit = ใช้ middleware ของ Pooil (มี Map-based อยู่แล้ว)

**3 คำเตือน Architect:**
1. JSON `field_schema` ต้องมี **version** field · จะมี breaking change ตอน iterate
2. Application status เป็น state machine · ต้องมี enum + transition guard (ห้ามกระโดด rejected → hired)
3. `national_id` ห้ามเก็บ plain → hash ก่อนเสมอ · เก็บแค่ last-4 digits ไว้แสดง

---

### 🧑‍💼 +1 HR Lead (ผมเสนอเพิ่ม · ไม่ได้อยู่ใน 6 ที่ CEO ลิสต์)

**มุม HR ที่ทีมเทคไม่เห็น:**
1. **Interview availability** — ทุกใบสมัครต้องมีคำถาม "ว่างเริ่มงานเมื่อไหร่" + "ว่างสัมภาษณ์วันไหนบ้าง"
2. **คนรู้จัก/แนะนำ** — ถามว่า "รู้จักพนักงานเราใครบ้าง" (HR ไทยให้ค่ามาก · มี referral bonus)
3. **เงินเดือนที่ต้องการ** — ต้องเป็น range ไม่ใช่ตัวเลข (HR จะไม่กล้าถามแบบเปิด)
4. **คำถาม IQ/ไหวพริบ** — ไม่ต้องยาก · 3-5 ข้อง่าย ๆ พอ (ดูว่าคิดเป็นไหม · ไม่ใช่วัด IQ จริง)
5. **Reference contact** — ขอชื่อ + เบอร์ผู้แนะนำ 1-2 คน (ก่อนรับเข้าทำงาน HR จะโทรเช็ค)

**3 must-have จาก HR ที่ CEO ยังไม่ได้พูด:**
1. ส่ง LINE notification กลับให้ผู้สมัคร = สำคัญกว่า email
2. มีหน้าให้ HR comment คำตอบรายข้อ ("คำตอบนี้ดี · คำตอบนี้แปลก")
3. Export ใบสมัครเป็น PDF เพื่อ print ใช้สัมภาษณ์

---

## 🤝 ฉันทามติทั้ง 7 เสียง

ทุกคนเห็นพ้อง 8 ข้อนี้ · CEO ไม่ต้องตัดสิน:

1. ✅ ใช้ Pooil app เดิม · ไม่สร้างโปรเจกต์ใหม่
2. ✅ Public form (`/apply/[slug]`) ไม่ต้อง login · ขึ้น mobile-first
3. ✅ เบอร์โทรเป็น primary identifier (ไม่ใช่อีเมล)
4. ✅ Field schema เป็น JSON ที่ versioned
5. ✅ AI advisory only · ห้าม auto-reject
6. ✅ Blacklist เก็บ hash ไม่เก็บ plain national_id
7. ✅ PDPA consent checkbox บังคับก่อน submit
8. ✅ Audit log ทุก action เหมือน Pooil module เดิม

---

## 🤔 ข้อขัดแย้ง — รอ CEO ตัดสิน (4 ข้อ)

### Q1: ตำแหน่ง URL ของ admin module
- **Option A:** `/recruit/` (อังกฤษ · ตามแบบ fuelos/cashhub/docuflow)
- **Option B:** `/รับสมัครพนักงาน/` (ไทย · แต่ URL ไทยอาจมีปัญหา escape)
- **ผมแนะนำ:** A (URL ภาษาอังกฤษ · UI Thai)

### Q2: Role ที่เข้าใช้ได้
- **Option A:** ใช้ `executive` + `branch_manager` ที่มีอยู่
- **Option B:** สร้าง role ใหม่ `hr`
- **ผมแนะนำ:** B (สร้าง `hr` role เพราะ HR ≠ branch manager จริง ๆ · แต่ phase 1 ใช้ A ก่อน · phase 2 ค่อยแยก)

### Q3: LINE OA integration
- **Option A:** ทำเลยใน Phase R5
- **Option B:** Phase 2 (หลัง launch)
- **ผมแนะนำ:** B (ยังไม่มี LINE OA setup · ขอเริ่มจาก email ก่อน)

### Q4: ใบสมัครหายไปอัตโนมัติเมื่อใด (PDPA retention)
- **Option A:** 1 ปีหลังไม่ active
- **Option B:** 2 ปีหลังไม่ active
- **Option C:** ไม่ลบ · ให้ HR ลบเอง
- **ผมแนะนำ:** B (2 ปี · พอ legal · พอ business reuse)

---

## 📋 Feature Spec — รายละเอียดเต็ม

### A. Form Builder (10 field types + validation)

| # | ชนิด | ใช้ทำอะไร | Options ที่ตั้งได้ |
|---|------|-----------|------------------|
| 1 | **ปลายปิด (yes/no)** | "มีใบขับขี่ไหม" | label, required, default |
| 2 | **Single dropdown** | "สาขาที่สมัคร" | options, required |
| 3 | **ปลายเปิด สั้น** | "ชื่อ-นามสกุล" | label, required, max length, format (เบอร์/อีเมล/บัตรประชาชน) |
| 4 | **ปลายเปิด ยาว** | "ประสบการณ์ทำงาน" | label, required, max chars (default 1000) |
| 5 | **Multiple choice — radio** | "ระดับการศึกษา" | options[], required |
| 6 | **Multiple choice — checkbox** | "ทักษะที่มี" | options[], required, min/max selections |
| 7 | **Range / สเกล** | "เงินเดือนที่ต้องการ" | min, max, step, unit (บาท/ปี/ชั่วโมง) |
| 8 | **ตัวเลข** | "อายุ" | min, max, integer/decimal |
| 9 | **วันที่** | "วันที่เริ่มงานได้" | min, max, required |
| 10 | **อัปโหลดไฟล์/รูป** | "Resume / ใบรับรอง / รูปถ่าย" | accept: **PDF + Word (.doc/.docx) + image (jpg/png)** · max 5MB · max 3 ไฟล์ · **ไม่ขอบัตรประชาชนตอนสมัคร** (ไว้มาสัมภาษณ์ค่อยให้) |

**Validation features:**
- ทุก field มี toggle `required` (บังคับ/ไม่บังคับ)
- ทุก field มี `helpText` (คำอธิบายเล็ก ๆ ใต้ label)
- Format validation: เบอร์โทร (10 หลัก), อีเมล (regex), บัตรประชาชน (13 หลัก + checksum)
- หน้า public form แสดง error inline ทันทีเมื่อ blur
- ปุ่ม Submit disable จนกว่า required fields ครบ

**Bonus: Section headers** (group field) — เช่น "ข้อมูลส่วนตัว" / "ประสบการณ์" / "คำถามไหวพริบ"

**Bonus: IQ Quiz mode** — ติ๊กที่ field ใดก็ได้ว่า "มีคำตอบถูก" → ระบบให้คะแนนอัตโนมัติเมื่อตอบถูก

---

### B. Public Apply Page (`/apply/[slug]`)

**Layout (mobile-first):**
```
┌─────────────────────────┐
│ Logo (Pooil/JPSync)     │
│ ตำแหน่ง: ชื่อตำแหน่ง   │
│ บริษัท: Pooil           │
│ เปิดรับ: 1-31 พ.ค. 26   │
├─────────────────────────┤
│ [field 1]               │
│ [field 2]               │
│ ...                     │
├─────────────────────────┤
│ ☐ ฉันยินยอม PDPA       │
│ [ปุ่ม "ส่งใบสมัคร"]    │
└─────────────────────────┘
```

**Features:**
- Auto-save draft ใน localStorage (กลับมากรอกต่อได้)
- Honeypot field (hidden) กันบอท
- Rate limit: 5 submit/IP/15 นาที
- Submit สำเร็จ → หน้า thank-you + reference ID
- ผิด field ไหน → scroll ขึ้นไป highlight แดง
- ลิ้งค์ปิด (`status=closed`) → แสดง "ปิดรับสมัครแล้ว · ขอบคุณที่สนใจ"

---

### C. Application Storage + Search + Pipeline

**Pipeline view (Kanban):**
```
ใหม่ → คัดกรอง → สัมภาษณ์ → เสนอ → รับเข้า / ไม่รับ / ถอน
 12      5         3         2         8 / 4 / 1
```

**Search/Filter:**
- ค้นด้วยชื่อ / เบอร์ / อีเมล / บัตรประชาชน (last-4)
- Filter: ตำแหน่ง · บริษัท (Pooil/JPSync) · status · ช่วงวันที่ · มีไฟล์/ไม่มี
- Sort: ใหม่สุด / AI score สูงสุด / ติด blacklist

**Detail page (per applicant):**
- คำตอบทุกข้อ (rendered ตาม field type)
- ไฟล์ทุกชิ้น (preview รูป · download PDF)
- AI score + เหตุผล (Section ที่ collapse ได้)
- Notes ภายใน (HR หลายคนเพิ่มได้)
- Star rating 1-5 จาก HR
- Status dropdown (เปลี่ยน status → audit log)
- ปุ่ม "เพิ่มเข้า Blacklist" (พร้อมเหตุผลบังคับ)
- ปุ่ม "Export PDF" (สำหรับ print สัมภาษณ์)

---

### D. AI Features (3 จุด · **manual trigger เท่านั้น**)

**กฏ AI หลัก (CEO 2026-05-20):** AI ห้าม auto · ห้ามวิ่งเองตลอดเวลา · ทุกการเรียกต้องมีคนกดปุ่ม → ประหยัด · ควบคุมต้นทุนได้

**D1. AI Field Suggestor** (เมื่อสร้างประกาศ · กดปุ่ม)
- Trigger: HR กดปุ่ม "🤖 ให้ AI ช่วยแนะนำ field"
- Input: ตำแหน่ง + บริษัท + เงินเดือนคร่าว ๆ
- Output: 8-15 fields แนะนำ + ทำไม
- Model: `claude-haiku-4-5` (เร็ว · ถูก)
- HR ติ๊กเลือกที่ชอบ · ทิ้งที่ไม่เอา · **HR แก้/เพิ่ม/ลบเองได้หมด**

**D2. AI Candidate Scoring** (manual · ไม่ auto)
- Trigger: HR กดปุ่ม **"🤖 ประเมินด้วย AI"** ในหน้าใบสมัครรายคน
- หรือ bulk: เลือกหลายคน → "ประเมินทั้งหมด" (confirm modal ก่อนยิง)
- Input: JD + คำตอบทุก field
- Output: score 0-100 + เหตุผล 3 บรรทัด + จุดแข็ง 3 ข้อ + จุดเสี่ยง 3 ข้อ
- Model: `claude-sonnet-4-5`
- Cache: ผลเก็บถาวร · กดซ้ำ = rerun (ตั้งใจ · บางครั้งอยาก refresh)
- **AI ไม่เห็น:** อายุ + เพศ + ภาพถ่าย (กัน bias)

**D3. AI Support Chat** (floating button · กดเปิดเอง)
- FAB มุมขวาล่าง ทุกหน้า admin
- กด → panel slide-in · ไม่ใช่ pop-up เด้งเอง
- Capability: ช่วยร่าง JD · เปรียบเทียบ candidates · สรุปใบสมัคร
- Context-aware: รู้ว่าหน้าไหน
- Model: `claude-sonnet-4-5`
- Budget guard: 30 calls/วัน (ลดจาก 50 เพราะ manual)

---

### E. Blacklist

**Match logic:**
- ตอนรับใบสมัครใหม่ → match กับ Blacklist ด้วย: `phone` (exact) OR `national_id_hash` (exact) OR `full_name + birthdate` (fuzzy)
- ถ้าเจอ → application มี flag `flagged_blacklist=true` + reason ปรากฏในรายการทันที
- HR ตัดสินเอง · ระบบไม่ block automatic

**Add to Blacklist UI:**
- ปุ่ม "เพิ่มเข้า Blacklist" จากหน้าผู้สมัคร
- บังคับกรอก: reason (min 20 chars), company_scope (Pooil/JPSync/both), expires_at (default +5 ปี)
- ลายเซ็น = ใครเพิ่ม + วันที่ (audit log)

**Manage Blacklist page:**
- List + search ทุกคน
- Edit/Remove (ต้อง role executive)
- Auto-expire เมื่อถึง expires_at (cron daily)

---

### F. Notifications + Follow-up Tasks (CEO Q4)

**Phase 1 (Resend email):**
- ส่งให้ผู้สมัคร: "ได้รับใบสมัครเรียบร้อย · เลขที่ {ref_id}"
- ส่งให้ HR: "มีใบสมัครใหม่สำหรับ {ตำแหน่ง}" (digest ทุก 6 ชม.)
- **ทุกครั้งที่ HR เปลี่ยน status:** ส่ง email ให้ผู้สมัครอัตโนมัติ
  - "ใหม่ → คัดกรอง" : "ใบสมัครของคุณอยู่ระหว่างพิจารณา"
  - "คัดกรอง → สัมภาษณ์" : "เชิญสัมภาษณ์ · HR จะติดต่อกลับ"
  - "สัมภาษณ์ → เสนอ" : "เรายื่นข้อเสนอ · โปรดติดต่อกลับ"
  - "X → ไม่รับ" : "ขอบคุณที่สนใจ · จะเก็บข้อมูลไว้พิจารณาตำแหน่งอื่น"
  - Template แก้ไขได้ใน settings

**Follow-up Task List (ใหม่ · จาก CEO Q4):**
- หน้าใหม่ "📌 งานที่ต้องทำ" — แสดงทุกคนที่ status รออยู่
- ตัวอย่าง:
  - "John Doe — รอนัดสัมภาษณ์ (2 วันแล้ว) ⚠"
  - "Mary K. — รอคำตอบหลังเสนอ (5 วัน · เกินกำหนด)"
- Sort by: urgency (กี่วันที่ค้าง)
- กด → ไปหน้า detail ของผู้สมัคร
- มี email digest ส่งให้ HR ทุกเช้า: "วันนี้มี 5 งานต้องตาม"

**Phase 2 (LINE OA · future):**
- LINE notify ผู้สมัคร: แทน email
- LINE notify HR: instant alert per application

---

### G. Analytics Dashboard

**Metrics ที่แสดง:**
1. Applications/week (กราฟ line)
2. Applications/posting (bar chart)
3. Conversion funnel: View → Start → Submit → Hired
4. Avg time-to-hire (วัน)
5. Top sources (Facebook · LINE · QR · Direct)
6. AI score distribution

**Filter:** บริษัท · ตำแหน่ง · ช่วงเวลา

---

### H. Admin / Permission / Audit

**Role matrix:**

| Action | executive | branch_manager (HR proxy) | staff | driver |
|--------|-----------|-------------------------|-------|--------|
| สร้างประกาศ | ✅ | ✅ | ❌ | ❌ |
| ดู applications | ✅ | ✅ company ตน | ❌ | ❌ |
| Score / Move pipeline | ✅ | ✅ | ❌ | ❌ |
| เพิ่ม Blacklist | ✅ | ✅ | ❌ | ❌ |
| ลบ Blacklist | ✅ | ❌ | ❌ | ❌ |
| Export | ✅ | ✅ | ❌ | ❌ |

**Audit events ใหม่:** `recruit.posting.created` · `recruit.posting.published` · `recruit.application.submitted` · `recruit.application.status_changed` · `recruit.blacklist.added` · `recruit.blacklist.removed` · `recruit.ai.scored`

---

### I. PDPA Compliance Pack

- Consent checkbox บังคับ · ข้อความเฉพาะ (ผมจะเตรียมจาก template ไทย)
- หน้า `/apply/[slug]/privacy` แสดง privacy notice
- หน้า `/apply/request-deletion` ให้ผู้สมัครขอลบ (verify ด้วย OTP)
- Auto-delete หลัง 2 ปีไม่ active (cron · keep audit log)
- National ID hash-only (ไม่เก็บ plain) · เก็บ last-4 สำหรับแสดง
- Files ใน R2 ตั้ง lifecycle 2 ปี

---

## 🗂 Database Schema (Prisma sketch)

```prisma
model JobPosting {
  id            String   @id @default(uuid())
  companyId     String   // FK to Company (Pooil/JPSync)
  title         String
  description   String   @db.Text
  slug          String   @unique
  status        PostingStatus @default(DRAFT)
  fieldSchema   Json     // versioned JSON
  settings      Json     // closing date, notifications, etc.
  opensAt       DateTime?
  closesAt      DateTime?
  createdById   String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  applications  Application[]

  @@index([companyId, status])
  @@index([slug])
}

model Applicant {
  id              String   @id @default(uuid())
  fullName        String
  phone           String   // primary identifier (indexed)
  email           String?
  lineId          String?
  // CEO 2026-05-20 Q5: ไม่เก็บ national ID ตอนสมัคร — เก็บตอน onboarding offline เท่านั้น
  createdAt       DateTime @default(now())
  applications    Application[]

  @@index([phone])
}

model Application {
  id              String   @id @default(uuid())
  postingId       String
  applicantId     String
  answers         Json
  files           Json     // [{key, name, size, mime}]
  status          ApplicationStatus @default(NEW)
  aiScore         Int?
  aiSummary       String?  @db.Text
  aiEvaluatedAt   DateTime?
  flaggedBlacklist Boolean @default(false)
  blacklistReason  String?
  draft           Boolean  @default(false)
  source          String?  // utm
  refId           String   @unique // human-readable for applicant
  submittedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  posting         JobPosting @relation(fields: [postingId], references: [id])
  applicant       Applicant @relation(fields: [applicantId], references: [id])
  notes           ApplicationNote[]

  @@index([postingId, status])
  @@index([applicantId])
}

model ApplicationNote {
  id            String   @id @default(uuid())
  applicationId String
  userId        String
  body          String   @db.Text
  rating        Int?     // 1-5
  createdAt     DateTime @default(now())
  application   Application @relation(fields: [applicationId], references: [id])

  @@index([applicationId])
}

model Blacklist {
  id              String   @id @default(uuid())
  phone           String?
  fullName        String
  reason          String   @db.Text
  // CEO 2026-05-20 Q1: ใช้ company รวมกัน — scope BOTH เป็น default แทบทั้งหมด
  companyScope    CompanyScope @default(BOTH)
  addedById       String
  addedAt         DateTime @default(now())
  expiresAt       DateTime
  removedAt       DateTime?
  removedById     String?

  @@index([phone])
}

enum PostingStatus { DRAFT OPEN CLOSED ARCHIVED }
enum ApplicationStatus { NEW SCREENING INTERVIEW OFFERED HIRED REJECTED WITHDRAWN }
enum CompanyScope { POOIL JPSYNC BOTH }
```

---

## 📅 Project Plan — 7 Phases (R0-R6)

### Phase R0 — Foundation (0.5 วัน)
- Migration ตาราง 5 ตัว
- RLS policies (ห้าม cross-company)
- Role guard `RECRUIT_ROLES`
- Tile "รับสมัครพนักงาน" บนหน้า home

**Deliverable:** Empty admin page เข้าได้ · DB พร้อม

---

### Phase R1 — Job Posting CRUD (1 วัน)
- หน้า list ประกาศ (filter by company + status)
- หน้าสร้าง/แก้ไขประกาศ (title, description, dates · ยังไม่มี field builder)
- Publish flow → generate slug + short link
- QR code generator

**Deliverable:** สร้างประกาศได้ · ได้ลิ้งค์ + QR

---

### Phase R2 — Form Builder UI (2 วัน)
- Drag-drop 10 field types
- Properties panel (label, required, options, validation)
- Section headers
- Preview ก่อน publish
- Zod schema validator (runtime)

**Deliverable:** HR สร้างฟอร์มเองได้ · preview ก่อน publish

---

### Phase R3 — Public Apply + File Upload (1 วัน)
- หน้า `/apply/[slug]` render ตาม field_schema
- Mobile-first responsive
- R2 file upload (signed URL flow)
- Rate limit + honeypot
- Auto-save draft (localStorage)
- หน้า thank-you + ref ID
- Email confirmation (Resend)

**Deliverable:** ผู้สมัครกรอกได้จริงจากมือถือ · ไฟล์อัปโหลดเข้า R2 · ได้ email confirm

---

### Phase R4 — Pipeline + Review (1.5 วัน)
- Kanban view (drag status)
- Detail page (answers + files + notes + rating)
- Search ข้ามทุกประกาศ (ชื่อ/เบอร์/บัตร)
- Export PDF + CSV
- Audit events

**Deliverable:** HR ทำงาน end-to-end ได้

---

### Phase R5 — AI + Blacklist (1.5 วัน)
- AI Field Suggestor (modal ในหน้าสร้างประกาศ)
- AI Candidate Scoring (auto เมื่อ submit + manual rerun)
- AI Support Chat (floating button)
- Blacklist CRUD + match logic
- Flag UI

**Deliverable:** AI 3 จุดใช้ได้จริง · Blacklist เตือนตอนสมัคร

---

### Phase R6 — Analytics + Polish + PDPA (1 วัน)
- Analytics dashboard
- PDPA: consent text, deletion request page, retention cron
- Empty states + loading skeletons
- Error pages
- Sentry integration (extend ของ Pooil)

**Deliverable:** Production-ready · ส่งให้ CEO test ได้

---

**Total:** 6.5-8.5 วัน (≈1.5-2 อาทิตย์ทำเต็มเวลา)

---

## ⚠️ Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | PDPA non-compliance ฟ้องร้องได้ | M | H | Consent + retention + deletion · legal review buffer |
| 2 | Blacklist กลายเป็นเครื่องมือเลือกปฏิบัติ | M | H | บังคับ reason + audit + auto-expire · ห้าม auto-reject |
| 3 | AI bias / wrong scoring | H | M | Advisory only · log AI decisions · HR ต้อง override ได้ |
| 4 | Public form ถูกบอตยิงสแปม | H | M | Rate limit + honeypot + (phase 2) CAPTCHA |
| 5 | R2 storage bill บานปลาย | M | M | Max 5MB/file · 3 files/application · lifecycle 2 ปี |
| 6 | Anthropic API ค่าแพง | M | M | Budget guard 50 calls/วัน · cache scoring · ใช้ haiku ตรงที่ทำได้ |
| 7 | Cross-company data leak (Pooil เห็น JPSync) | L | H | RLS by company_id · test ก่อน launch |
| 8 | ใบสมัครหายตอน submit (network) | M | M | Auto-save draft + retry + idempotency key |
| 9 | CEO scope creep | H | M | Lock scope · feature ใหม่ → Phase 2 |
| 10 | National ID เก็บ plain โดยพลาด | L | H | Hash ใน schema · CI lint ห้ามมี `nationalId String` |

---

## 💰 Cost Estimate (เดือน)

**Anthropic API:**
- Field Suggestor (haiku · 50 calls/วัน · ~500 tokens) = ~$3/เดือน
- Scoring (sonnet · 200 applications/เดือน · ~3k tokens) = ~$15/เดือน
- Support Chat (sonnet · 100 calls/เดือน · ~2k tokens) = ~$10/เดือน
- **รวม:** ~$28/เดือน (~1,000 บาท)

**R2:**
- เพิ่ม ~5GB/เดือน · ~$0.08/เดือน

**Resend:**
- เพิ่ม ~500 emails/เดือน · ฟรี (ใน free tier 3000/month)

**รวมต้นทุนใหม่:** ~1,100 บาท/เดือน

---

## 🎬 ตัดสินใจ Default ที่ผม assume (CEO ขัดได้)

1. URL admin = `/recruit/` (อังกฤษ)
2. Role = ใช้ `executive + branch_manager` ที่มีอยู่ก่อน · Phase 2 ค่อยแยก `hr`
3. LINE OA = Phase 2 (ยังไม่ทำรอบนี้)
4. Retention = 2 ปี
5. Field types Phase 1 = 10 ชนิดตามตาราง · ไม่มี conditional logic (ไว้ Phase 2)
6. Multi-page form = Phase 2 (รอบนี้เป็น single page scroll)
7. Interview scheduler = Phase 2
8. LINE login ของผู้สมัคร = ไม่มี (ส่ง public link ตรง)

---

## 🎯 ขั้นต่อไป (รออนุมัติ CEO)

1. CEO ตอบ 4 ข้อขัดแย้ง (Q1-Q4) ที่ list ไว้ข้างบน → ผมล็อก spec
2. CEO ติ๊กว่าเริ่ม Phase R0 เลยไหม
3. ถ้าเริ่ม → ผมทำตามลำดับ R0 → R1 → ... · มี briefing CEO หลังจบทุก phase
4. ทุก phase ที่จบ ผมจะ deploy ขึ้น preview URL ให้ CEO test ก่อนต่อ phase ถัดไป

---

## 📚 References

- [[architecture-c-separate-deploy-share-auth]] — โปรแกรมนี้อยู่ใน Pooil
- [[do-not-move-pooil-folder]] — ไม่ย้ายโฟลเดอร์
- [[pooil-deployment-state]] — Vercel project เดิม
- [[recruit-module-pooil-2026-05-20]] — memory entry สำหรับ initiative นี้
- `pooilgroup-web/STATUS.md` — sprint tracker (Phase 2 RLS + UX จบแล้ว · พร้อมรับ work ใหม่)
- `pooilgroup-web/CLAUDE.md` — Pooil project rules
