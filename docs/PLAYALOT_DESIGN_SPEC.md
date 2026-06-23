# Play a lot — Design Spec (Playland redesign)

> Build guide for re-skinning the existing **Playland** amusement-park module to the **Play a lot** ("Playalot") brand.
> Source: Claude Design project `28ce92db-2144-4d79-8082-11e714b949ab`, file `Play a lot Redesign.dc.html` (front-of-house cashier screens, "3 จังหวะ" flow).
> Brand assets downloaded to `public/playland/brand/` (3 mascots, moodboard, 4 screenshots).
> Target device: **1280px landscape tablet** (counter staff). Thai-first UI.

---

## 1. Brand tokens

### Colors (exact hex — confirmed from moodboard + redesign CSS)

| Token | Hex | Role |
|---|---|---|
| **Playalot Blue** | `#2D6CB1` | Primary brand / wordmark "Play"+"lot", headings, primary actions, blue accent tiles |
| **Mustard** | `#F0B323` | Dominant warm accent, wordmark "a", "+ ขนม" buttons, Sunny mascot, KPI numbers |
| **Playalot Red** | `#E74C3C` | Alert / checkout / "คิดเงิน", "เช็คเอาท์" button, near-expiry, Rocky mascot |
| **Warm Cream** | `#F7F2EA` | Card/panel surface (lighter) |
| **App background** | `#e7e5df` | Page background (warm grey-beige) |
| **Panel cream (alt)** | `#F4EDE0` / `#ECE5D8` | Inner surfaces, secondary buttons, empty tiles |
| **Border (warm)** | `#E0D6C4` | Default card/input border; also `#D9CDB8`, `#C9BDA9` for stronger edges |
| **Text (ink)** | `#3A3026` | Primary text |
| **Text muted** | `#8A7F70` | Secondary/caption text; `#6B6052` / `#A9978A` darker/lighter mutes |
| **Success green** | `#1F8A5B` (deep) / `#5BC88A` (bright) | "Day Pass / ทั้งวัน", paid/OK states, money totals |
| Tint — blue | `#EAF3F6` / `#CFE0EE` | Blue chip/tile backgrounds |
| Tint — red | `#FDECEB` / `#F4D9D6` | Red chip/near-expiry backgrounds |
| Tint — amber | `#FDF3DF` / `#F9F4EA` | Amber chip/tile backgrounds |
| Tint — green | `#EAF3EB` / `#EEF0EC` | Green chip backgrounds |

**Color ratio (locked):** `50% Mustard · 30% Cream · 10% Blue · 10% Red`.
→ The interface should read warm/mustard-dominant, with blue and red used sparingly as functional accents (blue = brand/navigation, red = checkout/alerts).

### Typography

| Font | Use | Weights loaded |
|---|---|---|
| **Fredoka** | EN headline + ALL large display numbers (countdown timers, KPIs, wordmark) | 500, 600, 700 |
| **Nunito** | EN body | 400, 600, 700, 800 |
| **Mitr** | Thai headline (SemiBold 600) + Thai body (Regular 400) — **also the default `font-family` for the whole app** | 300, 400, 500, 600 |

Google Fonts import:
`Fredoka:wght@500;600;700 & Mitr:wght@300;400;500;600 & Nunito:wght@400;600;700;800`

- Big numbers (timers, totals) → `font-family:'Fredoka'`, `line-height:1`, sizes **30–44px** (`8:26`, `47:06`, `34%`, `฿4,280`).
- Wordmark: Fredoka 700, 30px — "Play" `#2D6CB1`, "a" `#F0B323`, "lot" `#2D6CB1`.

### Radius scale
`8 · 10 · 12 · 14 · 16 · 18 · 20px` (cards mostly **16–18px**, inputs/buttons **10–14px**, inner chips **8–10px**) · pills = `999px` (status chips, segmented toggles).

### Shadow scale
- Card / elevated surface: `0 4px 24px rgba(0,0,0,.1)` (the workhorse — 14 uses)
- Floating control (zoom widget): `0 6px 22px rgba(0,0,0,.16)`
- Subtle: `0 2px 14px rgba(0,0,0,.06)`
- Modal: `0 20px 60px rgba(0,0,0,.3)`
- Focus ring (active card): `0 0 0 3px rgba(231,76,60,.35)` (red glow)

### Spacing
Page padding `56px`. Gaps in **4 / 8 / 12 / 16 / 24px** rhythm. Cards pad ~`18–24px`. Generous whitespace — tiles are big and tap-friendly (counter staff, fast service).

---

## 2. The "3 จังหวะ" concept (front-of-house cashier flow)

The headline thesis: **"ไม่ใช่ 3 ตัวเลือกแข่งกัน แต่คือ 3 จังหวะของงานเดียวที่ต่อเนื่องกัน"** — one job, three rhythms, sequential. The staff member never "navigates a menu"; they ride the natural arc of a customer visit:

