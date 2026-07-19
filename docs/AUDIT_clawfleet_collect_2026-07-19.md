# AUDIT — ClawFleet เก็บเงิน + ประวัติ + ตั้งค่าตู้ (2026-07-19)

**โหมด:** Full audit · 10 persona (OWN·STAFF·MGR·FIN·AUD·SA·BE·UX·QA·DEVIL) ทดสอบใช้จริงบน `origin/setup 39ae9baa`
**Trigger:** CEO เจอปัญหาจากการทดสอบจริงบน prod (screenshots) → `/auditbigteam`
**ผล:** แก้ display-layer ล้วน (0 migration · ไม่แตะ money contract submitBranchEvent) branch `claude/clawfleet-audit-2026-07-19`

---

## §1 Executive summary

CEO ทดสอบเก็บเงินจริง เจอ 4 ปัญหา → ทีม 10 persona ยืนยัน root cause ครบ + เจอเพิ่มอีกหลายจุด. ปัญหาแกน = **สถานะ "เก็บแล้ว" คิดจากประวัติ 45 วันโดยไม่กรองวัน** → ตู้ที่เก็บเมื่อวาน/40 วันก่อนขึ้น "เก็บแล้ว" วันนี้ → **พนักงานข้ามเก็บ = เงินตกหล่นจริง** (ทุก persona ให้ P0).

## §2 Scope

- **IN:** สถานะตู้หน้าหลัก · progress bar · ประวัติเก็บ (list+detail) · ปุ่มดูใบ/เก็บซ้ำ · มิเตอร์ในใบ · marker leak
- **OUT/DEFER:** schema rollup (YAGNI ตาม SA/Devil) · แก้รายการที่กรอกผิด · ประวัติข้ามคน (ผจก.ดูของลูกน้อง) · once-per-day DB guard · ย้าย clientKey ออกจาก notes → column+index

## §3 ปัญหา + fix (deployed ในรอบนี้)

| # | ปัญหา (persona) | severity | root cause | fix |
|---|---|---|---|---|
| 1 | ตู้เก็บวันก่อนยังขึ้น "เก็บแล้ว" · เก็บซ้ำ/ข้ามวันไม่ได้ (ทุกคน) | P0 | `doneCodesToday` วน history 45 วัน ไม่กรองวัน (`staff-app-client.tsx:1751`) | กรอง `h.date === todayYmd` (server Bangkok) + ปุ่ม "เก็บซ้ำ" บนตู้ done |
| 1b | เก็บซ้ำ → progress ทะลุ 100% (Devil/AUD) | P0 | `closedTodayCount` นับ event ไม่ใช่ตู้ (`page.tsx:137`) | `groupBy machineId` → นับ distinct ตู้ |
| 4 | `[BASELINE_KEY]…` leak ในหมายเหตุ + `[OVERRIDE]` ทิ้งทั้งโน้ต (FIN/AUD/QA) | P1 | filter จับแค่ substring (`page.tsx:197`) | `cleanNote()` replace เฉพาะ token · เก็บข้อความจริง |
| 3 | "ดูใบ" เด้งเข้า list ไม่ใช่ใบตู้นั้น (ทุกคน) | P1 | `setPanel("history")` (`:1903`) | `openDocFor(code)` เปิด detail รอบล่าสุดวันนี้เลย |
| 2 | ใบเก็บเห็นมิเตอร์เดี่ยวไร้ความหมาย · ไม่มี บน/ล่าง · ไม่มี before/เติม (FIN P0·UX P0) | P1 | loader ไม่ select 4 มิเตอร์กายภาพ + before (`page.tsx:168`) | select เพิ่ม → `MeterDetailRow` โชว์ ก่อน→หลัง(+delta) + บน/ล่าง + เติม |
| H | take:80 ตัดประวัติเงียบ (SA/BE/OWN) | P2 | limit ต่ำ | ยก 80→150 · swap 200→400 |

## §4 Top 5 Decisions Needing CEO Eyes (ต้อง CEO เคาะ)

1. **เก็บซ้ำ/วันแบบไม่จำกัด** — ผมเปิดปุ่ม "เก็บซ้ำ" + progress นับ distinct ตู้ (บาร์ไม่โป่ง). แต่ AUD เตือน: ไม่มีด่าน DB กัน 2 รอบ/วัน = ช่องยักยอกถ้าคนไม่ตรวจ. ☐ โอเคเปิดเสรี / ☐ อยากได้ "ยืนยันก่อนเก็บซ้ำ" / ☐ จำกัด 1 รอบ/วัน
2. **"ตรง/ไม่ตรง" หลอกตา** (FIN P0) — ป้าย "ตรง" = ไม่มี anomaly flag ไม่ใช่ "เงินตรงมิเตอร์จริง". ☐ เปลี่ยนนิยามเป็น cash เทียบ meter delta / ☐ คงไว้
3. **ประวัติข้ามคน** (MGR/AUD) — ตอนนี้ query `collectedById=userId` เห็นแค่ของตัวเอง → ผจก./กะถัดไปเช็คงานคนอื่น + กันเก็บซ้ำข้ามกะไม่ได้. ☐ ทำ view ผจก. / ☐ ทีหลัง
4. **แก้รายการที่กรอกผิด** (STAFF/UX) — พิมพ์เงิน/มิเตอร์พลาด แก้ไม่ได้ (แนบรูปได้อย่างเดียว). ☐ ทำปุ่มแก้/ยกเลิกรอบ / ☐ ทีหลัง
5. **clientKey ใน notes = fake-safety** (AUD/SA · [[fake-safety-idempotency-helper-no-db-column]]) — idempotency จริงคือ unique index ที่ DB. ควรย้าย clientKey → column + index. ☐ ทำ migration / ☐ คงไว้ (มี unique หนุนอยู่)

## §5 Persona sign-off

| Persona | Status | เงื่อนไข |
|---|---|---|
| OWN | ✅ | fix #1+progress = trust กลับมา · เหลือ alert ตู้ถูกข้าม (P1 defer) |
| STAFF | ✅ | เก็บซ้ำได้ + ดูใบตรง · เหลือแก้รายการผิด (defer) |
| MGR | 🟡 | ประวัติข้ามคน ยังไม่ทำ (decision #3) |
| FIN | 🟡 | มิเตอร์ครบแล้ว · "ตรง" นิยาม + before-cross-check ยัง (decision #2) |
| AUD | 🟡 | marker + date fix แล้ว · once-per-day guard เป็น decision #1 |
| SA | ✅ | display-layer 0 migration ตามแนะนำ |
| BE | ✅ | surgical ครบ · `!= null` ทุกจุด |
| UX | ✅ | MeterDetailRow ตาม layout · list-1-visit เหลือ polish |
| QA | 🟡 | edge case หลักครอบ · tie-break/minute-merge เป็น P2 |
| DEVIL | ✅ | ไม่ทำ rollup/schema (YAGNI) · progress distinct กัน double-count |

## §6 ที่ยังไม่ทำ (defer · flag)
baseline photosMissing=false เสมอ · swap ok:true เสมอ · swap group-by-minute เปราะ · sort tie-break · CF collection ไม่มี audit_log (มีแค่ baseline)
