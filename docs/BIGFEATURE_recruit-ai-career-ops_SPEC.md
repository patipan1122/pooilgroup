# BIGFEATURE — Recruit AI (Career Ops-inspired) — SPEC

**Branch:** `feat/recruit-ai-career-ops` (off `origin/setup` @ a4bf9750)
**Mode:** Full ship (build + verify + audit → CEO test → deploy)
**Trigger:** CEO saw GitHub "Career Ops" (job-seeker tool) → wants its capabilities in our employer-side **Recruit** module.

## Direction flip
Career Ops helps **job seekers**; our Recruit helps the **employer**. The 6 Career Ops features map to employer-side tools. 3 already exist (pipeline tracking · analytics dashboard · form-answer scoring). **3 gaps** to build:

| # | Feature | Career Ops origin |
|---|---|---|
| F1 | AI reads the actual résumé file (PDF/image) + scores | "AI Resume Optimization" |
| F2 | AI drafts candidate messages (invite/offer/reject/request-docs) | "Cover Letter Generation" |
| F3 | Batch actions on many applicants (score/move/message) | "Batch Processing" |

## Goal lock
- **Who uses:** HR / recruiter (org_admin + recruit-write roles). Not public.
- **Business goal:** cut HR screening time; standardize candidate comms; handle high-volume postings.
- **Success metric:** HR scores a résumé in 1 click (was: open PDF + read manually); draft a message in 1 click; process 20 applicants in 1 action.
- **Touches:** Recruit module only. Shared: `lib/ai/cost-cap` (metering), `lib/r2` (storage), `lib/audit`.
- **Migration:** NONE (all 3 reuse existing schema).

## Project consistency requirements
- **Design tokens:** reuse `--color-brand-*` (Recruit's existing token set). No new tokens.
- **Guards:** every action `requireSession()` + `canRecruitWrite(role)` + org scope (`orgId: session.user.org_id`).
- **Audit:** every AI/destructive op → `audit({ orgId, userId, action, resourceType, resourceId, diff })`.
- **Cost:** every Anthropic call → `trackRecruitUsage(endpoint, model, resp, track)` (post-hoc, best-effort, never blocks).
- **Models:** use existing consts `HAIKU_MODEL="claude-haiku-4-5"` / `SONNET_MODEL="claude-sonnet-4-5"`. **NEVER change model ids** ([[feedback-never-change-ai-model-from-guess]]).
- **AI = manual trigger only** ([[ceo-prefers-manual-ai-triggers]]) — button-press, never auto-run, never auto-send.

## F1 — AI résumé read + score
- **New:** `lib/r2/upload.ts::getObject(key)` (R2 fetch bytes, via shared `./client`).
- **New:** `lib/recruit/ai.ts::scoreResumeFile({ jobTitle, jobDescription?, file:{bytes,mime,name}, formAnswersText?, track? }): CandidateScore` — SONNET, document/image content block, timeout 30s. Reuses `CandidateScore` shape → UI/DB unchanged.
- **New:** `_actions/ai.ts::scoreResumeAction(applicationId)` — pick first PDF/image file, R2 fetch, call, write same `aiScore/aiSummary/aiStrengths/aiRisks/aiEvaluatedAt`, audit `RECRUIT_AI_SCORED_RESUME`.
- **UI:** `application-ai-panel.tsx` — 2nd button "อ่านเรซูเม่ + ให้คะแนน", shown only when `hasResumeFile`.
- **Guards/gotchas:** filter to `application/pdf` + `image/*` (DOCX unreadable → clear error "แปลงเป็น PDF ก่อน"); reinforce bias guardrail in prompt (résumé shows photo/age/gender → "ห้ามตัดสินจากรูป/อายุ/เพศ/ภูมิลำเนา"); 30s timeout; 5MB cap already enforced upstream.

## F2 — AI draft messages
- **New:** `lib/recruit/ai.ts::draftMessage({ kind, candidateName, postingTitle, companyName?, interviewWhen?, interviewKind?, interviewLocation?, missingDocs?, track? }): string` — HAIKU, plain-text Thai, max_tokens 600, 15s.
- **New:** `_actions/ai.ts::draftMessageAction(applicationId, kind)` — fetch app+posting+earliest upcoming interview; if `kind==="interview_invite"` and no interview → return `{ ok:false, error:"ยังไม่ได้นัดสัมภาษณ์..." }` (blocks hallucinated date); format date server-side (`th-TH`), inject as literal; audit `RECRUIT_AI_DRAFTED`. **Returns text only — does NOT send.**
- **UI:** `message-thread-view.tsx` — "✍️ ร่างด้วย AI" row + 4 kind buttons above composer; on click → `setBody(draft)` (HR edits + sends via existing Send). Separate `isDrafting` transition.

## F3 — Batch actions
- **New:** `lib/recruit/batch-actions.ts` — `batchChangeStatus(ids, status)`, `batchScore(ids)`, `batchSendMessage(ids, channel, body)`. Each: guard, loop over ids scoped by org, per-item try/catch (partial-failure resilient), audit per item, return `{ ok, failed:[{id,error}], done:number }`.
- **Rate/cost (batchScore):** AI budget cap = 30 calls/hr/user. Cap batch at **20 items**; compute cost estimate before run (`~฿X`); on per-item AI error (incl. rate limit) → stop, report `done/total` + which failed → HR resumes later.
- **Idempotency:** button `disabled` while running (isPending); status set is naturally idempotent; batch-message requires explicit confirm.
- **UI:** `pipeline-column.tsx` (+ `application-card.tsx`) — checkboxes, lift `selectedIds:Set` to column, sticky `BulkActionBar` when `size>0`. Cost-confirm dialog before batchScore.

## Consistency checklist
- [x] Uses host module design tokens (`--color-brand-*`)
- [x] Gates: `canRecruitWrite` + org scope
- [x] All AI/destructive ops audited
- [x] Manual AI trigger only (no auto-run/auto-send)
- [x] Model ids unchanged
- [x] Mobile-responsive (reuse existing responsive components)
- [x] No migration
- [ ] Verify: typecheck + build clean (per wave)
- [ ] Audit workflow (auditbigteam) → fix findings
- [ ] CEO manual test before deploy

## Risks (ranked)
1. **F3 batch AI cost/rate** — 50 résumé scores could be ฿150 + blow hourly cap. Mitigated: cap 20 + cost-confirm + graceful stop.
2. **F1 bias** — résumé exposes photo/age/gender; prompt must forbid using them. Mitigated: explicit guardrail (matches existing scoreCandidate).
3. **F1 cost logging** — `computeAiCostUsd` may not know `claude-sonnet-4-5` → vision logged as $0. Mitigated: verify/patch `lib/costctrl/pricing.ts`.
4. **F2 hallucinated date** — mitigated: hard block when no interview row; date injected server-side.

## Decisions (defaults taken under CEO full-authorization "ดำเนินการทำทั้งหมดได้เลย")
- **D1:** F1 reuses existing `aiScore` fields (no separate résumé-score column) → no migration. Résumé call also includes form answers → holistic score.
- **D2:** No hard budget pre-gate on single scoring (parity w/ existing). Batch gets soft cap + cost-confirm.
