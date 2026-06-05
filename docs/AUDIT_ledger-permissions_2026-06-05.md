# AUDIT — LedgerLine ระบบสิทธิ์ + ตัวตนผู้ใช้ (identity) ข้าม LINE / LIFF / เว็บ

> /auditbigteam · 2026-06-05 · 10 personas (SA·SEC·BE·BA·DEVIL·OWN·FIN·STAFF·UX·SRE) + synthesis
> Workflow run `wf_103cdf44-dad` · 11 agents · ~1.6M tokens · 12.5 min
> Trigger: CEO (pimm = super_admin) กดปุ่มแก้ไขใบเสร็จใน LINE → "บัญชียังไม่เปิดใช้งานสำหรับคุณ" ทั้งที่บอทรู้จักเขา

---

## §1 Executive Summary

โปรแกรมบัญชี LedgerLine มี **3 ช่องทาง** (บอท LINE / มินิแอป LIFF / เว็บ back-office) แต่ **ไม่มี "ความจริงเดียว" ว่า LINE คนนี้ = พนักงานคนไหน** — แต่ละช่องทางไปถามตัวตนคนละที่ จึงทะเลาะกันว่าใครเป็นใคร

**Root cause (ยืนยัน 10/10 persona จากโค้ดจริง):** LINE ออก "บัตรประชาชนดิจิทัล" (userId) ให้คนคนเดียว **2 ใบ** — ใบหนึ่งจากช่อง Messaging OA (`2007211439`, ที่บอทเห็น) อีกใบจากช่อง Login/LIFF (`2010283514`, ที่มินิแอปใช้) เพราะสองช่องนี้อยู่ **คนละ LINE provider**. การผูกบัญชีเดิม (`linkLineMemberToMe`) เก็บใบฝั่งบอท → บอทเลยจำเจ้าของได้ แต่มินิแอปเทียบด้วยใบฝั่ง Login ที่เป็นคนละค่า → หาไม่เจอ → ตกไป fallback (ChairOps maid / needsLink) → `resolveLedgerActor()` คืน null → เด้ง error

**กระทบกฎ CEO ทั้ง 2 ข้อ:**
1. super_admin ต้องไม่ถูกบล็อก → พังที่ชั้น identity ก่อนถึงชั้น role ด้วยซ้ำ (ไม่มี escape-hatch)
2. super_admin ตั้งแอดมินให้คนอื่นได้ (top-down) → **ไม่มีในโค้ดเลย** มีแค่ self-claim

---

## §2 Findings (14 · เรียงตามความรุนแรง)

### 🔴 P0 (บล็อกเจ้าของ / ช่องโหว่ความปลอดภัย)
| # | ปัญหา | ที่ |
|---|---|---|
| 1 | **messaging userId ≠ login-channel sub (คนละ provider)** → super_admin ถูกบล็อกที่ LIFF | `line-login/route.ts:255-265,358-364` · `liff-auth.ts:48-54` · `_actions.ts:1499-1502` · `channels.ts:39-41` |
| 2 | **ChairOps maid fallback ไม่มี org/module scope** → เจ้าของถูก downgrade เป็นแม่บ้านทั้งระบบ (เป็นทั้ง stale-session + ช่องโหว่ cross-module) | `line-login/route.ts:374-405` · `channels.ts:45-51` (ledger login secret fallback ไป CHAIROPS_*) |
| 3 | **linkLineMemberToMe ผูก LINE id ที่ไม่ได้พิสูจน์ + ไม่แก้ LIFF (false-fix)** — แอดมินหยิบ LINE ของใครมาผูกก็ได้ ไม่มี id_token challenge | `_actions.ts:1475-1520` |
| 4 | **super_admin ไม่มี escape-hatch ที่ระดับ identity** — กฎ CEO ข้อ 1 ถูกฝ่าฝืนทุกหน้า LIFF | `liff-auth.ts:32-49` · `admin/page.tsx` |
| 5 | **ไม่มี top-down admin assignment** — มีแค่ self-claim (กฎ CEO ข้อ 2 ขาดทั้งดุ้น) | `_actions.ts:1475-1508` · `setMemberRole:1352-1382` |