**จังหวะ 1 · หน้าหลัก (Home / "เปิดมาเจอก่อน")** — Blue.
The landing the cashier sees on open. A welcome banner (`สวัสดีตอนบ่าย พี่นก 👋`) with today's at-a-glance ("กำลังเล่นอยู่ N คน · ยอดวันนี้ ฿4,280"). Below it **4 big action tiles**: ① รับเด็กเข้าเล่น / Check-in (blue), ② เช็คเอาท์ · คิดเงิน (red), ③ ขายขนม · เครื่องดื่ม / POS (mustard), ④ ดูเด็กที่กำลังเล่น → goes to จังหวะ 2 (blue/grey). A bottom "near-time strip" warns of sessions about to expire. Mascots (Skye blue, Rocky red, Sunny yellow) inhabit the tiles.

**จังหวะ 2 · ระหว่างเล่น (During-play board / "ดูเด็กที่กำลังเล่น")** — Mustard.
Reached by tapping the "ดูเด็กที่กำลังเล่น" tile. A top stats+filter bar (กำลังเล่น 5 · ใกล้หมด 2 · ฿4,280 · filter chips กำลังเล่น/ใกล้หมด · ค้นหา) over a **grid of live session cards**. Each card = one child currently playing: mascot avatar + name + package, a giant Fredoka **countdown** (`8:26 เหลือ`), and two/three actions: `+ เวลา` (extend), `+ ขนม` (add POS to tab), and — when near expiry — a red **เช็คเอาท์** button that drops the staff into จังหวะ 3 for that child. A dashed "+" add-tile starts a new check-in. Near-expiry cards get a red border/`ใกล้หมด` pill; Day Pass cards show `ทั้งวัน` in green.

**จังหวะ 3 · เช็คเอาท์ (Checkout / "คิดเงิน")** — Red.
Triggered by the เช็คเอาท์ button on a session card. A two-pane settle screen: left rail = list of children ready to check out; right panel = **the bill** ("คิดเงิน · บิลชัดเป็นบรรทัด ยอดรวมตัวใหญ่"). Bill lines are one-per-row (time + any ขนม added), a large total, payment method (เงินสด/โอน/บัตร), and a confirm. Also supports `ต่อเวลา` from here. Ends on a success state: **"เช็คเอาท์เรียบร้อย · ขอบคุณค่ะ 💛"**.

**How the user moves between them:** Home tile → board grid → per-card checkout → success → back to Home. Continuous, never a dead-end menu. The redesign canvas (`overview.png`) literally lays the three panels left→right with `→` arrows between them to teach the flow.

---

## 3. Component inventory

**Top bar** — white, sits on a thin warm band; left = "Play a lot" wordmark + segmented nav pills (หน้าหลัก / เช็คอิน / POS / รายงาน); right = branch chip + a primary mustard/blue action. Radius 14–16, subtle shadow.

**Welcome banner (Home)** — large cream/white card, Mitr greeting in ink, mascot illustration, inline KPIs as bold Fredoka numbers.

**Big action tile (Home, ×4)** — ~square, radius 16–18, colored surface or tint (blue `#EAF3F6`, red `#FDECEB`, amber `#FDF3DF`), icon/mascot, Thai title (Mitr 600) + caption (muted), full-card tap target. Mascot art bleeds to the tile's bottom-right.

**Session card (Board, จังหวะ 2)** — white, radius 16–18, `0 4px 24px rgba(0,0,0,.1)`. Header row: circular mascot avatar (~44px) + name (Mitr 600) + package/minutes (muted) + status pill top-right. Center: Fredoka countdown 40–44px (color by urgency — ink/mustard normal, **red** near-expiry, green for Day Pass `ทั้งวัน`) with "เหลือ" caption. Footer: 2–3 buttons. Near-expiry variant = red 1–2px border + red `ใกล้หมด` pill + optional red focus glow.

**Status / filter pills** — `border-radius:999px`, tint bg + matching text: `ใกล้หมด` (red), `Day Pass`/`ทั้งวัน` (green), counts in filter bar. Segmented toggle uses the same pill shape with one active (filled) segment.

**Buttons**
- Primary (confirm/บันทึก/อ่านชัด): solid **blue `#2D6CB1`**, white text, radius 12–14, Mitr 600.
- Checkout/destructive-ish (`เช็คเอาท์`, `คิดเงิน`): solid **red `#E74C3C`**, white text.
- Add-time (`+ เวลา`): light **blue tint** `#EAF3F6` / blue text.
- Add-snack (`+ ขนม`): light **amber tint** `#FDF3DF` / mustard text.
- Secondary/ghost: cream `#F4EDE0` surface, ink text, warm border.

**Countdown chip / big number** — Fredoka, line-height 1, color-coded by state (see session card).

**KPI tile / inline stat** — label muted (Mitr/Nunito), value bold Fredoka; money in green `#1F8A5B`.

**Bill line (Checkout)** — single row: left label (Mitr), right amount (Fredoka/Nunito), divided by warm hairline `#E0D6C4`. Total row = oversized Fredoka, ink or green.

**Empty / add state** — dashed warm border (`#E0D6C4`/`#D9CDB8`), centered "+" in mustard, muted hint text, radius 16–18. Used for "เพิ่มเด็กเข้าเล่น" add-tile and empty board slots.

