# AUDIT — RentSpace (บริหารพื้นที่เช่า) · 2026-09-20

**Mode:** Full · Compressed (correctness-focus — no redesign requested; Phase 2 design-sprint + Phase 2.5 mockup + separate Phase 3 critique fan-out skipped; conflict ledger showed 0 substantive cross-persona contradictions so Phase 1 discovery synthesizes directly into sign-off)
**Roster:** 19 personas in 6 clustered agents — core 13 + OFC/FIN/AUD (money-reconcile) + A11Y (public tenant portal) + SEC (e-sign/LINE-OAuth/portal-tokens) + SRE (cron/webhook)
**Trigger:** CEO requested `/auditbigteam` → `/bigsolvebug` → `/upspeed` in sequence on RentSpace only, no other program.
**Prior runs referenced:** 2026-08-07 12-lens audit (19 findings, 14 shipped `10b9b7df` 2026-08-09, confirmed still live 2026-09-13); 2026-09-06→09 matrix slip-gate patches. This run's NEW lenses vs those prior runs: SEC-deep (e-sign/portal-tokens/rate-limiting), A11Y (public tenant portal), SRE (cron reliability), and a fresh QA/FE/DEVIL pass on the now much-larger route surface (12→59+ files since the original June spec).

---

## 1. Executive Summary

RentSpace is live, actively used, and structurally sound at the architecture/security layer — no P0 security holes, LINE identity across 3 touchpoints is correctly unified, doc-numbering races are already guarded, RLS-bypass is the known repo-wide pattern (not a RentSpace-specific gap). The real risk concentrates in **one root cause**: staff-entered payment amounts count as "paid" and hit revenue KPIs **immediately on entry**, with the AI slip-check running *after* and only blocking at the final send-to-ledger step. This is the direct cause of the 4 real bills currently stuck with mismatched amounts, and it will keep producing new ones every month until fixed at the entry point, not case-by-case.

Two further clusters matter before `/bigsolvebug` starts touching this code: (1) the exact functions that compute and gate money — `evaluateBillSlipGate()` and the billing engine itself — have **zero automated test coverage**, so the next two skills in this sequence will be editing the highest-risk code with no safety net; (2) two maker-checker gaps (single-bill hard-delete, discount self-approval) sit right next to already-fixed siblings that got the guard — these look like the guard was added once and not propagated, an easy, low-risk fix.

Everything else found is real but lower-stakes: a dead UI feature (UnitDrawer), a broken CSS class flattening the tenant-facing portal's text hierarchy, inconsistent bill-status labels across screens, missing cron alerting, and a handful of security hardening gaps (rate-limiting, e-sign audit trail) with no live exploit found.

**Findings: 7 P0 · 19 P1 · 8 P2. 0 BLOCKED personas, 2 CONDITIONAL (QA, AUD) — see §8.**

---

## 2. Scope

**IN:** all 12 admin functional areas (units/tenants/contracts/meters/bills/matrix/payments/deposits/collections/analytics/import/settings) + public bill/portal/sign routes + LIFF + LINE OAuth/webhook + monthly-bill cron + all 17 `Rental*` Prisma models.
**OUT (per CEO instruction):** ChairOps, ClawFleet, LedgerLine, CashHub — not touched, not read beyond what's needed to confirm namespacing/isolation.
**DEFERRED:** none hardware-related (no HW in this module). Phase 2 design-sprint/mockup deferred by mode choice (see header) — if CEO wants a visual redesign pass later, re-invoke `/auditbigteam RentSpace --mode=design` or `/claude-design`.

---

## 3. Current Information Architecture (lite — no full sitemap re-design this run)

Admin nav (desktop sidebar, `lib/modules.ts`): dashboard, units, tenants, contracts, meters, bills, matrix, payments, deposits, settings. **Collections and Analytics have NO sidebar entry** — reachable only via dashboard quick-links (finding UX-IA-5, §7). Public surface: bill/[token] (view), portal/[token] (tenant self-service), sign/[token] (e-sign), LIFF entry (rich-menu → portal).

