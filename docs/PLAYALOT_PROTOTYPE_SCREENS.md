# Play a lot — Prototype Screen Spec (pixel-faithful rebuild blueprint)

> Source of truth: `Play a lot Prototype.dc.html` (interactive, clocks tick) + `Play a lot Redesign.dc.html` (static all-screens reference) from Claude Design project `28ce92db-2144-4d79-8082-11e714b949ab`.
> Rendered screenshots: `/tmp/proto-shots/proto-*.png` (2x DPR, native 1280×860 tablet frame).
> All hex/text/spacing values below are read VERBATIM from the prototype inline styles. Build to these exact numbers.

---

## 0. Global design tokens

| Token | Value | Use |
|---|---|---|
| Brand blue | `#2D6CB1` | logo "Play"/"lot", primary buttons, +เวลา, links, blue tiles |
| Brand yellow | `#F0B323` | logo "a", yellow tile, avatar pill, near-mid timers |
| Brand red | `#E74C3C` | red tile, checkout button, near-expiry, ใกล้หมด |
| Green | `#1F8A5B` | money/revenue, confirm buttons (รับเงิน), success, safe timers |
| Ink (text) | `#3A3026` | primary text |
| Muted text | `#8a7f70` / `#6b6052` | subtitles, labels |
| Faint muted | `#a9978a` / `#bcae9b` / `#9a9285` | placeholders, footnotes |
| App canvas | `#F7F2EA` | every screen body bg (inside frame) |
| Page bg (outside frame) | `#d9d4cc` | the desktop backdrop |
| Card white | `#fff` | cards, header bar |
| Border (warm) | `#ece5d8` | card borders, header bottom border |
| Divider | `#f2ebdd` | inner row dividers |
| Tile tint blue | `#eaf3f6` | +เวลา bg, blue chip bg |
| Tile tint yellow | `#fdf3df` / `#fdf3df` | +ขนม bg |
| +ขนม text | `#a9791a` | amber text on yellow chip |
| Tint green | `#eaf3eb` | "กะเปิดอยู่" pill, success banner |
| Tint red | `#fdeceb` | ใกล้หมด pill bg, "เหลือ" pill on checkout |
| Emoji tile bg | `#f4ede0` | product/snack emoji squares, avatar circle bg |
| Toggle off track | `#d9cdb8` | staff permission switch (off) |
| Dark (monitor/tile) | `#1c2740` | Monitor bg, dark home tile |
| Monitor card (normal) | `#28365a` | non-expiring kid tile on Monitor |
| Monitor muted text | `#9fb0d0` | Monitor labels |

**Fonts:** `Fredoka` (700/600) for logo, numbers, countdowns, money. `Mitr` (500/400/300) for Thai headings/body. (Redesign also pulls `Nunito`.) Countdown digits + ฿ amounts are ALWAYS Fredoka.

**Timer color logic** (`colorFor(sec)`): `sec<=600` → red `#E74C3C`; `sec<=1500` → yellow `#F0B323`; else green `#1F8A5B`. Day Pass = always green, shows "ทั้งวัน". Near-expiry = `!dayPass && sec<=600`.

**Tablet frame:** `1280×860`, `border-radius:22px`, `box-shadow:0 18px 50px rgba(0,0,0,.22)`. Header bar on every inner screen is `height:74px`, white, `border-bottom:1px solid #ece5d8`, `padding:0 28px`, `gap:16px`.

**Card radii:** big tiles `20px` · cards `16–18px` · pills/buttons `10–14px` · chips `999px`.

---

## 1. HOME / หน้าหลัก (launcher)  — `proto-home.png`

**Purpose:** mission-control launcher. NOT a dense cockpit — it is 4 big tappable tiles + a greeting + 3 small footer links.

**Layout:** column. Header(74px) + content `padding:30px 38px`. Body is a 2×2 CSS grid `grid-template-columns:1fr 1fr; gap:18px; flex:1`, with the greeting above and 3 footer buttons below.

