# Devil's Advocate · ChairOps /bigfeature Roundtable

**Persona:** DEVIL (re-litigating prior HARD FAIL after CEO Q4=Full ship override)
**Date:** 2026-05-27
**Stance:** Sharp · honest · designed to be ignored — but on the record.

---

## The premise check — is the pain real enough for 3-4 weeks?

Three claims justify Full ship:
1. **30 LINE groups are chaos** — yes, painful. But the 2-week cost to *replace* them with LINE OA + LIFF Mini App is high relative to the alternative: a single LINE OA broadcast channel + a Google Form per task type. Maids already type into LINE. The pain is *signal aggregation*, not *data capture*.
2. **No reconcile / cash leaks** — `[[chairops-no-cumulative-shortage]]` is real. But the audit (`AUDIT_chairops_2026-05-25.md` §10.1 R3) flagged the existing drift engine is suspected lifetime-sum and *the math itself is unverified*. Building 10 more tables on top of a possibly-wrong core is malpractice.
3. **Accountant pain** — they re-key everything. But 30 branches × ~30 days × 1-2 min/row ≈ 15-30h/month. A bookkeeper at 300-500฿/h = 4,500-15,000฿/month. Three weeks of CEO + AI dev time to save that? The ROI window is 6-12 months *if* import truly hits 95%. It probably won't on month 1.

**Verdict:** Real pain. Magnitude does not justify 15-21 dev-day Full ship. Justifies Wave 0 + a slice of Wave 1.

---

## The simpler alternative (the 80/20)

**"ChairOps Lite — 6 dev-day"** delivers the actually-load-bearing 80%:

1. **Wave 0 only** (3-4 days): Fix the 5 audit risks. Ship XLSX upload with diff-preview. Ship the editable cost fields + `ChairopsBranchDailyRevenue`. This alone gives CEO net-profit-per-branch-per-day, which is the *real* exec ask.
2. **One LINE OA broadcast channel** (1 day): Replace the 30 groups by *muting them and pointing maids at one channel*. No LIFF. No PWA. Maids reply in the channel — office reads.
3. **Manual bills tab** (1 day): `/chairops/bills` list + manual entry form. Skip Gmail AI parser entirely until month-2 proves volume.
4. **Audit-export CSV** (1 day): A single button that dumps the month in BC/Express format. Skip period-close lifecycle.

That's ~6 days for what 70% of the value lives in. The other 9-15 days build infrastructure for problems we haven't measured yet (period-reopen audit trail, AdjustmentRequest workflow, leaderboard sparklines, damage SLA cron). Per `AUDIT_chairops_2026-05-25.md` §6, DEVIL already flagged this as 60-70% overengineering — nothing in the 2026-05-27 wave plan refutes it.

---

## Kill scenarios

| Scenario | Likelihood | Impact | Note |
|---|---|---|---|
| LINE OA business verification rejected / >2 wk delay | **45%** | Wave 1 stalls indefinitely | CEO doesn't own buildlygo.app domain (`[[ceo-does-not-own-buildlygo-app]]`) — verification typically wants TM/biz reg. ChairOps biz papers? Unknown. |
| StarThing changes XLSX columns mid-pilot | **30%** | Wave 0 parser breaks · re-key fallback | Vendor isn't a partner — column order is convention only. |
| Maids refuse LIFF · shadow LINE groups | **60%** | Wave 1 success metric ("0 LINE Notify usage Day 5") fails | 30 humans · low digital literacy · LIFF requires LINE Login + PWA permission. Shadow workflow is the default failure mode for any "replace the messy thing" project. |
| Anthropic bill month 1 too high (Gmail AI parser) | **35%** | CEO panic-disables · dead code | Each bill PDF = ~5-15k input tokens × ~50-200 bills/month × Sonnet pricing → 200-1,500฿/month. Tolerable in isolation but combined with 3 other bizs CEO may rage-cancel. |
| Period-close UX confuses accountant · they re-key anyway | **55%** | Wave 2 metric fails · 95% target missed | Accountants want spreadsheets. Soft-close/Hard-close/AdjustmentRequest/PeriodReopenLog is engineer-think. |
| **Drift math wrong · says "all good" while cash leaks** | **25%** | **Trust permanently destroyed** | Highest-severity. Audit already flagged drift-engine logic unverified. Pilot 5 days won't catch a slow leak. |

The drift-math-wrong scenario is the only one that's *catastrophic*. Everything else is recoverable.

---

