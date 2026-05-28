# BIGFEATURE · ChairOps · Persona QA (Quality Assurance)

> **Persona:** QA · **Run:** /bigfeature ChairOps · **Date:** 2026-05-27
> **Inputs read:** CONTEXT.md · GOAL.md · WAVE_PLAN.md · AUDIT §7 (40 P0 + 12 P1 test cases)
> **Focus:** test scenarios · edge cases · failure modes · verification gates

---

## 1 · Test pyramid plan (per wave)

| Layer | Tool | Wave 0 | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|---|---|
| **Unit** | Vitest | XLSX parser pure fns · drift-engine · COA map | LIFF prefill · idempotency hash | PDF→JSON normalizer · period-lock guard | Filter compose · CSV write |
| **Integration** | Vitest + prisma test DB | diff-preview · branch-fuzzy-match · audit-log writer | webhook HMAC · outbox replay | Gmail label poll mock · Claude extract mock | export-self-audit |
| **E2E** | Playwright on staging | upload → diff → commit (1 happy + 4 sad) | maid full flow · office grid live | bill received → CEO approve | audit query → drawer → export |
| **Manual** | CEO + 1 maid pilot | sample-XLSX walkthrough | 1 branch × 5 days | accountant April-2026 dry-run | quarterly review rehearsal |
| **Real-device** | Android 7/8/9 + iPhone | n/a | 3 devices × 3 WiFi profiles | n/a | mobile KPI 2×3 portrait |

**Coverage target (MVP per CLAUDE.md "no unit-test mandate in MVP"):** unit + integration **only on money-math** (drift · period · COA · idempotency). Everything else = manual checklist.

---

## 2 · Critical test scenarios

### Wave 0 — XLSX + diff + risks
- [ ] **XLSX-1** Idempotency: same file twice → 0 inserts on 2nd run · same hash short-circuit
- [ ] **XLSX-2** Overlap: re-upload Mar-2026 file after Apr-2026 → diff shows "same N · changed 0 · new 0"
- [ ] **XLSX-3** Branch fuzzy: `"เซ็นทรัล ลาดพร้าว"` vs `"central ladprao"` → suggests map · does NOT auto-create
- [ ] **XLSX-4** Empty rows / merged cells / hidden sheet → parser skips · no crash
- [ ] **XLSX-5** 5 MB+ file (300 days × 30 branches) → parse <30s · diff render <2s
- [ ] **XLSX-6** Corrupted XLSX (renamed .zip) → friendly Thai error · no 500
- [ ] **XLSX-7** Thai date BE 2569 vs AD 2026 → both parse to same `bizDate`
- [ ] **XLSX-8** Cost-field edit (rent 30k→32k) → `ChairopsAuditLog` row w/ before+after · `tx_id` propagates
- [ ] **XLSX-9** Diff-preview counts match SQL truth (assert `new+same+changed == total`)
- [ ] **RISK-1** Drift daily-window: window D = sum(cash D)–sum(collect D) · negative → immediate alert
- [ ] **RISK-2** All 3 crons in `vercel.json` and respond 200 on manual curl w/ secret
- [ ] **RISK-3** Module gate: visit `/chairops/pos-ingest` w/ entitlement off → 403 not blank page
- [ ] **RISK-4** No auto-bootstrap admin: fresh Pool admin visiting → `/chairops/access-request` not auto-granted
- [ ] **RISK-5** LINE Notify only fires for `level=CRITICAL` · others suppressed w/ TODO

### Wave 1 — LINE OA + maid PWA + office grid
- [ ] **W1-1** Webhook HMAC fail (wrong secret) → 401 · no DB write · audit "rejected"
- [ ] **W1-2** LIFF outside LINE (open in Chrome) → friendly "เปิดผ่าน LINE OA เท่านั้น" + deep link
- [ ] **W1-3** Offline outbox: airplane mode → submit 3 records → re-online → all 3 land · 0 dupes
- [ ] **W1-4** Photo >5 MB pre-compression → canvas compress 1600px · final <500 KB · sha256 stable
- [ ] **W1-5** clientNonce duplicate: same UUID twice → 2nd returns existing row · no double-credit
- [ ] **W1-6** MANAGER_AREA empty: `getUserAreaBranchIds()` returns `[]` → `/chairops/manager` redirects · no SQL `IN ()` crash
- [ ] **W1-7** Dashboard load: 30 branches × 4 tasks × today → SSR p95 <2s on Vercel Pro
- [ ] **W1-8** Real device: Android Go 7.1 / Samsung A03 / iPhone SE2 × WiFi-good/h4-flaky/4G → all 4 maid flows succeed
- [ ] **W1-9** Cleanliness all-tap = PASS shortcut → records 6 ticks (not default-PASS bug)
- [ ] **W1-10** Damage URGENT → bottom-sheet confirm appears · cancel returns to form intact

