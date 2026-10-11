# DocuFlow document detail page — mobile (390px) tab-row clip + header squeeze

**Summary.** On a 390px mobile viewport, DocuFlow's document detail page had two independent layout bugs: the view-tabs row (`Preview/ข้อมูล/ประวัติ/Comments`) silently clipped the "Comments" tab instead of making it reachable, and the header's upload-date label got crushed into a near-zero-width column, breaking apart character-by-character. Both were pre-existing on every document, not document-specific. Root cause: a same-day grid-level overflow fix (commit `13ee5c6a`) correctly stopped the whole page from stretching past the viewport, but didn't — and wasn't meant to — fix overflow *inside* an already-correctly-sized card, nor a sibling flex-squeeze bug in the header. Fixed in commit `9be38a75` on branch `claude/docuflow-phase2-move-doc-2026-10-10`, deployed live, verified via DOM measurement and Playwright functional click-through both locally (production-mode server) and on live production.

## Symptom

Screenshotting `pooilgroup.com/docuflow/documents/<id>` at a real 390×844 mobile viewport (as part of verifying an unrelated same-day feature, the move-document button) showed:

- The tab strip `Preview | ข้อมูล | ประวัติ N | Comments` visually cut off mid-label ("Comm…") at the right edge of its card, on every document tested.
- In the header, the line `อัปโหลด {date}` rendered as `อัป` / `โหลด` / `7 Oct` / `26` / `20:36` — each fragment on its own line — with the action-button row (`ตั้งจุดเซ็น` / `ดาวน์โหลด` / `ลบ`) visually overlapping it.

Both reproduced on two different documents: one with a short name (`ksher สมัคร`) and one with a long unbroken hash-style name (`30b724d67b4702b745317b55fef627b8`), ruling out document-name length as the cause.

## Root cause

