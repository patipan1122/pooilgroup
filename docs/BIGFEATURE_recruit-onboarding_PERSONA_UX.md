# BIGFEATURE recruit-onboarding — Persona: UX

**Feature:** ระบบรับพนักงานใหม่ออนไลน์ (one permanent public link · no login · no per-person code)
**Scope note:** Legal/business scope is FINAL (locked spec). This doc covers the candidate-facing journey only — screen order, reuse-vs-build calls, and the concrete interaction design for the three genuinely new UI pieces (long-document consent gate, drawn signature, live selfie). HR's review screen is out of scope here except for where it hands off from the candidate's confirmation state.

**Codebase investigated (pooilgroup-web):**
- `app/apply/[slug]/apply-client.tsx` + `app/apply/[slug]/submit-action.ts` + `app/apply/[slug]/success/page.tsx` — existing public application shell
- `components/recruit/public-form-renderer.tsx` — existing public-form field renderer + draft/upload logic
- `components/docuflow/signer-interface.tsx` — existing drawn-signature UI (react-signature-canvas, fullscreen pad)
- `components/playland/face-capture.tsx` — existing live-camera capture UI (getUserMedia + fallback)
- `components/cashhub/slip-camera.tsx`, `components/chairops/id-card-upload.tsx` — existing document-photo upload patterns
- `lib/recruit/types.ts` — field schema (`FieldSchema`, incl. `format: "thai_id"` already defined but not yet given special input treatment in the renderer)
- `app/my/[refId]/page.tsx` — existing no-login, ref-ID-keyed status tracking page

---

## 1. Concrete step-by-step journey

