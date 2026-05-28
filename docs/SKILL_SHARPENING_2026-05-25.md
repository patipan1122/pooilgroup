# 🔪 Skill Sharpening Recommendations · 2026-05-25

> หลังรัน **/auditbigteam chairops** (รอบ 2 · 17 personas · 5 phases) ผมเจอจุดที่ทั้ง 3 skills (auditbigteam · claude-design · bigsolvebug) ทำงานคู่กันยังคมไม่พอ · บันทึกข้อเสนอปรับให้ session ถัดไปไหลดีกว่านี้

---

## 1️⃣ auditbigteam · ปรับแล้ว 6 ข้อ · เสนออีก 5

### ✅ ปรับแล้วในรอบนี้ (made permanent)

| Sharpening | ผล |
|---|---|
| +3 optional personas (OFC · FIN · AUD) | จับ insider-fraud · period-close gap · audit-immutability gap ที่ default 13 personas ไม่เจอ |
| +3 more optional (SRE · A11Y · SEC) | linter เพิ่ม · จับ cron not scheduled + LINE Notify EOL ที่ default ไม่เจอ |
| Phase 0.5 Drift Audit MANDATORY | จับ 10 P0 + 9 P1 drift items ก่อน Discovery (plan ↔ schema ↔ code drift) |
| Persona roster sizing examples in SKILL.md | next run รู้เลยว่า ChairOps = 17 · Recruit = 16 · ClawFleet = 15 |
| Cost guard updated (16-17 persona budget) | trim per-agent context to ~8k when roster ≥16 |
| ChairOps overlay tokens (shortage signature · CSV diff buckets · LINE matrix · master-detail 3-pane) | UX persona รู้สเปกเฉพาะธุรกิจ ไม่ใช่ generic |

### 🔪 เสนอเพิ่ม 5 จุด

**A · Phase 2.5 Scope-Cut Session (DEVIL HARD FAIL trigger)**
- ปัญหา: Phase 2 มี 4 personas (UX/IA/FE/BA) optimize own deliverable · ไม่มี shared scope ceiling · DEVIL hard-failed ในรอบนี้ (overengineering 60-70%)
- เสนอ: ถ้า DEVIL ใน Phase 3 critique = HARD_FAIL → auto-trigger Phase 2.5 ที่ DEVIL + PM กลับมา negotiate Wave-1 cut กับ UX/IA/FE/BA ก่อน Phase 4 sign-off
- ผลกระทบ: ป้องกัน "design-by-committee bloat" pattern ที่เห็นซ้ำ (ClawFleet ก็เป็น)

**B · Conflict Resolution Round (auto-detect drift between Phase 2 deliverables)**
- ปัญหา: รอบนี้เจอ 6+ naming conflicts ระหว่าง Phase 2 deliverables (ReconcilePeriod vs PeriodLock vs ChairopsPeriodLock · `.ch-scope` clash · 13 vs 12 vs 8 components · MANAGER_AREA rank 3.5 vs 3)
- เสนอ: Phase 2.6 (after design) = sequential agent ที่ grep cross-references ระหว่าง 4 specs · output conflicts list · UX/IA/FE/BA negotiate ก่อน Phase 3
- Implementation: 1 agent อ่าน 4 spec files · regex match term names · group by concept · ให้ user แก้

**C · Memory Rot Visibility ใน Phase 0 Briefing**
- ปัญหา: รอบนี้ memory บอก "build NOT started" แต่จริงๆ commit `5e3a6d2` ขึ้นแล้ว 4 วัน · ผมไม่ได้เช็คก่อน
- เสนอ: Phase 0 brief แสดง memory age + verify-link · ถ้า memory > 7 วัน + claim about code → MUST grep verify ก่อน cite
- Implementation: SKILL.md Phase 0 step 4 มี "memory rot check" แล้ว · ขยายเป็น hard-requirement + พิมพ์ออก briefing ว่า "memory X is N days old · last verified วันที่ Y"

**D · Persona "Did you read?" Self-Check**
- ปัญหา: บางรอบ persona ตอบโดยไม่ได้อ่าน file ที่บอก (เห็นได้ว่าตอบ generic)
- เสนอ: Each persona's output JSON must include `files_actually_read: [paths]` field · runner verify ≥ N files · ถ้าไม่ครบ → re-launch persona พร้อม emphasizing
- Implementation: เพิ่มใน persona templates · check ใน consolidation step