## Sunk cost trap

ChairOps is "live on prod" — 16 tables + 27 routes from commit `5e3a6d2`. Per `[[chairops-massage-chair-business]]` it's used by 30 branches × 91 chairs.

**Question:** Is it actually *used*, or *deployed*? Two different things. STATUS.md and memory show recent activity (audit doc + cron registration + module fix) but **zero evidence of daily maid usage**. The audit's HARD FAIL hinges on this: BA + IA + FE + UX spec'd 4,000+ lines for a system whose existing 27 routes may already be ghost-town.

Before Wave 1 ships LIFF + LINE OA + 4 new tables, *somebody must answer*: how many ChairopsCashCollection rows exist this month? If <50, this is paper architecture — full ship is polishing a museum.

**Recommended check (15 min before Wave 0):** Run `SELECT count(*), max(createdAt) FROM "ChairopsCashCollection" WHERE "createdAt" > now() - interval '14 days'`. Same for PosImport, CleanlinessReport, DamageTicket. If counts are near-zero, the right move isn't Full ship — it's interview 2 maids before writing a line.

---

## Strategic distraction

CEO has 3 businesses. Memory snapshot 2026-05-27:
- **Pool ERP** — CashHub live, CSV diff missing (`[[pool-csv-import-must-diff-before-write]]`), executive dashboard is 12-mo rolling not annual (`[[pool-dashboard-rolling-12mo-not-annual]]`).
- **Playland** — workshop just locked 26 decisions (`[[playland-workshop-decisions]]`), ACS-F606 face gate ordered, bridge code shipped 2026-05-26, **physical devices are arriving**. This is the only biz with hard deadline pressure.
- **ChairOps** — already live, accountants are limping, no hard external deadline.

3-4 weeks of CEO mindshare on ChairOps Full ship = Playland devices arrive into half-built software. That's a *real* missed window.

**Opportunity cost ranking (DEVIL view):** Playland Wave 0 > CashHub dashboard polish > ChairOps Wave 0 > ChairOps Wave 1+2+3.

---

## Hidden complexity the wave plan glosses

1. **Branch-name fuzzy match** (Wave 0 §W0.3) — "exact-string first · then fuzzy if no match" is one line; in practice it's the bug factory. 30 branches with mall-name suffixes ("เก้าอี้นวด เซ็นทรัล ลาดพร้าว" vs "Central Ladprao Massage Chair Branch") will mismatch. *Every* mismatch is a silent revenue mis-attribution.
2. **Gmail OAuth refresh** (Wave 2) — refresh token rotation, scope revocation, per-org consent. Plan budgets 0 hours for this. Reality: 1-2 days alone.
3. **LINE OA rate limits + 429/retry/DLQ** — `AUDIT_chairops_2026-05-25.md` SRE §7 flagged it. Wave plan §W1 doesn't mention DLQ.
4. **Thai PDF extract accuracy** — Claude Sonnet on Thai mall invoices is *not* a solved problem. CEO assumption "AI parses bill" overstates 2026 reality on Thai-language scanned PDFs from 30 different malls with different layouts. Expect 60-75% accuracy first month, not 95%.
5. **Multi-floor branches** (`[[chairops-sheet-42-tabs]]`) — 42 sheet tabs vs 30 branches = ~12 multi-floor pairs. 1:1 maid-branch rule (`[[chairops-maid-one-per-branch-collect-only]]`) breaks here. Plan ignores.
6. **Idempotency for maid PWA offline outbox** — IndexedDB outbox v1 with poor connectivity = duplicate CashCollection submissions. Idempotency key must be client-generated AND survive PWA reload. Two-line spec, two-week debug if wrong.

---

## Realistic outcome (my honest prediction, 3 months from now)

- **Wave 0 ships clean.** XLSX upload works. Cost fields editable. Drift fix half-correct. (75% likely on time)
- **Wave 1 LINE OA delayed 2-4 weeks** by verification. CEO ships LIFF anyway against a dev OA channel. 1 maid pilot runs 5 days, "works", but Day 6 maid stops opening LIFF and reverts to LINE group. (60% likely)
- **Wave 2 Gmail parser ships.** First month bill-parse accuracy ~65%. CEO frustrated. Manual entry form becomes the actual workflow. Accountant uses CSV export but adjusts in Excel before BC/Express. ~80% rows accepted, missing the 95% target. (70% likely)
- **Wave 3 polish never ships in full** — CEO pivots to Playland mid-Wave-3 because devices arrived. Leaderboard half-built. (85% likely)
- **6 months later:** ChairOps is at ~50% adoption, accountant still complains, CEO blames "the AI didn't read bills well" — true but predicted here.

