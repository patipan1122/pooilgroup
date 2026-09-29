# AUDIT — Playland Track A (money-flow + ACS hardware integration)

> `/auditbigteam` · Lean mode (8 personas: BA·SA·BE·SEC·AUD·SRE·DEVIL·OWN — UX/IA/QC/FE/MGR/STAFF skipped on purpose, `/leanux` covers that layer next) · Phase 2/2.5/3 skipped (no redesign requested — correctness/consistency audit only, `/bigsolvebug` runs next for hands-on runtime verification)
> Scope: checkin · checkout · wristband · booking · pos · gate-override · ACS/agent integration (built same day) · audit log. **OUT OF SCOPE (Track B, separate run)**: safety · incidents · stock · shifts · reports · lost-found · repairs · owner-report · monitor · board.
> Module size: 18,116 LOC · 35 Prisma models · cost: 8 agents, ~1.18M subagent tokens, ~35 min wall time.

## 1. Executive summary

Playland ไม่ใช่โปรเจกต์เปล่า — เป็นระบบจัดการสวนสนุกที่มีโค้ดจริงจังมาตั้งแต่พฤษภาคม 2569 วันนี้ (28-29 ก.ย.) มีการต่อฮาร์ดแวร์จริง (เครื่องสแกนหน้า ACS-F606 ×2) เข้าระบบผ่าน "agent ตัวกลาง" ตัวใหม่ และแก้บั๊กใหญ่ 1 ตัว (ฟีเจอร์ลงทะเบียนหน้าเองผ่านมือถือไม่เคยทำงานจริงเลยตั้งแต่สร้าง)

ทีมตรวจ 8 คนอิสระเจอปัญหา **บรรจบกันเองจากหลายมุมมอง** (สัญญาณความน่าเชื่อถือสูง) — สรุปคือ **โครงสร้างพื้นฐานวันนี้ถูกทาง แต่มีบั๊ก sibling ที่ยังไม่แก้ + จุดอ่อนด้านความปลอดภัย/สังเกตการณ์ที่ต้องปิดก่อนเปิดใช้จริงกับลูกค้า**

## 2. Top 10 findings (เรียงตามความเสี่ยง)

