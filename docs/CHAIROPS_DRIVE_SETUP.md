# ChairOps · ตั้งค่า Google Drive backup (CEO 2026-06-03)

เก็บสลิป/ใบเสร็จ/สัญญา ขึ้น Google Drive ของบริษัท (พื้นที่ฟรี 2TB) แล้วลบสำเนาฝั่ง R2 อัตโนมัติหลัง ~2 เดือน เพื่อประหยัด

## โครงสร้างโฟลเดอร์ (ระบบสร้างให้อัตโนมัติ)
```
เก้าอี้นวด backup1/
  └─ 2026-06/
       ├─ ค่าใช้จ่าย/     (สลิปจ่ายบิล vendor)
       ├─ สลิปรายได้/    (สลิปฝากเงินแม่บ้าน)
       └─ สัญญา/         (สัญญาจ้างแม่บ้าน)
```

## ขั้นตอนตั้งค่าครั้งเดียว (CEO ทำใน Google Cloud Console)

1. ไป https://console.cloud.google.com → สร้าง Project (หรือใช้ที่มี)
2. **APIs & Services → Library** → เปิดใช้ **Google Drive API**
3. **APIs & Services → OAuth consent screen** → External → ใส่ชื่อแอป + อีเมล → เพิ่ม **scope** `https://www.googleapis.com/auth/drive.file` → เพิ่มอีเมลบริษัท (เช่น jpsync.amazon@gmail.com) เป็น Test user
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URI:**
     `https://pooilgroup.vercel.app/api/chairops/drive/oauth/callback`
   - กด Create → จะได้ **Client ID** + **Client Secret**
5. เอาไปใส่ใน **Vercel → Settings → Environment Variables**:
   - `GOOGLE_OAUTH_CLIENT_ID` = (Client ID)
   - `GOOGLE_OAUTH_CLIENT_SECRET` = (Client Secret)
   - *(แนะนำ)* `CHAIROPS_DRIVE_CRYPTO_KEY` = base64 ของ 32 bytes สุ่ม (เข้ารหัส refresh token); ถ้าไม่ใส่ระบบจะ derive จาก service-role key อัตโนมัติ
6. Redeploy → เข้า **/chairops/settings/drive** (เมนู "สำรองขึ้น Drive" ใต้ จัดการ) → กด **"เชื่อม Google Drive"** → ล็อกอินบัญชีบริษัท → อนุญาต → เสร็จ

ตั้งแต่นั้น ไฟล์สัญญา + สลิปฝากเงิน จะถูกสำรองขึ้น Drive อัตโนมัติ (best-effort — ถ้า Drive ล่ม ระบบเดิมยังทำงานปกติ เก็บใน R2 ตามเดิม)

## เปิดการลบ R2 อัตโนมัติ (offload) — ทำทีหลังเมื่อมั่นใจ

ค่าเริ่มต้น = **ปิด** (ปลอดภัย). เมื่อพร้อม:
- ตั้ง env `CHAIROPS_DRIVE_OFFLOAD_DAYS` = `60` (ลบสำเนา R2 ของไฟล์ที่อายุเกิน 60 วัน *ที่มีสำเนาใน Drive ยืนยันแล้ว*)
- เพิ่ม Vercel Cron ยิง `GET /api/chairops/cron/drive-offload` (มี header `Authorization: Bearer $CRON_SECRET`) วันละครั้ง
- ระบบจะลบเฉพาะไฟล์ที่ (1) อายุเกินกำหนด (2) ยืนยันว่าไฟล์ใน Drive ยังอยู่ (3) เป็นชนิดที่ชี้ลิงก์กลับได้ (ตอนนี้ = สัญญาจ้าง). สลิปจะถูกสำรองขึ้น Drive แต่ยังไม่ลบ R2 จนกว่าจะต่อ repoint (กัน "รูปหาย")

## ความเป็นส่วนตัว
- ค่าเริ่มต้น: ไฟล์ใน Drive = **ส่วนตัว** (เฉพาะบัญชี Google ที่เชื่อมเห็น) — ปลอดภัยสำหรับเอกสารอ่อนไหว
- ถ้าต้องการให้พนักงานเปิดไฟล์เก่า (หลัง offload) ผ่านลิงก์ได้เลย → ตั้ง env `CHAIROPS_DRIVE_PUBLIC_LINKS=1` (ไฟล์จะเป็น "ใครมีลิงก์ก็เปิดได้")

## หมายเหตุทางเทคนิค
- ใช้ scope `drive.file` (แอปเห็นเฉพาะไฟล์ที่ตัวเองสร้าง — สิทธิ์น้อยสุด)
- ก่อนเปิด offload จริง แนะนำเทสว่า cron มองเห็นไฟล์ที่อัปไว้ก่อนหน้า (ปุ่มเชื่อม → อัปสัญญา 1 ไฟล์ → รัน cron ดูว่า `driveFileExists` = true)
