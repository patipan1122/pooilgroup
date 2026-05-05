# 🎨 Pooilgroup ERP — Design System

> **Source of truth สำหรับงานออกแบบทั้งระบบ**
> ผ่าน Brand DNA workshop กับเจ้าของระบบ 2026-05-05
> ทุกหน้าใหม่ + รีเฟรชหน้าเก่าใช้คู่มือนี้

---

## 0. Brand DNA (สั่งจากเจ้าของ)

```
3 คำ:        พรีเมี่ยม + มืออาชีพ + ใช้ง่าย
แบรนด์ที่อิง: Auditmekub + Apple
ห้ามมี:       ดูเป็นราชการ · สีเยอะ
```

ทุก decision หลังจากนี้ derive จาก 3 บรรทัดนี้

---

## 1. หลักการใหญ่ (3 ข้อ)

### 1.1 พรีเมี่ยม = ใจกว้าง · ลายมือเด่น · ละเอียด
- whitespace เยอะ (Apple-grade): hero มี vertical space ≥ 80px
- typography ตัวใหญ่หนัก (Anuphan 800 ขนาด 5xl-7xl)
- shadow นุ่ม (`shadow-soft`, `shadow-blue` only) ห้าม drop shadow แข็ง ๆ
- radius เล็กน้อย → ใหญ่ขึ้น (`rounded-xl` ขั้นต่ำ, hero ใช้ `rounded-3xl`)

### 1.2 มืออาชีพ = ระเบียบ · เห็นภาพ · เปลี่ยน-ใจคน
- numbered sections "01 · OVERVIEW" ทุก section
- tabular-num สำหรับเลขทุกที่
- alignment เคร่ง (grid-cols, ไม่ปล่อยลอย)
- 1 primary action ต่อ section (ห้าม 5 ปุ่มเรียงกัน)

### 1.3 ใช้ง่าย = ผู้ใช้รู้เลย · ไม่ต้องคิด
- ปุ่มแตะมือถือได้ ≥ 44px (`h-12` หรือ `h-14`)
- ภาษาไทยที่คนทั่วไปอ่านเข้าใจ — ห้าม jargon technical
- empty state ต้องบอก "ทำอะไรต่อ"
- error message บอกวิธีแก้ ไม่ใช่ stack trace

---

## 2. สี — กฎเข้ม (LOCKED)

### หลักการ: 90% ของหน้าใช้ ฟ้า + ขาว + เทา เท่านั้น

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Default palette (ใช้ได้ทุกที่ทุกเวลา):
  ฟ้า  =  --color-brand-50 ... 900   (Pooil Blue)
  ขาว  =  bg-white, surface
  เทา  =  zinc-50 ... 900             (text, border, neutral)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Semantic colors (ใช้เฉพาะ binary outcome ที่ชัดเจน):
  เขียว (leaf)   →  "ผ่าน · ใช่ · approved · สำเร็จ"
                    เช่น: ✓ อนุมัติแล้ว, รายงานครบ, ผ่าน checklist
                    ห้ามใช้แค่เพราะอยากให้สวย
  
  แดง           →  "ไม่ผ่าน · ปฏิเสธ · error · ขาด"
                    เช่น: ปฏิเสธรายงาน, login ล้มเหลว, เงินขาด
                    ใช้แล้วต้องสำคัญจริง
  
  อำพัน (amber) →  "รอ · pending" เท่านั้น
                    ถ้าเป็น info ทั่วไป → ใช้ฟ้า ห้ามใช้อำพัน
```

### กฎห้าม (สำคัญ — กันคนเผลอ)

```
✗ ใช้สีจัดประเภท (เช่น 3 module = 3 สี)
  → ทำไมผิด? เพราะไม่มีอะไรดี/ไม่ดี — แค่ต่างกัน
  → ใช้ฟ้าเหมือนกันหมด แยกด้วย emoji/icon

✗ "info card" สีอำพัน  
  → info ทั่วไป = ฟ้า ไม่ใช่อำพัน
  → อำพันเก็บไว้สำหรับ "รอ" จริง ๆ

✗ ใช้เขียวเพราะ "ดูสบายตา"
  → เขียวสงวนไว้ "ใช่/ผ่าน" เท่านั้น

✗ Module/section พื้นเขียว/แดง/อำพัน เป็น default
  → default tint = bg-white หรือ bg-brand-50 เท่านั้น

✗ Purple, pink, teal, orange, magenta, cyan
  → ห้ามทุกที่ทุกเวลา
