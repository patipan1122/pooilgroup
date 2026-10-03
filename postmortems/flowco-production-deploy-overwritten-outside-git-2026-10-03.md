# pooilgroup.com production deploy overwritten outside git (2026-10-03)

## Summary

`pooilgroup.com` briefly served a production build that was never pushed through git — a direct `vercel deploy`/`vercel --prod` run from a different machine/session overwrote the production alias, silently reverting the just-shipped CashHub FlowCo fix (commit `4d9d2cf4`, which added FlowCo station 2002 "62 STATION" to the fuel sales report). Fixed by `vercel promote` back to the last git-built deployment. No code in the app repo was ever wrong — `origin/setup` stayed correct throughout. The gap is in deploy process: `verify-gate.py` only guards `git push`, not direct Vercel CLI deploys.

## Symptom

CEO sent a screenshot of `https://pooilgroup.com/cashhub/flowco?view=matrix&mode=month` showing "ทุกสาขา (21)" with no "62 STATION หลังโลตัสหัวทะเล" row — the exact state from before commit `4d9d2cf4` shipped a few hours earlier. A fresh headless screenshot (Playwright, `scratchpad/shot-retry-login.mjs`) of the same URL reproduced it: branch count 21, total ฿632.8M, no ste-2002 row.

## Root cause

`git log origin/setup` showed no revert of `4d9d2cf4` and no commit touching `lib/cashhub/flowco-branch-map.ts` after it — `git show origin/setup:lib/cashhub/flowco-branch-map.ts` confirmed ste 2002 was still present in the file on the remote branch. So the regression was not in git history at all.

`vercel ls` showed two "Ready" Production deployments:
- `pooilgroup-mkaxebnum-...` — 8h old, built from commit `0dbeb56c` (the git-pushed STATUS.md update on top of the fix) — **correct**.
- `pooilgroup-fei6ks8kl-...` — created `Sat Oct 03 2026 19:14:24 GMT+0700`, 1h old, aliased to `pooilgroup.com` — **the one actually live**.

`vercel inspect <fei6ks8kl-url> --meta` returned no git commit/branch/SHA metadata for the newer deployment — Vercel only attaches that metadata to deployments triggered by its git integration (a `git push`). A deployment with no git metadata at that timestamp means it was produced by running the Vercel CLI (`vercel` / `vercel --prod`) directly against some local checkout, not through GitHub. That checkout's copy of `lib/cashhub/flowco-branch-map.ts` did not have the ste-2002 addition — whether because it was pulled before `4d9d2cf4` landed, or is a long-lived local clone on another machine that was never updated, is not knowable from the Vercel side; the deployment carries no identifying info beyond the timestamp.

Context: a separate Claude Code session was active the same evening, working on FlowCo data-sync infrastructure (`192.168.1.14`, a local office PC with direct DB access, per `CLAUDE_CODE_HANDOFF.md` referenced in that session's own transcript) and has Vercel CLI credentials for this same project. That session is the most likely source of the direct deploy, though this was not directly confirmed (no deploy-time terminal log was available to inspect).

## Why it produced the symptom

Vercel's alias system (`pooilgroup.com` → current production deployment) accepts the *last* deployment marked Production, regardless of whether it came from `git push` or a bare `vercel deploy --prod`. The git-pushed deployment at `mkaxebnum` had the fix; the out-of-band deploy at `fei6ks8kl` ran 1 hour later from stale local source and silently took over the alias, with no warning that it diverged from `origin/setup` HEAD.

## Fix

```
vercel promote https://pooilgroup-mkaxebnum-patipan1122s-projects.vercel.app
```

promotes the existing, already-built `mkaxebnum` deployment (built from `origin/setup` commit `0dbeb56c`) back onto the `pooilgroup.com` alias. This re-points production at a known-good, git-traceable artifact rather than rebuilding — faster and avoids re-introducing any uncertainty about what source produced the build.

This is not a code fix — nothing in the app repo changed. The fix is purely a deploy/alias operation.

## How it was found

1. CEO sent a screenshot of the live report missing station 2002.
2. `git fetch origin setup && git log --oneline -10 origin/setup` — ruled out a git-level revert; `4d9d2cf4` and everything after it was intact.
3. `git show origin/setup:lib/cashhub/flowco-branch-map.ts | grep -n "2002"` — confirmed the source file on the remote branch still has the fix, ruling out "wrong commit merged" entirely.
4. `vercel ls` — found two Ready production deployments, one 8h old (expected) and one unexpected 1h-old entry.
5. `vercel inspect <new-url>` — confirmed it was aliased to `pooilgroup.com` and had no git commit metadata, which is the tell for a CLI-direct deploy vs. a git-triggered one.
6. A fresh headless screenshot of the live site confirmed the symptom matched the CEO's report exactly (21 branches, no ste 2002, same total magnitude as pre-fix).
7. `vercel promote` to the known-good deployment, then `vercel inspect pooilgroup.com` to confirm the alias moved, then another fresh headless screenshot confirming station 2002 was back (฿30.4M, "ทุกสาขา (22)").

No hypothesis was rejected along the way — the git-history check and the `vercel ls` listing pointed at the cause directly on the first pass.

## Why it slipped through

Process gap, not a CI or code-review gap: `verify-gate.py` (a `PreToolUse` hook on `git push`) checks a clean working tree and a `.claude-verified` stamp bound to `HEAD` before allowing a push to `setup`/`main`/`master`. It has no equivalent check for `vercel deploy`, `vercel --prod`, or `vercel promote` — those commands bypass the hook entirely because they never match `git push` in the hook's command-regex gate. Any session or person holding Vercel CLI credentials for this project can push a build straight to production with no git diff, no typecheck, no review, and no record of what source produced it.

This is the first time two concurrently-active Claude Code sessions (this one, working in the `pooilgroup-web` git checkout, and the other, working directly against the office DB on a different machine) both had deploy access to the same Vercel project at the same time. The gate was built assuming all deploys go through git; it was not designed against a second, independent deploy path existing at all.

## Validation

- `vercel inspect pooilgroup.com` after the promote: `url: pooilgroup-mkaxebnum-patipan1122s-projects.vercel.app`, `id: dpl_pma3nwb1kcJuUEUYWDJGprBKviyK` — alias confirmed pointed at the correct, git-built deployment.
- Fresh headless screenshot (mobile viewport, logged in as test admin) of `https://pooilgroup.com/cashhub/flowco?view=matrix&mode=month` post-promote: "62 STATION หลังโลตัสหัวทะเล" row present at ฿30.4M, footer reads "ทุกสาขา (22)", total ฿663.3M.
- Only this one page/view was re-checked. Other pages were not swept for divergence from the rogue deployment — if that deployment differed from git in other files too (not just the FlowCo branch list), those differences were also reverted by the promote, but were not individually enumerated or confirmed.

## Action items

- Open question, not yet decided: should `verify-gate.py` be extended to also intercept `vercel deploy` / `vercel --prod` / `vercel promote` / `vercel alias set` the same way it intercepts `git push`? This would close the gap but needs the CEO's call since it affects anyone who ever needs a quick manual deploy. No ticket filed yet.
- Needs a human-to-human (or session-to-session) coordination fix: whoever is running the FlowCo DB-sync session on the office PC needs to deploy app-code changes through `git push` to `setup`, not direct `vercel` CLI, so it goes through `verify-gate.py` like every other change. Owner: CEO, to communicate to that session/operator.
- No regression test added — this is an infra/process gap, not an application bug, so there is no code seam to add a test at.