**Check-in / registration form** — cream card, back link ("‹ ย้อนกลับ"), section title (Mitr 600), labeled inputs (white, warm border, radius 10–12, muted label above), a green PDPA consent checkbox, full-width blue primary "บันทึก · เลือกแพ็กเกจ".

**Zoom widget (canvas only)** — fixed bottom-right floating control (`− 34% +`, ดูทั้งหมด, อ่านชัด); a presentation affordance of the design canvas, **not** a product component.

**Mascot avatar** — circular cropped mascot, used as the child's identity on session cards and tiles.

**Success state** — centered confirmation with 💛 ("เช็คเอาท์เรียบร้อย · ขอบคุณค่ะ").

Other screens present in the HTML (beyond the 3 panels): **POS** (product grid + cart + charge-target), **New Registration + PDPA**, **Shift / Cash Drawer** (summary + cash count), **Receipt / Slip**, **Live Monitor (TV)**, **Extend-time modal**. Same token system applies.

---

## 4. Layout / grid

- **Canvas:** 1280px landscape tablet, page bg `#e7e5df`, page padding 56px.
- **Home (จังหวะ 1):** vertical stack — top bar → welcome banner (full width) → 2×2 grid of big action tiles → bottom near-time strip.
- **Board (จังหวะ 2):** top stats+filter bar (full width) → responsive **card grid** (≈3 cards/row at 1280) of session cards, last cell = dashed add-tile.
- **Checkout (จังหวะ 3):** **two-pane** — left rail (~⅓, list of children to settle) + right panel (~⅔, the bill + payment). 
- **Check-in / registration:** single centered card (~720–760px wide), two-column field rows inside.
- The overview/teaching canvas places จังหวะ 1 → 2 → 3 side-by-side with `→` arrows; in production each จังหวะ is its own route/screen.

---

## 5. Mascot usage

Three dino mascots (files in `public/playland/brand/`), each a personality the brand leans on:

| Mascot | File | Species | Color | Personality / role |
|---|---|---|---|---|
| **Sunny** | `mascot-sunny.png` | Stegosaurus | Mustard/yellow | ร่าเริง · พลังงานสูง · **เป็นตัวแทนแบรนด์** (hero mascot). Welcome banner, POS/snack tile, default child avatar. |
| **Skye** | `mascot-skye.png` | Brachiosaurus | Blue | ใจดี · สุภาพ · ชอบเรียนรู้. Check-in tile, calm/info contexts, child avatars. |
| **Rocky** | `mascot-rocky.png` | Triceratops | Red | กล้าหาญ · ปกป้องเพื่อน. Checkout/คิดเงิน tile, alert/near-expiry contexts, child avatars. |

Where they appear: **Home tiles** (one mascot per tile, color-matched to the tile's role), **session-card avatars** (rotating identity for each playing child), **empty/success states**, and **brand surfaces** (banner, monitor). Mascots are PNG with transparency (~205px tall); place bottom-aligned, bleeding off card edges for a playful feel. Keep them functional accents — not every surface needs one.

---

## 6. Mapping note — redesign coverage vs existing Playland pages

Existing module routes under `app/(admin)/playland/`:

| Existing page | Route | Redesign covers it? | Maps to |
|---|---|---|---|
| Cockpit / home | `/playland` | ✅ Yes | **จังหวะ 1 · หน้าหลัก** (welcome + 4 tiles + near-time strip) |
| Monitor | `/playland/monitor` | ✅ Yes | **จังหวะ 2 board** + the HTML's "Live Monitor (TV)" screen |
| POS | `/playland/pos` | ✅ Yes | HTML "POS" screen (product grid + cart + charge-target) |
| Scan | `/playland/scan` | ◻︎ Partial | Check-in flow implies scan/return-customer search; no dedicated scan screen drawn |
| Shifts | `/playland/shifts` | ✅ Yes | HTML "Shift / Cash Drawer" (summary + cash count) |
| (check-in / register) | counter flow | ✅ Yes | HTML "Check-in" + "New Registration + PDPA" + `01-flow.png` register form |
| (receipt) | print/slip | ✅ Yes | HTML "Receipt / Slip" |
| Bookings | `/playland/bookings` | ❌ No | Not drawn (front-of-house focus, not online bookings admin) |
| Wristbands | `/playland/wristbands` | ❌ No | Not drawn |
| Audit | `/playland/audit` | ❌ No | Not drawn |
| Members | `/playland/members` | ❌ No | Not drawn |
| Reports | `/playland/reports` | ◻︎ Nav only | A "รายงาน" nav pill exists in the top bar; no report screen drawn |
| Overrides | `/playland/overrides` | ❌ No | Not drawn |
| Settings/* (branches, devices, packages, products, promos, stock-count) | `/playland/settings/*` | ❌ No | Not drawn |

**Summary:** the redesign is a **front-of-house cashier re-skin** — it covers the live service loop (home → board → checkout, plus check-in, registration, POS, shift/cash-drawer, receipt, TV monitor). It does **not** cover back-office/admin pages (bookings, wristbands, audit, members, reports detail, overrides, all of settings). Those should adopt the **token system** (Section 1) for consistency but have no drawn reference — keep their existing IA and just re-skin.