**Header:** logo `Play a lot` (24px Fredoka, blue + yellow "a"); vertical divider; green pill `กะเปิดอยู่` (bg `#eaf3eb`, text `#1F8A5B`, 8px green dot); pushed right: `ปิดกะ` chip (bg `#f4ede0`, text `#6b6052`) + round 40px yellow avatar "น" (`#F0B323`, white text).

**Greeting:** `สวัสดีตอนบ่าย พี่นก 👋` (26px Mitr-500). Sub: `มีเด็กเล่นอยู่ **5** คน · รายได้ **฿4,280**` (count in blue, revenue in green).

**4 tiles** (each `border-radius:20px; padding:26px 30px; color:#fff; flex column; justify-between; position:relative; overflow:hidden`; icon chip 56px `border-radius:15px` translucent white; mascot PNG absolutely bottom-right ~108–138px, opacity .9):

| Tile | bg | Title (26px Mitr-500) | Subtitle (15px, opacity .85) | Icon | Mascot | Badge |
|---|---|---|---|---|---|---|
| 1 รับเด็กเข้าเล่น | `#2D6CB1` (blue) | รับเด็กเข้าเล่น | ลงทะเบียน · เลือกแพ็กเกจ | user (circle+shoulders) | **skye** (blue dino) br | — |
| 2 เด็กที่กำลังเล่น | `#E74C3C` (red) | เด็กที่กำลังเล่น | ต่อเวลา · เพิ่มขนม · เช็คเอาท์ | clock | **rocky** (red dino) br | top-right translucent pill `2 ใกล้หมดเวลา` (only if hasNear) |
| 3 ขายขนม · เครื่องดื่ม | `#F0B323` (yellow) | ขายขนม · เครื่องดื่ม | POS · คิดเงิน | shopping-bag | **sunny** (yellow dino) br | — |
| 4 จอ Monitor (TV) | `#1c2740` (dark) | จอ Monitor (TV) | โชว์เวลาให้ทั้งร้านเห็น | monitor/tv | — (no mascot) | — |

**Footer:** flex row `gap:12px; margin-top:20px`. 3 equal white buttons (`border:1px solid #ece5d8; border-radius:14px; padding:14px; text-align:center; 15px`): `📊 Dashboard` · `⚙️ แพ็กเกจ & สต๊อก` · `👥 พนักงาน & สิทธิ์`.

---

## 2. BOARD / ระหว่างเล่น  — `proto-board.png`

**Purpose:** live grid of kids currently playing, with the running countdown front-and-center.

**Header:** back `‹ หน้าหลัก` · divider · title `เด็กที่กำลังเล่น` (20px). Right: stat chip `กำลังเล่น **5**` (white border, blue number) · stat chip `ใกล้หมด **2**` (red-tinted border `#f4d9d6`, red number) · yellow CTA `+ รับเด็กเข้า` (bg `#F0B323`, white).

**Body:** `padding:22px 28px`, grid `repeat(3,1fr); gap:18px`. Each kid = a card. After kids comes ONE dashed "add" tile.

**Kid card:** `background:#fff; border-radius:18px; padding:18px; border:2px solid {border}`. Border = `#E74C3C` if near-expiry else `#eef0ec`.
- Row: 48px round avatar (bg `#f4ede0`, mascot img 40px) + name (18px-500) + package sub (13px `#8a7f70`). If near-expiry: red pill `ใกล้หมด` (bg `#fdeceb`, text `#E74C3C`, 12px-600) far right.
- **Center countdown:** `font-family:Fredoka; font-weight:700; font-size:38px; color:{timerColor}`. Below it the label **`เหลือ`** (13px `#8a7f70`). Day Pass shows `ทั้งวัน` + sub `Day Pass`.
- **3 color-coded pill buttons** (flex, gap:8px, each `flex:1; padding:10px; border-radius:10px; text-align:center; 14px`):
  - `+ เวลา` → bg `#eaf3f6`, text `#2D6CB1` (teal/blue)
  - `+ ขนม` → bg `#fdf3df`, text `#a9791a` (yellow/amber)
  - `เช็คเอาท์` → bg `#E74C3C`, text `#fff` (red)

