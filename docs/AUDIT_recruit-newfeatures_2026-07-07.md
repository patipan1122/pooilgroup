# AUDIT — Recruit new features (AI resume-read · msg-drafts · batch · profile form · IQ bank)

**Date:** 2026-07-07 · **Mode:** /auditbigteam (8-persona Workflow + adversarial verify) · **Scope:** diff `a4bf9750..01221a85` (deployed) · **Deployed:** pooilgroup.com (LIVE)

## Result
25 raw findings → **18 confirmed** (adversarial-verified). Filtered **1 contamination** (blacklist finding = other worktree `recruit-fixes`, not this diff — workflow ran with `worktree=undefined`, some agents read the wrong worktree; findings verified against `origin/setup` are valid, cross-checked file-by-file against the real diff).

## P1 — must fix (about the shipped features)

| # | Finding | Where | Fix |
|---|---|---|---|
| 1 | **IQ answer key serialized to the applicant's browser** — full fieldSchema (incl. correctAnswer) passed to the public apply client → any candidate can view-source, score 19/19 → HR over-trusts a fake number. Undermines the whole "auto-score". | section-templates.ts (keys) + app/apply/[slug]/page.tsx→apply-client.tsx (leak path) | Strip correctAnswer/correctPoints/hasCorrectAnswer server-side before passing schema to the public client; re-attach from DB only for HR scoring. |
| 2 | **A11Y exclusion** — 19 required, image-only IQ questions block submission; blind/low-vision candidates can't complete a hiring test (legal/disparate-impact). | section-templates.ts (required:true) + public-form-renderer.tsx (img alt generic) | Make IQ section optional (required:false) + exclude from any auto-cut; add real alt/skip path. |
| 3 | **medium-4 answer key inverted** — template says "a", SVG's authored answer is "b" → scorer marks correct wrong. | section-templates.ts + medium-4.svg | DROP medium-4 (disputed a-vs-b; 6 other medium remain). |
| 4 | **AI endpoints skip checkAiBudget** — résumé-vision + 20× batch don't call the cost circuit-breaker (record-only). Runaway cost. | lib/recruit/ai.ts (scoreResumeFile/draftMessage), _actions/ai.ts | Add checkAiBudget() pre-gate (mirror ledger/cashhub). |
| 5 | **résumé-read can score a face photo** — files.find picks first PDF/image; a selfie can be fed to vision for a hiring score (bias/PDPA), contradicting the "no photo/age/gender" promise. | _actions/ai.ts:88 | Prefer application/pdf; skip/ warn if only an image. |
| 6 | **résumé no size guard** — whole R2 object base64→Sonnet vision, no byte cap (5MB only in helpText). Cost/timeout footgun. | _actions/ai.ts + lib/recruit/ai.ts | Reject if resume.size > cap before AI. |

## P2 — should fix
- batch re-scores already-scored cards = double-spend (skip aiEvaluatedAt) · ฿2/score is a hardcoded guess
- doc/docx accepted but AI can't read → silent dead-end (drop docx or warn)
- résumé-score vs form-score overwrite same aiScore fields, no provenance badge for HR
- IQ question text shown twice (field label + baked in SVG)
- AI draft overwrites text HR already typed (add confirm)
- mobile checkbox tap target 28px < 44px on horizontally-scrolling kanban
- broken/404 IQ image traps candidate on a required question (add onError)
- interview-invite draft can pick a stale/past interview (filter scheduledAt >= now)
- résumé parse-fail persists score 0, wiping a prior good score (skip write on fail)
- UI copy "ทั้งคู่ไม่ตัดสินจากรูป/อายุ/เพศ" is inaccurate for the résumé path (model DOES see the photo) — fix copy + add advisory

## Filtered / out of scope
- **Blacklist company-scope removed** (blacklist-match.ts) — NOT in this diff; belongs to branch `recruit-fixes` (separate in-progress work). Flag to owner of that branch.

## Top-5 for CEO eyes
1. IQ key leak (#1) — makes auto-score meaningless until fixed
2. A11Y exclusion (#2) — legal exposure on a hiring instrument
3. medium-4 wrong key (#3) — flips real hiring signal
4. checkAiBudget (#4) — cost runaway
5. résumé-scores-photo (#5) — bias/PDPA

## Note on method
Workflow `args.worktree` arrived `undefined` → agents fell back to reading various recruit worktrees. Most findings self-verified against `origin/setup` (the real deployed code) and cross-checked here against the actual `a4bf9750..01221a85` file list. Lesson logged to auditbigteam LESSONS.md.
