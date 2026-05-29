# คู่มือเปิดใช้งานระบบ LINE — ChairOps (เก้าอี้นวด)

> Last updated: 2026-05-28
> สถานะ: **โค้ดเสร็จ + ขึ้น production แล้ว** — เหลือแค่ "เปิดสวิตช์" ฝั่ง LINE
> Audience: CEO (ไม่ต้องเขียนโค้ด — ทำตามทีละข้อได้เลย)

---

## สรุป 1 บรรทัด

ระบบ LINE เขียนเสร็จและอยู่บนเว็บจริงแล้ว (`pooilgroup.vercel.app`) เหลือแค่
**ไปเปิดบัญชี LINE ทางการ (OA) → เอารหัสมาใส่ 3 ตัว → เชื่อมกลุ่มสาขา 5 กลุ่ม → ทำเมนูปุ่ม** เท่านั้น

---

## เปลี่ยนจากอะไร → เป็นอะไร (ทำไมต้องทำ)

| เดิม (ตอนนี้) | ใหม่ (หลังตั้งเสร็จ) |
|---|---|
| 30 สาขา = ~30 กลุ่ม LINE | 1 บัญชี LINE ทางการ (OA) เดียว |
| ทุกเรื่องปนกัน (เก็บเงิน/แจ้งซ่อม/เบิกของ/เช็คคลีน) | แม่บ้านกดเมนู 4 ปุ่ม → กรอกฟอร์ม → เข้าระบบ |
| หลังบ้านอ่าน 30 กลุ่มไม่ไหว ไม่รู้ใครทำครบ | หลังบ้านเห็น dashboard รวม + เตือนตอนเย็นว่าสาขาไหนยังไม่ครบ |

**สำคัญ:** กลุ่ม LINE เดิมไม่ต้องปิด — เปิดคู่กันได้ 3 เดือน ค่อยๆ ย้าย ไม่บังคับตัดทันที

---

## เช็กลิสต์รหัสที่ต้องเก็บมา (8 ค่า)

กรอกค่าลงช่องขวาแล้ว **ส่งให้ผม** (ผมจะใส่ให้ — แต่ token เป็นความลับ จะเตือนเรื่องความปลอดภัยก่อน)
หรือ CEO ใส่เองใน Vercel ก็ได้ (วิธีในขั้น B)

| # | ชื่อรหัส (env) | เอามาจากไหน | ได้มาขั้นไหน |
|---|---|---|---|
| 1 | `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API channel → Issue token | ขั้น A3 |
| 2 | `LINE_CHANNEL_SECRET` | Messaging API channel → Basic settings | ขั้น A3 |
| 3 | `NEXT_PUBLIC_LIFF_ID` | LIFF tab → LIFF app ที่สร้าง | ขั้น A4 |
| 4 | `LINE_GROUP_FINANCE` | groupId กลุ่ม "การเงิน/เก็บเงิน" | ขั้น C |
| 5 | `LINE_GROUP_REPAIR` | groupId กลุ่ม "แจ้งซ่อม" | ขั้น C |
| 6 | `LINE_GROUP_OPS` | groupId กลุ่ม "ปฏิบัติการ/เช็คคลีน" | ขั้น C |
| 7 | `LINE_GROUP_BRANCH` | groupId กลุ่มรวมสาขา | ขั้น C |
| 8 | `LINE_GROUP_CEO` | groupId กลุ่มผู้บริหาร | ขั้น C |

> ค่า 1–3 จำเป็นก่อนระบบจะเริ่มทำงาน · ค่า 4–8 ใส่ทีหลังได้ (ระบบจะ fallback ไป LINE Notify เดิมจนกว่าจะใส่ครบ)

---

## ค่าคงที่ที่ต้องใช้ตอนตั้งค่า (คัดลอกไปวางได้เลย)

```
Webhook URL        : https://pooilgroup.vercel.app/api/chairops/line/webhook
LIFF Endpoint URL  : https://pooilgroup.vercel.app/liff
LIFF Size          : Full
LIFF Scopes        : openid, profile
Supabase Redirect  : https://pooilgroup.vercel.app/liff/status
```

---

## Part A — สร้างบัญชี + Channel (ฝั่ง CEO ทำที่เว็บ LINE)

### A1. สร้าง LINE Official Account (OA)
1. เข้า https://manager.line.biz → "สร้างบัญชีใหม่"
2. ตั้งชื่อ เช่น **"ChairOps เก้าอี้นวด"** (คนละบัญชีกับ OA สมัครงาน/Recruit)
3. ทำได้ทันทีแม้ยังไม่ verified (badge เทา) — ใช้ทดสอบได้เลย
   - การ verify (badge น้ำเงิน) ส่งเอกสารธุรกิจ ใช้เวลา 1–3 วัน → ทำคู่ขนานได้ ไม่ต้องรอ

### A2. เปิดโหมด Messaging API
1. ใน LINE Official Account Manager → ตั้งค่า → **Messaging API** → "เปิดใช้"
2. ระบบจะให้สร้าง/ผูก **Provider** (ตั้งชื่อบริษัทก็ได้) → ยืนยัน
3. จะได้ "Messaging API channel" ผูกกับ OA นี้

### A3. เก็บรหัส 2 ตัว (จาก https://developers.line.biz)
1. เข้า https://developers.line.biz/console → เลือก Provider → เลือก channel ที่เพิ่งสร้าง
2. แท็บ **Basic settings** → คัดลอก **Channel secret** → นี่คือ `LINE_CHANNEL_SECRET` (ค่า #2)
3. แท็บ **Messaging API** → เลื่อนลงหา **Channel access token (long-lived)** → กด **Issue** → คัดลอก → นี่คือ `LINE_CHANNEL_ACCESS_TOKEN` (ค่า #1)
4. แท็บ **Messaging API** → ช่อง **Webhook URL** → วาง:
   `https://pooilgroup.vercel.app/api/chairops/line/webhook`
   → กด **Verify** (ควรขึ้น Success สีเขียว) → เปิดสวิตช์ **Use webhook = ON**