```

### ตรวจตัวเอง (ก่อน commit)

```
☐ หน้านี้สีหลักคือฟ้า + ขาว + เทา ใช่ไหม?
☐ ถ้าใช้เขียว → มี binary "ผ่าน" ชัดไหม?
☐ ถ้าใช้แดง → มี binary "ไม่ผ่าน/error" ชัดไหม?
☐ ถ้าใช้อำพัน → คือ "รอ" จริง ๆ ไม่ใช่ info?
☐ Module 3 ตัว ใช้สีเดียวกันหรือยัง?
```

### Background
- หลัก: `bg-white` หรือ `bg-zinc-50`
- decorative: `bg-grid-dots opacity-[0.35]` ทับบน white
- การ์ด tint: `bg-brand-50/40` หรือ `bg-zinc-50` เท่านั้น (ไม่ใช่ bg-amber-50)
- **AI / smart sections ในอนาคต:** dark navy gradient (background only)

---

## 3. Typography (3 ฟอนต์ ทำงาน 3 หน้าที่)

| ฟอนต์ | ใช้กับ | weight | utility |
|------|--------|--------|---------|
| **Anuphan** (Thai display) | h1/h2/hero/CardTitle | 700-800 | `font-display` |
| **Plus Jakarta Sans** | ตัวเลขใหญ่ + Latin headlines | 800 | `font-num-mega` |
| **IBM Plex Sans Thai** | body, label, button text | 400-600 | default `font-thai` |

### Hierarchy (UPDATED — bolder & bigger per CEO directive 2026-05-05)
```
Hero h1:    text-6xl sm:text-7xl lg:text-8xl
            font-display  font-extrabold (800)
            tracking-[-0.04em]  leading-[0.95]
            มี keyword ไล่สีฟ้าเสมอ

Page h1:    text-4xl sm:text-5xl lg:text-6xl
            font-display  font-extrabold

Section h2: text-2xl sm:text-3xl  font-display  (auto via <Section>)
Card title: text-base sm:text-lg  font-display  font-bold (700)
Body:       text-sm-base  font-thai  leading-relaxed (1.6)
Stat mega:  text-4xl sm:text-6xl  font-num-mega  font-extrabold
            keyword สำคัญใช้ .text-gradient-blue

Label:      text-[11px] uppercase  tracking-[0.22em]  font-bold
```

### Keyword highlighting — ทุก hero ต้องมี

**Default:** ใช้ `text-gradient-blue` กับ keyword สำคัญใน hero
- `<span class="text-gradient-blue">โปรแกรมไหน</span>` — ไล่สีฟ้า 135deg
- `<span class="text-gradient-blue-vivid">฿1.4M</span>` — สำหรับเลขใหญ่ ๆ ที่ต้องการเด่น
- `<span class="brand-gradient-text">Pooilgroup</span>` — เขียว→น้ำเงิน (ชื่อแบรนด์เท่านั้น)

**Marker (ทางเลือก สำหรับ secondary keyword):**
- `<span class="marker-underline">keyword</span>` — เส้นใต้สีน้ำเงินอ่อน
- `<span class="accent">keyword</span>` — สีน้ำเงินเข้มเฉย ๆ

**Rule:** 1-2 keyword สี ต่อ headline ห้ามใส่สีทุกคำ

### Readability (Apple-grade — ไม่ปวดตา)
```
Body line-height:    leading-relaxed (1.6)
Headline tracking:   tracking-[-0.04em] (tighter ดู premium)
Body color:          text-zinc-700 (ไม่ใช่ pure black)
Subtle text:         text-zinc-500
Maximum line width:  max-w-3xl สำหรับ paragraph
Font weight body:    400-500 (ไม่ใช่ thin/light เด็ดขาด)
Contrast:            ≥ 4.5:1 (WCAG AA) — ใช้ zinc-700 บน white ผ่านเสมอ
```

---

## 4. Spacing & Shape

```
Padding:
  Page:    p-4 sm:p-8 lg:p-12
  Card:    p-5 (CardBody default)
  Hero:    py-12 sm:py-16

Radius (จากเล็ก → ใหญ่):
  Tag/pill:  rounded-full / rounded-lg
  Button:    rounded-xl
  Card:      rounded-2xl
  Hero card: rounded-3xl

Border:
  Card:      border-2 border-zinc-200 hover:border-zinc-300
  Hover:     border-2 border-[--color-brand-400]
  Active:    border-2 border-[--color-brand-500]

Section gap:
  Major:     mb-12 sm:mb-16
  Inside:    gap-3 sm:gap-4 (grids)
```

---

## 5. Components catalog

### 5.1 Buttons
```
Primary CTA:     bg-brand-600 text-white rounded-xl shadow-blue h-12
                 hover:bg-brand-700  + ลูกศร → ที่ขวา (ArrowUpRight)
