# BugSolve · recruit · Phase C (run #3) · 2026-05-26

**Mode**: Smart-subset Full mode (5 missing sims + 4 backend verify · 9 parallel agents)
**Cost**: ~290k tokens · ~25 min wall
**Purpose**: Fill persona-coverage gap from Quick mode (run #1) + verify run #2 fixes hold

## §summary

- **19 NEW bugs found** (P0=4 · P1=12 · P2=14)
- **All 5 regression-library fixes from run #2 VERIFIED** (B-001 · B-002 · B-003 · B-008 · B-002-partial)
- **Persona coverage**: 5/25 → 10/25 sims (Super-Admin + Support-Staff now covered)
- **Security posture**: ✅ SOLID per EdgeCase audit · 0 RLS bypass · 0 privilege escalation surface

## §coverage-gain (this run · 9 agents)

| Persona | Result |
|---|---|
| Super-Admin × Newbie | 4 P2 (org context labels · terminology) |
| Super-Admin × Power | **0 bugs** · ALL security guards PASS |
| Super-Admin × EdgeCase | **0 new security bugs** · 9 attack vectors blocked |
| Support × Mobile | **7 bugs** (1 P0 keyboard · 4 P1 tap targets · 2 P2) |
| Support × Impatient | **8 bugs** (3 P0 messaging race · 3 P1 UX · 2 P2) |
| Phase 3A DB | All 4 regressions hold · 31 server actions audited |
| Phase 3B Upload | B-002-partial holds · 2 NEW P1 (0-byte · ContentLength) |
| Phase 3C Calc | 2 NEW low-sev (triage div/0 · AI score NaN) |
| Phase 3D Flow | B-008 holds · 8 latent revalidate gaps (masked by force-dynamic) |

## §new-P0-bugs (4 · all in Messaging Hub)

1. **Support × Mobile S1**: Messaging composer has NO `pb-safe` for iPhone notch · iOS keyboard ซ่อนหน้า composer (`/recruit/messages` thread view)
2. **Support × Impatient M-01**: Send button no debounce · double-tap → 2 messages
3. **Support × Impatient M-02**: Concurrent send from 2 tabs · no DB unique on outbound · duplicates
4. **Support × Impatient M-03**: Stale cache after nav-away-and-back (revalidatePath doesn't integrate with client-nav)

→ **Pattern**: Messaging Hub was untested in run #1 · Quick mode missed it entirely · pattern noted in LESSONS

## §new-P1-bugs (12 · highlights)

**Messaging UX (5)**:
- Send button 40px (<44px tap target)
- Textarea no maxLength
- Channel selector 32px buttons
- Header action buttons 36px
- No optimistic UI (500-2000ms perceived lag)

**Upload (2 from Phase 3B)**:
- 0-byte file accepted (no `size > 0` check)
- ContentLength NOT bound in signed PUT URL (attacker can PUT 50MB after claiming 1MB)

**Other (5)**: Template insertion gap · Session race · Triage div/0 · AI score NaN propagation · Latent revalidate gap (publishPosting doesn't revalidate /apply/[slug])

## §regression-pass (run #2 fixes verified)

| bug-class | check | verified by | result |
|---|---|---|---|
| B-001 webhook idempotency | findFirst before create | Phase 3A | ✅ inbox-ingest.ts:97-110 |
| B-002 external timeouts | AbortSignal/timeout option | Phase 3A | ✅ email.ts:104 + ai.ts:66/147/213 |
| B-003 RLS gaps | migration applied · 12/12 tables | Phase 3A | ✅ all rowsecurity=true (code level) |
| B-008 race optimistic lock | updateMany WHERE expectedStatus | Phase 3D | ✅ actions.ts:231-239 |
| B-002 partial ext-MIME | expectedExts map | Phase 3B | ✅ upload/route.ts:61-81 |

## §security-posture (Super-Admin × EdgeCase findings)

✅ **No RLS bypass** — `is_super_admin()` SECURITY DEFINER checks role+active at DB
✅ **Cross-org erasure protected** — explicit orgId match in erasure-actions.ts:32
✅ **No privilege escalation** in recruit module (no user-management endpoints; guarded at /api/admin/users/*)
✅ **Audit logging intact** — all super_admin actions logged with userId+orgId+action
✅ **Session edge cases** — transaction-bound mutations · early session checks · RLS re-enforced

## §canvas-parity-gaps (feature gaps · NOT bugs)

Per recruit canvas Section 8 "Messaging Hub":
- Missing 4 composer buttons: Template · นัด · แนบ · AI ช่วยร่าง (CEO design call · ~1 day)

## §next-actions

### Tier A · Same-day fixes (3 P0 from messaging)
1. Add `pb-safe` to messaging composer (1 line · 5 min)
2. Add `disabled={isPending}` debounce to Send button (1 line · 5 min)
3. Add unique constraint on (orgId, applicationId, body, createdAt within 5s) for outbound dedup — OR client-side debounce 500ms (CEO call)

### Tier B · Upload hardening (Phase 3B P1s)
4. `size > 0 && size <= MAX_FILE_SIZE` guard in upload/route.ts
5. Bind `ContentLength: size` in r2 signed URL (lib/r2/upload.ts)

### Tier C · Polish + latent
6. Triage div/0 guard
7. AI score NaN guard
8. 7 missing revalidatePath calls (defense-in-depth · would break if force-dynamic removed)

### Feature design call
- Messaging composer 4-button (Canvas Section 8) · ~1 day

## §files

- `/tmp/bugsolve_recruit_phase2C_SUPERADMIN_NEWBIE.md`
- `/tmp/bugsolve_recruit_phase2C_SUPERADMIN_POWER.md`
- `/tmp/bugsolve_recruit_phase2C_SUPERADMIN_EDGECASE.md`
- `/tmp/bugsolve_recruit_phase2C_SUPPORT_MOBILE.md`
- `/tmp/bugsolve_recruit_phase2C_SUPPORT_IMPATIENT.md`
- `/tmp/bugsolve_recruit_phase3C_db.md`
- `/tmp/bugsolve_recruit_phase3C_upload.md`
- `/tmp/bugsolve_recruit_phase3C_calc.md`
- `/tmp/bugsolve_recruit_phase3C_flow.md`
- `docs/BUGSOLVE_recruit_phaseC_2026-05-26.md` ← this file