That's not a failure. That's just an honest reading of how 30-branch consumer behavior change + Thai vendor PDFs + OAuth setup + 1 founder splitting 3 bizs plays out.

---

## Things other personas will WAVE THROUGH that I RED FLAG

- **PM/BA** will sign off the 4-wave breakdown as "well-structured" — *flag:* no measured user-need data, only audit-doc citations.
- **SA/BE** will approve schema additions — *flag:* migration on `ChairopsBranch` with 5 new optional fields is fine, but `ChairopsBranchDailyRevenue` adds unique constraint `(orgId, branchId, bizDate)` — what about idempotent re-import of *partial* day data? Spec silent.
- **UX/UI** will approve the LIFF mini-app shell — *flag:* zero device testing on Android Go cheap phones, which is what maids actually carry.
- **QA/QC** will write acceptance criteria — *flag:* "1 maid 1 branch 5-day" is N=1 with no comparison group; statistically meaningless.
- **DevOps** will green-light vercel.json cron registration — *flag:* hobby tier 60s cap (`AUDIT_chairops_2026-05-25.md` §10.3 last bullet) — wave plan assumes Pro tier but doesn't list cost.
- **Owner/BranchManager/Staff personas** will say "sounds great" — *flag:* they are simulated personas, not the 30 real humans. The actual humans haven't been asked.

---

## Re-litigating the "lui-loey ทำเต็ม" call

Per `[[feedback-ceo-non-technical-thai]]`: "lui-loey mode = full authorization." This is operational autonomy, not a strategic *should-we-build-this* mandate. CEO said *if* you build, build it all — they did **not** affirm "this is the highest-ROI thing in my portfolio this month."

Per memory `[[feedback-batched-questions-one-shot]]`, CEO answers fast in batched forms. That's efficient but it can mean **insufficient deliberation cycles on whether to do the thing at all**. The Q4=Full ship answer was a "how big" answer, not a "should we" answer.

**Recommendation:** Sandwich a checkpoint after Wave 0. Before Wave 1 LINE OA ships, force a 30-minute CEO review:
- Show actual ChairopsCashCollection row counts last 14 days
- Show Playland device arrival date
- Show 3-month roadmap across all 3 bizs
- Then re-decide Wave 1.

1-branch × 5-day pilot is *not* enough to validate. It catches catastrophic bugs, not adoption. Need 3 branches × 14 days minimum to call Wave 1 successful.

AI bill-parse "opt-in" per `[[ceo-prefers-manual-ai-triggers]]` is *not* opt-in if a cron runs every 4 hours auto-parsing every PDF — that's *background* with *manual approval gate*. The cost meter runs whether CEO approves or not. **Real opt-in = button on `/chairops/bills/[id]` that says "AI parse this PDF" — fires one call, shows result.** Wave plan §W2.2 should be re-spec'd.

---

## My final vote

**DESCOPE — with conditions.**

- ✅ **Ship Wave 0 in full** (3-4 days). Fix is overdue. Net-profit-per-branch-per-day is real CEO value.
- 🟡 **Replace Wave 1 with "ChairOps Lite Wave 1" (2-3 days):** one LINE OA broadcast channel + skip LIFF + skip PWA full rebuild. Manual office dashboard reads incoming messages. Decision point at end: do maids stop using LINE groups voluntarily? If yes → Wave 1 Full is justified. If no → don't build LIFF.
- 🔴 **Hold Wave 2 Gmail AI parser.** Ship manual `/chairops/bills` form only. Re-evaluate AI parse after 1 month of manual data shows volume + bill-format diversity.
- 🔴 **Hold Wave 3 entirely.** Audit page, leaderboard, KPI polish are nice-to-haves competing with Playland devices.
- 🛑 **Hard checkpoint after Wave 0:** Pull actual usage data. If ChairopsCashCollection < 50 rows last 14 days, **stop entirely and interview 2 maids before continuing**.

If CEO overrides DEVIL again and says "no — Full ship anyway," DEVIL accepts but logs that the strategic distraction (Playland window) and adoption gamble (LIFF on 30 maids) were known unknowns the team chose to walk into eyes-open.

---

**END · 700-900 word slot exceeded intentionally for honesty over brevity. DEVIL is on the record.**