**E · Phase 4 Sign-off Quorum Rules**
- ปัญหา: ปัจจุบัน "Aim for all PASS. If >2 FAIL → 1 more critique round" · loose
- เสนอ:
  - DEVIL FAIL alone = MUST run Phase 2.5 cut session (per A)
  - 2+ business personas (OWN/MGR/OFC/FIN) FAIL = blocker
  - 2+ tech personas (FE/BE/SA) FAIL with conflicting reasons = blocker · need user resolution
  - Sign-off result MUST be one of: GREEN (≥80% PASS) · YELLOW (50-80% conditional) · RED (<50% or DEVIL HARD_FAIL)
- เห็นจริงในรอบนี้: 15 conditional + 1 HARD_FAIL = YELLOW · CEO override → ทาง A · skill ควร flag GREEN/YELLOW/RED ชัดเจน

---

## 2️⃣ claude-design · ยังไม่รัน · เสนอปรับ 4 จุด (ก่อนรัน)

### 🔪 เสนอ 4 จุด

**A · Pre-flight: ต้องมี audit doc ก่อน**
- skill SKILL.md เขียน "After /auditbigteam produced spec · user wants implementation" · ดี
- ปัญหา: ไม่ enforce ใน code · ถ้าไม่มี audit doc skill ก็รันได้ แต่ผลลัพธ์จะแย่
- เสนอ: Phase 0 ต้องตรวจ `docs/AUDIT_<module>_*.md` มีอยู่หรือไม่ · ถ้าไม่มี → warn user + offer to run /auditbigteam first

**B · Inject Phase 2 Spec จากรอบ audit (ChairOps มี 3,631 lines)**
- Phase 2 specs ที่ผมสร้างใน /tmp/audit_chairops_phase2_*.md ยาวรวม 3,631 lines · มีสเปก granular ทุกหน้า
- claude-design ต้อง use as primary input · ไม่ใช่ start fresh
- เสนอ: Phase 0 ของ claude-design = auto-read latest audit Phase 2 outputs ถ้ามี

**C · Workspace-by-workspace split = parallel build is RIGHT · แต่ต้อง share kit FIRST**
- skill plan: spawn N+1 agents (N workspace + 1 kit) parallel
- ปัญหา: kit agent might finish AFTER workspace agents need primitives
- เสนอ: kit agent run SEQUENTIAL first (~10 min) · then workspace agents run parallel · use the new primitives
- Cost: +10 min wall · save merge conflicts later

**D · Stub Conventions + Greppable TODO Tags ดีแล้ว · แต่ขอเพิ่ม "TODO Burndown" ใน Phase 4 brief**
- skill มี `TODO[claude-design]` greppable convention · ดี
- เสนอ Phase 4 brief แสดง: total TODO count · top 5 critical · estimated hours to clear
- ช่วย CEO รู้ว่า "ทำเสร็จแต่มี 27 TODO ค้าง · 3 ตัวเป็น P0"

---

## 3️⃣ bigsolvebug · ยังไม่รัน · เสนอปรับ 6 จุด (ก่อนรัน)

### 🔪 เสนอ 6 จุด

**A · Token cap 1.0M อาจไม่พอสำหรับ module ใหญ่**
- ChairOps + Phase 2 spec injection อาจชน 1M cap
- เสนอ:
  - --quick mode (Phase 1+2 only · no auto-fix · ~150k) เป็น default first run
  - --full mode (all 7 phases · ~700k-1M) เฉพาะ pre-pilot deep test
  - Hard cap warning ที่ 750k + offer to stop

**B · 25 sims (5 types × 5 tiers) อาจ overkill สำหรับ admin-only module**
- ChairOps admin-only · ไม่มี public form · Newbie/Power/Impatient/Mobile/EdgeCase × 5 = 25 น่าจะ redundant
- เสนอ: matrix selector ที่ pick subset · เช่น admin module = 3 types × 3 tiers = 9 sims (~70% saving)
- Implementation: Phase 0 step 5 mode selection ขยายให้ pick persona count