| # | เรื่อง | ระดับ | ใครเจอ | รายละเอียด |
|---|---|---|---|---|
| 1 | **`createMember` (ลงทะเบียนหน้าเคาน์เตอร์) มีบั๊กเดียวกับที่เพิ่งแก้ใน `register-face` แต่ยังไม่ถูกแก้ — แย่กว่าด้วยซ้ำ** | 🔴 P0 | BA + SA + DEVIL (3 คนอิสระ) | `lib/playland/actions.ts:111-136` ยังเรียกเครื่องสแกนตรง ๆ แบบ synchronous → ทุกสมาชิกที่พนักงานลงทะเบียนหน้าเคาน์เตอร์ (มีรูป) ที่สาขามีเครื่องจริง จะไม่มี `faceId` เลยตลอดไป (ไม่ fallback เป็นอะไรทั้งนั้น ต่างจาก register-face ที่ fallback เป็น MOCK-id) |
| 2 | **Check-in + ออกสายรัด ไม่ผูกกัน → เสี่ยงเก็บเงินซ้ำ + สายรัดค้างระบบตลอดกาล** | 🔴 P0 | BA | เช็คอินที่เคาน์เตอร์ออก wristband แบบไม่ผูก sessionId · สแกนที่ประตูจริงไม่เปลี่ยนสถานะ · `activateWristband` สร้าง session+เก็บเงินใหม่ซ้ำได้โดยไม่เช็คว่ามี session active อยู่แล้ว (guard นี้มีแค่จุดเดียวใน `checkInSession` ไม่ครบทุกทางเข้า) |
| 3 | **เปิดประตูฉุกเฉิน (anti-fraud) บนสาขาที่มีทั้งเครื่องจริง+เครื่องปลอม จะไปเรียกเครื่องปลอมเงียบ ๆ แล้วรายงานว่าสำเร็จ** | 🔴 P0 | SA (ยืนยัน sibling ตามที่ขอให้ตรวจ) | `gate-override.ts` เลือกเครื่อง default ด้วย `orderBy: createdAt asc` = เครื่องเก่าสุด บนสาขา Demo คือ mock device → `emergencyOpen()` เป็น no-op แต่คืนค่าสำเร็จ → audit log บันทึกว่า "เปิดประตูสำเร็จ" ทั้งที่ไม่มีสัญญาณไปเครื่องจริงเลย |
| 4 | **โค้ด QR ที่มีอยู่แล้วขัดกับกฎเรื่องเงินจริงของสายรัด** | 🔴 P0 | DEVIL | `handle-qr-scan.ts` เปิดประตูทันทีถ้าสถานะ ISSUED/ACTIVE โดยไม่มีขั้นจ่ายเงิน แต่ `wristband.ts` บังคับเลือก package+ชำระเงินก่อนถึงจะ ACTIVATE ได้จริง — ถ้าต่อเครื่องที่รองรับ QR วันนี้ = รูรั่วรายได้ ไม่ใช่แค่โค้ดที่ยังไม่ได้ใช้ |
| 5 | **ลงทะเบียนหน้าเองผ่านมือถือ ไม่มีการยืนยันตัวตนใด ๆ เลย ก่อน sync เข้าประตูจริง** | 🔴 P0 | SEC | Public endpoint ไม่ auth รับชื่อ+เบอร์+รูปอะไรก็ได้ → sync เข้าเครื่องสแกนหน้าจริงที่ประตู ไม่มี liveness/OTP/captcha กันเลย เกราะเดียวคือ rate-limit 5 ครั้ง/10นาที/IP ซึ่งเก็บ state ใน memory (ไม่รับประกันผลบน production) |
| 6 | **ไฟล์ `.env.example` ของ agent ใหม่มีรหัสลับจริงฝังอยู่ + ยังไม่ commit เข้า git เลย** | 🔴 P0 | SEC + SRE (2 คนอิสระ ยืนยันจากไฟล์จริง ไม่ใช่เดา) | `playland-agent/.env.example` มี webhook secret จริง 2 ตัว + IP เครื่องจริง และ `.gitignore` มี `!.env.example` (บังคับไม่ ignore) — พร้อมหลุดเข้า git ทันทีที่มีคน `git add` |
| 7 | **2 ฟีเจอร์ใหม่ที่แตะข้อมูลลูกค้า (register-face, agent sync) ไม่มี audit log เลยสักบรรทัด** | 🟡 P1 | AUD | สร้างสมาชิก+อัปโหลดรูปหน้าแบบสาธารณะ และ push/ลบรูปหน้าเข้าเครื่องจริง — ไม่มีร่องรอยอะไรนอกจากสถานะที่ถูกเขียนทับ (ประวัติความพยายามครั้งก่อนหายสนิท) |
| 8 | **ไม่มีระบบเช็คว่าเครื่อง/โปรแกรมตัวกลางเงียบหายไป — ป้าย "ออนไลน์" อาจเขียวหลอกได้ตลอดไป** | 🟡 P1 | SRE + OWN (2 คนอิสระ คนละมุมมอง เทคนิค+ธุรกิจ) | มี timestamp (`lastSeenAt`) เก็บไว้แล้วจริง แต่ไม่มี cron/watchdog อ่านมันเพื่อแจ้งเตือนเลย — ถ้าคอมร้าน/เน็ตดับ เจ้าของจะไม่รู้จนลูกค้าบ่นที่ประตู |
| 9 | คิวงาน (face-sync) claim แบบไม่ล็อกแถว + endpoint รายงานผลเชื่อค่าที่ผู้เรียกส่งมาเองทั้งหมด | 🟡 P1 | BE + SA (อิสระ) | ผลกระทบจริงถูกลดทอนเพราะคำสั่งเครื่อง (เพิ่ม/ลบหน้า) น่าจะทำซ้ำได้โดยไม่พัง แต่ผิดหลัก queue-claim มาตรฐาน |
| 10 | เปิดประตูฉุกเฉิน + ยกเลิกบิลขาย เป็น single-approver ทั้งคู่ ไม่มีคนที่สองตรวจ | 🟡 P1 | AUD | ไม่สอดคล้องกับมาตรฐานที่ ChairOps เพิ่งตั้งไว้ (ลบสลิปต้องผู้จัดการอนุมัติ) |

