# AUDIT · Pinpoint / โหมดติชม
> /auditbigteam · 16 personas (core 13 + SEC + A11Y + SRE) · 2026-06-14
> Mode: Full · spec-only (ไม่เขียนโค้ดในออดิต) · self-verified by orchestrator
> Verdict: **0 P0 · 31 P1 · 69 P2 · ทุก persona = CONDITIONAL** (ไม่มีตัวบล็อก · มีของควรแก้)

## 1. Executive summary
Pinpoint แข็งแรงในแกนหลัก: org isolation ถือจริง (ทุก query มี `.eq('org_id')`), bug_reports integration เป็น additive จริง, ภาพ best-effort ไม่บล็อกการเซฟหมุด, role gate อยู่ฝั่ง server. **ไม่มี security leak ข้ามบริษัท · ไม่มี P0.** แต่ออดิตเจอ **บั๊กความถูกต้องจริง 3 ตัว** (seq ชนกัน · ตัวนับเพี้ยน · finish ซ้ำได้) + **ปัญหาภาพหมุดเลื่อนตามจอ** + UX/access เล็กน้อย ที่ควรเก็บก่อนใช้หนัก

## 2. Scope
- **IN:** ทุกไฟล์ lib/pinpoint, overlay provider, 7 API routes, 3 หน้า, purge cron, migration, จุดเชื่อม (admin-shell/ai-chat/layout) — ~2,552 LOC
- **HW matrix:** ทุก finding = 🟢 **BUILDABLE_NOW** (ไม่มี hardware blocker)

## 3. 🔴 P1 — ควรแก้ (deduped จาก 31 → 9 ธีม)

### A. Data integrity (บั๊กจริง · ผู้ใช้เห็นผล)
| # | Issue | Evidence | Fix |
|---|---|---|---|
| **A1** | **seq หมุดชนกัน** — POST pins อ่าน `pin_count` แล้ว +1 (read-modify-write) ไม่มี UNIQUE(session_id,seq) ไม่ atomic → กดรัว/2 แท็บ = หมุดเลขซ้ำ + export เพี้ยน | `sessions/[id]/pins/route.ts` (BA·BE·QA·SA) | UNIQUE(session_id,seq) + atomic seq (หรือเลิกใช้ตัวนับ ใช้ `max(seq)+1`/count) |
| **A2** | **ตัวนับเพี้ยนตอนลบ** — `pin_count` ไม่ลดเมื่อลบหมุด → "พิมแก้แล้ว X/Y" ตัวหารผิด + badge จำนวนจุดผิด | `pins/[pinId]/route.ts` DELETE (BA·BE) | ลด pin_count ตอนลบ หรือคำนวณจากจำนวนจริง (ทิ้ง denormalized counter) |
| **A3** | **finish ไม่ idempotent** — check-then-act (อ่าน draft → insert bug → update) กันด้วย client busy flag เท่านั้น → finish พร้อมกันจริง = bug_reports ซ้ำใน /bugs | `sessions/[id]/route.ts:115` (BE) | conditional UPDATE (`status='draft'→'submitted'` ถ้าไม่โดน row = ไม่สร้าง bug) |

### B. Visual fidelity
| **B1** | **หมุดเลื่อนตามจอ** — เก็บพิกัด %ของ viewport + `position:fixed` ไม่ชด scrollY → หน้ายาว/เลื่อนแล้วหมุดหลุดจากเป้า (โครงหลัก "annotation") | PinMarker `:459` (FE·QC·QA·OWN) | เก็บพิกัดอิง document (clientX+scrollX) หรือผูก element rect · structured selector ยังชี้เป้าถูก ผมแก้ได้ |

### C. Navigation / access
| **C1** | nav "ติชม" โชว์ให้ admin-tier แต่หน้า super_admin-only → admin/org_admin กดแล้วเด้ง /dashboard | admin-shell + page.tsx (PM·IA·DEVIL) | gate nav เป็น super_admin **หรือ** ให้ author เห็น "session ของฉัน" |
| **C2** | author (admin-tier) สร้าง+ส่งได้ แต่ไม่มีหน้า list ของตัวเอง (เห็นได้แค่ super_admin) → หา session เก่าไม่เจอ | page.tsx redirect (PM·IA·MGR) | **ตัดสินใจ:** บีบ comment เป็น super_admin-only (ให้ตรงกับ reviewer) หรือเพิ่ม my-sessions |
| **C3** | session bar ทับปุ่ม AI ลอย บนจอ ~560-680px (แท็บเล็ต) → บังปุ่ม "เสร็จ" | provider session bar (QC) | เว้นที่/ขยับเมื่อชน FAB |
| **C4** | ปุ่ม toggle เขียนชื่อ "สถานะปัจจุบัน" ไม่ใช่ "การกระทำ" ("ปักหมุด"/"เลื่อนดู") → งง | provider (UX·STAFF) | เขียนเป็น action ที่จะเกิด + ป้ายโหมดเด่นตอน browse |

