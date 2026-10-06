# Post-mortem: Recruit pipeline/inbox showed wrong applicant counts (mobile AND desktop)

**Summary.** The Hiring Pipeline Kanban board and the applications inbox displayed `applications.length` — the length of an array capped server-side at `take:300` across all statuses combined — instead of the real per-status/total count. HR saw "299" on the NEW column when the real count was 766, and a bare "100" in the inbox header with no indication 696 more applications existed. Found via the `/ultramobileux` mobile audit (2026-10-06, `docs/MOBILEUX_recruit-hiring_2026-10-06.md` P0-1/P0-2). Fixed by threading the already-computed, uncapped `countMap` down to both display sites instead of deriving from the capped array. Commit `8e41b80c`, branch `claude/recruit-mobileux-fixes-2026-10-06`, worktree `worktrees/pool-recruit-mobileux-fixes` — **not yet pushed/deployed**, awaiting CEO sign-off.

## Symptom

- `/recruit/pipeline` (Kanban view): the "ใหม่" (NEW) column badge showed **299**. The real count, visible on `/recruit/dashboard` and via a direct DB count, was **766**.
- `/recruit` (applications inbox, list view): the header showed a bare **"100 ใบสมัคร"** with no qualifier, when the real total was **796**.
- Reproduced on both the mobile viewport (390×844) and the desktop viewport — this is not mobile-specific, even though it was found during a mobile-focused audit.

## Root cause

`app/(admin)/recruit/pipeline/page.tsx` loads applications for the Kanban board with a single combined query capped at `take: 300` **across all statuses together**, then groups the results client-side by status into `grouped: Record<ApplicationStatus, AppCard[]>`. Separately, the same page already runs an uncapped `groupBy` query to produce `countMap: Record<ApplicationStatus, number>` — the real per-status totals.

`components/recruit/pipeline-column.tsx` (pre-fix) rendered its badge from `applications.length`, i.e. `grouped[status].length` — the length of the *capped* slice for that status, not the real total. When a single status (NEW) has more rows than fit in the shared 300-row cap, its displayed count silently reads far below reality. The same shape of bug existed in `components/recruit/applications-inbox.tsx`, which rendered `apps.length` (the loaded page of 100 rows) as if it were the grand total, with no "showing X of Y" qualifier.

## Why it produced the symptom

The cap exists to bound the Kanban board's initial payload size — a reasonable perf guard. But nothing distinguished "this is a capped slice for rendering cards" from "this is the count to display in the badge." Both pieces of UI reused the same array for two different purposes (render cards + report a total), and only one of those purposes tolerates truncation. The real total was computed correctly elsewhere on the same page (`countMap`) but never reached the component that needed it.

## Fix

- `app/(admin)/recruit/pipeline/page.tsx`: passed the existing `countMap` down as a new `countMap` prop to `<PipelineBoard>` (it was already being computed, just not forwarded).
- `components/recruit/pipeline-board.tsx`: added `countMap` to its props, passed `totalCount={countMap[s]}` to each `<PipelineColumn>`.
- `components/recruit/pipeline-column.tsx`: added a `totalCount: number` prop, changed the badge to render `{totalCount}` instead of `{applications.length}`.
- `components/recruit/applications-inbox.tsx`: changed the header count to the real total from `countMap`, and added a conditional "(แสดง N รายการล่าสุด)" note when the loaded page is smaller than the real total — so a future cap doesn't silently read as the whole truth again.

This addresses the root cause (wrong data source for the displayed number) rather than raising the cap, which would only move the threshold at which the same bug reappears.

## How it was found

Found live, not by code reading first — a real mobile screenshot of `/recruit/pipeline` during the `/ultramobileux` audit (2026-10-06) showed "299" on the NEW column. The audit cross-checked that number against `/recruit/dashboard`'s reported total and found a mismatch (766 vs 299), then traced the data path: `pipeline-column.tsx:76` (`applications.length`) → `pipeline-board.tsx` (no count prop existed yet) → `page.tsx` (confirmed `countMap` was already computed from an uncapped `groupBy` but never passed down). No false hypotheses needed ruling out — the capped-query comment in the code (`take: 300`) made the mechanism obvious once the mismatch was confirmed. The same check was then run against the desktop viewport, which showed the identical wrong number, correcting an initial assumption (made before verification) that this was mobile-only.

## Why it slipped through

Latent code path: the badge and the capped array were both correct in isolation (a capped query is a legitimate perf choice; a badge rendering `array.length` is normal code) — the bug only exists in the combination, and only becomes *visible* once a single status's real count exceeds the shared 300-row cap. No test or review step compared the badge's displayed number against an independent source of truth (e.g., `/recruit/dashboard`'s total), so a value that was "a real number, just the wrong one" passed every surface-level check.

## Validation

- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit` — 0 errors.
- `NODE_OPTIONS=--max-old-space-size=10240 npx next build` — clean build, all routes compiled including `/recruit/pipeline` and `/recruit`.
- Live verification: started a local dev server from the worktree (not production — production does not have this fix yet), logged in as the test admin (`claude-test@pooilgroup.test`), and took real screenshots at the 390×844 mobile viewport:
  - `/recruit/pipeline` NEW column badge now reads **766** (matches the real count).
  - `/recruit` inbox header now reads **"796 ใบสมัคร (แสดง 100 รายการล่าสุด)"** — honest about the partial load instead of implying 100 was the total.
- Not independently re-verified on the desktop viewport after the fix (the pre-fix bug was confirmed on both; the post-fix screenshot pass only covered mobile, since `countMap` is viewport-agnostic and the same component now serves both).

## Action items / follow-ups

- Updated `~/.claude/skills/ultramobileux/mobile-pattern-library.md` entry M-004 ("mobile view shows capped/paginated count as if it were the real total") with an addendum: this occurrence confirmed the same root cause also silently affects desktop, not just mobile — the bug class isn't viewport-specific, only usually *found* via mobile audits because mobile screens surface fewer numbers per view, making a wrong one easier to spot. (Owner: Claude, done same day via the ultramobileux skill's self-improve step.)
- No regression test added — this project does not require unit tests in MVP phase (per `CLAUDE.md` testing approach); the inbox's new "(แสดง N รายการล่าสุด)" qualifier is itself a structural guard against the same silent-truncation failure mode recurring unnoticed.
- Related: `docs/MOBILEUX_recruit-hiring_2026-10-06.md` P0-5 (postings page loads unbounded, 32,976px) is an adjacent but distinct capped-vs-real-data risk in the same module, not fixed this round — flagged as backend/pagination work, out of scope for a mobile-UI-only fix batch.

Cross-linked from `STATUS.md` → "Recruit — ไล่แก้ครบ 15 จุด mobile UI/UX จากสกิล `/ultramobileux`" (2026-10-06).