### Wave 2 — vendor bills + period + export
- [ ] **W2-1** Gmail OAuth revoked mid-cron → cron logs "auth_expired" · LINE OA push CEO · no infinite retry
- [ ] **W2-2** PDF >20 MB (Claude file limit) → skip + flag DISPUTED w/ reason "pdf_too_large"
- [ ] **W2-3** `dueDate` in past on receive → status auto = OVERDUE · banner red
- [ ] **W2-4** Period SOFT_CLOSED: XLSX upload of closed month → diff-preview shows · commit blocked w/ "request adjustment"
- [ ] **W2-5** Adjustment 0-amount → schema CHECK rejects (amount != 0) · friendly Thai error
- [ ] **W2-6** BC/Express CSV: branch `"ห้างเซ็นทรัล#5"` → escape quote · accents intact in TIS-620 + UTF-8 export
- [ ] **W2-7** AI extract: vendor bill missing `dueDate` → status RECEIVED · field null · approval queue surfaces "incomplete"
- [ ] **W2-8** CEO approve bill → status APPROVED + audit + LINE push · NO auto-pay (per `[[ceo-prefers-manual-ai-triggers]]`)
- [ ] **W2-9** Two officers click "Approve" same bill simultaneously → optimistic-lock `updatedAt` mismatch → 2nd sees friendly conflict toast

### Wave 3 — polish + audit-of-auditors
- [ ] **W3-1** Audit export self-audit: exporting audit creates an audit row pointing to itself · no infinite loop (size-guard)
- [ ] **W3-2** 11 filter combos (entity × action × actor × date × override × cron × JSON-path) → SQL plan uses indexes · p95 <500ms
- [ ] **W3-3** KPI sparkline w/ 1 datapoint · w/ 0 datapoints → renders placeholder · no NaN

---

## 3 · Edge cases the spec missed
- [ ] Branch with **0 chairs** at time of import → revenue rows OK · `paymentsPerChair` = null not divide-by-zero
- [ ] **0-revenue day** (holiday closure) → diff shows "same" · KPI shows ฿0 not "no data"
- [ ] **Songkran 13-15 Apr** consecutive closure across period boundary
- [ ] **Holiday weekend** + maid skip 3 days → cumulative drift window growth (irregular schedule per `[[chairops-maid-schedule-irregular]]`)
- [ ] **DST:** Thailand has none — but if a CEO travels and server logs differ TZ → assert BKK fixed `+07:00`
- [ ] **org_id mismatch:** super_admin browsing as Pool A but ChairOps session = Pool B → guard rejects · no leak
- [ ] **Leap year Feb-29-2028:** drift cron date arithmetic
- [ ] **Branch renamed mid-month** → branchId stays · historical reports keep old name snapshot
- [ ] **Maid LINE userId reused** (LINE acc reset) → re-link flow · old userId archived not deleted

## 4 · Race conditions
- [ ] POS XLSX upload mid-cron `recompute-drifts` → row-level lock or queue · no half-baked drift
- [ ] Two officers approve same vendor bill → see §W2-9
- [ ] Maid collects + office triggers period soft-close in same second → collection lands in OPEN (createdAt < closedAt) · period gauge updates
- [ ] Cron `ceo-digest` running while `sop-check` writes alerts → digest snapshots `READ COMMITTED` · no torn count
- [ ] Two crons same minute (manual trigger + scheduled) → clientNonce `{route+minuteBucket}` deduplicates per `[[chairops-audit-2026-05-25]]` BE finding

## 5 · Failure modes
- [ ] **Vercel cron 60s hobby cap**: drift recompute 30 branches × 5s serial = 150s → exceeds. **Mitigation:** Pool subscription confirmed (300s pro). Add `export const maxDuration = 300`
- [ ] **Anthropic API rate limit (429)** in bill cron → exponential backoff · max 3 retries · mark `extractionStatus=RATE_LIMITED` · CEO sees in queue
- [ ] **Supabase pool exhaust** (60 conn free tier) → ChairOps long-running cron holds conn · monitor + alert
- [ ] **LINE OA rate limit** (500/sec push) → outbox queue · spread sends
- [ ] **R2 5xx** on photo PUT → outbox retry · max 5 · then mark photo `r2_failed` · maid sees orange chip "ภาพยังไม่ขึ้น"
- [ ] **Claude SDK timeout** → return RECEIVED w/ raw PDF · do NOT block · CEO can manual-enter