### 🟡 P1 (พังต่อ role จริง)
| # | ปัญหา | ที่ |
|---|---|---|
| 6 | ledger role assignment ไม่มี role-rank guard → ปั้น 'admin' (เปิดทุก money capability) ได้อิสระ = privilege escalation | `_actions.ts:1202,1352-1382,1221-1268` |
| 7 | **ระบบสิทธิ์การเงิน 2 ชั้น diverge**: เว็บ gate ด้วย Pool role, `can()` matrix เป็น no-op ฝั่งเว็บ (export/view_pnl ไม่มี call site) → toggle "สิทธิ์" บนคอนโซลเป็นของประดับ | `can()` เรียกแค่ `liff-auth.ts:56-57` · web confirm:221/bulk:337/export:582/TRCloud:754,788 |
| 8 | member ซ้ำ/ตัวตนแตก: webhook seed ด้วย messaging id, invite-accept ด้วย login-sub → 1 คน 2 แถว → สาขาที่กำหนดไม่ตรงกับที่ LIFF อ่าน | `members.ts:74-83` vs `api/ledger/invite/accept` |
| 9 | role `external_accountant` เข้าเว็บไม่ได้ + ไม่เคยได้ "ดู+ส่งออกเท่านั้น" ตามดีไซน์ (ไม่มีใน Pool UserRole) | `expenses/page.tsx` · `dashboard/page.tsx:61-67` · `liff-auth.ts:40-45` |
| 10 | พนักงานสาขา (LINE ล้วน ไม่มี Pool row) เปิด LIFF ไม่ได้เลย → needsLink ตลอด → ฟีเจอร์ "ถ่าย→แก้→ยืนยัน" พังตั้งแต่ประตูแรก | `line-login/route.ts:358-426` (ไม่มี path มินต์ session ให้ ledger_line_member) |

### 🟢 P2 (friction / รั่วเล็ก)
| # | ปัญหา | ที่ |
|---|---|---|
| 11 | นิยาม "แอดมิน" ไม่ตรงกัน 3 จุด: บอทรับ viewer/area_manager แต่ LIFF console รับแค่ isAdminTier → /drive รั่วให้ role ที่เว็บถือว่าต่ำกว่า | `line-commands.ts:80` vs `admin/page.tsx` vs `liff-auth.ts:40` |
| 12 | per-company member scope trap + disabled member ยังหลุดถามยอดใน group Q&A บริษัทอื่น | `members.ts:74-83` · webhook gate · `liff-auth.ts:50-54` |
| 13 | setup doc + `.env.example` ไม่บอกให้ตั้ง Login channel ใต้ provider เดียวกัน + silent env fallback ไป CHAIROPS_* | `LEDGER_LINE_SETUP.md` · `.env.example` · `channels.ts:45-51` |
| 14 | 1:1 chat capture เปิดกว้าง (คนนอกสร้าง draft ได้) + iOS WKWebView cookie-drop ทำ spinner ค้างไม่มีปุ่มลองใหม่ | webhook `route.ts:601-610` · `expense/[id]/page.tsx:35-47` |

---

## §3 Recommended Fix Plan (4 ส่วน)

### A) UNBLOCK เจ้าของวันนี้ — band-aid ปลอดภัย ไม่ต้อง migration · effort M
1. `line-login/route.ts`: ก่อน fallback ChairopsUser (`:374`) ถ้า `lineModule==='ledger'` **ห้าม** resolve เป็น maid / selfRegister → กัน stale-maid session กลืนเจ้าของ
2. เพิ่ม `POST /api/ledger/admin/claim-line`: `requireRealRole('super_admin')` → รับ idToken จาก LIFF → `verifyLineIdToken(loginChannelIdForModule('ledger'))` → เขียน `users.line_user_id = verified.sub` ให้ตัวเอง → เจ้าของกดยืนยันใน LIFF ครั้งเดียว ได้สิทธิ์ทั้งบอท+LIFF โดย **พิสูจน์ตัวจริง** (ไม่ใช่หยิบ id คนอื่น)

### B) FIX ถาวร — CONFIG-FIRST (ทางหลัก) · effort S
- ใน **LINE Console**: สร้าง Login channel + LIFF app ใต้ **provider เดียวกับ Messaging OA** ของ ledger → อัปเดต `NEXT_PUBLIC_LEDGER_LIFF_ID` + `LEDGER_LINE_LOGIN_CHANNEL_SECRET` ใน Vercel
- ผล: provider เดียว → LINE ออก userId ใบเดียว → `sub == messaging id == users.line_user_id` → ไม่ต้องแตะ resolve logic
- **VERIFY**: หลัง re-login เทียบ `users.line_user_id` (super_admin) กับ `ledger_line_member.line_user_id` ต้องเท่ากัน + `/api/auth/whoami` role ถูก
- ⚠️ ถ้าสร้าง Login channel ใหม่ LIFF id เปลี่ยน → ต้องอัปเดต Endpoint/Rich Menu/deep-link + คนที่ผูก id เก่าต้อง re-link รอบเดียว
- Fallback ถ้าย้าย provider ไม่ได้: เพิ่มคอลัมน์ `users.line_login_sub` แยก + resolve ทั้งสอง id