**Add tile:** `border:2px dashed #d9cdb8; border-radius:18px; min-height:200px`, centered yellow `+` icon + `รับเด็กเข้าเล่น` (text `#a9791a`).

**Seed data** (for fidelity): น้องปอนด์/rocky/60นาที/red, น้องเอ/sunny/60นาที/red, น้องบีม/skye/120นาที/green 47:16, น้องมายด์/sunny/30นาที/yellow 22:01, น้องเจได/skye/Day Pass/ทั้งวัน.

---

## 3. EXTEND popup (ต่อเวลา)  — `proto-board-extend.png`

Modal over board. Overlay `rgba(28,39,64,.45)`. Card `width:540px; bg:#fff; border-radius:22px; shadow 0 20px 60px`.
- Header row (`padding:24px 30px 16px; border-bottom:1px solid #f2ebdd`): 50px round avatar (bg `#fdeceb`) + `ต่อเวลาให้ {name}` (21px Mitr-500) + sub `ตอนนี้เหลือ {time}` (time in red). Close `✕` button: 36px round `#f4ede0`.
- Body (`padding:24px 30px`): hint `แตะเพื่อเพิ่มเวลา (คิดเงินตอนเช็คเอาท์)` (15px muted). Then grid `repeat(3,1fr); gap:12px` of 3 option cards (`border:1.5px solid #ece5d8; border-radius:14px; padding:18px 0; text-align:center`): big label `+15` (24px Fredoka blue) / `นาที` (13px muted) / price `฿30` (16px Fredoka green). Options: **+15 ฿30, +30 ฿55, +60 ฿100**. Hover → border blue + bg `#eaf3f6`.

---

## 4. CHECKOUT / เช็คเอาท์  — `proto-checkout.png`

**CRITICAL: single centered column, NOT a 2-pane.** Receipt-style.

**Header:** back `‹ กลับกระดาน` · divider · `เช็คเอาท์` (20px).

**Body:** `padding:28px 40px; max-width:760px; margin:0 auto; flex column`.
- **Kid row:** 54px round avatar (bg `#fdf3df`) + `{name} · เช็คเอาท์` (22px-500) + sub package + right red pill `เหลือ {time}` (bg `#fdeceb`, text `#E74C3C`, `border-radius:999px`).
- **Charge list card:** `bg:#fff; border-radius:16px; border:1px solid #ece5d8`. Each line: `padding:16px 20px; border-bottom:1px solid #f2ebdd`; label (17px) left, `฿amount` (18px Fredoka-600) right.
- **Total row:** `รวมทั้งหมด` (18px `#6b6052`) left, big `฿100` (**42px Fredoka-700** `#3A3026`) right.
- **Bottom (margin-top:auto):** label `ชำระด้วย` (14px muted). 3 method pills (flex gap:10px, each `flex:1; padding:13px; border-radius:12px; 16px; text-align:center`): `เงินสด` (SELECTED = bg `#2D6CB1` white) · `PromptPay` (white border) · `บัตร` (white border).
- **Confirm button:** full-width green `#1F8A5B`, `border-radius:14px; padding:18px; 22px Mitr-500; white`, content `รับเงิน ฿100 · เช็คเอาท์ ✓` (checkmark svg).

---

## 5. CHECK-IN / รับเด็กเข้าเล่น  (4 sub-steps)

Shared header: back `‹ ย้อนกลับ` · divider · `รับเด็กเข้าเล่น`. Body `padding:34px 44px`.

