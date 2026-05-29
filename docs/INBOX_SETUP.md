# กล่องข้อความรวม (Inbox) — คู่มือเปิดใช้งาน

โมดูลรวมแชทลูกค้าจากทุก LINE OA + Facebook Page มาไว้ที่เดียว + บอท AI ตอบอัตโนมัติ
(เปิดบอทเฉพาะธุรกิจ "เก้าอี้นวด/chairops" ก่อน)

> สถานะ: โค้ดเสร็จ + build ผ่าน (tsc + next build 0 error) · **ยังไม่เปิดใช้งานจริง**
> จนกว่าจะทำ 3 ขั้นด้านล่าง

---

## ขั้นที่ 1 — รันฐานข้อมูล (migration) ⚠️ ต้องทำก่อนเสมอ

ไฟล์: `supabase/migrations/20260528100000_inbox_omnichannel.sql`

- เปิด Supabase → SQL Editor → วางทั้งไฟล์ → Run
- หรือ `psql "$DATABASE_URL" -f supabase/migrations/20260528100000_inbox_omnichannel.sql`
- ปลอดภัย: เป็นการ **สร้างตารางใหม่ล้วน** (CREATE ... IF NOT EXISTS) ไม่แตะตารางเดิม
- **ห้าม** ใช้ `prisma db push` (มี schema drift เดิมอยู่ — อาจเตือนลบตาราง)

ถ้ายังไม่รัน migration แล้วเปิดหน้า `/inbox` จะขึ้นข้อความ "ยังไม่พร้อมใช้งาน" (ไม่พัง)

---

## ขั้นที่ 1.5 — โหลดสมองบอทเริ่มต้น (เก้าอี้นวด) ⭐ แนะนำ

รัน seed นี้เพื่อให้บอทรู้ SOP จริงตั้งแต่วันแรก (เบอร์ติดต่อ 084-198-1623 · ราคา · เลขเครื่อง · วิธีปรับความแรง · ขั้นตอนเครื่องไม่ทำงาน):

```
npx tsx -r dotenv/config scripts/seed-inbox-chairops-bot.ts dotenv_config_path=.env.local
```

- รันซ้ำได้ (idempotent) · ไม่ลบคำตอบที่ CEO เพิ่มเองในเว็บ
- แก้/เพิ่มทุกอย่างได้ที่ `/inbox/bot` ทีหลัง (ไม่ต้องเขียนโค้ด)

---

## ขั้นที่ 2 — ตั้ง Environment Variable

| ตัวแปร | ใช้ทำอะไร | มีอยู่แล้วไหม |
|---|---|---|
| `RECRUIT_CHANNEL_KEY` | กุญแจเข้ารหัส token ของช่องทาง (ใช้ร่วมกับโมดูล Recruit) | ถ้าตั้ง Recruit omnichannel ไว้แล้ว = มีแล้ว |
| `ANTHROPIC_API_KEY` | บอท AI ตอบคำถาม (รุ่น Haiku) | มีอยู่แล้ว |
| `CRON_SECRET` | ป้องกัน cron สรุปรายวัน | มีอยู่แล้ว |
| `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_GROUP_CEO` | ส่งสรุปรายวันเข้า LINE กลุ่ม CEO (ของ chairops) | optional |

ถ้ายังไม่มี `RECRUIT_CHANNEL_KEY`: `openssl rand -base64 32` แล้วตั้งใน Vercel

---

## ขั้นที่ 3 — เชื่อมช่องทาง (ทำในเว็บ ที่ `/inbox/settings/channels`)

### LINE OA (ต่อ 1 ครั้ง/หนึ่ง OA — รองรับหลาย OA)
1. LINE Developers Console → สร้าง Messaging API channel ของ OA นั้น
2. ในเว็บ `/inbox/settings/channels` → เพิ่มช่องทาง → เลือก LINE → ตั้งชื่อ + เลือก "ธุรกิจ" (เก้าอี้นวด) → วาง **Channel Secret** + **Channel Access Token**
3. คัดลอก **Webhook URL** ที่ระบบสร้างให้ (`/api/webhooks/inbox/line/<id>`) ไปวางใน LINE Console → เปิด "Use webhook" + **ปิด "Auto-reply"**
4. ถ้าเป็นเก้าอี้นวด → เปิดสวิตช์ "บอท" ที่การ์ดช่องทางนั้น

### Facebook Page
1. developers.facebook.com → สร้าง App (Business) → เพิ่ม Messenger → subscribe `messages`
2. ในเว็บ → เพิ่มช่องทาง → Facebook → วาง **Page Access Token** + **App Secret**
3. คัดลอก Webhook URL + **Verify Token** ที่ระบบสร้างให้ ไปวางใน FB App webhook config

---

## ทดสอบ
- ส่งข้อความหา OA/เพจ → ต้องเด้งเข้า `/inbox` ภายในไม่กี่วินาที
- พิมพ์ "หยอดเงินแล้วเครื่องไม่ทำงาน" → บอทควรตอบให้โทรเบอร์ + แท็กด่วน (ถ้าเปิดบอท)
- ตั้งคลังคำตอบ + ข้อมูลร้าน ที่ `/inbox/bot`

## หมายเหตุข้อจำกัด (ตามจริง)
- ดึงแชทเก่าย้อนหลังไม่ได้ (LINE/FB ไม่เปิดให้) — เริ่มเก็บตั้งแต่วันที่ต่อ webhook
- "LINE ธรรมดา" (ไม่ใช่ OA) ต่อระบบไม่ได้ — ต้องเป็น LINE OA / FB Page เท่านั้น
- บอทคุมค่าใช้จ่าย: ตอบจาก FAQ ก่อน (ฟรี) → AI เฉพาะที่ไม่เจอ (Haiku) → เพดาน ~$50/เดือน/องค์กร
