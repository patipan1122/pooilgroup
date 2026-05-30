# CLAWFLEET_GO_LIVE.md — Runbook สำหรับ deploy ตู้คีบ v2

> ใช้เอกสารนี้ตอน merge `claude/clawfleet-prod-redesign` → `setup` → ขึ้น prod
> ผู้ทำ: CEO (Pattipan) — มี action ที่ Claude ทำเองไม่ได้

---

## 🎯 สรุปสั้น

ตู้คีบ v2 redesign **เขียนเสร็จ + commit แล้วทั้งหมด** บน branch `claude/clawfleet-prod-redesign`.
ก่อน live ต้องทำ 4 ขั้น (รวม **~10 นาที**):

1. **Apply migration** บน production DB (Supabase)
2. **`npm run build`** ใน main repo (validate)
3. **Merge + push** เพื่อให้ Vercel deploy
4. **ทดสอบบนมือถือจริง** 1 รอบเก็บเงิน

---

## 📦 สิ่งที่ branch นี้มี

### Commits (เรียงจากเก่า → ใหม่)
- `cb29724` backend (3 server actions + 2-way cross-check)
- `73662bb` staff collect flow 5 ขั้น
- `a1b86d1` ปุ่ม dead button + CSV + PDF
- `00bd80a` promote v2 → main /clawfleet
- `a3f2c26` fix icon imports (PackageOpen/UsersIcon)
- `f1a8170` Team/Audit/Settings pages
- `32b6098` docs/MODULE_GUIDE.md + setup-worktrees.sh
- `<this>` docs/CLAWFLEET_GO_LIVE.md + nav roles fix

### ฟีเจอร์
| สิ่งที่ใช้ได้ | URL |
|---|---|
| Hub ตู้คีบ | `/clawfleet/v2/hub` (or just `/clawfleet`) |
| ฟอร์มเก็บเงินพนักงาน (5 ขั้น · 5 รูป) | `/clawfleet/v2/collect` |
| Anomaly review | `/clawfleet/v2/anomalies` |
| Stock + reorder + CSV | `/clawfleet/v2/stock` |
| Operations + เริ่มรอบ | `/clawfleet/v2/operations` |
| Insights + CSV + range + tabs | `/clawfleet/v2/insights` |
| Team & สาขา | `/clawfleet/v2/team` |
| Audit log | `/clawfleet/v2/audit` |
| Settings | `/clawfleet/v2/settings` |

---

## 🚀 ขั้นตอน deploy (copy-paste ได้เลย)

### ขั้น 1 — Apply migration บน production (5 วินาที)

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web

# ตรวจ env ว่ามี DATABASE_URL ของ prod
echo $DATABASE_URL | head -c 30 ; echo ...

# Apply
psql "$DATABASE_URL" -f supabase/migrations/20260528000001_clawfleet_v2_branch_model.sql
```

**Verify migration applied:**
```bash
psql "$DATABASE_URL" -c "\d cf_collection_sessions" | grep -E "branch_id|expected_cash_cents|prize_meter_out"
# ควรเห็น 3 column นี้ — ถ้าเห็น = migration applied แล้ว
```

**ถ้าเด้ง error "column already exists"** = อยู่แล้ว ข้ามไปขั้น 2 ได้

---

### ขั้น 2 — Build + verify (3 นาที)

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web
git fetch
git checkout claude/clawfleet-prod-redesign
git pull
npx prisma generate           # รีเฟรช Prisma client ให้ตรง schema
npm run build                 # ต้องผ่าน (เขียวทั้งหมด)
```

**ถ้า build เขียว** → ไปขั้น 3
**ถ้า build แดง** → ส่ง error ให้ผม ผมแก้ทันที

---