**Design call:** do NOT force everything into one continuous scroll (the way `/apply/[slug]` does today), and do NOT build a generic multi-step wizard component either (grep confirmed: **no stepper/wizard component exists anywhere in the codebase** — `currentStep`/`Stepper`/`ProgressSteps` all came back empty except two unrelated components). Instead: reuse the existing long-scroll single-card pattern for the *data-entry* phase (it already works, it's what candidates on Facebook/LINE job ads are used to from `/apply`), and treat contract-read, signature, and selfie as **separate full-screen steps** after the data phase — because those three have interaction models (full-attention legal reading, canvas drawing, camera permission) that don't compose safely with a long form scroll. A nervous first-day hire scrolling past 41 fields must not also be scrolling past a "you must read this contract" gate — they're cognitively different modes and deserve a hard screen break.

**Screens, in order:**

| # | Screen | Pattern reused | Why |
|---|---|---|---|
| 1 | **Landing / hero** — role, company, "ใช้เวลาไม่เกิน X นาที", "ไม่ต้องล็อกอิน" trust chips | `apply-client.tsx` hero block verbatim (lines 54–111) | Same trust-building job already solved; swap copy from "ใบสมัคร" → "เอกสารเริ่มงาน" |
| 2 | **Section A — Position/company/branch/salary** (self-reported) | `PublicFormRenderer` numbered-dot sections | dropdown/short_text fields, same as recruit form fields |
| 2 | **Section B — Personal info** (incl. Thai ID + birthdate 18+ check) | same renderer, **+ new numeric-mask input for `format: "thai_id"`** (see finding below) | |
| 2 | **Section C — Address** | same renderer | |
| 2 | **Section D — 2 emergency contacts** | same renderer, repeated as 2 sub-groups | |
| 2 | **Section E — Education** | same renderer | |
| 2 | **Section F — Work history** | same renderer | |
| 2 | **Section G — Bank account** | same renderer | |
| 3 | **Section H — 6 document uploads** (ID card, house reg., bank book, front-facing photo, education cert, other) | `field.type === "file"` UI already in `public-form-renderer.tsx` (lines 773–827), **each of the 6 as a distinct required `file` field, not one generic uploader** | Each doc type gets its own drop target + label so a nervous user always knows exactly what's missing — matches `IdCardUpload`'s one-purpose-per-uploader pattern rather than a single multi-purpose dropzone |
| 4 | **"Review your answers" mini-summary + local submit** (NEW, small) | n/a — new but trivial (read-only recap of top 6-8 answered fields, no full re-render of all 41) | Candidates who just typed for 5+ minutes on a phone want a checkpoint before the tone changes to "now read a legal contract." Keeps them from bailing mid-document read confused about whether their form data was saved |
| 5 | **Contract read screen** — full-screen, own route/step, 10 articles | **New** (no existing long-document-consent component found in the codebase — confirmed via grep) | See §3 |
| 6 | **Sign screen** — canvas signature | `SignerInterface` / `SignatureFullscreenPad` reused almost 1:1 | See detail below |
| 7 | **Selfie screen** — live camera capture | `FaceCapture` (playland) reused almost 1:1 | See §4 |
| 8 | **Submit + confirmation** | `app/apply/[slug]/success/page.tsx` pattern, adapted copy | See §5 |

Screens 2–3 (data + docs) stay as **one scrollable page** (current recruit pattern) — this is the part of the journey structurally identical to what already works in production. Screens 5–7 (contract → sign → selfie) become **three separate full-screen "moments,"** each with its own back-forward control, because each requires the user's full, undivided attention and each is a hard gate (can't sign before reading, can't submit before selfie). Screen 4 is a cheap seam between "I'm filling out a form" and "I'm now signing a legal document" — it costs one tap and meaningfully lowers the chance of a candidate bailing out confused midway.

**Total taps to completion (rough):** ~41 field interactions + 6 file picks + 1 review-continue + 1 scroll-to-unlock + 1 sign + 1 selfie + 1 submit ≈ 52 discrete actions. On mobile, in one sitting, that's 12–18 minutes for a non-technical user — hence §2 (auto-save/resume) is not optional, it's core.

---

## 2. Auto-save / resume — and a real collision risk in reusing it as-is

**What exists today:** `apply-client.tsx` (lines 37–45) reads `localStorage["recruit_draft_${slug}"]` into `initialAnswers` on mount; `public-form-renderer.tsx`'s `setAnswer()` (lines 78–90) writes the full answers object back to that same key on every field change; `handleSubmit()` (lines 270–274) clears it on successful submit. This is a solid, already-proven pattern — reuse it directly for the data/docs phase.

**The collision this feature introduces that `/apply` never had:** `/apply/[slug]` job postings are still *usually* one candidate, one browser, one sitting (they find the ad, apply, done). This onboarding link is explicitly **one permanent URL with no per-person code** — which means it is very plausible that HR hands their own tablet/phone to *multiple new hires in a row* at the office ("here, fill this out"), or a candidate fills it half-way on a shared family computer. If we key the draft purely off `slug` (there's only one slug — this is a single permanent link, not per-posting like `/apply/[slug]`), **candidate #2 on the same device would load candidate #1's half-typed Thai ID number, address, and bank account** into their form. That's not just a UX annoyance, it's a real PII leak between two unrelated new hires on a shared device.

**Recommendation:**
1. On mount, before doing anything else, generate (or read) a **client-side draft session id** (`crypto.randomUUID()`, stored in a *separate* localStorage key, e.g. `onboard_session_id`) — this is not a per-person code from the business/legal side (spec stays "no code"), it's purely a client-local disambiguator so two drafts on one device don't merge.
2. Key the draft as `onboard_draft_${sessionId}`, not `onboard_draft_${slug}` (since slug is effectively constant here).
3. On the landing screen, if a draft already exists, show a lightweight prompt: **"พบข้อมูลที่กรอกค้างไว้ (X นาทีที่แล้ว) — ทำต่อ หรือ เริ่มใหม่?"** ("Found a draft from X minutes ago — continue, or start fresh?"). This single prompt solves both the legitimate resume case (candidate closed the tab, comes back) and the shared-device case (next hire explicitly starts fresh, wiping the previous draft key).
4. Uploaded file references (the 6 documents) should be included in the same draft blob — but note they point at Google Drive files already uploaded under candidate #1's session; if candidate #2 hits "start fresh," those stray Drive uploads become orphaned in Drive. Flag to backend/SA: either (a) tag Drive uploads with the session id in the filename/folder so orphaned ones are identifiable for cleanup, or (b) don't finalize/attach Drive files to a submission until the actual submit — either is a backend decision, just noting the UX action ("start fresh") has a downstream cleanup implication.
5. Do **not** persist the drawn signature or the selfie into localStorage as a resumable draft field — both are meant to be captured fresh at signing time, and a base64 image sitting in localStorage across a shared-device reset is exactly the kind of residue that should not survive a "start fresh."

**Copy that should show throughout** (mirrors existing `public-form-renderer.tsx` line 454–457 footer): keep "บันทึกอัตโนมัติทุกครั้งที่กรอก" but drop "กลับมาต่อจากเครื่องอื่นได้" — that line is currently true for the job-application flow (dedup happens server-side by phone), but for THIS flow there is no server-side identity yet at draft time (candidate hasn't submitted), so resume only works on the *same device*, not "from another device." Saying otherwise sets a false expectation for a nervous first-day hire who might reasonably try to continue on a different phone.

---

## 3. The "must scroll to the end" contract-read gate

**Confirmed via grep:** there is no existing "scroll to bottom to unlock" pattern anywhere in the codebase (`scrollHeight`, `IntersectionObserver`, `hasScrolledToEnd`, etc. all came back empty for this use case). This is genuinely new UI. Build it minimal, reusing primitives already in use elsewhere in the codebase rather than pulling in a new library:

- `signer-interface.tsx` already uses `ResizeObserver` (lines 111–122) to track a container's live size — the same technique, applied to a scroll container's `scrollTop + clientHeight >= scrollHeight - <threshold>`, is enough to detect "reached the end." No new dependency needed (Ladder rule: nothing to install).
- Render all 10 articles as **plain scrollable text in one container**, not paginated — pagination adds a second "did they actually read it" ambiguity (did they tap through without reading each page?) that a single continuous scroll avoids.

**How it should feel:**
- **Progress indicator: yes, but minimal** — a thin fixed progress bar at the very top of the screen (not a "page 3/10" counter, which reads as bureaucratic) that fills as the user scrolls through the contract body. This gives constant, ambient feedback without adding another thing to read.
- **The consent checkbox stays visually present but disabled** the whole time (grayed, with a `cursor-not-allowed` and a one-line caption directly under it: "อ่านให้จบก่อนถึงจะติ๊กได้" — "read to the end before you can tick this"). This is better than hiding the checkbox entirely, because a nervous user scanning ahead (as people do) can see up front that there *is* a checkbox waiting, which sets the expectation "I need to get through this," rather than being surprised by a checkbox appearing out of nowhere at the bottom.
- **When the end is reached:** the checkbox unlocks with a small state change (border color + a brief pulse, same visual language `public-form-renderer.tsx` already uses for radio/checkbox "selected" states — `border-[var(--color-brand-500)] bg-[var(--color-brand-50)]`) plus the caption swaps to "อ่านครบแล้ว ติ๊กเพื่อยืนยัน" ("You've read it all — tick to confirm"). Don't auto-check it — an explicit tap is the actual consent action and should stay a deliberate gesture.
- **Download-before-signing: keep it, as a secondary, non-blocking affordance.** A small "ดาวน์โหลด PDF" link/icon pinned near the top of the contract screen (not competing with the progress bar) lets a candidate save a copy for a parent/spouse/friend to review — common and reasonable for a first job contract with an unfamiliar company. This does NOT bypass the scroll gate: downloading doesn't unlock the checkbox, only scrolling the on-screen version to the end does. That keeps the "must read it here" requirement intact for the person actually clicking Sign, while still respecting that people reasonably want a personal copy.
- **Re-entry:** if the candidate backs out of the contract screen (e.g. accidental back-gesture) and returns, the scroll-gate state should reset (require reading to the end again) rather than remembering "already unlocked" — cheap to implement, and removes any ambiguity about whether they actually read it this time.

---

## 4. Live selfie capture

**Reuse call: `components/playland/face-capture.tsx` is a near-exact match for what this needs — reuse its interaction model directly rather than designing from scratch.** It already solves every hard part of this exact problem:

1. **Permission prompt, gesture-gated correctly.** The component does NOT call `getUserMedia` on mount (browsers can silently swallow permission prompts fired from a `useEffect` instead of a user click — this is called out explicitly in the code comment at line 92–93). Instead it shows an explicit "ขออนุญาตเปิดกล้อง" (ask permission to open camera) tap-target first, and only requests the camera after that tap. This matters even more here than in Playland: a nervous new hire seeing a browser permission popup appear "out of nowhere" is more likely to panic-deny than a staff member used to the app.
2. **Guidance overlay:** current component keeps it simple — a live mirrored (`scaleX(-1)`) video preview inside a square 1:1 frame, no face-outline overlay. For onboarding, consider adding a light circular guide overlay (CSS only, no new asset) since this photo is going into an HR file (not a fun feature like Playland) and framing consistency matters more here — flag to UI/visual persona rather than solve in this doc.
3. **Retake:** already built in (`retake()`, lines 138–143) — clears the captured value and returns to the pre-permission state rather than auto-restarting the stream, which is the safer default (don't leave a camera stream silently running when the user isn't actively using it).
4. **Fallback path already built in, and it matters for THIS flow specifically:** if `getUserMedia` is denied, unsupported, or the camera is in use by another app, the component classifies the failure (`classifyError`, lines 23–38: denied / no-camera / in-use / no-support / other) and shows a specific, actionable message per case (e.g. "Chrome: กดไอคอน 🔒 ข้าง URL → Camera → Allow"), then offers a fallback: `<input type="file" accept="image/*" capture="user">` — which on a phone still opens the native front camera (just via the OS camera app instead of an in-page live preview), so a "denied" state doesn't dead-end the flow. **This fallback needs one explicit decision from the business/legal side before reuse, not a UX call:** the locked spec says "LIVE SELFIE... not an upload" — confirm whether the `capture="user"` fallback (which technically routes through the OS camera app, still produces a fresh photo, not a gallery pick) satisfies that "live, not uploaded" requirement, or whether camera-denied should instead hard-block submission with a "camera permission required" message and no fallback. Recommend allowing the `capture="user"` fallback (it still forces a fresh shot from the front camera, same as a live capture would produce) since hard-blocking a nervous new hire over a one-time permission misclick with no recovery path is a worse failure mode than accepting the equivalent-effect fallback.
5. **Output format already right-sized:** 480×480 JPEG ~200KB base64 — appropriate for an HR file photo, no change needed.

**One necessary change from the Playland version:** strip Playland's dark/neon theme (`#1c1917`, `#fbbf24`, `.pl-btn` classes) and restyle with the brand tokens already used across `public-form-renderer.tsx`/`apply-client.tsx` (`var(--color-brand-500)`, `var(--color-brand-50)`, the same button radii/shadow language as the submit CTA) so it doesn't feel like a different app bolted onto the onboarding flow mid-journey.

---

## 5. Post-submission — what the candidate sees

**Reuse call:** `app/apply/[slug]/success/page.tsx` is the right shape and should be adapted almost directly — it already solves "confirm success + give a trackable reference + explain what happens next" for exactly this no-login, no-account audience. Its copy pattern ("ขอบคุณที่ส่งใบสมัครเข้ามา · ทีม HR จะพิจารณาและติดต่อกลับโดยเร็ว" + a ref-ID card + a link to a no-login status page) maps directly onto onboarding:

- **Confirmation state, adapted copy:** headline changes from "ส่งใบสมัครเรียบร้อย" to something like "ส่งเอกสารเริ่มงานเรียบร้อย" ("Onboarding documents submitted"), body text explicitly sets expectations for a *manual review step that isn't instant*: "ทีม HR จะตรวจสอบเอกสารและข้อมูลของคุณ แล้วจะส่งสำเนาสัญญาที่อนุมัติแล้วให้ทาง [LINE/อีเมล] ภายใน [X วันทำการ]" ("HR will review your documents and information, then send you the approved contract copy via [LINE/email] within [X business days]"). This directly answers the brief's ask — the candidate must clearly understand this is "submitted, pending HR review," not "done, you're hired." Getting this expectation-setting right matters a lot for a first-day-nerves audience who may otherwise refresh-check or call HR anxiously the next morning.
- **Reference number + no-login status page:** reuse the exact `/my/[refId]`-style pattern already live and battle-tested (`app/my/[refId]/page.tsx`) — it already implements a no-OTP, no-account, ref-ID-keyed status page with a status pill + "next step" hint copy per status (`NEW`, `SCREENING`, etc., lines 39–90). For onboarding, this becomes the natural home for "HR review pending → approved, here's your signed copy" — the state candidates land in immediately after submit is a new status equivalent to `NEW` ("ส่งแล้ว รอ HR ตรวจสอบ"), and the approved-contract-copy download can slot in as a later status state on that same page once HR approves. This means **no new "check my status" surface needs to be built** — extend the enum/labels on the existing page rather than building a parallel one.
- **What NOT to do:** don't promise instant confirmation language like "เสร็จสมบูรณ์" ("all done") on the immediate post-submit screen — matches the CEO's Rule A instinct (Buildly Go's own rule, and the sound UX principle behind it): never tell a user something is finished when a manual approval step still stands between them and actually being onboarded.
- **PDPA/closing line:** keep the existing pattern's closing reassurance line ("ปิดหน้านี้ได้เลย...") but adapt to make clear their data/documents are held pending HR action, consistent with whatever retention copy Legal locked in the spec.

---

## Summary of reuse-vs-build calls (for the roundtable)

| Piece | Call | Source |
|---|---|---|
| Data form (33 non-doc fields) | **Reuse as-is** | `PublicFormRenderer` |
| Thai ID field (`format: "thai_id"`) | **Extend** — renderer currently treats it like plain text (only `email`/`phone` get special `type`/`inputMode` in `renderInput`, lines 592–609); add numeric keypad + digit mask for the 13-digit ID | `public-form-renderer.tsx` |
| 6 document uploads | **Reuse as-is**, one `file` field per doc type | `public-form-renderer.tsx` `file` case + Drive-first upload endpoint already wired |
| Auto-save/resume | **Reuse pattern, re-key it** — session-id-based key instead of slug-based, to avoid cross-candidate leakage on shared devices | `apply-client.tsx` / `public-form-renderer.tsx` draft logic |
| Contract read + scroll gate | **New** (confirmed nothing exists) — but built from primitives (`ResizeObserver`) already used elsewhere, not a new library | n/a |
| Drawn signature | **Reuse near-1:1** | `signer-interface.tsx` / `SignatureFullscreenPad` |
| Live selfie | **Reuse near-1:1**, restyle to brand tokens | `components/playland/face-capture.tsx` |
| Post-submit confirmation + status tracking | **Reuse pattern + extend existing no-login status page** rather than building a new one | `app/apply/[slug]/success/page.tsx` + `app/my/[refId]/page.tsx` |

**Net new UI to actually build:** the contract scroll-gate screen, the brief "review your answers" checkpoint, and the session-id draft re-keying. Everything else is direct reuse or a small extension of an existing, already-shipped pattern — which keeps this fast to build and consistent with the rest of the product's design language.