**Bug 1 — tab row clipped, not scrollable.**
`components/docuflow/viewer-tabs.tsx` renders the tab bar (`.df-seg`, `role="tablist"`) inside a plain `<div style={{display:"flex", gap:12}}>` toolbar wrapper, with no overflow handling of its own. That wrapper sits inside a `DfCard` in `app/(admin)/docuflow/documents/[id]/page.tsx` that sets `style={{overflow:"hidden"}}` (intentional, so the card's rounded corners clip cleanly). At 390px the four tabs' combined width exceeds the card's available width, so content that doesn't fit is clipped by the card's `overflow:hidden` — invisibly and unreachably, not just visually tight.

This is distinct from the bug fixed earlier the same day in `13ee5c6a`: that commit changed `.df-grid-2col`'s mobile media-query override from `grid-template-columns: 1fr !important` to `minmax(0, 1fr) !important`, because a bare `1fr` track has an implicit `min-width: auto`, so a wide child (this same tab row) was stretching the *entire two-column grid* past the viewport — pushing every card's right edge, including unrelated cards and the action buttons, off-screen. That fix is correct and necessary, and it does stop page-level horizontal overflow (confirmed: `document.body.scrollWidth === window.innerWidth` after it). But fixing the grid *track* sizing doesn't give the *content inside* a now-correctly-sized card anywhere to go — the tab row still needs its own overflow-x handling to be reachable rather than clipped. These are two different CSS failure modes that happen to live in the same page and look similar in a screenshot: one is "the whole layout is wider than the viewport," the other is "a flex row inside a correctly-sized container doesn't fit and has nowhere for the overflow to go."

**Bug 2 — header title block crushed instead of wrapping.**
In the same file, the header row (`display:flex, justifyContent:"space-between", flexWrap:"wrap"`) has two children: the icon+title block (`flex: 1, minWidth: 0`) and the action-button block (no explicit flex/min-width, sizes to its own content). `minWidth: 0` on a flex item is normally used to let text truncate/ellipsis instead of forcing the item past its content's intrinsic minimum — but it also means the item is willing to shrink arbitrarily close to zero *before* the parent's `flex-wrap` kicks in. Flexbox only wraps a sibling onto a new line once items can't shrink further at their effective minimums; since the title block's minimum was explicitly set to 0, the browser kept both children on one row and shrank the title block down to whatever sliver was left after the button row claimed its (unconstrained) content width, rather than wrapping the buttons down. At that near-zero width, the Thai text `อัปโหลด` — a single word with no spaces — hit the browser's dictionary-based Thai line-breaking and split across lines syllable by syllable.

## Why it produced the symptom

Bug 1: `overflow:hidden` on `DfCard` is for clean rounded corners, not for hiding interactive content — but with no `overflow-x` set on the tab row itself, any overflow is silently swallowed by the card instead of surfacing as a scrollbar or wrap. The user has no affordance (no visible cut edge treated as "swipe me," no scroll indicator) — it just looks like the UI ran out of space and the fourth tab doesn't exist.

Bug 2: the squeeze only appears once total header content (icon + pills + date + title, plus the button row) exceeds the viewport — i.e., only on narrow mobile widths, which is exactly the CEO's primary device and the one most likely to go unnoticed in a desktop-first dev workflow.

## Fix

`components/docuflow/viewer-tabs.tsx`: added `overflowX: "auto"`, `WebkitOverflowScrolling: "touch"`, and `scrollbarWidth: "none"` to the tab bar's wrapper div, and `flexShrink: 0` to the inner `.df-seg` element so the scroll container — not the tab buttons — absorbs the width difference. This turns the tab row into a standard horizontally-scrollable strip: all four tabs stay full-size and reachable by swipe, instead of being squeezed or clipped.

`app/(admin)/docuflow/documents/[id]/page.tsx`: changed the header title block's `minWidth` from `0` to `240` (a floor sized to its actual content — icon + shortest reasonable pill/date combination). This gives flexbox a real minimum to hit, so once the row runs out of width, the button block correctly wraps onto its own line beneath the title block instead of crushing the title block toward zero.

Neither fix touches `.df-grid-2col` or the `minmax(0, 1fr)` change from `13ee5c6a` — that fix is correct and stays as-is; these are two additional, narrower fixes one layer deeper in the same page.

## How it was found

Found incidentally while verifying an unrelated feature (Phase 2 "move document to a different group," commit `13ee5c6a`) against live production at a real 390×844 mobile viewport, per this session's established lesson that `next dev` and static screenshots can both false-positive — `next dev` by not reproducing production bundling bugs, and a single static screenshot by not revealing whether a visually-clipped region is actually scrollable or genuinely unreachable.

- Initial screenshot of the document detail page showed the tab row cut off and the header text broken apart. First hypothesis: the long hash-style document name was the cause (its h1 doesn't wrap). Rejected by testing a second document with a short name (`ksher สมัคร`) — identical symptom on both, ruling out document-name length.
- Measured `document.body.scrollWidth` vs `window.innerWidth` directly via Playwright `page.evaluate` — found them equal, meaning there was no page-level horizontal overflow. This initially looked contradictory (the screenshot clearly showed clipped content), which was the signal to stop guessing from visuals and go read `app/(admin)/docuflow/documents/[id]/page.tsx` and `viewer-tabs.tsx` directly instead.
- Reading the source revealed `DfCard` wraps `ViewerTabs` with `overflow:"hidden"` — explaining how content can be clipped without the clipping ever reaching `document.body`'s scrollWidth (an ancestor's `overflow:hidden` establishes a new formatting context that absorbs the overflow locally).
- Confirmed the tab row's own `scrollWidth` (428) exceeded its `clientWidth` (364) — real, localized overflow, consistent with the card-clipping theory.
- For the header, confirmed no global `word-break` CSS rule was forcing the character-split (`grep` came back empty), which pointed at a width-starvation cause rather than a forced break-all rule — consistent with the flex-squeeze mechanism once the button row's unconstrained content width was read from the code.
- Single experiment that confirmed the header fix: changing `minWidth: 0` to `minWidth: 240` and re-screenshotting showed the button row cleanly wrapping to its own line with no overlap, on both test documents.
- Verified the tab-row fix wasn't just visually identical-looking (a horizontally-scrollable row at rest looks the same as a clipped one in a static screenshot) by using Playwright's `getByRole('button', {name: /Comments/i}).click()`, which auto-scrolls the target into view before clicking — this failed before the fix and succeeded after, with the comments panel rendering.

## Why it slipped through

Incomplete-fix-adjacent: `13ee5c6a`'s grid-track fix was correct and necessary for the bug it targeted (whole-page overflow), but its commit message description ("fixes a pre-existing mobile horizontal overflow bug... pushing every card's right edge off-screen") was broad enough to read as covering this tab-row symptom too, when it only addressed the outer grid-track layer. There was no test or screenshot-diff step between that commit and this one that specifically re-verified the tab row was reachable (not just that the page no longer scrolled horizontally) — the verification that caught this was incidental, from testing a different feature on the same page.

The header squeeze (Bug 2) is unrelated to `13ee5c6a` entirely — a pre-existing bug with no connection to that day's other work, only surfaced because the same verification pass happened to screenshot the same page at 390px.

## Validation

- Local: fresh `next build && next start` (production mode, not `next dev`) at 390×844, both fixes screenshot-confirmed on two documents (short name, long hash name).
- Local functional: `toolbar.scrollWidth (428) > toolbar.clientWidth (364)` with `overflowX: auto` confirmed via `page.evaluate`; `page.getByRole('button', {name: /Comments/i}).click()` succeeds and `ยังไม่มี comment` placeholder renders.
- Live production (`pooilgroup.com`) post-deploy: identical DOM measurement (`428 > 364`, `overflowX: auto`) and identical Playwright click-through, both passing. Header fix re-confirmed visually live (clean single-line date, buttons wrapped, no overlap).
- Validated only on the DocuFlow document detail page (`/docuflow/documents/[id]`) at the one 390×844 mobile viewport size used throughout this session's screenshot convention — not retested at other breakpoints (e.g., 768px tablet) or on other pages that reuse `.df-seg` (`components/docuflow/df-ui.tsx`, `components/docuflow/document-view-tabs.tsx`), which were not touched by this fix and were not confirmed to have or not have the same issue.

## Action items / follow-ups

- Audit the other two `.df-seg` usages (`components/docuflow/df-ui.tsx:367`, `components/docuflow/document-view-tabs.tsx:47`) for the same card-clipping pattern — not confirmed broken, not confirmed fine. (Unassigned, no ticket filed yet.)
- Consider a lightweight convention/lint note: any element inside a `DfCard` (or any container with `overflow:"hidden"`) that can exceed its own width on mobile needs explicit `overflowX` handling — grid/flex track-sizing fixes (`minmax(0, 1fr)`) do not substitute for this. Worth a one-line comment in `df-ui.tsx` near `DfCard`'s definition if a repeat case turns up in the audit above. (Unassigned.)
- No regression test added — this repo does not have Playwright UI regression tests wired into CI for DocuFlow; manual screenshot + functional click-through at 390px remains the verification method per current project convention (`CLAUDE.md` "ไม่บังคับเขียน unit test ใน MVP phase").