### ขั้น 3 — Merge + deploy (1 นาที)

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web
git checkout setup
git pull
git merge claude/clawfleet-prod-redesign --no-ff -m "merge: ClawFleet v2 redesign (production)"
git push
# → Vercel auto-deploy เริ่มทันที (ดู https://vercel.com/<your-team>/pooilgroup-web)
```

**Verify deploy:**
- เปิด https://pooilgroup.vercel.app/clawfleet → ควรเด้งเข้า `/clawfleet/v2/hub` อัตโนมัติ
- ถ้าเด้ง 500 → ดู Vercel logs ส่ง error ให้ผม

---

### ขั้น 4 — ทดสอบมือถือจริง (5 นาที)

**ก่อนเริ่ม:** ต้องมี **branch ที่มี `businessType='claw_machine'`** ในระบบ + ตู้คีบ (CfMachine `kind=CLAW`) อย่างน้อย 1 ตู้

ถ้ายังไม่มี:
```bash
# (run from main repo · session)
npm run tsx scripts/seed-clawfleet-demo.ts
# → จะสร้าง 3 branches/20 machines (เป็น demo data ทดสอบ)
```

**ทดสอบ flow:**
1. เปิด https://pooilgroup.vercel.app/clawfleet/v2/collect บนมือถือ
2. **เลือกสาขา** → เด้งเข้ารายการตู้ → กดปุ่ม "กรอก →" บนตู้แรก
3. **ขั้นที่ 1 นับตุ๊กตาก่อนเติม** — ใส่จำนวน 16 (สมมุติ) → ถ่ายรูป
4. **ขั้นที่ 2 มิเตอร์ + เงิน:**
   - กดถ่ายมิเตอร์เหรียญ + พิมพ์เลข (เช่น 14708 จากเดิม 14600 = +108 ครั้ง × ฿10 = ฿1,080)
   - กดถ่ายมิเตอร์ตุ๊กตา + พิมพ์เลข (เช่น 988 จากเดิม 980 = +8 ครั้ง)
   - พิมพ์เงินสด 1080 + ถ่ายรูปเงิน
   - ระบบควรขึ้น "🟢 ตรง"
5. **ขั้นที่ 3 เติมตุ๊กตา:**
   - เลือก SKU จาก dropdown
   - ใส่ "เติมกี่ตัว" (เช่น 6)
   - ใส่ "ตุ๊กตาในตู้หลังเติม" (เช่น 22 = 16-8+6=14... สมมุติแต่ค่า)
   - ถ่ายรูปหลังเติม
6. กดบันทึก → ควรเด้งกลับรายการตู้ ตู้แรกเป็น ✓ เสร็จ
7. (กรอกตู้ที่เหลือเหมือนกัน หรือทดสอบ 1 ตู้ก็พอ)
8. กด **"ปิดรอบ + cross-check"** → ดูผล:
   - ถ้าทุกตู้เก็บครบ + ตรง → ขึ้น "ปิดรอบเรียบร้อย"
   - ถ้าไม่ตรง → ขึ้น "ส่งให้เจ้าของตรวจ" + ดู `/clawfleet/v2/anomalies`

**ผ่าน checklist:**
- [ ] เลือกสาขาได้
- [ ] เริ่มรอบได้ (เห็นรายการตู้)
- [ ] กรอก 1 ตู้ครบ 5 รูปได้
- [ ] cross-check live preview ทำงาน (ตัวเลขขึ้นถูก)
- [ ] บันทึก 1 ตู้ได้ (กลับมารายการเห็น ✓)
- [ ] ปิดรอบได้ (เห็นผล)
- [ ] anomaly review เห็นรอบที่ปิด

---

## ⚠️ ถ้าเจอปัญหา

| อาการ | สาเหตุน่าจะ | แก้ |
|---|---|---|
| เปิด `/clawfleet` แล้วเด้งไป `/clawfleet/dashboard` (v1) | ยังไม่ deploy หรือ build ไม่มี landing redirect | redeploy / ตรวจ commit f1a8170 อยู่บน setup ไหม |
| `/collect` เปิดได้ แต่ไม่เห็นสาขา | user ไม่มี `UserBranch` linkage กับ claw_machine branch | ไปสร้าง user-branch link ใน admin หรือใช้ super_admin |
| กดบันทึก 1 ตู้ → error "column ... does not exist" | ยังไม่รัน migration | ทำขั้น 1 ก่อน |
| รูปอัพไม่ได้ | R2 env หาย | ตรวจ R2_*ENV vars บน Vercel |
| Cross-check ผิดเลข | logic bug | screenshot ส่ง ผมตามแก้ |

---

## 🔄 Rollback (ถ้าต้องการ)

ถ้า deploy แล้วพังเยอะ:
```bash
git checkout setup
git revert HEAD --no-edit       # revert merge commit
git push
# → Vercel auto-deploy back to v1
```

v1 routes (`/clawfleet/dashboard`, `/sessions`, `/machines`, ฯลฯ) ยังครบ — ใช้งานต่อได้จน fix เสร็จ

---

## 📞 ติดต่อ Claude (ผม) ถ้าติด

ขั้นใดติด ส่ง:
- ข้อความ error เต็ม
- screenshot
- คำสั่งที่รัน

ผมตามแก้ตอนนั้นได้
