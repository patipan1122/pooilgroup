# Persona: Owner (CEO mock) — Recruit Onboarding /bigfeature roundtable

> Voice: Pattipan, CEO, non-technical, Thai-first
> Date: 2026-09-22 · Run #1
> Note: SA/PM persona output files (`BIGFEATURE_recruit-onboarding_PERSONA_{SA,PM}.md`) ยังไม่ถูกเขียนตอนที่ผมเปิดดู — ผมรอ effort number จริงจากพวกเขาอยู่ ด้านล่างคือสิ่งที่ผมประเมินได้จากหลักฐานที่มีตอนนี้

---

## 1. Priority now?

เช็ค `STATUS.md` แล้ว — งานที่ **build เสร็จแล้วแต่ยังไม่ push/deploy** ค้างอยู่จริงหลายก้อนตอนนี้ (invite-link standardize, CashHub program_admin permissions, LedgerLine TRCloud reconcile) แถม ChairOps เพิ่ง deploy hotfix สลิป/ฝากเงินไปเมื่อวันนี้เอง และมี "เซ็นสัญญาจ้างออนไลน์" ของ ChairOps ที่ workshop-lock ไว้แล้วแต่ค้างรอทนายตรวจก่อนเริ่มโค้ด — เป็นฟีเจอร์คู่แฝดของ Recruit onboarding นี้เป๊ะ (contract-signing + selfie + upload) ผมอยากให้สองงานนี้ **ใช้ทนายคนเดียวกัน คิวเดียวกัน** ไม่ใช่ส่งไปแยกกัน 2 รอบ

แต่โหมด build ตอนนี้คือ "เขียน+verify ไว้ก่อน ไม่ deploy จนกว่าผมไฟเขียว" — แปลว่าไม่ไปแย่งพื้นที่ prod กับงานที่ค้างอยู่ตอนนี้ **ผมโอเคให้เดินหน้าคู่ขนานได้** เพราะ blocker จริง (ทนายตรวจ) ต้องใช้เวลาอยู่แล้ว ปล่อยให้ engineering เดินระหว่างรอทนายคุ้มกว่าปล่อยว่าง

## 2. สิ่งที่ผมกังวลที่สุด

ลิงก์นี้ **ถาวร + ไม่ล็อกอิน** เก็บบัตรประชาชน+เซลฟี่+เซ็นชื่อของทุกคนที่เคยสมัครตลอดกาล — ผมเจอว่า draft ก่อนหน้า (`WORKSHOP_recruit-employee-onboarding.md`, 09-21) เคยมี "รหัสอ้างอิง 6 หลัก" กันคนเดินผ่านมากรอกมั่ว แต่ spec ที่ lock ล่าสุดตัดรหัสนี้ออกไปแล้ว ("no per-person code") — ถ้าลิงก์หลุดออกไปครั้งเดียว (แคป-แชร์ในกลุ่มไลน์ผิด, Google index เจอ, สมัครแล้วส่งต่อให้เพื่อน "ลองดู") **ไม่มีทางหมุนรหัสใหม่หรือตัดคนเก่าออกได้เลย เพราะไม่มี TTL** — กลายเป็นช่องเก็บ PII สาธารณะถาวร ยิ่งอยู่นานยิ่งสะสมของมากขึ้น ถ้าวันหนึ่ง Google Drive credential รั่ว ไม่ใช่รั่ว 1 ใบ แต่รั่ว**ทุกใบที่เคยส่งเข้ามาตั้งแต่วันเปิดระบบ** — นี่คือจุดเดียวที่ผมอยากให้มี rate-limit/monitor ก่อน enable จริง แม้ scope จะ final แล้วก็ตาม

## 3. ต้นทุนสมเหตุสมผลไหม

ยังตอบเต็มไม่ได้เพราะ SA/PM ยังไม่ขึ้นไฟล์ — แต่มี anchor ตัวเลขจริงจาก `STATUS.md` (09-22): ตอน ChairOps ตัดชิ้น "token wrapper + anonymous upload route" ออกจากงานตัวเอง เขาอ้างว่า Recruit workshop เคยประเมินชิ้นนี้ไว้ **14-16 วัน** — และ Recruit onboarding นี้ยังคง**เก็บชิ้นนั้นไว้เต็มๆ** (เป็น core requirement) บวกฟอร์ม 41 ข้อ + อัปโหลด 6 เอกสาร + contract renderer 10 บท + drawn signature + live selfie ทับเข้าไปอีก — ถ้า PM สรุปออกมาใกล้ 4-5 สัปดาห์รวม ผมรับได้เพราะ integration map เดิมบอกว่า reuse หนักจริง (DocuFlow signer, Drive-upload route เดิม, invite-pattern เดิม) แต่ถ้าเกินนั้นมาก อยากให้ PM แจกแจงว่าไปหนักตรงไหน ก่อนผมอนุมัติงบเวลา
