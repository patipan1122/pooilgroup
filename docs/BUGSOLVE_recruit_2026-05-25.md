# BugSolve · recruit · 2026-05-25

**Mode**: Quick (Phase 0 → 1 → 2 [5 sims] → 4 → 7 · no auto-fix · report only)
**Skill**: `/bigsolvebug --quick recruit` (first ever run · seeds LESSONS + regression-library)
**Cost**: ~210k input tokens · 25 min wall time
**Skill version**: v1.0 (2026-05-25)

---

## §summary

- **35 bugs found**: **6 P0** (critical) · **15 P1** (high) · **14 P2** (polish)
- **23 auto-fix-safe** · **12 need CEO decision** (schema/design/infra)
- **First run of `/bigsolvebug`** — produced 10 regression-library entries → next run auto-tests these patterns

Status: ⏳ ALL bugs deferred (Quick mode = no auto-fix · CEO reviews + decides which Tier to ship)

---

## §scope

- **Module**: recruit
- **Working dir**: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web`
- **Routes scanned**: 24 (20 admin + 4 public) + 2 webhooks
- **Tables**: 12 RecruitX models
- **Server actions**: 7 files
- **Components**: 27 in `components/recruit/`
- **Sims run**: 5 / 25 possible (Quick mode 20%)
  - HR-Admin × Newbie · HR-Admin × Power · HR-Admin × Impatient
  - Candidate × Mobile · Branch-Manager × EdgeCase
- **Personas missing** (Full mode would cover): Super-Admin · Support-Staff · all × 5 tiers

---

## §bugs-fixed (P0+P1)

| # | file:line | desc | commit |
|---|---|---|---|
| — | (none) | Quick mode = report-only, no auto-fix this run | — |

---

## §bugs-deferred (all 35 · CEO decides)

### 🔴 P0 (6)
1. **recruit_inbox_channels missing RLS** — cross-org channel enum risk (DDL fix · 15 min)
2. **recruit_form_templates missing RLS** — same as #1 (DDL fix · 15 min)
3. **Webhook idempotency missing** — LINE/FB retry → duplicate messages (schema `@@unique([channelInstanceId, externalId])` + upsert · CEO confirm needed)
4. **Resend email no timeout** — hangs · simple wrap (15 min)
5. **Anthropic API no timeout** — same · 3 features affected (30 min)
6. **sendMessage cross-org channelInstanceId** — RLS catches but business logic missing guard (15 min)

### 🟠 P1 (15) · highlights
- Modal no Esc key (ScheduleInterview) · UUID validation missing · tab icons no aria-label
- Mobile: no inputMode · keyboard hides submit · no camera capture · file accept uses ext not MIME
- File MIME spoofing (no magic bytes) · long_text no max · date "Feb 30" coerced silent
- 3 race conditions (status · tag · interview auto-advance)
- R2 partial upload orphan · 5min URL too short · blacklist no unique constraint

### 🟡 P2 (14) · highlights
- Thai `confirm()` modals (2 places) · breadcrumb missing on new posting · copy/action-bar icon-only labels
- Bulk multi-select missing (feature gap) · modal no focus trap · tap target <44px
- FB verify_token plaintext · maxFiles no server check · Resend silent warn · stale cache

(Full table in `/tmp/bugsolve_recruit_phase4_triage.md`)

---

## §regression-pass

| bug-class | from-run | test-result |
|---|---|---|
| — | (none) | regression-library was empty this run — 10 new entries seeded for next run |

---

## §persona-coverage

| Type × Tier | Newbie | Power | Mobile | EdgeCase | Impatient |
|---|---|---|---|---|---|
| HR-Admin | 7 bugs | 5 bugs | — | — | 8 bugs |
| Candidate | — | — | 5 bugs | — | — |
| Branch-Mgr | — | — | — | 17 bugs | — |
| Super-Admin | — | — | — | — | — |
| Support-Staff | — | — | — | — | — |

**Coverage: 5/25 = 20%** · ขาด Super-Admin · Support · ขาดทุก type × NEWBIE/POWER ที่ไม่ใช่ HR-Admin

---

## §next-actions (CEO must decide)

### Quick wins (~1.5 hour · 6 P0) — ลุยได้ทันที
- เพิ่ม RLS policy 2 tables (DDL) · wrap external APIs ใน AbortSignal · cross-org guard
- **คำสั่ง**: `/bigsolvebug recruit` (Full mode · จะ auto-fix + Phase 6 verify)

### Schema decisions (CEO confirm) — ต้องคุยก่อนแก้
- **P0-3**: เพิ่ม `@@unique([channelInstanceId, externalId])` to RecruitMessage — ตกลงไหม?
- **P1-15**: เพิ่ม `@@unique([orgId, phone])` to RecruitBlacklistEntry — ตกลงไหม?
- **P1-14**: R2 lifecycle policy 24h cleanup — config Cloudflare side · CEO acknowledge

### Design call (CEO discuss)
- **P2-7**: Bulk multi-select on /recruit/applications — feature gap · ออกแบบ + เวลา?
- **P1-11, P1-12**: Race conditions — optimistic lock strategy (WHERE expectedStatus) หรือ pessimistic transaction?

### Coverage gap
- Quick mode covered 20% (5/25 sims) · ถ้าอยากครบ → `/bigsolvebug recruit` (Full mode · 45 min · ~1M tokens · 25 sims)

---

## §lessons-this-run (feeds LESSONS.md)

- 💚 **worked**:
  - 3 inventory agents (1A · 1B · 1C) ครอบ structure ครบ · เจอ 8 bugs ก่อน sim ด้วยซ้ำ
  - 5 sims เลือกครอบ 5 different bug classes · ไม่ overlap มาก · dedup เหลือ 10 จาก 45
  - Memory hint injection ทำให้ agents focus (Mobile sim เช็ค sticky-bg-inherit ตรงทันที · EdgeCase ใช้ recruit-deep-audit memory ไม่ re-flag bugs ที่ fixed แล้ว)
  - Cost ต่ำกว่า budget (~210k / 1M cap) · เหลือเพียงพอ Full mode ใน run ถัดไป

- 💔 **didn't**:
  - 1B กับ Sim 5 ขัดกันเรื่อง `sendMessage` revalidatePath (1B ว่า missing · 5 ว่ามี) · ผมแก้ด้วย Sim 5 (newer + more accurate) → ต้องมี **conflict-ledger pattern** เหมือน auditbigteam Phase 3.5
  - Sim 1A สรุปสั้นเกินไป (สรุปบอก "0 critical" แต่ในตารางมี 7 bugs) · agent summary message ≠ file content → ผมต้องอ่าน file เสมอ
  - ไม่ได้แตะ Phase 3 (backend verify) ในโหมด Quick · แต่ Sim 4 EdgeCase ทำหน้าที่นี้ทดแทนได้ดี
  - Persona ขาด 80% (5/25) · Quick mode ไม่ครอบ Super-Admin · Support-Staff
  - บั๊ก "feature gap" (P2-7 bulk select) ถูก list เป็น bug แต่จริงๆ คือ enhancement · ผมต้องแยก label "gap" vs "bug"

- 🔧 **next-run fix** (proposed SKILL.md edits):
  - Add **Phase 3.5 Conflict Ledger** (เหมือน auditbigteam) · auto-consolidate ข้อขัดแย้งระหว่าง sims
  - Add rule: "ALWAYS Read every sim's output file · don't trust agent summary message"
  - Add label distinction: `bug` vs `feature-gap` · `feature-gap` ห้ามนับใน P0/P1
  - Add Quick mode persona expander: ถ้าเหลือ token budget > 500k → spawn 5 sims เพิ่ม (Type 2 × 5 tiers)
  - Add "bugs you missed" check at Phase 4 — re-run regression-library entries against current code

- 📊 **cost**: ~210k input tokens · 25 min wall time · 8 agent invocations · 8 source files (~2,500 lines) → 1 triage doc + 1 master report
- **bugs found**: P0=6 · P1=15 · P2=14 · auto-fixed=0 (Quick mode) · deferred=35

---

## §process notes

- First-ever run of `/bigsolvebug` — proves skill orchestration works end-to-end
- LESSONS.md grew from 0 → 1 entry · regression-library grew from 0 → 10 entries
- All 5 sims completed successfully · no agent failures · no retry needed
- Quick mode took ~25 min · Full mode would take ~45 min (5x more sims · +Phase 3 + Phase 5 + Phase 6)
- Token cost ~210k out of 1M cap · Quick mode is **5x cheaper** than Full

---

## Files produced

- `/tmp/bugsolve_recruit_phase0_brief.md`
- `/tmp/bugsolve_recruit_phase1_buttons.md` (430 lines)
- `/tmp/bugsolve_recruit_phase1_db.md` (212 lines)
- `/tmp/bugsolve_recruit_phase1_integrations.md` (443 lines)
- `/tmp/bugsolve_recruit_phase2_HRADMIN_NEWBIE.md` (140 lines)
- `/tmp/bugsolve_recruit_phase2_HRADMIN_POWER.md` (186 lines)
- `/tmp/bugsolve_recruit_phase2_CANDIDATE_MOBILE.md` (93 lines)
- `/tmp/bugsolve_recruit_phase2_BRANCH_EDGECASE.md` (162 lines)
- `/tmp/bugsolve_recruit_phase2_HRADMIN_IMPATIENT.md` (117 lines)
- `/tmp/bugsolve_recruit_phase4_triage.md` (consolidated)
- `docs/BUGSOLVE_recruit_2026-05-25.md` ← **this file** (CEO-facing)

---

## Hand-off

1. CEO reviews this doc → decides which Tier (A/B/C) to ship
2. If approves Tier A → run `/bigsolvebug recruit` (Full mode · auto-fixes 4 P0 + verifies)
3. If wants full coverage → `/bigsolvebug recruit` (25 sims · ~45 min)
4. After N days → `/bigsolvebug --regression recruit` (test the 10 regression-library entries · ~5 min)

**Next run will be smarter**: LESSONS + regression-library now seeded with this run's findings.
