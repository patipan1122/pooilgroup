# AUDIT · inbox · 2026-05-30

> 6-persona focused audit (UX · IA · OWN · MGR+STAFF · DEVIL · A11Y) of the just-shipped Pooil Inbox module.  Code-side bugs handled by `/bigsolvebug` earlier the same day (commit `a1e067e` — 17 fixed, 11 deferred).
>
> This doc covers what bigsolvebug did NOT — design/UX coherence, business workflow, accessibility, scope discipline.  Phase 2 Design Sprint + 2.5 HTML mockups skipped (module is live, not pre-launch).

## §1 Executive summary

**Three-sentence TL;DR**:

The inbox is a beautifully-built **chairops customer-support tool with 6 extra businesses bolted on**.  Every "B/C/D" grade traces to the same root cause — `classify.ts`, templates, alert routing, and the trainer system prompt are chairops-hardcoded, while business.ts opens `botCapable=true` for 7 verticals.  Two architectural decisions this week (per-vertical classifier + per-business alert target) move 4 verticals from D→B; five more over Q3 (assignment · SLA · lead pipeline · bot scorecard · retention) get the module to SaaS-grade omnichannel for the 17-seat team.

**Status**: ✅ Live, serving customers (43 FB + 1 LINE).  Code quality high (bigsolvebug fixed 17 issues same day).  Architecture quality MEDIUM — works for 1 vertical at 1× scale, will sag at 5× without the shipping list below.

## §2 Scope (IN / OUT / DEFERRED)

**IN**: `/inbox`, `/inbox/bot`, `/inbox/settings/channels`, `/inbox/settings/channels/facebook-import|paste`, 3 webhooks, OAuth start+callback, daily-summary cron · ~3,000 LOC across 25 lib files + 11 components.