### D. Accessibility (A11Y)
- popover ไม่ใช่ dialog จริง (ไม่มี focus trap/Esc/aria-modal) · ปักหมุดด้วยคีย์บอร์ดไม่ได้ (pointer-only) · ไม่มี live region บอกสถานะโหมด → แก้ได้บางส่วน (focus trap + aria + Esc)

### E. SRE / ops
- **E1** purge cron ยิง batch เดียว `.limit(500)` ไม่มี loop → ถ้าค้าง >500 ภาพ/วัน ลบไม่หมด (PDPA backlog ค่อย ๆ โต)
- **E2** schedule drift: comment เขียน `0 19` แต่ vercel.json ลงจริง `0 20` (trivial · แก้คอมเมนต์)
- **E3** mark-fixed (service path ไม่ login) ไม่มี audit log

## 4. 🟡 P2 — polish / cleanup (เด่น ๆ จาก 69)
- **Dead code (DEVIL):** `wontfix` status ไม่มี UI ใช้ · `viewport_w/h` write-only ไม่เคยอ่าน · `fixed_commit_sha` เก็บแต่ไม่เคยแสดง · pin PATCH (แก้ comment/priority) ไม่มี UI เรียก → ลบหรือเดินสายให้ครบ
- **Resilience:** ภาพ upload fail = ไม่ retry · in-flight set ไม่ clear กรณี fail (QA) · draft comment ที่กำลังพิมพ์/พูด หาย ถ้าปิดแท็บ (ขัดคำว่า "ไม่หาย")
- **Mobile (OWN·MGR·STAFF):** มือถือ skip screenshot → review เห็น "ไม่มีภาพ" (รู้ทั้งทีม · by design) · touch target หลายปุ่ม <44px · voice ไทยไม่เห็นข้อความระหว่างพูด
- **IA:** ชื่อฟีเจอร์ไม่สม่ำเสมอ (ติชม/โหมดติชม/Pinpoint) · /bugs ไม่มีลิงก์ย้อนกลับไป session
- **QC:** SessionReview ไม่มี empty state ตอนลบหมุดหมด · marker urgent ใช้สีอย่างเดียว (ตาบอดสีแยกไม่ออก)

## 5. ✅ สิ่งที่ออดิตยืนยันว่า "ทำถูกแล้ว" (ไม่ต้องแก้)
- org isolation ถือจริงทุก route + data.ts (SA·SEC·BE) · ไม่มี cross-tenant leak
- ภาพ best-effort decouple สมบูรณ์ (ล้มแล้วหมุดยังเซฟ · QA)
- z-index band (9988-9995) ไม่ชนของเดิม · snapdom lazy จริง (FE)
- CRON_SECRET constant-time + fail-closed (SEC·SRE — จากรอบ review ก่อน)
- mark-fixed org-scoped ถูก (SEC) · voice handle start() throw ดี (QA)
- finish-twice กันได้ที่ data layer (409) · empty finish บล็อก 2 ชั้น (BA)

## 6. 🎯 Top 5 Decisions Needing CEO Eyes
1. **แก้ data-integrity trio (A1+A2+A3)** — owner: BE/BA · cost-if-wrong: **med** (ผู้ใช้เห็นเลขเพี้ยน/บั๊กซ้ำ) · 👉 แนะนำ **ทำ** (เล็ก, BUILDABLE_NOW)
2. **หมุดเลื่อนตามจอ (B1)** — owner: FE · cost-if-wrong: med (โครงหลัก "ภาพ annotation") · 👉 แนะนำ **ทำ** (selector ยังชี้ถูก แต่ภาพควรตรง)
3. **ใครใช้ Pinpoint ได้** — admin-tier เท่านั้น vs เปิดให้ ผจก.สาขา/พื้นที่ ติชมด้วย? · cost: high (เปลี่ยน gate) · 👉 **CEO เคาะ**
4. **มือถือไม่มีภาพ** — รับได้ (เบา) vs ลงทุนทำ capture มือถือ? · 👉 **CEO เคาะ** (ตอนนี้ review หมุดมือถือ "ไม่มีภาพ")
5. **author เห็น list ตัวเองไม่ได้ (C2)** — บีบ comment เป็น super_admin-only vs เพิ่ม my-sessions? · 👉 **CEO เคาะ**

## 7. Sign-off table
| Persona | Status | เงื่อนไขหลัก |
|---|---|---|
| ทั้ง 16 (PM·BA·SA·FE·BE·QA·QC·UX·IA·OWN·MGR·STAFF·DEVIL·SEC·A11Y·SRE) | 🟡 CONDITIONAL | แก้ data-integrity trio + marker scroll-drift + เคลียร์ access inconsistency → ผ่าน |
| BLOCKED | 0 | — |

## 8. แนะนำขั้นต่อไป
ออดิตนี้ spec-only ไม่แตะโค้ด · ของจริงที่ควรทำ = **fix-batch P1** (A1-A3 + B1 + C1/C3/C4) ทั้งหมด BUILDABLE_NOW เล็ก ๆ · เหลือ C2/มือถือ/ใครใช้ได้ = CEO เคาะ
