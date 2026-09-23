# BugSolve · RentSpace · 2026-09-20

**Mode:** Targeted (fed directly from `docs/AUDIT_RentSpace_2026-09-20.md` — known findings + CEO-answered decisions, not a fresh 25-persona crawl from zero). Step 2 of a CEO-requested 3-skill chain (`/auditbigteam` → `/bigsolvebug` → `/upspeed`) run on RentSpace only.

## §summary
- ✅ 7 P0 + ~14 P1 fixed across 3 commits (schema, code, tests) — money-approval gaps closed, soft-delete replaces hard-delete, new super_admin permissions page shipped, test coverage added to previously-untested money-gating code.
- ⏳ 1 item deferred (needs CEO approval to add a new npm dependency — HTML sanitizer for the e-sign contract body).
- 🔴 0 items need CEO decision before merge — all 5 of the audit's Top-5 decisions were answered by CEO before this pass started and implemented exactly as directed.
- **Correction to the original audit**: the "UnitDrawer is dead" P0 finding was a false positive — it's triggered live via the 2D/3D site-map click path, the audit only checked one of two trigger mechanisms. Not removed; left as-is.

## §scope
3 commits on branch `claude/rentspace-bigsolvebug-2026-09-20` (pushed, not merged to `setup`): schema migration, code fixes (30 files), tests (2 new files + CI wiring). No other program touched.

## §bugs-fixed (P0 + P1)

| # | Finding | Fix | Commit |
|---|---|---|---|
| 1 | `actDeleteBill` had zero guard against deleting a **paid** bill | Paid bills now blocked from direct delete; routes to a new super_admin-approval request flow (`actRequestDeleteBill`/`actDecideDeleteBill`) | `3cf176ac` |
| 2 | `actDecideDiscount` allowed self-approval, gated to any admin-tier | Restricted to `super_admin` role only | `3cf176ac` |
| 3 | `RentalBill`/`Payment`/`Discount` hard-deleted — conflicts with ≥5yr audit-retention rule | Soft-delete (`deletedAt`) everywhere; ~85 read call sites across 14 files threaded with the filter | `4c6aa364`, `3cf176ac`, `dd123874` |
| 4 | `evaluateBillSlipGate()` + billing engine had zero test coverage | 25 test cases added (`slip-gate.run.ts` ×12, `billing-engine.run.ts` ×13), wired into CI | `be611994` |
| 5 | CRON auth bypassable via spoofed `x-vercel-cron` header | Removed the bypass branch, matches the other 16 cron routes' strict pattern | `dd123874` |
| 6 | Cron had no per-project error isolation — one project failing silently skipped every other project | Each project now wrapped in its own try/catch; response reports per-project success/failure | `dd123874` |
| 7 | `rs-text-2` used as a literal CSS class on the public tenant portal — doesn't exist, only a `--rs-text-2` token variable | 14 sites converted to the repo's established `style={{color:"var(--rs-text-2)"}}` pattern | `dd123874` |
| 8 | Auto-billed (cron) + bulk-issued bills never notified tenants; stale comment falsely claimed no LINE channel exists | `notifyBillIssued` now called from the reminder path too; comment corrected | `3cf176ac` |
| 9 | Zero rate-limiting on e-sign save / portal slip-upload / LINE OAuth callback | Added using the existing `lib/chairops/utils/rate-limit.ts` limiter, no new dependency | `dd123874` |
| 10 | E-sign: no token-expiry check | 90-day staleness check added (proxy via `contract.updatedAt` — no dedicated expiry column exists; documented limitation) | `dd123874` |
| 11 | E-sign: non-transactional double-submit race | Converted to the repo's established `updateMany` WHERE-guard idiom (mirrors `actConfirmTenantPayment`) | `dd123874` |
| 12 | E-sign: no IP/user-agent audit trail | Captured via `headers()`, logged into the existing `audit()` entry's `ipAddress`/`userAgent` fields | `dd123874` |
| 13 | Bill status rendered 3 different labels across screens (same bill could show contradictory statuses) | Unified into one canonical `billDisplayStatus()` in `lib/rentspace/format.ts`, 9 call sites updated | `dd123874` |
| 14 | Mid-month move-out never prorated (`moveOutDate` written, never read) | Proration added to `buildBill()`, day-based, electric/water stay usage-based (unprorated) | `dd123874` |
| 15 | Meter-reading resync read live VAT config instead of the frozen per-item snapshot | Existing item's `vatable` now preserved on resync; only computed fresh for genuinely new items | `3cf176ac` |
| 16 | Dashboard had no signal for slip-mismatch or cron failure | New "ยอดสลิปไม่ตรง" attention banner on the overview page | `dd123874` |
| — | **NEW feature (CEO-requested):** super_admin permissions settings page | `RentspacePermission` table + `lib/rentspace/permissions.ts` (mirrors `lib/ledger/permissions.ts`) + settings-page toggle UI; wired to slip-verification page access (default unchanged, now configurable) | `4c6aa364`, `dd123874` |

