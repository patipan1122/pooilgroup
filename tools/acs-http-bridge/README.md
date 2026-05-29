# ACS-F606 HTTP → HTTPS bridge

## ทำไมต้องมีตัวนี้

- F606 firmware ส่ง event ด้วย HTTP เท่านั้น (ยืนยันจาก doc-2 §2.6.1 หน้า 28 ข้อความสีแดง: "must set up **http** server to receive data" + log ภายในของ device เขียน `http api post record url:http://...`)
- Vercel เปิดรับเฉพาะ HTTPS · request ที่มาแบบ HTTP จะถูก 308 redirect → HTTPS
- doc-2 หน้าเดียวกันบอกชัด device **ไม่ตาม redirect** · ผลคือ engineer ของ ACS เลย report ว่า "your interface cannot be connected"

Bridge ตัวนี้รับ HTTP จาก device แล้ว forward ไป HTTPS ที่ Vercel · device ได้ HTTP-only แบบที่ firmware ต้องการ · เราได้ TLS ตลอดเส้นทาง public internet

## เลือก 1 ใน 2 แบบ

### แบบที่ 1 — Cloudflare Worker (แนะนำ)

**ข้อดี:** ฟรี · ไม่ต้องดู server · scale ใหญ่แค่ไหนก็ไม่ล้ม  
**ข้อแม้:** ต้องมีโดเมนของตัวเอง (อะไรก็ได้ที่ ~฿350/ปี เช่น `.com`, `.app`, `.dev`) เพราะ `*.workers.dev` บังคับ HTTPS — ใช้กับ F606 ไม่ได้

#### ขั้นตอน (ครั้งเดียวจบ)

```bash
# 1. ติดตั้ง wrangler (CLI ของ Cloudflare)
cd tools/acs-http-bridge
npm install -g wrangler

# 2. login เข้า Cloudflare (จะเปิด browser)
wrangler login

# 3. deploy
wrangler deploy

# จะได้ URL เช่น: https://acs-http-bridge.<your-account>.workers.dev
# ทดสอบ healthcheck:
curl https://acs-http-bridge.<your-account>.workers.dev/health
```

#### ผูก custom domain (ขั้นตอนสำคัญ · ไม่ผูก = ใช้กับ device ไม่ได้)

1. ใน Cloudflare dashboard → เพิ่มโดเมนของคุณ (ทำ DNS ที่ Cloudflare)
2. SSL/TLS → Edge Certificates → **ปิด "Always Use HTTPS"** (สำคัญที่สุด · เพื่อให้ HTTP ผ่านได้)
3. SSL/TLS → Overview → set เป็น **"Flexible"** หรือ **"Full"** (ห้าม "Strict" เพราะ Vercel cert ของ workers.dev อาจ mismatch)
4. แก้ `wrangler.toml` ในโฟลเดอร์นี้ — uncomment block `[[routes]]` แล้วใส่ pattern เช่น `acs.example.com/*` + `zone_name = "example.com"`
5. `wrangler deploy` ซ้ำ
6. ทดสอบ HTTP (ไม่ใช่ HTTPS):
   ```bash
   curl -v http://acs.example.com/health
   # ต้องเห็น HTTP/1.1 200 ไม่มี 301/308 redirect
   ```

#### URL ที่จะส่งให้ Lily หลัง deploy เสร็จ

```
http://acs.<your-domain>.com/api/playland/acs/event?device=TEST-CLOUD-001&secret=cloud-test-secret-2026
```

(สังเกต `http://` ไม่ใช่ `https://`)

---

### แบบที่ 2 — nginx บน VPS เล็ก ๆ (สำรอง)

**ข้อดี:** ไม่ต้องมีโดเมน · ใช้ public IP ของ VPS ตรง ๆ ได้  
**ข้อเสีย:** ต้องมี VPS (~฿140-200/เดือน) · ต้อง maintain server เอง

#### ขั้นตอน

1. สมัคร VPS เช่น Hetzner CX11 (~€4/เดือน) หรือ DigitalOcean ($6/เดือน) · Ubuntu 24.04 LTS
2. SSH เข้าไป:
   ```bash
   apt update && apt install -y nginx
   ```
3. copy ไฟล์ `nginx-fallback.conf` จากโฟลเดอร์นี้ ไปที่ `/etc/nginx/sites-available/acs-bridge.conf`
4. ```bash
   ln -s /etc/nginx/sites-available/acs-bridge.conf /etc/nginx/sites-enabled/
   rm /etc/nginx/sites-enabled/default
   nginx -t && systemctl reload nginx
   ufw allow 80/tcp
   ```
5. ทดสอบ:
   ```bash
   curl -v http://<VPS-PUBLIC-IP>/health
   ```
6. URL ที่จะส่งให้ Lily:
   ```
   http://<VPS-PUBLIC-IP>/api/playland/acs/event?device=TEST-CLOUD-001&secret=cloud-test-secret-2026
   ```

---

## หลัง bridge ขึ้นแล้ว ต้องอัปเดต device

ใน admin UI `/playland/settings/devices` (หรือผ่าน `setIdentifyCallBck` API ของ device) · เปลี่ยน `platformIp` ของทุก device จาก URL Vercel ตรง ๆ ไปเป็น URL ของ bridge

ของเดิม (เลิกใช้):
```
https://pooilgroup.vercel.app/api/playland/acs/event?device=...&secret=...
```

ของใหม่:
```
http://acs.<your-domain>.com/api/playland/acs/event?device=...&secret=...
```

## เมื่อไรเลิกใช้ bridge ได้

เมื่อ ACS Auto ออก firmware ที่รองรับ HTTPS จริง ๆ (รอ Lily ยืนยัน) · เปลี่ยน `platformIp` กลับไปเป็น URL Vercel ตรง · ปลด Cloudflare Worker / ปิด VPS ได้เลย · zero lock-in