**OUT**: code-level bugs (handled by bigsolvebug today) · /api/webhooks/recruit/* (different module sharing same patterns) · Buildly Go inbox (separate project per memory `[[architecture-c-separate-deploy-share-auth]]`).

**DEFERRED (hardware-blocked)**: none — module is software-only.

## §3 Persona sign-off

| Persona | Status | 1-line condition |
|---|---|---|
| **UX** | 🟡 CONDITIONAL | Mobile <lg breakpoint is broken (no back button, no filter access). 44-channel rail = scroll fest. |
| **IA** | 🟡 CONDITIONAL | Naming inconsistency across sidebar/page/tab labels (4 verbs for "train bot"). No `/inbox/settings/` index page. No cross-module jumps. |
| **OWN** | 🟡 CONDITIONAL | KPI strip on /inbox header is point-in-time, not "today's delta" or "today's cost" — wrong shape for a CEO of 8 businesses. |
| **MGR + STAFF** | 🔴 BLOCKED | No assignment model, no SLA, no per-staff metrics → cannot grade admin performance, cannot prevent double-replies. |
| **DEVIL** | 🔴 OBJECTS-BUT-ACCEPTS | Says delete 1,147 LOC trainer + 246 LOC flow-images + 200 LOC paste-JSON UI + 110 LOC Realtime broadcast + 5/7 non-chairops verticals. Will not sign off until at least the leaked 43 tokens are rotated. |
| **A11Y** | 🟡 CONDITIONAL | 10+ touch targets below 44px · zinc-400 contrast failures at 10-11px text · no live region for realtime messages · 3 textareas with no `aria-label`. |

**Aggregate**: 4 CONDITIONAL · 1 BLOCKED · 1 OBJECTS-BUT-ACCEPTS · 0 PASS.  Reasonable signal for a same-day audit on a freshly-shipped module — but the 1 BLOCKED (workflow) and the DEVIL escalation point to the same root cause: shipping per-business UX without the per-business plumbing underneath.

## §4 Top concerns by P-severity

### P0 (5 items · CEO this week)

| # | Domain | Concern | Lead persona | Cost-if-ignored |
|---|---|---|---|---|
| **A1** | Security | 43 FB Page Access Tokens leaked twice in CEO chat transcript today.  Tokens still active.  Anyone with the log = 43 pages under control. | DEVIL | Brand reputation · attacker can DM customers as CEO businesses |
| **A2** | Mobile | `/inbox` middle pane goes blank on `<lg` after picking a conversation — NO BACK BUTTON, NO FILTER ACCESS.  17-seat team includes mobile staff today. | UX + STAFF | Staff abandon mobile, all triage falls on desktop users |
| **A3** | Workflow | No assignment model — 17 staff race on the same conversation, can double-reply via `sendReply` (no outbound idempotency).  Memory `[[chairops-maid-one-per-branch-collect-only]]` predicts this. | MGR | Customer gets contradictory replies; admin morale crashes after 2 incidents |
| **A4** | KPI shape | `/inbox` header surfaces 4 point-in-time counts (open/needsHuman/urgent/leads); CEO wants today-vs-yesterday delta + bot-deflection % + MTD AI cost. | OWN | Bill shock + invisible bot ROI + no firing-grade signal for admins |
| **A5** | Channel filter rail | 44 channels in plain rows, no search/group/collapse. 4 weeks from now with 100+ channels = unusable. | UX + IA | Triage becomes "scroll for the right page", time-per-reply doubles |

### P1 (8 items · this sprint)

| # | Concern | Lead | Fix shape |
|---|---|---|---|
| B1 | No SLA / response-time tracking | MGR | Derive from `lastInbound`/`lastOutbound`, badge red if `inbound > outbound AND age > 30min` |
| B2 | No bot performance scorecard | OWN + DEVIL | `botDeflected` count in `summary.ts` daily push; visible "yesterday bot saved N replies" cell on /inbox |
| B3 | Touch targets ×10 below 44px | A11Y | `h-7`/`h-8`/`size-9` → `h-11`/`size-11` across status pills, copy buttons, trash, business chips |
| B4 | No live region for realtime new messages | A11Y | `<div role="status" aria-live="polite" id="inbox-announce">` + write on broadcast |
| B5 | Reply UX has no optimistic bubble · 1-4s blank after Send | STAFF | Append optimistic bubble pre-server-confirm; replace on resolve |
| B6 | Per-business UX is half-built (8 chips · 5 dead verticals · chairops-hardcoded classifier+trainer+templates) | DEVIL + OWN | Either ship per-vertical classifier OR pull bot toggle from non-chairops channels |
| B7 | No `/inbox/settings/` index page · /inbox/bot/?biz= URL pattern doesn't deep-link cleanly | IA | Rename sidebar to "ฝึกบอท"; move to `/inbox/bot/[biz]` route OR keep `?biz=` but add canonical link generator |
| B8 | Channel health silent — Tiny Food fb token expires at 2am, nobody knows until next morning | MGR + OWN | Morning brief cron at 08:30 ICT runs 6 health probes (LINE/FB token alive · Realtime alive · Gemini alive · DB alive · cron alive · webhook alive) and pushes a 🟢/🟡/🔴 line |

### P2 (12+ items · captured in §11 backlog)

## §5 Top 5 Decisions Needing CEO Eyes

(highest blast radius — CEO veto would change the audit's recommendations)

1. **AI budget: per-business or per-org $50/mo cap?** — `lib/inbox/bot/ai.ts:10`. With 44+ channels in 1 org cap, one business's bot spike starves chairops bot mid-month.
   - owner: OWN
   - cost-if-wrong: high (silent bot death across all verticals)
   - CEO action: ☐ raise org cap to $200 / ☐ split per-business / ☐ leave as-is

2. **Lock bot toggle to `businessTag === 'chairops'`?** — until per-vertical classifier + trainer ship.  Today 7 verticals show the toggle; turning it on for Owl Cha gives tea customers chair-shop replies (bigsolvebug deferred BOT-004).
   - owner: DEVIL
   - cost-if-wrong: medium (CEO embarrassment; not catastrophic)
   - CEO action: ☐ lock to chairops / ☐ accept the risk and warn admins / ☐ ship per-vertical first

3. **Delete the Claude Sonnet 4.6 trainer chat (1,147 LOC) and replace with a 2-field FAQ form?** — DEVIL's strongest call.  Currently we use $$$$ Claude to train a bot that has 0 FAQs and a single vertical live.
   - owner: DEVIL
   - cost-if-wrong: low (you'd lose a hot demo · gain 1,147 LOC freed)
   - CEO action: ☐ delete now / ☐ delete after 5 FAQs land via trainer to prove value / ☐ keep

4. **Rotate 43 leaked FB Page Access Tokens TODAY?** — DEVIL's "fire today" signal.  Tokens are in chat transcript; rotating costs 5 minutes via Graph API Explorer.
   - owner: DEVIL
   - cost-if-wrong: very high (impersonation across CEO's businesses)
   - CEO action: ☑ rotate now (no debate — just do it)

5. **Build assignment model (`assignedToId` on InboxConversation + "งานของฉัน" filter)?** — MGR's BLOCKED concern.  Without this, the 17-seat team has no ownership; performance reviews are impossible.
   - owner: MGR
   - cost-if-wrong: medium-high (admin morale erodes within 2 weeks of double-reply incidents)
   - CEO action: ☐ ship next sprint / ☐ pre-sprint hotfix / ☐ stay in "free-for-all" mode

## §6 Sitemap (current)

| Route | Who | KPI | Status |
|---|---|---|---|
| `/inbox` | admin · staff w/ inbox entitlement | TTFR · resolved-without-phone-rate · unread>24h | ✅ live |
| `/inbox?c=<id>&status=…&biz=…` | same | shareable URL state | ✅ |
| `/inbox/bot?biz=<tag>` | org_admin+ | FAQ count · bot reply% · deflection | ✅ live (chip switcher) |
| `/inbox/settings/channels` | admin tier | channels active/setup/error · last-event freshness | ✅ live · scaling concern at 200+ channels |
| `/inbox/settings/channels/facebook-import` | admin | OAuth success rate | 🟡 OAuth dialog breaks at 40+ pages (bigsolvebug FB-001 deferred) |
| `/inbox/settings/channels/facebook-paste` | admin | paste-import success | 🟡 DEVIL says delete after 43 imported |
| **`/inbox/settings/` (index)** | — | — | ❌ **doesn't exist** (IA gap) |
| **`/inbox/triage` (escalation queue)** | mgr | unanswered across all biz | ❌ **doesn't exist** (MGR ask) |
| **`/inbox/insights` (per-staff metrics)** | mgr | reply count · TTFR per admin | ❌ **doesn't exist** (MGR ask) |
| **`/inbox/leads` (lead funnel)** | own | leads → close rate | ❌ **doesn't exist** (OWN ask) |
| API routes | webhooks · oauth · cron | per-route 200% | ✅ — bigsolvebug verified |

## §7 Naming + label sweep

Settle on this vocabulary across sidebar · page H1 · Section labels · tab labels:

| Concept | Today (varies) | Recommend |
|---|---|---|
| Inbox module | "กล่องข้อความ" / "กล่องข้อความรวม" | **กล่องข้อความรวม** (the "รวม" is the differentiator) |
| Bot trainer | "ตั้งค่าบอท" (sidebar) / "ฝึกบอท" / "สอนบอท" / "เทรน" | **ฝึกบอท** consistently · drop English "เทรน" |
| Channel page sidebar entry | "เชื่อมช่องทาง" | **LINE + Facebook** (concrete) |
| FB OAuth button | "เชื่อม Facebook (หลายเพจ)" | **เชื่อมด้วย Facebook Login** (signals OAuth) |
| Paste-JSON button | "Paste JSON" (English-only · CEO freezes) | **ใช้วิธีพิเศษเมื่อปุ่มบนใช้ไม่ได้** OR **วาง Token (สำรอง)** |
| Manual single-channel add | "เพิ่มทีละช่อง" (ambiguous) | **เพิ่ม LINE OA ทีละบัญชี** (FB has 2 dedicated paths) |
| `personal` businessTag | "ส่วนตัว / แฟนเพจ" | **ส่วนตัว / แฟนเพจ (บอทตอบไม่ได้)** suffix in dropdown |

## §8 A11y baseline (post-bigsolvebug, pre-this-audit)

Already fixed (bigsolvebug):
- `aria-pressed` on status pills (CH-004)
- `aria-label` on bot toggle including channel name (CH-005)

Still open · ranked by effort:
- **QW-1** live region for new realtime messages (~12 LOC)
- **QW-2** bump 10 touch targets to `h-11`/`size-11` (~25 LOC)
- **QW-3** `aria-label` on 3 textareas (~6 LOC)
- **QW-4** SR prefix on bubbles + unread count (~10 LOC)
- **QW-5** `useReducedMotion` for trainer auto-scroll (~15 LOC)
- BR-1 keyboard listbox + skip links (design call)
- BR-2 10-11px font budget — raise to 12px floor or re-color above 7:1 (design call)
- BR-3 native `confirm()` → `ConfirmDialog` (design call, 3 sites)

## §9 Locked decisions

D-INBOX-001 · Audit decision · Lock business-tag list at 8 (chairops · pooil · owl_cha · fnb · hotel · playland · personal · other) · Pre-DEVIL "delete 5 verticals" recommendation requires CEO override.  Default = keep until ≥1 channel + ≥3 FAQs are written for a vertical.

D-INBOX-002 · Audit decision · Mobile <lg responsive plan = "sliding workspace" pattern (drawer for filters, back button for detail, bottom-sheet for contact panel) · per CEO memory `[[ceo-prefers-multi-pane-workspace]]` that says "no list → new page → back."

D-INBOX-003 · Audit decision · Real-time stays as broadcast (RT-003 cross-org enum risk acknowledged, deferred until Realtime Authorization policy ships in Q3) · NOT reverting to 4s poll per DEVIL's call (broadcast is already shipped and stable).

D-INBOX-004 · Audit decision · Skip Phase 2 Design Sprint + 2.5 HTML mockup this run (module is live, not pre-launch).  If CEO wants visual mockup for the §11 hero-screen redesigns, re-run audit with `--with-mockup` flag.

D-INBOX-005 · Per the goal directive, no auto-`/plan` after this audit · CEO reads, decides on Top 5, manually queues next.

## §10 Pilot Plan / Sprint Allocation

### Sprint 1 (week of 2026-06-02) — 5 dev-days estimated · "stop the bleed + fix mobile"

| Day | Item | Effort | Owner |
|---|---|---|---|
| 1 AM | **A1** rotate 43 FB tokens via Graph API Explorer (15min) + verify all 43 channels still receive (45min) | 1h | CEO |
| 1 PM | **A2** mobile back button + sliding filter drawer on /inbox | 0.5d | FE |
| 2 | **A3** assignment model — schema (`assignedToId` + `assignedAt`) + UI assignee chip + filter | 0.5d FE + 0.5d BE | FE + BE |
| 3 | **A4** KPI header strip rewrite — today vs yesterday + bot deflection + MTD AI cost | 1d | FE + BE |
| 4 | **A5** channel rail group-by-business + search input | 0.5d | FE |
| 4 | **B3 + B4 + QW-1/2/3** A11Y batch — touch targets + live region + aria-label | 0.5d | FE |
| 5 | **B8** morning brief cron · 6 health probes · LINE push | 0.5d BE + 0.5d cron | BE |
| **Day-1 hotfix budget** | **0.5d reserved** for bugs discovered in piloting | 0.5d | any |

### Sprint 2 (week of 2026-06-09) — Per-vertical readiness

- **B6** per-vertical classifier (split `classify.ts` into chairops + others stub) — 1d
- **B6** per-vertical alert target table (replace `INBOX_ALERT_TARGET` env) — 0.5d
- **B6** per-vertical trainer system prompt — 0.5d
- **B7** `/inbox/bot/[biz]` route normalization — 0.5d
- **B1** SLA badge in conversation list — 0.5d
- **B2** bot deflection metric in `summary.ts` — 0.5d

### Deferred to Q3 (after CEO decision on Top 5)

- **FB-001** OAuth cookie size — replace cookie with temp DB row + nonce
- **RT-003** Realtime Authorization policy
- **CH-001** explicit `RECRUIT_CHANNEL_KEY` env + tag migration
- Per-staff metrics page (`/inbox/insights`)
- Lead funnel page (`/inbox/leads`)
- Channel folder hierarchy (when channels > 100)
- Retention/PDPA cron (when message rows > 500k)

## §11 Backlog (P2 / nice-to-have)

- Snippet system for repeated staff replies (top 10 worth templating · MGR audit)
- Optimistic bubble + per-message delivery dot (STAFF)
- Edit/delete outbound within 30s (STAFF)
- Internal note (direction=INTERNAL on inboxMessage) (MGR)
- Audit trail (`inboxConversationEvent` append-only) (MGR)
- "Customer is typing" indicator (STAFF · provider feature)
- Read receipts (mark_seen API) (STAFF)
- Density toggle compact/comfortable on conversation list (UX)
- Cross-module deep links inbox → chairops/playland (IA)
- Empty states with first-FAQ CTAs (IA + UX)

## §12 Risks / open questions

1. **Token leak** (DEVIL) — 43 FB Page Access Tokens posted twice in CEO chat today.  Until rotated, this is the single highest-blast-radius risk in the entire system.
2. **Audit fatigue** (DEVIL) — CEO ran bigsolvebug + auditbigteam + /increase quality in 1 day.  60+ findings stacked.  Risk: nothing in this doc gets actioned because CEO scrolls past it.
3. **Per-business plumbing debt** — CEO opened `botCapable=true` for 7 verticals before the per-vertical plumbing (classifier · trainer · alert target) was in place.  Tomorrow's CEO will inherit the debt.
4. **Realtime broadcast topic enumeration** (RT-003 from bigsolvebug · still deferred) — `inbox:org:<uuid>` topic is guessable by any logged-in admin who has seen another org's UUID.  Not a leak today (only `ts` + `conversationId` in payload), but evolution risk.
5. **n8n cutover** for chairops customer OA — webhook still points at `n8ndigital.jpsync-group.com`.  Connecting our bot REPLACES this.  CEO confirmation needed.

## §13 Memory updates

- ✅ Save `~/.claude/projects/<slug>/memory/audit-inbox-2026-05-30.md` summarizing this doc
- ✅ Append to `MEMORY.md` index
- ✅ Append to `STATUS.md` Done section
- ✅ Append run entry to `~/.claude/skills/auditbigteam/LESSONS.md`
- 🟡 **CEO action**: rotate 43 FB tokens · update `inbox-fb-bulk-import-pending-2026-05-30` memory to mark tokens-rotated

---

**Files referenced by personas**: enumerated in each persona section at `/tmp/audit_inbox_phase1_<code>.md` (UX · IA · OWN · MGR+STAFF · DEVIL · A11Y).