## 3. บั๊ก sibling ที่เพิ่งยืนยันซ้ำอีกรอบ (pattern จาก memory `feedback-fixed-one-sibling-missed-another`)

วันนี้แก้ `register-face/route.ts` ไปแล้ว 1 จุด — ทีมตรวจเจอว่า **โค้ดจุดเดียวกันทุกประการ (เรียกเครื่องสแกนตรง ๆ แบบ synchronous) ยังอยู่ครบใน `createMember` (หน้าเจ้าหน้าที่ลงทะเบียน)** และ **`gate-override.ts`'s device-selection logic** ก็เป็นเวอร์ชันที่ยังไม่ได้ "real device ต้องชนะเสมอ" เหมือนกัน — นี่คือ pattern ที่เจอซ้ำในโปรเจกต์นี้บ่อยมาก แนะนำให้ดึง logic ออกเป็น shared helper ตัวเดียวที่ทั้ง 2-3 จุดเรียกใช้ร่วมกัน แทนที่จะแก้แยกทีละจุด

## 4. Conflict ledger

ทีม 8 คนไม่มีการขัดแย้งกันเองจริงจัง (0 conflict ที่ต้องตัดสิน) — ทุกคนเสริมกันคนละมุม ไม่มีใครฟันธงตรงข้ามกับอีกคน

## 5. Sign-off

| Persona | สถานะ | เงื่อนไข |
|---|---|---|
| BA | 🟡 CONDITIONAL | ต้องตอบคำถามเรื่อง flow เช็คอิน/สายรัดก่อนใช้จริง |
| SA | 🟡 CONDITIONAL | ต้องแก้ sibling bug 2 จุด (createMember, gate-override) ก่อน |
| BE | 🟡 CONDITIONAL | แนะนำแก้ queue-claim แต่ยอมรับความเสี่ยงต่ำได้ถ้ารีบ |
| SEC | 🔴 BLOCKED | ห้ามเปิดใช้ register-face กับลูกค้าจริงจนกว่าจะปิดช่องโหว่ #5 และหมุน secret ที่หลุด #6 |
| AUD | 🟡 CONDITIONAL | แนะนำเพิ่ม audit log แต่ไม่บล็อกการใช้งานทันที |
| SRE | 🟡 CONDITIONAL | ต้อง commit `playland-agent/` เข้า git + genericize `.env.example` ก่อน (ความเสี่ยงข้อมูลหาย/รั่วจริง) |
| DEVIL | ⚠ OBJECTS-BUT-ACCEPTS | คัดค้านโค้ด QR ที่ยังไม่มีเครื่องจริงรองรับ แต่ไม่ block งานหลัก |
| OWN | 🟡 CONDITIONAL | อยากเห็นตัวเลข "หน้าไม่ผ่านกี่คน" + สถานะเครื่องที่เชื่อถือได้จริงก่อนเปิดใช้ |

**1 BLOCKED (SEC)** — ต่ำกว่าเกณฑ์ ≤2 CONDITIONAL+0 BLOCKED เล็กน้อย แต่ยังไม่ต้อง trigger patch round เต็มรูป เพราะข้อบล็อกชัดเจนและแคบ (2 ข้อ: liveness/OTP บน register-face, หมุน secret)

## 6. 🎯 Top 5 Decisions Needing CEO Eyes