## §bugs-deferred

| Severity | Item | Reason |
|---|---|---|
| P1 | `dangerouslySetInnerHTML` on `contract-document.tsx` (reaches public e-sign page) unsanitized | No HTML sanitizer installed in this repo; adding a new npm dependency (recommend `isomorphic-dompurify`) needs CEO approval per project convention — not added without asking |

## §regression-pass
- `tsc --noEmit`: 0 errors (checked after every commit)
- `npm run lint` scoped to all 37 touched files: 1 pre-existing error in `unit-drawer.tsx` (React hooks rule, unrelated to any change made this pass — not introduced by this work)
- `npm run build`: exit 0, full production build succeeded, all RentSpace routes compiled including the new `/rentspace/settings` permission panel
- Money-module pre-flight: `RentalBill`/`Payment`/`Discount` row counts unchanged before/after (38/36/20), 0 soft-deleted rows, 0 pending delete-requests — confirms no unintended data mutation from schema/code changes (no live app traffic exercised the new write paths during this session)
- New test suite: 25/25 cases pass (`slip-gate.run.ts`, `billing-engine.run.ts`)

## §persona-coverage
Not a fresh 25-persona crawl — this run consumed the prior `/auditbigteam` run's 19-persona findings directly (fed via prompt context) rather than re-discovering them, per the skill's Targeted mode. Live runtime verification was done via `next build` + the new automated test suite rather than a Playwright persona walk, given the fix set was already fully specified by the audit + CEO's decisions.

## §next-actions (CEO must decide)
1. Approve adding `isomorphic-dompurify` (or another sanitizer) so the e-sign contract-body HTML fix can land — the only deferred item.
2. Decide when to merge `claude/rentspace-bigsolvebug-2026-09-20` (+ the audit-doc branch + this) into `setup` — currently held separate to avoid an unplanned deploy; merging will trigger a Vercel deploy per this repo's usual flow.
3. Try the new settings page (`/rentspace/settings`, scroll to "สิทธิ์การใช้งาน") and decide whether to open slip-verification access to `staff`/`branch_manager` roles (currently still defaulted OFF, matching prior behavior).

## §lessons-this-run
- 💚 worked: feeding a same-day `/auditbigteam` doc's findings directly into `/bigsolvebug`'s Phase 0 context (file:line + fix criteria already known) skipped an entire redundant discovery crawl — went straight to Phase 5 (fix) + Phase 6 (verify), saving the ~500k-token persona-walk budget entirely.
- 💚 worked: file-partitioned parallel agents (5 running concurrently across non-overlapping file sets) + the core money-logic (`_actions.ts` schema/approval workflows) done directly by the orchestrator to avoid same-file collisions — zero merge conflicts across the whole run.
- 💚 worked: CEO's explicit, itemized answers to the audit's Top-5 (rather than "use your judgment on everything") meant zero re-litigation mid-fix — every ambiguous call (super_admin-only vs admin-tier, soft-delete vs guard-only, remove-vs-keep UnitDrawer) was already decided going in.
- 🔧 finding-class (already logged to auditbigteam's finding-library, worth noting here too): a "dead component" finding that only checked ONE trigger mechanism (URL query param) missed a second, working trigger (local React state via a different parent component) — future dead-code checks should grep for every plausible trigger shape, not stop at the first pattern that returns zero hits.
- 📊 cost: ~1.4M subagent tokens across 7 parallel agents (1 recon + 5 fix batches + 1 test-writer) + orchestrator direct edits (schema, `_actions.ts` core, settings UI, dashboard signal). 3 commits, 30+ files touched, 0 typecheck errors, 0 new lint errors, clean production build.