## 6 · Verification per wave (exit gates)

**Wave 0 acceptance test:**
1. `cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web && pwd && cat .vercel/project.json` confirms Pool project (per `[[verify-cwd-before-vercel-prod]]`)
2. `npm run typecheck && npm run lint && npm run build` ALL clean (typecheck alone insufficient per `[[feedback-real-world-verification]]`)
3. `curl https://pooilgroup.vercel.app/api/chairops/cron/recompute-drifts -H "x-cron-secret: $SECRET"` → 200
4. Upload sample XLSX → diff preview → commit → `/chairops` shows new rows
5. Re-upload same XLSX → diff = "0 new · N same · 0 changed"
6. Edit branch.monthlyRent → audit log row present w/ before+after

**Wave 1 acceptance test:** LINE OA pilot 1 branch × 5 days · 0 LINE Notify usage by Day 5 · all 4 maid flows submit successfully on real Android Go device under flaky WiFi

**Wave 2 acceptance test:** April-2026 BC/Express import ≥ 95% rows · accountant re-keys ≤ 5% · period soft-close blocks new XLSX

**Wave 3 acceptance test:** all 11 audit filters compose correctly · audit export creates self-audit row · mobile KPI 2×3 portrait passes lighthouse a11y ≥ 90

## 7 · Test data generation
**Seed script required:** `scripts/seed-chairops-demo.mjs` modelled on `[[repair-demo-seed-pattern]]`
- 30 branches across 3 malls · 91 chairs distributed
- 90 days of POS data covering: holiday closures · 0-revenue days · maid-skip-3-days · 1 shortage event · 1 surplus event · 1 disputed collection
- Idempotent (delete via `metadata->>'demo'='true'`)
- 5 sample vendor-bill PDFs in `tests/fixtures/bills/` for Gmail mock

## 8 · Pre-prod smoke checklist (before declaring "live")
- [ ] `pwd` shows pooilgroup-web (not buildlygo)
- [ ] `cat .vercel/project.json` → projectId for `pooilgroup`
- [ ] `npm run build` exit 0
- [ ] `curl -I https://pooilgroup.vercel.app/chairops` → 200 (after login redirect)
- [ ] `curl https://.../api/chairops/cron/recompute-drifts -H "x-cron-secret: $S"` → 200
- [ ] Open `/chairops/pos-ingest` → upload sample → see diff → commit
- [ ] Open `/chairops/m/collect/new` on phone → submit collection
- [ ] Open `/chairops/audit` → row present from above 2 actions
- [ ] Vercel dashboard: 3 ChairOps crons listed under "Crons"
- [ ] Sentry/log search "chairops" → no 500s last 1h

## 9 · Flows with NO acceptance test (spec gaps · MUST fix before sign-off)
- [ ] **Branch cost edit history** — D-NEW-F default "current-only" lacks audit-trail acceptance test
- [ ] **Maid LINE link re-bind** — what happens when LINE userId changes
- [ ] **Period HARD_CLOSE undo** — no spec'd test (immutable per design · but need negative test)
- [ ] **Spare-part stock < 0** — what if SHIPPED before RECEIVED? Wave 3 lacks edge case
- [ ] **Audit export concurrent run** — two CEOs export same minute · race undefined
- [ ] **Vendor bill PDF retention 7y** (D-NEW-G) — no automated test for retention boundary

## 10 · TOP-3 HIGHEST-RISK paths if pilot Monday
1. **Drift engine daily-window correctness** — money-math · if wrong CEO sees fake shortage · trust collapses Day 1. Need 13 BR1 cases (audit §7.4) before any branch goes live.
2. **XLSX idempotency + diff-preview accuracy** — CEO re-uploads (per `[[pool-csv-import-must-diff-before-write]]`) · silent dupes = double-counted revenue = wrong drift = cascading distrust.
3. **Offline outbox under ห้างชั้น 4 flaky WiFi** — maid submits, sees success, but record lost → cash collection unrecorded → next-day reconcile = false shortage = maid blamed. Real-device QA non-negotiable.

---

**END · Persona QA · all sections complete · 40 P0 + 12 P1 references mapped to waves**