### C) TOP-DOWN admin assignment (CEO req 2) · effort L
- `promoteMemberToAdmin(memberId, targetPoolUserId?)`: ผูก `member.poolUserId = target` (ไม่ใช่ผู้กด) + ถ้า target ยังไม่มี Pool user → สร้าง `program_admin` ของ ledger
- ห้ามเดา LINE id คนอื่น → ใช้ **scoped invite** (ต่อยอด `createLedgerInvite` ให้ pre-assign role+poolUserId, single-use, first-tap binds) → ปลายทางกดลิงก์ → `verified.sub` ผูกกับ pool_user_id ที่เจ้าของกำหนด
- บังคับ `canAssignRole`/role-rank guard (admin ห้ามปั้น super_admin) + audit ทุกครั้ง

### D) ต่อสาย can() ให้เป็น gate จริง + รวมนิยาม "แอดมิน" + กัน /drive รั่ว · effort M
- resolver กลางคืน `{role, can:Set}` ใช้ทั้งเว็บ/LIFF → แทน `isAccountant()` ที่ confirm/bulk/export/TRCloud ด้วย `can(...)` ที่ตรง capability **โดยคง super_admin/admin-tier bypass เสมอ** (กัน req 1)
- `isLedgerAdminActor(session)` ตัวเดียวเรียกจาก 3 จุด ลด drift · จำกัด /drive เฉพาะ admin-tier · `external_accountant` default `scope.all_branches=false`

---

## §4 Top 5 Decisions Needing CEO Eyes

1. **เส้นทาง FIX ถาวร: CONFIG (LINE Console, ถูก+คลีน แต่ต้องแตะ Console + re-link) vs CODE (เพิ่มคอลัมน์ login_sub, ไม่แตะ Console)** — blast radius สูง · CEO action: เลือก
2. **super_admin escape-hatch ที่ระดับ session** (ผ่านทุกหน้าโดยไม่สน LINE id) — ต้องยอมรับว่า "ถ้าล็อกอินเว็บเป็น super_admin ได้ = ผ่านทุกอย่าง" · cost-if-wrong: med
3. **top-down assign แบบ invite-link (ปลอดภัย) vs จิ้มเลือก member ตรง ๆ (เสี่ยง takeover)** — SEC แนะ invite · CEO action: approve invite-based
4. **ปิดช่องโหว่ /drive + can() จริง** อาจกระทบ viewer/area_manager ที่เคยเห็นข้อมูลการเงิน — ยอม tighten ไหม · cost-if-wrong: med (อาจมีคนใช้อยู่)
5. **band-aid A ก่อนเลยวันนี้ ไหม** (deploy เร็ว ปลดล็อกเจ้าของ) แล้วค่อยทำ B/C/D ตามมา · recommended: ใช่

---

## §5 Persona Sign-off (focused audit · identity/permission only)

| Persona | Status | เงื่อนไข |
|---|---|---|
| SA · SEC · BE · BA · DEVIL · OWN · FIN · STAFF · UX · SRE | ✅ PASS (วินิจฉัยตรงกัน) | root cause ยืนยัน 100% จากโค้ด · ทุกคนเห็นด้วยว่า config-first + super_admin bypass คือเส้นถูก |

หมายเหตุ: นี่เป็น **audit เจาะ identity/permission** ไม่ใช่ full UX redesign — ไม่มี wireframe/mockup phase (ไม่จำเป็นกับ scope นี้)

---

## §6 Open Questions / Risks
- ต้องมีสิทธิ์ owner ใน LINE Console เพื่อทำ config-fix (B) — ใครถือ?
- การย้าย/รวม provider อาจทำให้ LIFF id เปลี่ยน → ผู้ใช้ที่ผูกแล้วต้อง re-link รอบเดียว
- band-aid #1 (ห้าม ledger ตกเป็น maid) ต้อง regression-test flow maid ChairOps ที่ใช้ line-login เดียวกัน