---

## 4. Design Tokens

Module-scoped tokens live in `components/rentspace/tokens.css` (`.rs-scope`), meant to extend `~/.claude/skills/auditbigteam/tokens.md`. Discovery found real drift from that source of truth: `--rs-text-3` fails WCAG AA contrast (~2.56:1) and has been hand-patched around twice locally instead of fixed at the token; the overview dashboard bypasses the tokens entirely (hardcoded hex, no Lucide icons, 7 emoji-as-icons). See §7 UX/A11Y findings.

---

## 5. Findings (clustered by root cause, most-severe first)

### 🔴 Cluster A — Money counted as "paid" before it's verified (root cause of the 4 stuck bills)
- **[OWN]** Staff-typed payment amount counts as paid + hits "เก็บได้เดือนนี้" KPI **immediately on entry**; AI slip-check runs after, and only *blocks* at the final "ส่งเข้าบัญชี" step — no check at entry (maker-checker gap). This is why the 4 mismatched bills happened and will keep recurring monthly unless fixed at the entry point.
- **[AUD] P0** `actDecideDiscount` has no requester≠approver check — same person can request and approve their own discount. Sibling flows (`actDecideVoidBill`, `actDecideContractEdit`) already have this guard. `app/(admin)/rentspace/_actions.ts:2653-2677`

### 🔴 Cluster B — Financial records can be destroyed with no trace
- **[FIN/AUD] P0** `actDeleteBill` hard-deletes a bill's full payment history with **no `paidAmount>0` guard**, while its sibling `actDeleteBillsBulk` (added later, same file) explicitly blocks deleting paid bills — the single-delete path never got the fix. `app/(admin)/rentspace/_actions.ts:2069-2111` (vs `:2118-2173`); reachable via `bills/[id]/_components/bill-detail-actions.tsx:791`
- **[AUD] P0** `RentalBill`/`RentalPayment`/`RentalBillItem`/`RentalDiscount` are true hard-deletes, not soft-deletes — conflicts with the repo's legally-mandated ≥5yr audit retention rule; audit-log snapshot only captures bill items, not payments. `app/(admin)/rentspace/_actions.ts:2069-2173`
- **[AUD] P1** No content-hash on uploaded payment-slip/ID photos — relies entirely on R2 bucket integrity, no cryptographic proof for สรรพากร/dispute evidence. `_actions.ts:135-144`, `lib/r2/upload.ts`

### 🔴 Cluster C — The exact code that computes and gates money has zero test coverage
- **[QA] P0** `evaluateBillSlipGate()` — the last gate before money posts to the accounting ledger — has zero repeatable test, only a manual live-DB script. `lib/rentspace/ledger-push.ts:108`
- **[QA] P0** The real billing engine (`buildBill`/`recomputeBillTotals`/`createBillForContract` — meter reads, late fees, status derivation) is entirely untested; only a pure sub-function is CI-gated. `lib/rentspace/billing.ts:252,419,459`
- **[QA] correction]** CI *does* run the one existing test (`.github/workflows/ci.yml:32`) but the CI **Build** step is disabled (`if: false`) and typecheck failures only warn — less safety net than "no CI" implies.
- **[QA] P1** Mid-month move-**out** is not prorated: `moveOutDate` is written on termination but never read anywhere in the billing engine. `_actions.ts:1187` vs `billing.ts` (0 references).
- **[QA] P1** E-sign has no token-expiry check and a non-transactional double-submit race on `tenantSigned`. `app/sign/rentspace/[token]/_sign-action.ts:34,49`