5. ปิด **Auto-reply / Greeting message** (ไม่งั้นบอทจะตอบรกๆ) — ที่ LINE OA Manager → การตอบกลับ → ปิด auto-reply

### A4. สร้าง LIFF app (หน้าฟอร์มที่เปิดใน LINE)
1. ใน channel เดิม → แท็บ **LIFF** → **Add**
2. ตั้งค่า:
   - **Size** = `Full`
   - **Endpoint URL** = `https://pooilgroup.vercel.app/liff`
   - **Scopes** = ติ๊ก `openid` + `profile`
   - Bot link feature = On (แนะนำ)
3. กด Add → จะได้ **LIFF ID** หน้าตาเช่น `2001234567-AbCdEfGh` → นี่คือ `NEXT_PUBLIC_LIFF_ID` (ค่า #3)

---

## Part B — ใส่รหัสเข้าระบบ (ค่า #1–3)

มี 2 ทางเลือก:

**ทางที่ 1 (แนะนำ): CEO ใส่เองใน Vercel**
1. เข้า https://vercel.com → project **pooilgroup** → Settings → **Environment Variables**
2. เพิ่มทีละตัว (Environment = **Production** ติ๊กด้วย):
   - `LINE_CHANNEL_ACCESS_TOKEN` = (ค่า #1)
   - `LINE_CHANNEL_SECRET` = (ค่า #2)
   - `NEXT_PUBLIC_LIFF_ID` = (ค่า #3)
3. กด Save → ไปแท็บ **Deployments** → กด **Redeploy** ตัวล่าสุด (env ใหม่จะมีผลหลัง redeploy)

**ทางที่ 2: ส่งค่าให้ผม** — ผมจะเตือนเรื่องความปลอดภัยก่อน (token = กุญแจ ใครได้ไปคุมบอทได้) แล้วช่วยใส่ให้

> นอกจากนี้ ขั้นนี้ต้องเพิ่ม Supabase redirect ด้วย (ทำครั้งเดียว):
> Supabase Dashboard → project → **Authentication → URL Configuration → Redirect URLs** → เพิ่ม
> `https://pooilgroup.vercel.app/liff/status`
> (ไม่งั้นแม่บ้านกดเมนูแล้ว login ค้าง)

---

## Part C — เชื่อมกลุ่มสาขา (เอา groupId · ค่า #4–8)

ระบบส่งแจ้งเตือนเข้า "กลุ่มงาน" 5 แบบ เราต้องรู้ว่ากลุ่มไหนมี id อะไร:

1. **เชิญ OA เข้ากลุ่ม** ที่ต้องการให้ระบบยิงเตือน (เช่น กลุ่มการเงิน, กลุ่มแจ้งซ่อม ฯลฯ)
2. ทันทีที่ OA เข้ากลุ่ม ระบบจะ **บันทึก groupId ลง log อัตโนมัติ**
3. CEO อ่าน groupId ได้ที่: Vercel → project pooilgroup → **Logs** → ค้นคำว่า `JOIN`
   จะเห็นบรรทัด: `[chairops-line webhook] JOIN · sourceType=group id=Cxxxxxxxx — add to LINE_GROUP_*`
   → คัดลอก `id=Cxxxx` นั้นไปใส่ env ตามชนิดกลุ่ม
4. ใส่ใน Vercel env (เหมือนขั้น B): `LINE_GROUP_FINANCE`, `LINE_GROUP_REPAIR`, `LINE_GROUP_OPS`, `LINE_GROUP_BRANCH`, `LINE_GROUP_CEO`

> ถ้ายังไม่ใส่ค่าเหล่านี้ ระบบจะ fallback ไปยิง LINE Notify เดิม → ไม่พัง แค่ยังไม่ได้ใช้กลุ่มใหม่

---

## Part D — ทำเมนูปุ่ม 4 ปุ่ม (Rich Menu)

เมนูที่แม่บ้านจะเห็นล่างจอแชท: 4 ช่อง

```
┌─────────────┬─────────────┐
│  เก็บเงิน    │  เช็คคลีน    │   ← /chairops/m/collect/new · /chairops/m/cleanliness/new
├─────────────┼─────────────┤
│  แจ้งซ่อม    │  เบิกของ     │   ← /chairops/m/damage · /chairops/m/parts/new
└─────────────┴─────────────┘
```

ขั้นตอน:
1. เตรียมรูปเมนู **2500 × 1686 px** (PNG/JPEG) แบ่ง 4 ช่องมีป้ายข้อความ — ถ้าไม่มีดีไซเนอร์ บอกผม ผมทำรูปง่ายๆ ให้ได้
2. รันสคริปต์ลงทะเบียนเมนู (ผมรันให้ได้ หรือ CEO รันเอง):
   ```bash
   LINE_CHANNEL_ACCESS_TOKEN=<ค่า#1> NEXT_PUBLIC_LIFF_ID=<ค่า#3> \
     node scripts/chairops-richmenu.mjs ./menu-2500x1686.png
   ```
3. เสร็จแล้วเมนูจะขึ้นให้ทุกคนที่เพิ่มเพื่อน OA นี้อัตโนมัติ

---

## Part E — ทดสอบให้เห็นกับตา

1. **เพิ่มเพื่อน** OA ChairOps ในมือถือ → ควรเห็นเมนู 4 ปุ่มล่างจอ
2. ผูกแม่บ้านกับ LINE: ที่ระบบหลังบ้าน admin ตั้งค่า `line_user_id` ของแม่บ้าน (มีช่องอยู่แล้ว ไม่ต้องสร้างใหม่)
   - วิธีหา line_user_id ของแม่บ้าน: ให้แม่บ้านกดเมนูครั้งแรก ระบบจะบอก "ยังไม่ผูกบัญชี" + แสดง id ให้ admin เอาไปใส่
3. กดปุ่ม **เก็บเงิน** → ควรเด้งเข้าฟอร์มในแอป → กรอก → เห็นหน้า "สำเร็จ" + เลขอ้างอิง
4. เย็น ~17:00 ระบบจะ push สรุป "สาขาไหนยังทำไม่ครบ" เข้ากลุ่ม `ops` อัตโนมัติ

---

## ลำดับที่แนะนำ (ทำอะไรก่อนหลัง)

1. **วันนี้:** A1→A4 (สร้าง OA + channel + LIFF) → ได้รหัส #1–3
2. **วันนี้:** Part B (ใส่ env + redeploy + Supabase redirect) → ระบบเริ่มทำงาน
3. **วันนี้/พรุ่งนี้:** Part D (เมนูปุ่ม) → ทดสอบ Part E กับ 1 สาขาก่อน (pilot)
4. **สัปดาห์นี้:** Part C (เชื่อมกลุ่มทีละกลุ่ม) → ขยายทีละสาขา
5. **คู่ขนาน:** ยื่น verify business (1–3 วัน) — ไม่บล็อกข้ออื่น

---

## ของที่ระบบมีให้แล้ว (ไม่ต้องสร้าง)

- ✅ Webhook receiver (ตรวจลายเซ็น HMAC กันปลอม) — `app/api/chairops/line/webhook/route.ts`
- ✅ ตัวส่งข้อความเข้ากลุ่ม (มี retry + fallback) — `lib/chairops/line/messaging.ts`
- ✅ หน้าฟอร์มแม่บ้านในแอป (เก็บเงิน/เช็คคลีน/แจ้งซ่อม/เบิกของ) — `app/(admin)/chairops/(maid)/m/*`
- ✅ Login อัตโนมัติผ่าน LINE (verify id_token กัน spoof) — `app/api/auth/line-login/route.ts`
- ✅ เตือนตอนเย็นว่าใครยังทำไม่ครบ (cron 17:00) — `app/api/chairops/cron/eod-reminder/route.ts`
- ✅ สคริปต์ทำเมนูปุ่ม — `scripts/chairops-richmenu.mjs`
