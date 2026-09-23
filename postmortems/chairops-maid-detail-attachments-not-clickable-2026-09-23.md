# Post-mortem: office maid-detail page — selfie/ID-card photos weren't clickable

**Summary.** The admin-facing maid detail page's "ยืนยันตัวตน + เบอร์ฉุกเฉิน" section showed the maid's selfie as a small, unlinked `<img>` thumbnail with no way to open it larger, and didn't show the ID card photo at all — only the status text "แนบแล้ว" (attached), with nothing behind it to view. Added click-to-view links for both, matching the existing convention already used elsewhere in the same folder. Branch `claude/chairops-maid-attachments-click-fix-2026-09-23`, merged onto `setup` at `82962209`. **Deployed live 2026-09-23.**

**Symptom.** CEO, immediately after testing the same-day contract-PDF fix: "เห็นว่ากดดูรูป selfie ไม่ได้ และกดดูเอกสารแนบไม่ได้ที่แม่บ้านแนบเอกสารมา" (can't click to view the selfie, and can't click to view the attached document the maid submitted).

**Root cause.** `app/(admin)/chairops/(office)/maids/[userId]/page.tsx`:
```tsx
// selfie — before: a plain, unlinked <img>
<img src={maid.selfieImageUrl} className="size-24 rounded-lg ..." />

// ID card — before: no image at all, just a status word inside a generic label/value row
<InfoRow
  label="บัตรประชาชน"
  value={maid.idCardImageUrl ? "แนบแล้ว" : maid.idCardNumber ? "มีเลขบัตร ยังไม่แนบรูป" : null}
/>
```
Neither field was ever wired for "click to view full size" — the selfie was a static thumbnail, and the ID card field never rendered the actual photo at all, only whether one was attached. Not a regression — this was the original, always-been-this-way state.

**Fix.**
- Selfie thumbnail wrapped in `<a href={maid.selfieImageUrl} target="_blank" rel="noopener noreferrer">`, matching the exact pattern already in use one folder over (`maids/_components/maid-profile-form.tsx`'s contract-file link).
- Added a second thumbnail, same treatment, for the ID card photo (`maid.idCardImageUrl`) — previously not rendered as an image anywhere on this page at all.
- The ID card *number* (a separate field from the photo) had no other home on the page once the "แนบแล้ว" status text was replaced by the new thumbnail, so it's now its own row (`InfoRow label="เลขบัตรประชาชน" value={maid.idCardNumber}`) — no information lost.

**How it was found.** Grepped the page for `selfieImageUrl`/`idCardImageUrl` directly against the CEO's report; both fields were immediately visible in the JSX with no wrapping link.

**Validation.** `./node_modules/.bin/tsc --noEmit`: 0 errors. `eslint` on the changed file: 0 errors/warnings. `next build`: succeeded. Live verification (not just typecheck/build): logged into a local dev server with the real test-admin account, navigated to a real maid's detail page (the same test maid used to validate the contract-PDF work earlier the same day, who has both a real selfie and a real ID card photo on file), confirmed via the rendered DOM that both `target="_blank"` links exist and resolve to the correct real R2 image URLs, and visually confirmed via screenshot that both now render as actual photo thumbnails rather than a blank/text placeholder. Pre-push gate: `/verify` in full (typecheck, eslint, `next build`, clean `git status --porcelain`, live smoke test on `pooilgroup.com`).

**Action items / follow-ups.** None — small, self-contained, no data model changes.
