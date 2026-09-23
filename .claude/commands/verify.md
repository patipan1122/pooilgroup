---
description: ด่านตรวจก่อนขึ้น production (typecheck + build + smoke test) — ห้ามบอก "เสร็จ" ก่อนผ่านครบ
---

ตรวจ 4 ด่านก่อนบอกว่าโค้ดพร้อมขึ้น production **ห้ามข้ามด่านไหน ห้ามสรุปเองว่าผ่าน**

รันจาก repo root: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web`

### 1. Typecheck — ด่านสำคัญที่สุด
```
./node_modules/.bin/tsc --noEmit
```
- ⚠️ **ต้องใช้ `./node_modules/.bin/tsc` เท่านั้น** — `pnpm exec tsc` bail เงียบด้วย ERR_PNPM_IGNORED_BUILDS แล้วรายงาน "0 errors" ปลอม (memory: `feedback-pnpm-exec-tsc-false-negative`)
- ⚠️ **ห้าม wrap ด้วย `timeout`** — macOS ไม่มีคำสั่งนี้ → ล้มเงียบ → false clean (memory: `macos-no-timeout-false-clean-tsc`)
- ⚠️ `pnpm build` **ไม่ได้รัน tsc** → import ที่หายไปจะรอดขึ้น prod แล้วค่อย crash ตอน user เปิดใช้ (memory: `clawfleet-refill-flow-refillonly-mirror-and-tsc-lesson`) — ด่านนี้คือด่านเดียวที่จับได้

### 2. Build (รวม prisma generate + schema guard)
```
pnpm build 2>&1 | tail -25
```
- ถ้า `check-schema-applied.mjs` fail = migration ยังไม่ apply บน prod → **หยุด** แจ้ง CEO ให้ apply ก่อน (memory: `wave-migration-written-not-applied-trap`)

### 3. ไฟล์ค้าง — ของที่เทส ≠ ของที่ push
```
git status --porcelain
```
- ต้องว่าง ถ้ามีไฟล์ค้าง = build ผ่านเครื่องเราแต่พังบน Vercel เพราะไฟล์ไม่ได้ commit (memory: `setup-build-broken-by-uncommitted-imported-files`)

### 4. Smoke test หน้าจริงบน prod
```
for p in / /chairops /clawfleet /dc /rentspace; do code=$(curl -sI -o /dev/null -w "%{http_code}" "https://pooilgroup.vercel.app${p}"); echo "$p → $code"; done
```

### 5. ประทับตราผ่านด่าน — ทำเป็นขั้นสุดท้ายเท่านั้น
**เฉพาะเมื่อข้อ 1-4 ผ่านครบจริง** (ไม่ใช่ "ผ่านโดยประมาณ") จึงรัน:
```
git rev-parse HEAD > "$(git rev-parse --absolute-git-dir)/.claude-verified"
```
ตรานี้ผูกกับ commit ปัจจุบัน · แก้โค้ดเพิ่ม = ตราหมดอายุทันที ต้อง verify ใหม่
ด่าน `verify-gate.py` จะบล็อก `git push` ขึ้น setup ถ้าไม่มีตรานี้

---

รายงานเป็นตาราง:
| ด่าน | ผล | หมายเหตุ |
|---|---|---|
| Typecheck | ✅/❌ | จำนวน error |
| Build | ✅/❌ | routes / schema guard |
| ไฟล์ค้าง | ✅/❌ | กี่ไฟล์ |
| Smoke test | ✅/❌ | route ไหนไม่ 200 |
| ประทับตรา | ✅/⛔ | ⛔ ถ้ายังไม่ผ่านครบ |

**ถ้าด่านไหนไม่ผ่าน → แก้ก่อนจบ turn · ห้ามบอก "เสร็จ" · ห้ามประทับตรา · ห้ามใช้ VERIFY_SKIP=1 เองโดยไม่ถาม CEO**
