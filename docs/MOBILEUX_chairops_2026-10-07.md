# MOBILEUX — ChairOps, full module (2026-10-07)

> CEO command: `/ultramobileux โปรแกรมเก้าอี้นวด ทุกหน้าเลย` — no specific prior complaint, a full-coverage audit of every reachable ChairOps surface. Mobile-only scope (desktop not evaluated). This is the largest `/ultramobileux` run to date: 73 routes mapped, 63 real mobile screenshots captured (390×844@2x), 15-persona fan-out (12 core + SA/BE/SEC add-ons, loaded because the module handles money, PII, and a LINE integration).

> **2026-10-07 update**: CEO said "แก้ไปเลยสิ" (just go fix it) — 8 fix batches (A–H) landed same day on branch `claude/chairops-mobile-fixes-2026-10-07`, committed and typecheck/build-verified but **NOT yet deployed** (awaiting CEO push approval). Each fixed finding below is marked `✅ FIXED` with its batch/commit. 3 items are explicitly NOT done yet: P0-2/P0-3 (Sentry DSN — needs CEO to retrieve it, no code fix possible), P0-4 (LINE secret split — investigated + planned, execution needs separate CEO approval per RULE J's coordinated-rotation risk), and the forced-camera-only question for `deposit/form.tsx` which turned out to already be correctly built (false positive, see Batch B commit `c644859e`).

## §1 Executive verdict

ChairOps is architecturally sound in several places (idempotent cash-collection writes, a well-built self-healing permission reconciler, correctly-fixed camera bugs from a prior incident, a genuinely good office bottom-nav component) — but this audit surfaced **9 independent P0-severity issues**, several of which are not "mobile polish" at all: a live production crash caught *during* the audit (invisible because site-wide error monitoring is still broken), real PDPA-sensitive documents (ID cards, selfies, bank slips) served from unauthenticated public URLs indefinitely, a secret-sharing violation that could silently break two *other* programs' LINE login, and a support tool ("เล่นเป็นแม่บ้าน") that lies to the admin who uses it. None of these were things the CEO asked about by name — they surfaced specifically *because* the audit went page-by-page with real screenshots and real code verification, the way this skill is designed to work.

Convergent evidence matters here: several findings were independently discovered by 5+ of the 15 personas working in parallel without seeing each other's output — that's a strong signal they're real, not one persona's misreading.

## §2 Top decisions needing CEO eyes (highest blast radius first)

1. **PII exposure (ID cards/selfies/bank slips are public URLs)** — ✅ **FAST-PATH FIXED** (Batch C, commit `624a3d06`): added an authed proxy (`/api/chairops/photo`) in front of every render site — the app's own HTML no longer embeds the bare public URL, a ChairOps session is required to view. DB still stores the raw public URL and the bucket itself is still technically public if someone already has an old link — **full fix (migrate to private bucket + presigned GETs) is still open**, CEO explicitly chose the fast path first.
2. **Sentry ยังพังทั้งเว็บ** — NOT fixed, no code fix possible · still needs CEO to retrieve the real DSN from sentry.io.
3. **`CHAIROPS_LINE_LOGIN_CHANNEL_SECRET` แชร์ข้าม 2 โปรแกรม** — investigated in full (see memory `chairops-fixes-batch-a-h-2026-10-07`), turns out LOWER risk than assumed (plain OAuth secret, not a key-derivation input — rotating it can't brick encrypted data). Plan written, **presented to CEO, execution not yet approved**.
4. **"เล่นเป็นแม่บ้าน" โกหกว่าสำเร็จ** — ✅ **FIXED** (Batch F, commit `a95ee61d`): synced the grant-side route and the session-swap gate to the same allowed-role list, AND added the role-ceiling check (`canManageUser`) on both sides so an org_admin/admin can never reach a peer-or-superior account.
5. **ปุ่ม "ปิดสาขา" ไม่มี confirm dialog** — ✅ **FIXED** (Batch A, commit `7ff936ae`): `window.confirm()` gate added before the close/reopen action fires.

## §3 Methodology note (read before reading any screenshot evidence below)

ChairOps's bottom nav is genuinely `position:fixed` (confirmed in code at both `maid-shell.tsx:337` and the office equivalent — both correctly reserve bottom padding via `pb-[calc(64px+env(safe-area-inset-bottom))]`). Playwright's `fullPage` screenshot capture stitches fixed-position elements at a single pixel position in the tall output image, which can make content look like it sits "behind" or "after" the nav bar when it doesn't in real scrolled use. This was confirmed as a pure capture artifact (not a real bug) via a direct real-viewport re-capture (screenshot 29 vs. 29c) and independently re-confirmed by 4 different personas reading the actual CSS. **No nav-overlap finding in this report is asserted as real** — every persona was briefed on this and cross-checked before reporting.

## §4 P0 — fix before anything else (business-critical, not polish)

| # | Finding | Status |
|---|---|---|
| P0-1 | **ID card photos, selfies, and bank-slip photos are served as public, unauthenticated R2 URLs with no expiry.** `components/chairops/id-card-upload.tsx:7`, `app/api/r2/sign/route.ts:125-130`. | ✅ FAST-PATH FIXED — Batch C `624a3d06`, see §2 |
| P0-2 | **Sentry error monitoring is still sitewide broken** (placeholder DSN, ~140 days old) + 4/7 ChairOps `error.tsx` boundaries never call `Sentry.captureException`. `app/(admin)/chairops/(maid)/error.tsx:22-24`, `.../pos-ingest/error.tsx:17-19`. | ❌ NOT FIXED — needs real DSN from CEO |
| P0-3 | **A real production crash happened during this very audit** — `/chairops/pos-ingest/i/[id]` Server Component render error, digest `2550650762`. | ❌ NOT FIXED — blocked on P0-2 (no monitoring to confirm it's resolved) |
| P0-4 | **`CHAIROPS_LINE_LOGIN_CHANNEL_SECRET` is silently the fallback LINE-login secret for `ledger`/`clawhub` too** (and dormant for a 4th, `rentspace`, via the `default` arm). `lib/line/channels.ts:51-70`. | 📋 PLANNED, not executed — see memory, awaiting CEO approval |
| P0-5 | **"เล่นเป็นแม่บ้าน" reports false success**, and separately had zero role-ceiling check. `app/api/admin/users/[id]/impersonate/route.ts:28` vs `lib/auth/session.ts:69`. | ✅ FIXED — Batch F `a95ee61d` |
| P0-6 | **Damage-report and cleanliness-checklist forms have zero duplicate-submission protection.** `app/(admin)/chairops/damage/actions.ts:17-23`, `app/(admin)/chairops/cleanliness/actions.ts:55-111`. | ✅ FIXED (code) — Batch D `d12333f3` · ⚠️ **migration not yet applied to production** (schema change needs separate go-ahead, see RULE P) — code will break submits if deployed before the migration runs |
| P0-7 | **"ปิดสาขา" has no confirmation dialog.** `.../branch-close-buttons.tsx:41-53`. | ✅ FIXED — Batch A `7ff936ae` |
| P0-8 | **The office exec dashboard (`/chairops`) overflows the mobile viewport entirely** (1396px vs 780px). `app/(admin)/chairops/(office)/page.tsx:372,560,562,567`. | ✅ FIXED — Batch A `7ff936ae` (`min-w-0` on the ancestor flex/grid containers) |
| P0-9 | **Review-queue is an unpaginated wall of up to 100 full-res photos, 75,428px tall.** `app/(admin)/chairops/(office)/review-queue/page.tsx:18-21,106-110`. | ✅ FIXED — Batch E `cdbb22fe` (paginated 12/page, real aggregate totals) |

## §5 P1 — fix soon (real problems, lower blast radius or needs more design)

- **Legacy `AdminShell` top-nav causes a logo/tab collision, 9 pages.** `components/chairops/features/admin-shell.tsx:8-18`. — ❌ NOT FIXED
- **Floating AI-chat button / Pinpoint session bar collide with ChairOps's bottom nav.** `components/layout/admin-shell.tsx:203-208`. — ✅ **PARTIALLY FIXED** — Batch A `7ff936ae` added ChairOps to the AI-chat allowlist; Pinpoint's `SessionBar` collision is a separate, larger gap (hardcoded position, no module-awareness at all) — still open.
- **"Button looks enabled but isn't" (M-001) recurs across 5+ forms.** — ✅ FIXED — Batch G `5139c50a` (4 forms switched to calling the real validator in `disabled`; contract e-sign got a new `hasSignature` state + the step-1 preview gate)
- **54-branch lists on 2 pages have no search.** — ✅ FIXED — Batch H `85e25ddd`
- **Contract form missing `required`/`aria-required`.** — ❌ NOT FIXED
- **4 daily-use maid forms force camera-only photo capture.** — ✅ FIXED on 6/7 originally-flagged sites — Batch B `c644859e` (CEO confirmed: not intentional, open gallery too). `deposit/form.tsx` was a **false positive** — already had a correct dual camera/gallery button pair, documented in the commit instead of "fixed."
- **AI slip-reading (Gemini) calls skip `checkAiBudget()`.** — ✅ FIXED — Batch A `7ff936ae` (both call sites gated)
- **`/chairops/maids` roster has no pagination/search; status chip clips at device edge.** — ✅ Search fixed (Batch H, same fix as the 54-branch item above) · chip-clipping NOT fixed
- **Misleading top-line dashboard stat ("POS วันนี้ -96.7%").** — ❌ NOT FIXED (needs a design decision, not a quick patch)
- **Same-branch cross-maid IDOR risk.** — ❌ NOT FIXED (unconfirmed exploitability — no branch currently has 2+ active maids)
- **`?error=forbidden` redirect silently dropped on maid home.** — ✅ FIXED — Batch A `7ff936ae` (ported `ForbiddenToast` + `redirectTo` prop)

## §6 P2 — polish / lower-urgency (unchanged, none addressed this round)

- `mm/dd/yyyy` unlocalized native date inputs recur on 5+ forms
- Write-off self-approval rate is 82%
- Branches tagged "ไม่เคยเก็บ" with large negative drift
- Maid branch-switcher bottom sheet has no visible close button
- One task card on maid home shows a status badge instead of a chevron
- `write-offs` list renders a blank empty state
- POS-ingest file upload has no retry/backoff
- No cleanup cron for orphaned R2 uploads/stale POS-import rows
- Zero funnel/analytics instrumentation
- `batchDeposit` doesn't treat a hash collision as idempotent-success the way `createCashCollection` does

## §7 Good patterns already in the codebase (extend these, don't reinvent)

- **Cash-collection idempotency** — the reference pattern Batch D (P0-6) copied.
- **Office bottom-nav component** — well-designed; the gap was coverage, not the component.
- **Reconcile page's search box + aggregate summary row** — the exact pattern Batch H copied for the 2 unsearchable 54-branch lists, and Batch E's aggregate-total fix for review-queue followed the same spirit.
- **Bills matrix table** — best mobile-table treatment in the module.
- **Reconcile's slip-photo lightbox** — same pattern Batch E's pagination borrowed the page-param convention from (`chairops/audit/page.tsx`, not reconcile directly, but same idea).
- **Camera bug fixes from 2026-09-23 are holding.**
- **Opt-out-by-exception checklists** (collect, cleanliness) — genuinely good design, untouched this round.
- **LINE rich-menu setup page's pre-flight credential health check.**

## §8 Untestable this round (needs a real device / real account) — unchanged

- The LINE LIFF entry point itself (`/liff/chairops`).
- Real camera/selfie/signature-pad behavior on `/m/contract` and `/m/onboarding`.
- `/m/onboarding`'s true first-run state and `/m/deactivated`'s true render.
- Native date-picker rendering inside LINE's in-app browser specifically.
- Whether any live branch actually has 2+ active maids.
- Whether the impersonation bug was reachable client-side as a followed-redirect-as-success in practice — moot now, P0-5 is fixed either way.

## §9 Phased fix plan — actual outcome vs. original synthesis

**Phase A (shipped as Batch A, `7ff936ae`)**: P0-7, P0-8, `?error=forbidden` toast, AI-chat allowlist, AI budget gate on slip-OCR. P0-4 (LINE secret split) was in the original Phase A list but turned out to need its own approval gate — moved to planned-only, see §2.

**Phase B (shipped as Batches C/D/E/G/H)**: P0-5 (`a95ee61d`), P0-6 code (`d12333f3`, migration pending), P0-9 (`cdbb22fe`), 54-branch search (`85e25ddd`), M-001 (`5139c50a`), P0-1 fast-path (`624a3d06`).

**Phase C**: still CEO/ops-input-gated, untouched — forced-camera question resolved as a false positive for 1/5 forms (not a real Phase-C decision after all), "ไม่เคยเก็บ" branches, write-off self-approval rate, Sentry DSN.

---

*Screenshots: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/scratchpad/shots/chairops/` (63 files + verification pairs). Full persona outputs available in session transcript — this doc is the orchestrator's synthesis of all 15, not a transcript dump, per RULE K.*