### 🟡 Cluster D — Built but disconnected (features that exist but don't reach the person who needs them)
- **[QC] P0** `UnitDrawer` (inline quick create-bill/record-payment popup) is mounted globally in the layout but **never triggered anywhere** — zero setters found repo-wide. Fully dead feature. `components/rentspace/unit-drawer.tsx` + `drawer-host.tsx` (mounted `layout.tsx:27`)
- **[STAFF] P1** Field staff (member-tier role) **cannot open the slip-verification page at all** — gated admin-tier only. Any mobile-UX investment there is currently wasted since the intended user can't reach it.
- **[BE] P1** Auto-billed (cron) and bulk-issued bills never trigger tenant notification — `notifyBillIssued` is wired only into the single-bill manual send action. A stale comment in the same file falsely claims "no LINE channel yet" even though LINE+email notify is fully implemented elsewhere. `_actions.ts:2451`, stale comment `:2429-2434`
- **[MGR] P1** The "ตามเก็บ" (collections) page records incoming payments well but has **no send-reminder button** — automatic notification fires once, at initial bill issuance, only.
- **[IA] P1** "Mark a bill paid" has two disconnected entry points (bills list vs. matrix cell click) with no cross-reference between them.

### 🟡 Cluster E — System can fail silently, nobody finds out
- **[OWN] P1** Overview dashboard has no signal at all for "slip amount mismatch" or "cron failed this month" — the data already exists (visible on `/matrix`) but nothing surfaces it proactively; fails the "know the problem in 10 seconds" bar.
- **[BE] P1** Monthly cron (`app/api/cron/rentspace-monthly-bills`) has no project-level error handling — if one project's query throws, the whole route dies uncaught, silently skipping every remaining project with zero alerting, on a job that only runs once a month.
- **[QA] P1** Even within a project, the cron swallows per-contract errors into a bare counter with no retained detail — one silently-failed contract means one tenant quietly never gets billed.
- **[SEC] P1** CRON auth has an unintended bypass: any external caller can skip the `CRON_SECRET` check by simply setting the header `x-vercel-cron`. `app/api/cron/rentspace-monthly-bills/route.ts:17-24`