Secondary:       bg-white text-zinc-900 border-2 border-zinc-200 rounded-xl
Outline:         border-2 + bg-white
Danger:          bg-[--color-danger] (เฉพาะ destructive)

ห้าม: ปุ่มเหลี่ยมไม่มี radius · ปุ่มสีเทอร์ควอยซ์/ม่วง · ปุ่มเล็กกว่า 32px
```

### 5.2 Cards (3 ประเภท)
```
Standard:        rounded-2xl border-2 bg-white shadow-soft
                 hover:border-brand-300 transition-colors

Premium/Module:  rounded-3xl + radial blur ที่มุม + hover-lift
                 ใช้กับ module launcher, hero feature card

Action card:     สีพื้นเบา ๆ (brand-50/60, amber-50/60, red-50/60)
                 border-2 ใช้สีของ accent
                 ใช้กับ admin pending tasks
```

### 5.3 Section header
ใช้ `<Section number="01" label="OVERVIEW" title="..." description="...">` ทุก section
- Number ใน pill เล็ก สีน้ำเงิน
- Label uppercase tracking widest
- Title ใหญ่ font-display

### 5.4 Stats
ใช้ `font-num-mega text-3xl sm:text-5xl` สำหรับเลขใหญ่
Pattern: label เล็ก uppercase บน → เลขใหญ่ → trend ↑+5 ในกรอบเขียว/แดง

### 5.5 Badges (toned pills)
- `success` (เขียว) — ผ่าน, ใช้งาน, อนุมัติ
- `brand` (น้ำเงิน) — info ทั่วไป
- `warning` (อำพัน) — รอ, ใกล้หมดอายุ
- `danger` (แดง) — ปิด, ผิดพลาด
- `neutral` (เทา) — placeholder, non-status

---

## 6. Page patterns (ทุกหน้าใหม่ใช้ template เหล่านี้)

### 6.1 Hero (หน้า /home, landing)
```
- Eyebrow: brand-gradient-text "Pooilgroup" + วันที่ + name (uppercase tracking-widest)
- H1: 5xl-7xl ภาษาไทยหนัก + 1 keyword .accent + 1 keyword .marker-underline
- Subtitle: text-lg เทา + tabular numbers ใน strong
- (Optional) right-side floating cards ตามภาพ auditme — ใช้กับ landing/marketing
```

### 6.2 Dashboard (CashHub, FuelOS, etc.)
```
01 OVERVIEW   — 4 stat cards (ใหญ่ ๆ) + arrow change
02 ACTIONS    — pending list / approval queue
03 INSIGHTS   — chart/sparkline/leaderboard
04 ACTIVITY   — recent events / log
```

### 6.3 Form (สร้าง/แก้ user, branch, etc.)
```
- Sticky header: ชื่อหน้า + back link
- 2-3 grouped Cards เรียงลง (ข้อมูลพื้นฐาน → รายละเอียด → ความสัมพันธ์)
- ขอบ form ใหญ่ ๆ (Field component)
- Bottom: ยกเลิก (ghost) + บันทึก (primary CTA pill)
```

### 6.4 List + Filter (users, branches, reports)
```
Header: ชื่อ + count + ปุ่มทางขวา (Import / สร้างใหม่)
Section 01: stat overview (4 chips)
Section 02: filter bar + DataTable หรือ grouped cards
Empty state: icon + "ไม่มี..." + CTA
```

### 6.5 Detail (user/branch/report detail)
```
Top: back link + title + status badge + action buttons (right)
Grid 2-cols cards: contact info / channels / relations / activity
Bottom: timeline / history (collapsible)
```

### 6.6 Comparison (Before/After) — auditme signature
```
Center title with red+blue keyword highlights
Twin cards: Left red (ก่อน/ปัญหา) / Right blue (หลัง/วิธีแก้)
Each card: badge เหนือ + bullet list with X / ✓ icons
ใช้ใน: month vs month, branch vs branch, before/after metric improvement
```

---

## 7. Motion — เต็มสตรีม "พรีเมี่ยม" (UPDATED 2026-05-05)

**Philosophy:** subtle + elegant — ไม่ flashy แต่รู้สึก "อยู่ดี" ทุกที่

### Animation utilities ที่มี (ใช้ได้เลย)
```
✓ animate-fade-up         — มาจากด้านล่าง (default reveal)
✓ animate-slide-up-soft   — มา + scale 98%→100% (hero / card grids)
✓ animate-blur-in         — blur 8px → 0 (hero text reveal)
✓ animate-scale-in        — scale 96%→100% (modal, popup)
✓ animate-fade-in         — opacity เฉย ๆ (subtle)
✓ animate-pulse-soft      — opacity 1→0.6 loop (live indicator)
✓ animate-float           — translate Y ±6px loop (decorative)
✓ animate-drift           — slow translate (background blob — 12s loop)
```

### Stagger delays
```
delay-100/150/200/250/300/400/500
ใช้กับ animate-fade-up หรือ animate-slide-up-soft
ทำให้ items ใน grid มาทีละตัว (premium feel)
```

### Hover effects
```
✓ hover-lift              — translate -2px + shadow-lg (default cards)
✓ hover-lift-premium      — translate -4px + shadow-blue (module cards)
✓ sheen-overlay           — แสงสว่างวาบ ผ่านปุ่มตอน hover (CTA หลัก)
✓ glow-blue               — เงาฟ้าอ่อน ๆ รอบ ๆ (focus state)
✓ glow-blue-strong        — เงาฟ้าเข้ม ๆ (hero CTA hover)
```

### Section reveal pattern (ทุก page)
```jsx
<header className="animate-fade-up">                 {/* hero immediate */}
<Section className="animate-fade-up delay-100">      {/* 1st */}
<Section className="animate-fade-up delay-200">      {/* 2nd */}
<Section className="animate-fade-up delay-300">      {/* 3rd */}
```

### Background decoration (subtle layer)
```
✓ Radial blur blobs ที่มุมการ์ด (auditme signature)
  style={{ background: "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)" }}