### 5a. choose — `proto-checkin-choose.png`
`max-width:840px; margin:0 auto`. Heading `เด็กคนนี้เคยมาเล่นไหม?` (28px Mitr-500). Sub `เลือกอย่างเดียวก่อน — ระบบพาไปต่อเอง` (16px muted). Grid `1fr 1fr; gap:22px` of 2 big cards (`bg:#fff; border-radius:20px; padding:30px; flex row; gap:22px; align-center`):
- **เคยมาแล้ว** — `border:2px solid #2D6CB1`; 64px icon chip (`border-radius:18px; bg:#eaf3f6`) search icon blue; title `เคยมาแล้ว` (24px-500) + sub `ค้นชื่อ / เบอร์เดิม`.
- **มาครั้งแรก** — `border:2px solid #ece5d8`; 64px chip bg `#fdf3df` yellow `+` icon; title `มาครั้งแรก` + sub `ลงทะเบียนใหม่`.

### 5b. search — `proto-checkin-search.png`
`max-width:760px`. Search input (`bg:#fff; border:1.5px solid #2D6CB1; border-radius:12px; padding:14px 16px`) with magnifier icon + value `086-204-1188`. Label `ผลการค้นหา`. Two result rows (`border:1px solid #ece5d8; border-radius:14px; padding:14px 16px; flex`): 48px round mascot avatar + name (18px-500) + sub `น้องเอ · มาแล้ว 7 ครั้ง`. First row has green pill `สมาชิก` (bg `#eaf3eb` text green). Families: **ครอบครัวคุณแม่ปุ๊ก** (sunny), **ครอบครัวคุณพ่อโต้ง** (skye).

### 5c. register — `proto-checkin-register.png`
`max-width:820px`. Heading `ลงทะเบียนเด็กใหม่` (22px). Field grids (label 14px muted + faux input `bg:#fff; border:1px solid #ece5d8; border-radius:12px; padding:14px 16px; 17px`): row1 `2fr 1fr` = `ชื่อเล่นเด็ก`(น้องมีน) + `อายุ`(5 ขวบ); row2 `1fr 1fr` = `ผู้ปกครอง`(คุณแม่ฝน) + `เบอร์โทร`(081-455-7xxx). PDPA consent card (`bg:#f9f4ea; border-radius:14px; padding:18px`): green 26px check square + text `ยินยอมให้เก็บข้อมูลเด็กและผู้ปกครองตาม PDPA เพื่อความปลอดภัย`. Blue CTA `บันทึก · เลือกแพ็กเกจ` (bg `#2D6CB1`, full-width, `padding:16px; 19px`).

### 5d. package — `proto-checkin-package.png`
`max-width:840px`. Heading `เลือกแพ็กเกจให้ {name}` (24px). Sub `แตะเลือกเวลาเล่น`. Grid `repeat(2,1fr); gap:16px` of 4 cards (`bg:#fff; border:1.5px solid #ece5d8; border-radius:18px; padding:24px 28px; flex; justify-between`): left = label (22px Mitr-500) + sub (14px muted); right = price (**26px Fredoka-700 green**). Packages: `30 นาที / เล่นสั้น / ฿70` · `60 นาที / มาตรฐาน · ขายดี / ฿100` · `120 นาที / เล่นนาน / ฿180` · `Day Pass / เล่นทั้งวัน / ฿350`. Hover → border blue + bg `#eaf3f6`.

---

## 6. POS / ขายขนม  — `proto-pos.png`

**2-pane** (this one IS split — unlike checkout). Header back `‹ หน้าหลัก` · `ขายขนม · เครื่องดื่ม`.

**Left (flex:1, padding:24px 26px):** product grid `repeat(4,1fr); gap:14px`. Each product card (`bg:#fff; border:1px solid #ece5d8; border-radius:16px; padding:14px`): 80px emoji square (bg `#f4ede0; border-radius:12px; font-size:38px`) + name (16px-500) + price (16px Fredoka-600 **green**). Hover → border blue.
Products: 🍪 โอริโอ้ ฿35 · 🍿 ป๊อปคอร์น ฿45 · 🍩 โดนัท ฿30 · 🍬 เยลลี่ ฿25 · 🧁 คัพเค้ก ฿40 · 🍦 ไอศกรีม ฿35 · 🥤 น้ำส้ม ฿30 · 🍫 ช็อกโกแลต ฿30.