### 🟢 Cluster F — Security hardening gaps (no P0, no live exploit found)
- **[SEC] P1** Zero rate-limiting on every public route (e-sign save, portal slip-upload that triggers AI OCR, LINE OAuth) despite a reusable limiter already existing in-repo (`lib/chairops/utils/rate-limit.ts`).
- **[SEC] P1** E-sign action never records IP/user-agent even though the `audit_logs` schema + `audit()` helper already support it — legally weak for e-sign defensibility. `app/sign/rentspace/[token]/_sign-action.ts:66-73`
- **[SEC] P1** `dangerouslySetInnerHTML` on the contract body with zero sanitization anywhere in the repo, reaching the public unauthenticated e-sign page. Admin-only writer today, but no defense-in-depth. `components/rentspace/contract-document.tsx:70,123`
- **[SEC] P2** Hardcoded fallback secret for OAuth-state HMAC if env vars are unset. `lib/rentspace/line.ts:144-146`
- **[SEC] P2 × 3]** Minor defense-in-depth gaps (public bill route over-fetches full tenant PII server-side but doesn't leak it; 2 queries missing an org filter, not currently attacker-reachable). Full detail in persona file.
- **[SA] Verified clean** — LINE identity is correctly unified across all 3 touchpoints (Messaging/Login/LIFF), namespaced env vars, constant-time webhook signature check. **[BE] Verified clean** — doc-numbering (bill/tax-invoice) has proper unique-constraint + retry; no race.

### 🟡 Cluster G — Inconsistent UI (correctness-adjacent, not pure polish)
- **[QC] P0** `className="rs-text-2"` is used as a literal CSS class 13+ times on the **public tenant portal**, but no such class exists (only a `--rs-text-2` custom property) — silently flattens text hierarchy on the highest-stakes screen tenants see. `app/rentspace/portal/[token]/_components/portal-client.tsx` (13+ sites), `not-found.tsx:9,12`
- **[QC] P1** The same bill's paid/overdue status renders 3 different Thai labels depending on which screen you're on — one bill can show "เกินกำหนด" and "ค้างชำระ" simultaneously on the same page.
- **[A11Y] P1** `--rs-text-3` computes ~2.56:1 contrast on white — fails WCAG AA, used for meaningful content module-wide including public routes. Already hand-patched around twice locally without fixing the source token.
- **[UX] P1** Overview dashboard — the first screen every user sees — ignores RentSpace's own design tokens entirely (hardcoded hex, raw SVG instead of Lucide, 7 emoji-as-functional-icons).
- **[UX] P1** "List → new page → back" navigation pattern used across units/tenants/contracts/bills, against the project's master-detail UI mandate.

### ⚪ Cluster H — Investment/scale questions (no bug, needs a CEO call)
- **[PM]** Program grew from the original 12-route/14-table spec to 17 tables/59+ files in 3 months, with most of that growth going into a LINE self-service ecosystem (OAuth login + LIFF + bot + e-sign + redline) for a single 50-unit pilot. Usage rate of this ecosystem is unknown (no DB access this run) — worth checking before further investment.
- **[DEVIL]** The 2D/3D site map (`site-map-3d.tsx`) is structurally single-tenant — hardcoded to one property's coordinates (`TALAYTOWN_SCENE`) despite the types looking general-purpose. Fine for the pilot; would need real work to support a 2nd property.
- **[DEVIL]** Contract-template versioning + redline + addendum system is **not** overengineered — proportional to real legally-binding leases. Recommend keeping as-is.
- **[FE] P1** `_actions.ts` is a 2,889-line, 56-function file holding every mutation for the whole module — the single biggest structural risk for the upcoming `/bigsolvebug`/`/upspeed` passes (any targeted fix risks unrelated collateral edits in this file).
- **[SA] P1** Every screen is locked to one "primary" project (`getPrimaryProject()`, 12 call sites) — a 2nd RentSpace property would be invisible in the main nav.

---

## 6. Acceptance Criteria (for the next 2 skills in this sequence)

**⛔ Pilot pass/fail bar (bigsolvebug must hit before calling this module "fixed"):**
1. `actDeleteBill` refuses to hard-delete a bill with `paidAmount>0`, matching `actDeleteBillsBulk`'s existing guard.
2. `actDecideDiscount` blocks self-approval (requester ≠ approver), matching `actDecideVoidBill`/`actDecideContractEdit`.
3. `evaluateBillSlipGate()` has an automated test covering match/mismatch/missing-slip cases.
4. `rs-text-2` on the public portal either becomes a real class or is replaced with the correct `.rs-scope` token usage.
5. Monthly cron: a single project's failure no longer kills every remaining project in the same run.
6. CRON route no longer accepts a spoofed `x-vercel-cron` header as a substitute for `CRON_SECRET`.

**Per-screen ACs:** see the persona detail files (path in §9) for the full per-finding fix criteria — not duplicated here to keep this doc CEO-readable.

---

## 7. Persona Sign-off Table

| Persona | Status | Conditions / Blockers |
|---|---|---|
| PM | ✅ PASS | — |
| BA | ✅ PASS | — |
| SA | 🟡 CONDITIONAL | single-project lock-in should be flagged to CEO before any 2nd-property plan |
| FE | 🟡 CONDITIONAL | `_actions.ts` god-file raises collateral-edit risk for the next 2 skills — recommend file-partitioning before large fix waves |
| BE | ✅ PASS | — |
| QA | 🟡 CONDITIONAL | will not sign full PASS until §5 Cluster C (zero test coverage on money-gating code) has at least the ⛔ bar covered |
| QC | ✅ PASS | — |
| UX | ✅ PASS | — |
| IA | ✅ PASS | — |
| OWN | 🟡 CONDITIONAL | wants Cluster A (maker-checker) treated as a process decision, not just a code fix — see §8 |
| MGR | ✅ PASS | — |
| STAFF | ✅ PASS | — |
| DEVIL | ✅ PASS | — |
| OFC | ✅ PASS | — |
| FIN | ✅ PASS | — |
| AUD | 🟡 CONDITIONAL | hard-delete-of-paid-financial-records conflicts with the org's own audit-retention rule; wants a CEO decision on soft-delete migration, not just the discount/delete guards |
| A11Y | ✅ PASS | — |
| SEC | ✅ PASS | no P0; P1s are hardening, not live exploits |
| SRE | ✅ PASS | — |

**0 BLOCKED. 5 CONDITIONAL (SA, FE, QA, OWN, AUD).** No Phase 4.5 patch round needed — all conditions are "needs a CEO decision" not "needs more audit work."

---

## 8. 🎯 Top 5 Decisions Needing CEO Eyes

1. **Maker-checker on manual bill-amount entry** — owner: OWN/AUD · cost-if-wrong: **HIGH** (real money misrecorded, recurring monthly) · This is a workflow change (hold the amount as "pending review" until slip-verified, instead of counting it paid on entry), not a one-line bug fix — needs CEO buy-in since it changes daily staff routine. CEO action: ☐ approve hold-until-verified flow / ☐ keep current flow + just fix the 4 stuck bills case-by-case / ☐ other
2. **Hard-delete of paid financial records** — owner: AUD · cost-if-wrong: **HIGH** (conflicts with the org's own 5-year audit-retention rule; a mistaken or malicious delete is unrecoverable) · CEO action: ☐ approve soft-delete migration (schema change, moderate effort) / ☐ accept the risk, just add the paid-guard (cheap fix, doesn't solve retention) / ☐ defer
3. **Zero test coverage on money-computing/gating code, right before 2 more skills touch it** — owner: QA · cost-if-wrong: **HIGH** (silent breakage from the very next steps in this sequence) · CEO action: ☐ approve adding tests as step 0 of `/bigsolvebug` / ☐ proceed without, accept the risk
4. **LINE self-service ecosystem — continue investing or pause for usage data?** — owner: PM · cost-if-wrong: **MEDIUM** (opportunity cost, not money-loss) · CEO action: ☐ pull usage numbers before more LINE-side work / ☐ keep building, it's working fine / ☐ not now
5. **Dead/disconnected features** (UnitDrawer built-unused, staff locked out of the mobile slip-check page they need, auto-billed tenants never notified) — owner: QC/STAFF/BE · cost-if-wrong: **MEDIUM** (wasted build effort + the notification gap compounds finding #1) · CEO action: ☐ wire up or delete UnitDrawer / ☐ open slip-check to staff tier / ☐ both / ☐ neither right now

---

## 9. Reference

- Full per-persona findings (§summary/§concerns/§decisions/§files_reviewed): `/private/tmp/claude-501/-Users-patipantantikul-Code-buildlygo/c1739937-23b1-449e-b1c5-0629bb0f53bb/scratchpad/audit_rentspace_phase1_*.md` (6 files — ephemeral scratchpad, not committed; ask Claude to re-generate if needed after this session ends)
- Original spec: `docs/BIGFEATURE_rentspace_SPEC.md` (2026-06-13) — now stale re: table/route count, still valid re: business intent
- Deploy runbook: `docs/RUNBOOK_rentspace_deploy.md`
- Prior audit: 2026-08-07 12-lens run → `10b9b7df` (2026-08-09) — 14/19 findings shipped, confirmed live 2026-09-13
- Test scaffold generated: `tests/regression/rentspace-audit-2026-09-20.scaffold.ts`

**Next step (this run does not auto-execute it):** `/bigsolvebug RentSpace` — hand this doc's §5/§6 directly to it as known findings + fix criteria, so it doesn't re-discover from scratch.