✓ animate-drift กับ blob ขนาดใหญ่ใน hero
✓ bg-grid-dots opacity-[0.35] เลเยอร์พื้นหลัง
```

### ห้าม
```
✗ scroll-jacking / locked scroll
✗ parallax extreme
✗ bounce/elastic easing (cubic-bezier(.68,-0.55,.27,1.55) ห้าม)
✗ multi-second animations (>1s)
✗ rotating loaders ใหญ่ ๆ (ใช้ skeleton หรือ pulse แทน)
✗ animation บน element ที่ scroll ผ่านบ่อย ๆ (รบกวน)
✗ flash / strobe
```

---

## 8. Anti-patterns (สิ่งที่ห้าม)

### Layout
✗ ตารางขอบเทาบาง ๆ แบบ government website
✗ ฟอร์มยาวเป็นเมตร (>15 fields ในหน้าเดียว)
✗ คอลัมน์ 5+ ในตาราง mobile
✗ ปุ่ม 6 ปุ่มเรียงในแถวเดียว

### Visual
✗ สี>4 สีในหน้าเดียว (รวม semantic)
✗ font-thin / font-light (ไทย)
✗ emoji เป็นปุ่ม (ใช้ icon)
✗ gradient หลายสี
✗ shadow ดำสนิท

### Copy
✗ ภาษาแปล Google ไทยแข็ง
✗ "Submit/Cancel/Delete" (ใช้ "บันทึก/ยกเลิก/ลบ")
✗ Technical error messages
✗ Capitalization ไม่สม่ำเสมอ

---

## 9. Reference checklist สำหรับทุก PR ใหม่

```
☐ ใช้ font-display สำหรับ h1/h2 ทุกตัว
☐ ใช้ tabular-num สำหรับเลขทุกที่
☐ Section ใหม่ใช้ <Section number="..." label="..." title="..."> wrapper
☐ ปุ่มหลัก: bg-brand-600, h-12 ขั้นต่ำ, มี ArrowUpRight ที่ขวา
☐ Card ขั้นต่ำ rounded-2xl, border-2, hover transition
☐ Empty state: icon + ชื่อ + คำอธิบาย + CTA
☐ Loading state: spinner หรือ skeleton (ห้ามขาว)
☐ Mobile-tested: padding ≥ p-4, touch targets ≥ 44px
☐ ภาษา: ไทยปกติ ไม่ใช่ภาษาราชการ
☐ สี: รวมทั้งหน้าใช้ ≤ 4 สีเท่านั้น
```

---

## 10. ตัวอย่างที่ดี (อ้างอิงในโปรเจกต์)

```
✓ /home          — hero auditme + module launcher + numbered sections
✓ /admin/users/[id] — detail pattern
✓ /admin/branches → grouped filter
✓ /cashhub/dashboard → stats + leaderboard + heatmap
```

ถ้าหน้าไหนไม่ตรงคู่มือ → mark TODO ในไฟล์ + แก้ทีหลัง

---

*Updated 2026-05-05 — เปลี่ยนเมื่อ Brand DNA เปลี่ยน*
*Memory link: feedback_design_brand_dna.md*
