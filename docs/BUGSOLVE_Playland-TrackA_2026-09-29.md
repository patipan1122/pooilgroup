# BugSolve · Playland Track A · 2026-09-29

> `/bigsolvebug` · Targeted mode (5 pre-diagnosed bugs from same-day `/auditbigteam` doc, no blind 25-persona crawl needed) · orchestrator implemented+verified directly given deep same-session context.

## §summary
- ✅ 4 code bugs fixed + verified (typecheck clean, 1 live-DB-query verified, live hardware commands already proven earlier same session) · ✅ 1 leaked secret rotated + example file genericized · 🔴 1 finding deferred to CEO (needs a product/trade-off decision, not a pure bug)
- **Not yet committed to git** — CLAUDE.md's rule ("never commit unless explicitly asked") takes priority over the skill's own default auto-commit step. Waiting for CEO go-ahead.
- Fix for the `gate-override.ts` device-resolution bug needed a SECOND pass — a live-DB check after the first fix showed it now resolved to a different stale placeholder device (`TEST-CLOUD-001`) instead of a working one. Caught before shipping.

## §scope
Files touched: `lib/playland/actions.ts`, `lib/playland/wristband.ts`, `lib/playland/gate-override.ts`, `lib/playland/acs/handle-qr-scan.ts`, `playland-agent/.env.example`, `playland-agent/.env` (new, git-ignored), + 2 `PlaylandDevice.webhookSecret` rows rotated in production DB.

## §bugs-fixed

| # | file:line | เรื่อง | วิธีแก้ |
|---|---|---|---|
| 1 | `lib/playland/actions.ts` `createMember` | เรียกเครื่องสแกนตรง ๆ กับ LAN จากเซิร์ฟเวอร์ (พังเสมอ) faceId ค้าง null ถาวร | ใช้ pattern เดียวกับ `register-face/route.ts` ที่เพิ่งแก้ — เข้าคิว `PlaylandFaceSync` แทน, ให้ vendor จริงชนะ mock เสมอ |
| 2 | `lib/playland/wristband.ts` `activateWristband` | ไม่เช็คว่าสมาชิกมี session ACTIVE/PAUSED อยู่แล้ว — เสี่ยงเก็บเงินซ้ำ | เพิ่ม guard เดียวกับที่ `checkInSession` มีอยู่แล้ว |
| 3 | `lib/playland/gate-override.ts` | เลือกเครื่อง default ผิด (ได้ mock หรือเครื่องที่ยังไม่ตั้งค่าจริง) → เปิดประตูฉุกเฉินรายงานสำเร็จทั้งที่ไม่มีสัญญาณไปเครื่องจริง | กรอง `vendor≠mock` **และ** `baseUrl` ต้องตั้งค่าไว้แล้ว — ทดสอบจริงกับข้อมูล production ยืนยันว่าตอนนี้ชี้ไปเครื่องจริง (`T77QR6301FZS`) ถูกต้อง |
| 4 | `lib/playland/acs/handle-qr-scan.ts` | สแกน QR ที่สถานะ ISSUED (ยังไม่จ่ายเงิน) เปิดประตูทันที ขัดกับกฎเงินจริง | เปลี่ยนเป็นปฏิเสธ (staff ต้อง activate+เก็บเงินก่อน) จนกว่าจะมีคนต่อ QR เข้า flow จ่ายเงินจริง |
| 5 | `playland-agent/.env.example` + DB | secret จริงฝังอยู่ในไฟล์ตัวอย่าง | เปลี่ยนเป็น placeholder + หมุน secret จริง 2 ตัวใน production DB แล้ว (ของเก่าใช้ไม่ได้อีกต่อไป) |

## §bugs-deferred (ต้องรอ CEO ตัดสินใจ ไม่ใช่บั๊กที่แก้เองได้)

| # | เรื่อง | ทำไมไม่แก้เอง |
|---|---|---|
| 5a | `register-face` (public, ไม่ auth) ไม่มีการยืนยันตัวตนก่อน sync รูปเข้าประตูจริง | เป็น trade-off จริง (เพิ่ม OTP = เสียดเวลาลูกค้า vs ความเสี่ยงมีคนปลอมตัว) — ต้องให้ CEO เลือก ไม่ใช่ผมตัดสินเอง |

## §regression-pass
- Typecheck ทั้งโปรเจกต์: 0 error (หลังแก้ครบทุกจุด)
- ทดสอบ live กับฐานข้อมูลจริง: query การเลือกเครื่อง default ของ gate-override ยืนยันว่าได้เครื่องจริง (`T77QR6301FZS`, baseUrl ถูกต้อง) ไม่ใช่เครื่องปลอม/เครื่องที่ยังไม่พร้อม
- คำสั่งเปิดประตู/ลบคนออกจากเครื่องจริง เคยทดสอบผ่านมาแล้วในเซสชันเดียวกัน (ก่อนหน้านี้วันนี้)

## §persona-coverage
ไม่ได้รันแบบ 25-persona เต็มรูป — ใช้ Targeted mode เพราะมีบั๊ก 5 จุดที่วินิจฉัยแม่นแล้วจาก `/auditbigteam` รอบก่อนหน้า (เอกสาร: `docs/AUDIT_Playland-TrackA_2026-09-29.md`)

## §next-actions (CEO ต้องตัดสินใจ)
1. **อนุมัติให้ commit การแก้ไข 4 จุด + หมุน secret หรือยัง?** (ยังไม่ commit ตามกฎ "ห้าม commit เองถ้าไม่ขอ")
2. register-face ต้องมี OTP/ยืนยันตัวตนก่อนไหม หรือยอมรับความเสี่ยงไปก่อน (pilot กลุ่มเล็ก)?
3. ตัวคิว `playland-agent/.env` ตอนนี้ตั้ง `CLOUD_BASE_URL=http://localhost:3100` (ไว้ทดสอบ) — ต้องเปลี่ยนเป็น URL เว็บจริงก่อนใช้งานจริงที่ร้าน

## §lessons-this-run
- 💚 worked: mirror pattern ที่ถูกต้องอยู่แล้วในโค้ดตัวเอง (register-face) แทนคิดวิธีใหม่ — แก้เร็ว ตรวจง่าย
- 💚 worked: ทดสอบ live กับข้อมูลจริงหลังแก้ครั้งแรก เจอว่าแก้ไม่ครบ (ยังมีเครื่องปลอมอีกตัว) — ถ้าเชื่อแค่ typecheck จะหลุดบั๊กเดิมในรูปแบบใหม่
- 📊 cost: ~15k tokens (ไม่ต้องเรียก sub-agent เพราะมี context ลึกจากการ audit เอง) · ~20 นาที