**Right (width:400px, white, border-left):** label `ลงบิลให้`; selector pill `ลูกค้าจ่ายสด` (bg `#eaf3f6; border:1.5px solid #2D6CB1`) — when charging a kid it reads `{name} · เก็บตอนเช็คเอาท์`. Divider. Cart lines (42px emoji + name + `฿35 × 1` + stepper: `−` button 26px `#f4ede0`, qty Fredoka, `+` button 26px **blue** `#2D6CB1` white). Empty → centered `แตะขนมทางซ้ายเพื่อเพิ่ม`. Footer: `รวม` + total (32px Fredoka-700) then green CTA `รับเงิน ฿{n}` (or `ลงบิล {name}` when charging a kid), bg `#1F8A5B`.

---

## 7. RECEIPT / ใบเสร็จ  — `proto-receipt.png`

Centered success screen on `#F7F2EA`, with **sunny mascot bottom-left (140px) + skye mascot top-right (130px)**, both opacity ~.85.
- 86px green circle (`#1F8A5B`) with white check.
- `รับเงินสำเร็จ` (30px Mitr-500). Sub `{name} · ขอบคุณค่ะ 💛`.
- Receipt card `width:500px; bg:#fff; border-radius:18px`. Top: dashed-bottom header with `Play a lot` logo (22px) + `ใบเสร็จ #{no}`. Lines: label/amount rows; total row `รวม (เงินสด)` (18px) + amount (24px Fredoka-700 green), dashed top border.
- 3 actions: `ปรินต์สลิป` (white) · `ส่ง LINE` (white) · `เสร็จ` (blue `#2D6CB1`, flex:1.2, → home).

---

## 8. MONITOR (TV)  — `proto-monitor.png`

**Dark full-bleed.** bg `#1c2740`. Header (80px, `border-bottom:1px solid rgba(255,255,255,.08)`): `‹ ออก` (muted `#9fb0d0`) + `Play a lot` logo (26px white, yellow "a") + `กำลังเล่น **5** คน`.
Body grid `repeat(4,1fr); grid-auto-rows:1fr; gap:16px; padding:26px 36px`. Each kid tile (`border-radius:18px; padding:20px; flex column; justify-between`): bg = **`#E74C3C` (full red) if near-expiry, else `#28365a`**. Top = name (19px Mitr-500 white). Bottom = big countdown (40px Fredoka-700, colored by timer logic but on monitor green=`#5bc88a`) + package sub (14px `#9fb0d0`). Day Pass → `ทั้งวัน`.

---

## 9. SHIFT / ปิดกะ  — `proto-shift.png`

2-pane. Header `‹ หน้าหลัก` · `ปิดกะ — พี่นก`.
**Left:** `สรุปยอดขายกะนี้`. 2 KPI cards (`ยอดขายรวม` green `฿4,280` · `จำนวนบิล` blue `73`). Breakdown card: `เงินสด ฿9,210` / `PromptPay ฿7,180` / `บัตร ฿2,250`.
**Right (width:440px white):** `นับเงินในลิ้นชัก`. Rows `เงินต้นกะ ฿2,000` / `+ ขายเงินสด ฿9,210` / `ควรมีในลิ้นชัก ฿11,210` (blue). Label `นับจริงได้` → input box (`bg:#f4ede0; border:1.5px solid #2D6CB1`) `฿ 11,210`. Green banner `✓ ตรงพอดี ไม่ขาดไม่เกิน`. Red CTA `ยืนยันปิดกะ` (bg `#E74C3C`).

---

## 10. DASHBOARD ร้าน  — `proto-dashboard.png`