1. **register-face ไม่มีการยืนยันตัวตนก่อน sync เข้าประตูจริง** — owner: SEC · cost-if-wrong: **สูง** (ใครก็ปลอมเป็นสมาชิกได้) · CEO action: ☐ เพิ่ม OTP/liveness ก่อนเปิดใช้จริง ☐ ยอมรับความเสี่ยงไปก่อน (pilot เล็ก)
2. **`createMember` มีบั๊กเดียวกับที่เพิ่งแก้ ยังไม่ได้แก้** — owner: BA/SA/DEVIL · cost-if-wrong: สูง (พนักงานลงทะเบียนหน้าเคาน์เตอร์ทุกคนจะไม่มี faceId) · CEO action: ☐ แก้ต่อเลย ☐ รอรอบหน้า
3. **เปิดประตูฉุกเฉินอาจไปเรียกเครื่องปลอมเงียบ ๆ** — owner: SA · cost-if-wrong: สูงมาก (ฟีเจอร์ anti-fraud หลักใช้งานไม่ได้จริงแบบไม่มีใครรู้) · CEO action: ☐ แก้ทันที ☐ ทดสอบก่อนว่าเกิดจริงไหม
4. **Check-in/wristband flow เสี่ยงเก็บเงินซ้ำ** — owner: BA · cost-if-wrong: สูง (เงินจริง) · CEO action: ☐ ยืนยัน flow ที่ต้องการจริง (คำถาม #1 ของ BA) ก่อนแก้
5. **secret หลุดใน `.env.example` + โค้ด agent ยังไม่ commit** — owner: SEC/SRE · cost-if-wrong: กลาง (ยังไม่หลุดจริง แต่พร้อมหลุด) · CEO action: ☐ แก้ก่อน commit ครั้งแรก (เร็ว ทำได้ทันที)

## 7. Hardware dependency matrix

ดูรายละเอียดเต็มใน BA persona output — สรุป: core money-flow (checkin/checkout/pos) = BUILDABLE_NOW ไม่ต้องรอฮาร์ดแวร์ · ACS integration ทั้งหมด (register-face จริง, webhook, gate-open) = HW_BLOCKED ในทางปฏิบัติจนกว่าจะติดตั้งเครื่องที่สาขาจริง (ตอนนี้ bench-test บนคอม CEO เท่านั้น) · QR = HW_BLOCKED เพราะยังไม่มีเครื่องที่ยืนยันว่ารองรับจริง

## 8. Open questions ทั้งหมด (รวมจาก 8 persona — ดูรายละเอียดในผลแต่ละคนด้านล่าง)

ดูหัวข้อ §questions_for_ceo ของแต่ละ persona ในภาคผนวก — คำถามหลักคือ 5 ข้อใน §6 ด้านบน ที่เหลือเป็นรายละเอียดย่อย

## 9. Locked decisions (D-###)

- D-Track-A-1: Playland มีระบบจริงอยู่แล้ว ไม่ใช่โปรเจกต์เปล่า (ยืนยันซ้ำจาก audit)
- D-Track-A-2: agent ตัวกลางที่สร้างวันนี้เป็นสถาปัตยกรรมที่ถูกทาง (ไม่มี persona คัดค้านทิศทางหลัก)
- D-Track-A-3: ตาราง `tools/acs-http-bridge/` (พฤษภาคม 2569) ถูกแทนที่แล้ว 100% โดย agent ใหม่ — รอ CEO ตัดสินใจว่าจะลบหรือเก็บเป็นข้อมูลอ้างอิง

## 10. Pilot plan (ก่อนเปิดใช้จริงกับลูกค้า)

**Day-1 Hotfix Budget:** จองเวลา 0.5-1 วันทำงานสำหรับแก้บั๊กที่เจอวันแรกที่ใช้จริง (ตามธรรมเนียมสกิล ไม่ผลักเป็น Phase 2)

**ต้องทำก่อน pilot จริง (ตามลำดับความเสี่ยง):**
1. แก้ sibling bug (`createMember`, `gate-override` device-selection) — งานเล็ก ทำได้เร็ว
2. Genericize `.env.example` + commit `playland-agent/` เข้า git
3. ตัดสินใจเรื่อง liveness/OTP บน register-face (หรือจำกัด pilot เฉพาะกลุ่มเล็กที่ควบคุมได้ก่อน)
4. ตอบคำถาม flow เช็คอิน/สายรัด (BA คำถาม #1) แล้วแก้ตาม

---

*บันทึกเต็มของแต่ละ persona (BA/SA/BE/SEC/AUD/SRE/DEVIL/OWN) เก็บไว้ในบทสนทนา session นี้ — ขอให้ทีมพัฒนาอ้างอิงเพิ่มเติมได้หากต้องการรายละเอียด file:line ครบทุกจุด*
