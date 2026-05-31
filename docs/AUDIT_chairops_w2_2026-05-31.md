# AUDIT · ChairOps Wave-2 · 2026-05-31

**Mode**: Full · 8 personas (BA · SA · SEC · BE · QA · UX/STAFF · DEVIL · OWN)
**Scope**: chair-checklist + batch deposit + office direct-collect + chair-move history + LIFF OAuth + moved-in badge
**Cost**: ~900k input tokens · 8 parallel agents · ~5 min wall · 8 outputs at `/tmp/audit_chairops_w2_phase1_<CODE>.md`
**Run by**: `/auditbigteam` skill (run #3 of skill · post-implementation focused surface audit)

---

## §1 · Executive summary

Wave-2 ships the architecture CEO asked for — chair-checklist replaces typeahead, batch deposit replaces 1-to-1, office can act for any branch without impersonation, chair moves are auto-tracked. Auth chain bulletproof for iOS LINE webview after the 4-bug debug round on 2026-05-30. **80% on-target**.

**3 ship-stop P0s** before pilot:
1. **bankFee not in drift formula** — `recomputeDriftForBranch` sums only `depositedAmount`, ignores `bankFee`. ~27k baht/mo across 30 branches gets misclassified as shortage, violating [[chairops-no-cumulative-shortage]] from the OPPOSITE direction (false alerts on already-correctly-deposited cash).
2. **Office direct-collect rots by-maid analytics** — `maidId = office user id` on the row means "patipan เก็บ 8,500" indistinguishable from a real maid. Needs `actorUserId` shadow column.
3. **Importer / POS-ingest violate diff-before-write rule** — `importStarThingEquipment` has no preview · `commitImport` auto-writes `ChairopsChairMove` rows · both violate [[pool-csv-import-must-diff-before-write]]. CEO authorized auto for POS (2026-05-31 message) but equipment importer wasn't covered by that auth.

**Plus 1 security P0** new this wave: `/api/auth/set-session` accepts any (access_token, refresh_token) over POST with no auth, no rate limit, no CSRF/origin check. Login-CSRF amplifier.

**The good news**: schema↔migration parity is clean · LIFF auth chain is sound · the existing role guards (MAID branchOverride forge check, org isolation) all hold up to verified-read review · drift engine correctly sums new `ChairopsCashDeposit` + legacy `CashCollection.depositedAmount WHERE depositId IS NULL`.

---

## §2 · Scope (IN / OUT / DEFERRED)

### IN scope this audit
- 7 server actions: `createCashCollection` · `batchDeposit` · `presignChairPhoto` · `presignSlipUpload` · `addChairsToBranch` · `syncChairsFromPos` · `importStarThingEquipment` · `commitImport` (chair-move portion)
- 9 routes: `/m/page.tsx` · `/m/collect/new` · `/m/collect/[id]` · `/m/deposit` · `/branch-collect` · `/(office)/collect/[branchId]/new` · `/chairs/[chairCode]` · `/branches/[id]/chairs/add` · `/branches/import-equipment`
- 4 auth routes: `/auth/line-start` · `/auth/line-callback` · `/auth/liff-complete` · `/api/auth/set-session`
- 3 schema changes: `ChairopsCashDeposit` (NEW) · `ChairopsChairMove` (NEW) · `ChairopsCashCollection.chairBreakdown` + `depositId`
- 2 migrations: `20260530080000_chairops_cash_deposit_split.sql` · `20260531000000_chairops_chair_move_history.sql`

### OUT scope
- Wave-1 surfaces unchanged (cleanliness · damage · parts)
- Pool admin shell (audited separately)
- Recruit/Inbox/CashHub (separate modules)

### DEFERRED-HW
- (none — Wave-2 is pure code)

---

## §3 · Cross-persona convergence — what multiple personas independently flagged

**High-signal items (≥2 personas agree):**

| # | Item | Personas | Severity |
|---|---|---|---|
| 1 | Office direct-collect attributes `maidId = officeUserId` · by-maid analytics rot | BA · DEVIL · OWN | **P0** |
| 2 | `importStarThingEquipment` no transaction · partial-failure leaves orphan moves | SA · BE · SEC | **P0** |
| 3 | `commitImport` outer tx has no `{timeout}` · 5s default kills large backfill | BE · SA · QA | **P0** |
| 4 | 6 office reports still aggregate deprecated `CashCollection.depositedAmount` → show 0 ฿ for new deposits | BA · OWN | **P0** |
| 5 | `bankFee` excluded from drift formula | OWN | **P0** |
| 6 | `/api/auth/set-session` accepts tokens with no auth/rate-limit/CSRF | SEC | **P0** |
| 7 | `presignChairPhoto` is MAID-only · office direct-collect can't attach broken-chair photo | QA | **P0** |
| 8 | Importer auto-writes chair-moves with no preview · violates [[pool-csv-import-must-diff-before-write]] | DEVIL · OWN | **P0** (escalate Q1 below) |
| 9 | `batchDeposit` missing `rateLimit()` call (cf. `createCashCollection` has it) | SEC · BA | P1 |
| 10 | All-broken submit lockout · violates real-world "no maid visit today" case | UX · BA | P1 |
| 11 | Office discoverability for `/chairops/branch-collect` · only 1 link from `/users` header | UX · DEVIL | P1 |
| 12 | 200-chair cap silently truncates · no banner | QA · UX | P1 |
| 13 | Moved-in badge text reads ambiguous to maid · "ย้ายมาใหม่ · จาก X" vs "ย้ายเข้าสาขานี้ · เดิม X" | UX | P2 |
| 14 | Diff warning only on `absDiff > 100` · negative drift should always warn (`[[chairops-no-cumulative-shortage]]`) | UX · OWN | P1 |
| 15 | Equipment XLSX importer uses `movedAt = now()` · POS-ingest uses `bizDate` · chronology inconsistency | QA · BA | P1 |

---

## §4 · Conflict ledger (Phase 3.5)

Auto-resolved by domain authority + CEO-explicit-authorization preference.

| # | A says | B says | Resolution | Reasoning |
|---|---|---|---|---|
| C1 | DEVIL: "auto-move from POS = trust file 100%" | DEVIL+OWN: "violates [[pool-csv-import-must-diff-before-write]]" | **CEO override** — CEO 2026-05-31 explicitly authorized auto for POS path ("เก็บยอดขายปกติ · แนะนำให้ย้ายได้เลย"). Equipment importer = separate path · still needs preview. Split Q1 to CEO. | CEO authority |
| C2 | DEVIL: "chair-move table overkill" | OWN: "explicit CEO ask · keep" | **OWN wins** · DEVIL conceded in own write-up | explicit user demand |
| C3 | BA: "batchDeposit max 50 rounds" | OWN: "holiday backlog will exceed" | **Raise to 100** · simple param change | low-cost compromise |
| C4 | UX: "add 5th 'ฝาก' tab in bottom-nav" | DEVIL: "YAGNI · banner on home is enough" | **UX wins** P1 · maids miss the home-page banner when back-button from collect | discoverability > 1-icon savings |
| C5 | BE: "evidencePhotoUrl='' empty-string anti-pattern" | BA: "OK because it's nullable downstream" | **BE wins** P1 · convert to `null` to keep schema-level "no rollup photo" semantic clean | type clarity |
| C6 | SEC: "Restrict importStarThingEquipment URL to Drive/CoS allowlist" | BE: "Defer · OFFICE-only insider threat" | **SEC wins** P0 · SSRF gives any office-tier user a Vercel-internal-network probe; cheap fix | defense-in-depth |

0 BLOCKED · 0 personas refused sign-off. Move to Phase 4.

---

## §5 · Persona sign-off

| Persona | Status | Conditions | Reference |
|---|---|---|---|
| BA | 🟡 CONDITIONAL | Fix P0 #1-#4 + #15 before pilot | `/tmp/audit_chairops_w2_phase1_BA.md` |
| SA | 🟡 CONDITIONAL | Wrap `importStarThingEquipment` in tx · add `commitImport` tx timeout | `/tmp/audit_chairops_w2_phase1_SA.md` |
| SEC | 🟡 CONDITIONAL | Lock `/api/auth/set-session` (P0) · Drive allowlist on importer URL (P0) · add `batchDeposit` rate-limit (P1) | `/tmp/audit_chairops_w2_phase1_SEC.md` |
| BE | 🟡 CONDITIONAL | Same as SA + selfRegister orphan cleanup + line-callback file-path doc fix | `/tmp/audit_chairops_w2_phase1_BE.md` |
| QA | 🟡 CONDITIONAL | Fix presignChairPhoto for office role + add 200-chair banner + verify migrations applied to prod | `/tmp/audit_chairops_w2_phase1_QA.md` |
| UX | 🟡 CONDITIONAL | Add 5th tab + fix all-broken lockout + diff direction + moved-in copy + office discoverability | `/tmp/audit_chairops_w2_phase1_UX.md` |
| DEVIL | ✅ PASS | "actually keeps more than it kills · 80% on-target" — concedes ChairopsChairMove + batchDeposit + chairs/[code] page | `/tmp/audit_chairops_w2_phase1_DEVIL.md` |
| OWN | 🟡 CONDITIONAL | bankFee→drift formula + office actorUserId split + treasury-card on exec dashboard | `/tmp/audit_chairops_w2_phase1_OWN.md` |

**Aggregate**: 7 CONDITIONAL · 1 PASS · 0 BLOCKED. Phase 4.5 patch round NOT triggered. Master spec is sign-off ready conditional on the P0 fix list.

---

## §6 · 🎯 Top-5 Decisions Needing CEO Eyes

(highest blast radius · CEO action required)

1. **Q1 · POS auto-detect chair-move: trust file or require preview?**
   - CEO 2026-05-31 said "auto · แนะนำให้ย้ายได้เลย" — but DEVIL+OWN flag violation of [[pool-csv-import-must-diff-before-write]]
   - Owner: BA + OWN
   - Cost-if-wrong: 1 typo in StarThing → revenue mis-routed to wrong branch P&L
   - CEO action: ☐ keep auto (current) ☐ add 1-screen preview before commit ☐ tag uncertain moves "pending_review"

2. **Q2 · Office direct-collect attribution: who is the row "for"?**
   - Today: `maidId = office user id` → looks like "patipan เก็บ 8,500" in by-maid views
   - DEVIL + BA + OWN all flag · 5-LOC fix (add `actorUserId` column · `maidId` = real assigned maid of the branch)
   - Owner: BE + SA
   - Cost-if-wrong: P&L per-maid wrong from day 1
   - CEO action: ☐ split actorUserId / maidId ☐ keep current ☐ defer until leaderboard built

3. **Q3 · bankFee in drift formula or as P&L cost only?**
   - Today: `bankFee` stored on `ChairopsCashDeposit` but `recomputeDriftForBranch` ignores it
   - 30 branches × ~30/mo × ~30 baht each = ~27k baht/mo misclassified as shortage
   - Owner: OWN + BA
   - Cost-if-wrong: false shortage alerts daily · maid morale + CEO false confidence
   - CEO action: ☐ add to drift (treat as deposit) ☐ keep separate as expense ☐ both (drift uses deposited+bankFee · P&L uses bankFee separately)

4. **Q4 · `/api/auth/set-session` token endpoint: lock or accept?**
   - Today: accepts any tokens with no auth · rate-limit · origin check · audit
   - Login-CSRF amplifier risk · ~30 staff target surface · trivial 10-LOC HMAC bind to OAuth state cookie
   - Owner: SEC
   - Cost-if-wrong: any leaked Supabase JWT → instant session in attacker browser
   - CEO action: ☐ HMAC-bind to OAuth state (recommended) ☐ rate-limit + audit only ☐ ship as-is (NOT recommended)

5. **Q5 · Legacy report aggregations show 0 ฿ for new deposits**
   - 6 office surfaces still SUM `CashCollection.depositedAmount` (deprecated · always 0 on new rows): `branches/page.tsx:882` · `collections/page.tsx:65,73,89,232,244` · `reports/monthly/page.tsx:41,68` · `reports/export/route.ts:157,177` · `dashboard/[branchSlug]/page.tsx:117`
   - Owner: BE
   - Cost-if-wrong: CEO sees contradictory numbers (drift engine right · list views wrong) · loses trust in alerts
   - CEO action: ☐ migrate all 6 reads to sum ChairopsCashDeposit (recommended) ☐ leave as-is ☐ rip Wave-2 split (NO)

---

## §7 · Hardware-block matrix

All Wave-2 features are 🟢 BUILDABLE_NOW · no HW deps · no MOCKABLE items. Already in production. This audit is post-ship review.

---

## §8 · Drift findings (Phase 0.5)

| Layer | Finding | Severity |
|---|---|---|
| Plan ↔ Schema | Clean. 3 new tables/columns match migrations 20260530080000 + 20260531000000 + 20260530060000 | OK |
| Schema TEXT vs UUID | Clean. All chairops `id` are TEXT (Prisma `@default(uuid())` string · no `@db.Uuid`) | OK |
| Schema indexes | `(branchId, depositId)` · `(chairId, movedAt)` · `(toBranchId, movedAt)` all present | OK |
| Back-relations | Branch · User · Chair all have new relations wired | OK |
| Routes | All 13 W2 routes shipped + linked | OK |
| Audit table | Reused (no new audit table) — `ChairopsAuditLog` with `entity="CashDeposit"` etc | OK |
| **Migration applied to prod** | **UNVERIFIED FROM CODE** · per [[migration-repair-without-real-apply-trap]] · CEO confirmed run via "iyo รันแล้ว" + "รันแล้ว" but suggest 1-row smoke test in Supabase SQL Editor | P1 |
| Pool ↔ Chairops `users` role | After CEO promoted pimm to `org_admin` (manually via Supabase), Pool admin tier works · OK | OK |

---

## §9 · Test Scaffold (Playwright stubs)

Per `auditbigteam` Phase 5 spec, scaffold file to be generated at `tests/chairops/wave2.scaffold.ts` (deferred — no `tests/` dir yet in repo). Minimum criteria the scaffold would cover:

```typescript
// AC-1: maid Step 1 chair-checklist renders all active branch chairs
// AC-2: marking chair "ขัดข้อง" requires reason + photo
// AC-3: submit with 0 collected lines rejected
// AC-4: submit with ≥1 collected creates ChairopsCashCollection w/ chairBreakdown
// AC-5: pending list on home shows depositId IS NULL rows · linked to /m/deposit
// AC-6: batchDeposit accepts checkbox-multi-select · creates 1 CashDeposit · updates N collections
// AC-7: slip-hash dup rejected
// AC-8: office /branch-collect lists branches with chair count + "เก็บเงินสาขานี้" CTA
// AC-9: office /collect/<branchId>/new submits with branchOverride · maidId=officeUser
// AC-10: POS upload with chair X at branch B (was A in DB) writes ChairopsChairMove row + updates chair.branchId
// AC-11: chair detail /chairs/<code> shows revenue grouped by branchId + move timeline
// AC-12: moved-in badge appears on chair-checklist for moves within 14 days
// AC-13: /api/auth/set-session accepts valid tokens · returns 200 · cookie set via response header
// AC-14: drift engine = sum(CashDeposit) + sum(legacy CashCollection.depositedAmount WHERE depositId IS NULL)
```

---

## §10 · Pilot plan

**Day-1 hotfix budget**: 0.75 dev-day reserved for live-fix during 3-branch pilot.

**Rollout sequence:**
1. **Day 0 · pre-pilot**:
   - Fix P0 #1-#7 (bankFee · actorUserId · 6 deprecated aggregates · set-session lock · SSRF allowlist · presignChairPhoto office gate · importer tx-wrap)
   - Smoke-test migrations via Supabase SQL editor
   - Manual iPhone test of LIFF OAuth chain (per [[liff-magic-link-ios-webview-cookie-drop-2026-05-30]] residual)
2. **Day 1-3 · 3-branch pilot** (Robinson Kanchanaburi + 2 worst-drift branches per OWN recommendation)
3. **Day 4-7 · 10-branch expansion**
4. **Day 8-14 · full 30-branch rollout**

**Rollback**: `MODULES_DISABLED=chairops_w2` env flag (NOT yet implemented · 1-line addition to `lib/modules.ts` registry per [[modules-disabled-env-killswitch]])

---

## §11 · Locked decisions (D-### list · new this wave)

- **D-CO-W2-1** · Chair-checklist = source of truth for current chair location (CEO 2026-05-31)
- **D-CO-W2-2** · ChairopsCashDeposit replaces 1-to-1 deposit · batch with bankFee (CEO 2026-05-30)
- **D-CO-W2-3** · Office direct-collect = no impersonation · branchOverride pattern (CEO 2026-05-31)
- **D-CO-W2-4** · ChairopsChairMove records every branch change · POS auto-detects (CEO 2026-05-31 "auto · แนะนำให้ย้ายได้เลย")
- **D-CO-W2-5** · Equipment XLSX importer = OFFICE-tier · auto-creates missing branches with sanitized slug (CEO 2026-05-30)
- **D-CO-W2-6** · "🆕 ย้ายมาใหม่" badge window = 14 days · sky-blue tone · single source of truth `chair-move-history-d-031` (CEO 2026-05-31)
- **D-CO-W2-7** · LIFF OAuth fallback path always available · client `setSession` skipped · server `/api/auth/set-session` is the cookie writer (CEO 2026-05-30 4-bug-fix series)

(Existing chairops D-### still apply: D-CO-001..D-CO-016 from `chairops-audit-2026-05-25.md`)

---

## §12 · Open questions / risks

(Surface to CEO before pilot)

- Q-OWN-1: bankFee in drift formula? (P0 · §6)
- Q-OWN-2: office actorUserId split? (P0 · §6)
- Q-DEVIL-1: POS chair-move auto vs preview? (P0 · §6 · CEO authorized auto on 2026-05-31 — confirm one more time given new info)
- Q-SEC-1: HMAC-bind /api/auth/set-session to OAuth state? (P0 · §6)
- Q-BE-1: Migration applied verified by smoke test? (P1 · §8)
- Q-UX-1: 5th tab "ฝาก" in maid bottom-nav? (P1)
- Q-UX-2: Force office discoverability — link branch-collect from office top-nav? (P1)

---

## §13 · Next steps

1. **CEO** · review §6 Top-5 decisions (5 min)
2. **CEO** · sign off on the answers to Q1-Q5
3. **`/plan chairops-w2-hotfix`** (next skill — implement the P0 list against the locked answers)
4. **Pilot day 0 → 14** per §10
5. **`/auditbigteam --diff chairops`** post-pilot to capture lessons + verify P0 list landed clean

---

## §14 · Visual mockups

Skipped (Phase 2.5) — UI is live; mockup would be redundant. Per LESSONS.md run #2 (chairops 2026-05-28): "when CEO has a fresh visual mockup already, design-sprint/HTML-mockup phases are pure redundancy."

---

## §15 · Source files

- 8 persona reports: `/tmp/audit_chairops_w2_phase1_<BA|SA|SEC|BE|QA|UX|DEVIL|OWN>.md`
- This master spec: `pooilgroup-web/docs/AUDIT_chairops_w2_2026-05-31.md`
- Memory entry: `claude-memory/chairops-audit-wave2-2026-05-31.md` (created next)
- LESSONS append: `~/.claude/skills/auditbigteam/LESSONS.md` (run #4)