Header `‹ หน้าหลัก` · `Dashboard ร้าน`. Body `padding:26px 32px; gap:18px`.
4 KPI cards (`repeat(4,1fr)`): `รายได้วันนี้ ฿4,280` green · `สัปดาห์นี้ ฿112,300` blue · `เด็กเฉลี่ย/วัน 64` yellow · `บิลเฉลี่ย ฿255` ink.
Lower row (flex): left `flex:1.6` card `รายได้ 7 วันล่าสุด` = bar chart (7 bars, faded bars `#cfe0ee`, recent 3 solid blue `#2D6CB1`, heights 52/44/60/50/78/100/92%). Right `flex:1` card `ขนมขายดี` = 3 progress rows (🍿 ป๊อปคอร์น 142 / 90%, 🍦 ไอศกรีม 118 / 74%, 🍪 โอริโอ้ 96 / 60%) with yellow `#F0B323` fill on `#f2ebdd` track.

---

## 11. SETTINGS / แพ็กเกจ & สต๊อก  — `proto-settings.png`

2-pane. Header `‹ หน้าหลัก` · `แพ็กเกจ & สต๊อก`.
**Left (border-right):** `แพ็กเกจเวลา` — 4 rows (`bg:#fff; border:1px solid #ece5d8; border-radius:14px; padding:16px 20px`): label + price (Fredoka-600) + blue `แก้ไข` link. `30 นาที ฿70 · 60 นาที ฿100 · 120 นาที ฿180 · Day Pass ฿350`.
**Right (width:460px white):** `สต๊อกขนม` — rows w/ 38px emoji tile + name + count (Fredoka-600). Low-stock items get red `ใกล้หมด` pill + red count: 🍿 ป๊อปคอร์น 48 · 🍦 ไอศกรีม **6 ใกล้หมด** · 🍪 โอริโอ้ 120 · 🍬 เยลลี่ **9 ใกล้หมด**.

---

## 12. STAFF / พนักงาน & สิทธิ์  — `proto-staff.png`

Header `‹ หน้าหลัก` · `พนักงาน & สิทธิ์` + right blue `+ เพิ่มพนักงาน`.
Body: column header row (muted 14px): `พนักงาน(2) | ตำแหน่ง(1.4) | เปิด/ปิดกะ | คืนเงิน | ดูรายงาน` (last 3 centered). Then staff rows (`bg:#fff; border:1px solid #ece5d8; border-radius:14px; padding:16px 20px; flex`): colored 40px round initial avatar + name; role chip; then 3 iOS-style toggles per row (`width:42px; height:25px; border-radius:99px`; ON = green `#1F8A5B` knob right, OFF = `#d9cdb8` knob left).
Rows: **คุณต่าย** (yellow ต) role `เจ้าของ` (green chip) — all 3 ON · **พี่นก** (blue น) `หัวหน้ากะ` (blue chip) — เปิด/ปิดกะ ON, คืนเงิน ON, ดูรายงาน OFF · **น้องฝ้าย** (red ฝ) `แคชเชียร์` (warm chip) — all 3 OFF.

---

## 13. Toast
Bottom-center pill `bg:#1c2740; color:#fff; padding:14px 26px; border-radius:999px; shadow`. Messages: `ต่อเวลา +N นาที แล้ว`, `{name} เช็คอินแล้ว!`, `ลงบิลให้ {name} แล้ว · เก็บตอนเช็คเอาท์`, `ปิดกะเรียบร้อย`, `ยังไม่มีรายการ`.

---

## Navigation map
home → (รับเด็กเข้าเล่น) check-in[choose→search/register→package] → board · (เด็กที่กำลังเล่น) board · (ขายขนม) pos → receipt · (จอ Monitor) monitor · (ปิดกะ) shift → home · footer → dashboard/settings/staff.
Board card: +เวลา → extend modal (stays on board) · +ขนม → pos in "charge-to-kid" mode → board · เช็คเอาท์ → checkout → receipt → home.
