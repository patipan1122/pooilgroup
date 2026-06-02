# BIGFEATURE · ClawFleet Unify — Consolidated Build Spec

> `/bigfeature` Phase 4 · 2026-06-02 · 12-persona roundtable (SA·Programmer·UX·UI·QA·QC·DevOps·PM·BA·Owner·BranchManager·Staff·DevilsAdvocate)
> Companion to docs/WORKSHOP_clawfleet_unify_2026-06-02.md · Status: GO (CEO Full-ship) · Scope: ClawFleet only
> Effort estimate: ~6 dev-days · staged

---

## Verdict (roundtable consensus)
**Graft `claude/clawfleet-antifraud` as the base** — it already has ~90% of the right direction:
- `lib/clawfleet/v2-group-data.ts` — branch>group>machine collect loader + exchanger
- `lib/clawfleet/settlement.ts` — per-round bank reconciliation (maker≠checker)
- commit `1ca2ef5` — single-sidebar fix (V2Shell → slim BranchFilterBar; Pool AdminShell is the only nav)
…then layer: A/B-both-coexist, LINE LIFF staff app, delete v1, KEEP today's F1/F2/F5.

---

## Build plan (file-level, staged)

### Stage 1 — Nav unify (kill double sidebar) ⟵ CEO's headline complaint
- **modify** `components/clawfleet/v2/shell.tsx` + `chrome.tsx` — drop the in-module `<Sidebar>`; render only a slim BranchFilterBar + content (graft 1ca2ef5 approach).
- **modify** `lib/modules.ts` — ClawFleet nav = the ONE source of truth; fix broken `/liff/clawfleet` item; add Audit; drop the v1/dup items.
- Verify: every v2 page uses BranchFilterBar (not the removed TopBar). `git grep TopBar 'app/(admin)/clawfleet/v2'`.
- **Acceptance:** office web shows ONE sidebar, no duplicates.

### Stage 2 — Schema: A/B groups + exchanger (greenfield, wipeable)
- **new migration** — `cf_group.type` enum (CASH|TOKEN), `cf_exchanger` (TOKEN only), `cf_machine.coinKind` (CASH|TOKEN), settlement table (if v1). Greenfield = safe drop/recreate.
- **modify** `prisma/schema.prisma` cf_* models accordingly.

### Stage 3 — Backend: unified cross-check (A 2-way / B 3-way)
- **graft+modify** `lib/clawfleet/validation.ts` — ONE close function that branches on group.type: A = `deriveBranchCrossCheck` (today's, with F1/F5); B = 3-way (Σ exchanger coins out ↔ Σ token-claw coin-meter-in ↔ exchanger cash, ±5%). **KEEP F1 ฿100 floor + F5 netting.**
- **graft** `v2-group-data.ts` + group functions in `v2-actions.ts`.
- **P0:** re-add **F2 self-approval block** (antifraud branch removed it) in review + settlement confirm. DB-level: `CHECK(makerId ≠ checkerId)`.
- **P1:** verify the Postgres 3-way trigger is ACTIVE (`information_schema.triggers`) — it was un-triggered before ([[clawfleet-audit-2026-05-31]]).

### Stage 4 — Office pages wired to A/B model
- collect/anomalies/operations/insights/stock/team/settings read the group-aware loaders; anomaly review shows 3-way for TOKEN groups, 2-way for CASH.
- settlement page (should-have v1.1 — defer unless CEO wants now).

### Stage 5 — LINE Mini App (LIFF) staff entry
- **new** `/liff/clawfleet` real flow (graft from `claude/clawfleet-staff-app` branch which had a working LIFF flow) — pick branch → (exchanger step if TOKEN) → claws one-by-one (photo+meters) → close.
- **web /collect fallback** stays.
- **Blocker (CEO):** LINE LIFF app ID + channel. Build behind env var; flag if absent.

### Stage 6 — Delete all v1
- **delete** 8 v1 routes `app/(admin)/clawfleet/{dashboard,groups,machines,products,sessions,reports,setup,stock,operations,anomalies}` + `v1 queries.ts/actions.ts` + `v2-collect-data.ts` (superseded) + static `app/(admin)/clawfleet/v2/mobile/page.tsx`.
- **P1:** grep entire repo for refs BEFORE delete: `grep -rE 'clawfleet/(dashboard|groups|machines|products|sessions|reports|setup)' app lib components`.

### Stage 7 — Verify
- tsc + next build clean · then `/auditbigteam` (audit) → `/bigsolvebug` (runtime click-every-button) → deploy + CEO retest.

---

## P0/P1 risks (must-mitigate)
| Sev | Risk | Mitigation |
|---|---|---|
| P0 | A 2-way vs B 3-way nested in one close fn → logic error hides fraud | type-split at schema (group.type) · adversarial verify in /auditbigteam before merge |
| P0 | settlement self-approval (maker=checker) | DB `CHECK(makerId≠checkerId)` + app guard · re-add F2 |
| P1 | delete v1 orphans cross-module links | grep repo + git log -S before delete · /bigsolvebug clicks all links |
| P1 | single-sidebar removed TopBar exports | grep v2 pages use BranchFilterBar |
| P1 | 3-way Postgres trigger inactive | verify `information_schema.triggers` · test insert |
| P1 | LIFF channel not set by CEO → staff revert to Excel | env-gated · /collect fallback · verify with 1 staff |

## CEO must provide for go-live
1. **LINE LIFF app ID + channel** (for staff Mini App)
2. **Confirm data wipe** (greenfield drop/recreate cf_* tables) — CEO already said "ลบได้หมด ไม่ซีเรียส"
3. **Deploy authorization** (prod via setup) when each stage is ready

## Deferred to v1.1
- Bank-settlement page (code exists on antifraud branch) · OCR meter reading · LINE push/rich-menu

## Next
Stage 1 (nav unify) now → then schema/backend → LIFF → delete v1 → /auditbigteam → /bigsolvebug.