**C · Regression Library Boot-Strap จาก memory**
- skill มี regression-library.md · เริ่มจาก empty
- เสนอ: bootstrap จาก existing memory entries ที่ tagged "bug-pattern" · เช่น `[[sticky-bg-inherit-anti-pattern]]` · `[[reserve-quota-int-bigint-bug]]` · `[[migration-repair-without-real-apply-trap]]` · `[[zod-v4-uuid-strict-rejects-seed]]` → instant regression checks ที่รอบ 1
- ผลกระทบ: รอบ 1 ของ bigsolvebug จับ bug ที่เคยเจอใน Pool ทันที

**D · Confirmation per Batch ดีแล้ว · แต่ขอเพิ่ม "Auto-Reject ถ้า P0 < N"**
- skill ขอ CEO confirm 1 ครั้ง for "P0 (N) + P1 (M)"
- ถ้า P0 = 0 และ P1 < 3 → auto-apply ไม่ต้องถาม
- ถ้า P0 ≥ 3 หรือ P1 ≥ 8 → block + brief CEO ก่อน fix (high blast radius)

**E · Phase 6 Verify Loop Cap = 2 ดีแล้ว · แต่ขอเพิ่ม "Bisect Mode"**
- ถ้า Phase 6 พบ regression ใหม่ → revert last commit · re-test · ระบุ commit-that-broke ตรงๆ
- Implementation: Phase 6 มี option `--bisect` ที่ใช้ git bisect ระหว่าง pre-fix commit + post-fix commit

**F · Output Schema "§persona-coverage matrix" สวยแต่ไม่ actionable**
- ปัจจุบัน Phase 7 มี 5×5 matrix · OK สำหรับ visual
- เสนอเพิ่ม section "§untested-routes" = routes ที่ไม่มี persona walk · CEO จะรู้ว่ายังขาด coverage ตรงไหน

---

## 4️⃣ Cross-Skill Recommendations (ทั้ง 3 skills รวมกัน)

**X · Standard Output Folder Layout**
- ปัจจุบัน: auditbigteam ใช้ /tmp/audit_<module>_* · claude-design ใช้ docs/CLAUDE_DESIGN_<module>_* · bigsolvebug ใช้ docs/BUGSOLVE_<module>_*
- เสนอ: standard layout `<project>/audit-<module>/{2026-05-25-audit/, 2026-05-25-design/, 2026-05-25-bugsolve/, INDEX.md}` · time-stamped folder per run · INDEX.md links latest of each
- ผลกระทบ: ตามไล่ artifacts ง่าย · ไม่หลุด /tmp · CEO เปิดดู Run history ได้

**Y · Shared "ChairOps Reality" Pre-load**
- ปัจจุบัน: ทุก skill ต้อง re-read memory + requirements + briefing pack
- เสนอ: สร้าง `<project>/reality/<module>.md` (auto-generated สรุปจาก memory + requirements + code state + last audit/design/bugsolve runs) · ทุก skill อ่านไฟล์เดียวนี้ก่อน
- Maintenance: trigger update เมื่อ memory เปลี่ยน หรือ commit ใหม่ใน module

**Z · Cost Telemetry Cross-Run**
- ปัจจุบัน: cost emit per-phase ใน bigsolvebug · ไม่มีใน auditbigteam/claude-design
- เสนอ: standard cost guard SDK ใช้ทั้ง 3 skills · log to `<project>/.skills/cost-log.jsonl` · CEO เห็น cost-per-skill-per-module ตามเวลา

---

## 5️⃣ ลำดับ Workflow ที่แนะนำสำหรับ ChairOps Wave 1

```
Wave 0 (in flight via agent · 5 surgical fixes · 1-2 dev-days)
  └─ Verify with /bigsolvebug --quick chairops (~15 min)
      └─ /claude-design chairops (build Wave 1 routes per Phase 2 spec · 3-5 dev-days)
          └─ /bigsolvebug chairops (full · ~30 min · auto-fix P0+P1)
              └─ /verify (typecheck + build + smoke routes)
                  └─ Manual UAT 1 สาขา (CEO + 1 maid + 1 office · 3 วัน)
                      └─ Wave 2 cut decision (continue scope or trim per DEVIL)
```

ทั้ง flow ~10-12 dev-days · ตรงกับ Way A timeline ที่ CEO อนุมัติ

---

**Last updated:** 2026-05-25 (after auditbigteam run #2 + sharpening review)
