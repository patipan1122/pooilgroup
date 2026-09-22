# Recruit Onboarding · BIGFEATURE Persona — UI (Visual / Design)

> **Persona:** UI (Visual/Design) · **Run:** /bigfeature roundtable · **Date:** 2026-09-22
> **Goal:** Confirm exact design tokens/components to reuse for the public onboarding form + contract-read + signing/verification flow. No new visual language — extend what `/apply/[slug]` and DocuFlow already ship.
> **Files read in full:** `app/apply/[slug]/apply-client.tsx` · `components/recruit/public-form-renderer.tsx` · `components/docuflow/signer-interface.tsx` · `components/docuflow/signer-risk-summary.tsx` · `components/playland/face-capture.tsx` · `components/chairops/id-card-upload.tsx` · `components/recruit/application-files.tsx` · `components/ui/button.tsx` · `components/ui/card.tsx` · `app/globals.css`

---

## ⚠️ 0. Flag before I proceed — scope mismatch vs the locked workshop doc

`docs/WORKSHOP_recruit-employee-onboarding.md` (revised **2026-09-21**, one day before this run) is the actual locked artifact for this feature and it says something different from the LOCKED FEATURE SPEC I was handed:

- **Line 10 + 79 + 123:** *"เซ็นออนไลน์ — ใช้แบบเบาที่สุด... CEO เลือก **พิมพ์ชื่อ-นามสกุล + กดปุ่มยอมรับ** (ไม่ต้องวาดลายเซ็น ไม่ต้อง OTP)"* — the CEO explicitly killed the drawn-signature pad on 2026-09-21. `SignerInterface` gets forked to swap the `<SignatureCanvas>` for a typed-name input, not reused as-is.
- **No mention anywhere in that doc of a live-selfie-capture step.** I grepped for `selfie|ถ่ายรูป|กล้อง|camera|live|liveness` — zero hits outside the signature debate. It isn't in the Must/Should/Could list (§6) either.

I'm not re-litigating scope — I don't know if a newer stakeholder-form answer superseded the workshop doc after 09-21, which is entirely possible in this roundtable. But since the two sources disagree on two structural screens (draw-vs-type signature, selfie step exists-or-not), **PM/BA should reconcile which is current before Architect/FE lock the data model** — a typed-name "signature" has zero canvas/contrast concerns and a different `ConsentRecord` shape than a drawn one.

Below I answer the brief exactly as given (signature-drawing + live-selfie), and I've written §3/§4 so the guidance holds either way — the fullscreen-modal shell and the reuse targets don't change based on which content goes inside it.

---

## 1. Design tokens to reuse — confirmed, with source lines

All from `app/globals.css:10-115` (`@theme inline` block) and `components/ui/{button,card}.tsx`. Nothing below needs a new token.

| Token | Value | Source |
|---|---|---|
| Brand primary (CTA) | `--color-brand-600` `oklch(0.45 0.24 264)` | `app/globals.css:26` |
| Brand hover/pressed | `--color-brand-700` / `-800` | `app/globals.css:27-28` |
| Brand tint (selected state bg) | `--color-brand-50` `oklch(0.97 0.025 263)` | `app/globals.css:20` |
| Success (upload-done / signed badge) | `--color-success` = leaf `oklch(0.60 0.18 148)` | `app/globals.css:48` |
| Card radius | `rounded-3xl` (form shell) / `rounded-2xl` (`--radius-2xl: 32px` for hero-overlap card, `--radius-card: 12px` semantic default) | `apply-client.tsx:115`, `globals.css:73,95` |
| Input radius | `rounded-xl` (`--radius-input: 12px`) | `public-form-renderer.tsx:328,344,358` etc, `globals.css:98` |
| Card shadow | `shadow-soft` = `0 1px 2px rgb(0 0 0/.04), 0 1px 3px rgb(0 0 0/.06)` | `globals.css:77`, used in `components/ui/card.tsx:19` and `components/ui/button.tsx:20` (primary variant) |
| CTA elevated shadow | `--shadow-blue: 0 8px 24px -8px oklch(0.50 0.25 264 / 0.30)` | `globals.css:81` — **note:** `apply-client.tsx:438` currently hardcodes `shadow-[0_6px_16px_rgba(30,58,255,0.25)]` instead of using this token. Small pre-existing inconsistency — use the `shadow-blue` token for the new onboarding CTA rather than a third hand-rolled value. |
| Input height / text size | `h-12` (48px) + `text-base` (16px, blocks iOS auto-zoom) | `public-form-renderer.tsx:328` |
| Focus ring | `focus:ring-2 focus:ring-[var(--color-brand-400)]` | every input in `public-form-renderer.tsx` |
| Section label pattern | colored dot `size-2 rounded-full bg-[var(--color-brand-500)]` + zinc-400 tabular number + brand-700 bold title | `public-form-renderer.tsx:45-47, 389-395` |
| Selected-choice pattern | `border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]` vs `border-zinc-200 text-zinc-700 hover:border-zinc-400` | gender picker, yes/no, radio, checkbox — `public-form-renderer.tsx:372-376, 632-636, 666-670, 695-699` |
| Font | `font-display` (Thai display face) for H1/section titles | `apply-client.tsx:82`, `signer-interface.tsx:194` |

Hero treatment (`apply-client.tsx:55-111`) — brand gradient `from-[var(--color-brand-600)] via-[var(--color-brand-700)] to-[var(--color-brand-900)]` (or dark-overlay-on-cover-photo variant), white pill trust-chips (`bg-white/15 backdrop-blur px-3 py-1.5 rounded-full text-[11px]`), bottom curve via `rounded-t-[24px]` overlap div, form card pulled up `-mt-6`. This is the exact hero to reuse for the onboarding landing screen — swap copy ("กรอกข้อมูลพนักงานใหม่" / company name) and the three trust chips (e.g. เวลาไม่เกิน N นาที / ไม่ต้องล็อกอิน / เก็บที่ Google Drive ปลอดภัย) for onboarding-appropriate claims, keep the exact classes.

## 2. Layout plan — the 6-document upload section (spec items 33–38)

**Confirmed: no existing 2×2/grid pattern for multi-document upload exists in this codebase.** I checked three candidates:

- `public-form-renderer.tsx`'s own `file`-type field (lines 773-827) renders **one full-width dashed dropzone per field**, each ~`p-4` with a centered icon+label row. Six of these stacked = six ~64px+ blocks in a column before you even reach the consent section. This is the current behavior and it's exactly the "stacked large dropzones" the brief flags as wrong for 6 documents.
- `components/chairops/id-card-upload.tsx` — same single-document dashed-dropzone pattern, used for exactly one document at a time in the maid onboarding form. Not a grid.
- `components/recruit/application-files.tsx:24` — `grid grid-cols-1 sm:grid-cols-2 gap-2`, but that's the **admin-side read-only list of already-uploaded files**, not an upload control.

So this is a genuine, justified gap — build it, but build it from existing atoms only:

**Proposed tile grid** (new sub-component, e.g. `DocumentUploadGrid` living beside `FieldInput` in `public-form-renderer.tsx`, or triggered when a section has ≥2 consecutive `file`-type fields):

- `grid grid-cols-2 gap-3` — 2 columns × 3 rows for the 6 items (respects RULE L's "numbers = 2×2 grid" density rule even though this is 6 not 4).
- Empty tile: `border-2 border-dashed border-zinc-300 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/40 rounded-xl` (same classes as the existing dropzone, `public-form-renderer.tsx:816`), `min-h-[96px]` square-ish, centered `Upload` icon (`lucide-react`, already imported) + 2-line label (e.g. "บัตรประชาชน" / required `*`).
- Filled tile: swap to `border border-zinc-200 bg-zinc-50` (matches the existing filled-file row style, `public-form-renderer.tsx:789`), small thumbnail if image or `FileText` icon fallback (pattern already in `id-card-upload.tsx:89`), truncated filename, small green "uploaded" checkmark badge top-right — reuse the exact badge treatment from `face-capture.tsx:168-170` (`CheckCircle2` in a rounded pill), recolored to `--color-success` token instead of Playland's hardcoded `var(--pl-ok)`.
- Remove control: reuse the existing `X` icon-button pattern (`public-form-renderer.tsx:792-799`) — **but see §4, it's currently under the 44px tap-target minimum and should get the `p-3 -m-3` treatment already used correctly in `signer-interface.tsx:350,358`.**
- The "other files" slot (item 38, likely `maxFiles > 1`) stays a tile but shows a count chip ("2 ไฟล์") instead of one filename when >1 file is attached — no new visual language needed, just conditional label text.
- Underlying logic: zero new upload code. `uploadFile` / `removeFile` / `files` state already live in `PublicFormRenderer` (lines 92-197) and already drive Google Drive upload with R2 fallback — the grid is a container/layout change only, not a new upload path.

## 3. Live-selfie-capture screen

**Direct reuse candidate exists and already solves the hard part:** `components/playland/face-capture.tsx`. It already implements exactly what the brief asks for — webcam viewfinder, capture button, retake — plus things a from-scratch build would likely get wrong the first time:

- 3-tier fallback chain: live webcam (`getUserMedia`) → phone native camera via `<input capture="user">` → plain file upload, so it never hard-blocks a candidate whose browser/device refuses camera access.
- Explicit user-gesture gate before requesting camera permission (`startCamera()` only fires on click, not on mount) — avoids the silent-permission-prompt failure mode some browsers have on `useEffect`-triggered `getUserMedia`.
- Classified, Thai, actionable error copy per failure mode (`denied` / `no-camera` / `in-use` / `no-support`) — `face-capture.tsx:23-38`.
- Square 1:1 viewfinder, mirrored preview (`transform: scaleX(-1)`) so it reads like looking in a mirror, captures a 480×480 JPEG.

**What needs to change is skin only, not logic:** `FaceCapture` is styled with inline `style={}` objects and Playland's own `--pl-*` / `.pl-btn` classes — it does not use the pool-blue brand tokens at all. For onboarding:

- Reuse the entire component (state machine, error handling, capture/retake functions) as-is or forked.
- Present it inside the same fullscreen-modal shell `SignerInterface` already uses for its signature pad (`signer-interface.tsx:310-411`, the `SignatureFullscreenPad` function): `fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-sm`, white top bar with `X` close (left) + label (center) + reset icon (right), white bottom bar with outline "ยกเลิก" + primary xl "ถ่ายเลย"/"ถืนไป" buttons, `document.body.style.overflow = "hidden"` scroll-lock while open. That shell is already mobile-first and already handles the safe-area bottom padding (`safe-bottom` class, `signer-interface.tsx:389`).
- Swap `FaceCapture`'s inline dark viewfinder background/border for brand-consistent classes (`bg-zinc-950` viewfinder frame is fine as-is — cameras conventionally sit on near-black — but the surrounding chrome, buttons, and the "captured" badge should use `Button` (`components/ui/button.tsx`) variants instead of `pl-btn`, and `--color-success` instead of `--pl-ok`).
- Capture CTA = `Button variant="primary" size="xl" fullWidth` with `Camera` icon, matching the exact visual weight of `SignerInterface`'s "แตะเพื่อเซ็น" CTA (`signer-interface.tsx:274-283`) so the two consecutive steps (sign → selfie) feel like the same product, not two different builds.
- Retake = `Button variant="outline"` with `RotateCcw` — that icon is already the established "reset" icon in this exact file (`signer-interface.tsx:22,358` uses `RotateCcw` for "เคลียร์" on the signature pad), so reusing it for selfie retake is free consistency, not a new choice.

## 4. Accessibility basics

| Check | Current state | Verdict / action |
|---|---|---|
| Font size on 41 fields | All text inputs already `text-base` (16px) — `public-form-renderer.tsx:328` etc. | ✅ Correct, keep. iOS auto-zooms any input <16px; this codebase already avoids that everywhere in this file. |
| Labels/help text | `text-sm` (14px) label, `text-xs` (12px) help text — `public-form-renderer.tsx:509,521` | 🟡 12px help text is on the small side for a possibly-older/non-technical audience reading on a phone. Not a blocker (it's secondary text), but don't go smaller anywhere new. |
| PDPA consent text | `text-xs text-zinc-700` on `bg-zinc-50/40` — `public-form-renderer.tsx:425-428` | 🟡 Recommend bumping to `text-sm` for the onboarding version specifically — this block carries actual legal/consent weight and the target reader skews less tech-comfortable than a general job applicant. |
| Tap targets — buttons/pills | Gender, yes/no, radio, checkbox all `h-12` (48px) or full-row `p-3` clickable `<label>` | ✅ Exceeds the 44px WCAG target already. |
| Tap targets — file remove `X` | `public-form-renderer.tsx:792-799` — icon-only `<button>` with **no padding**, just `size-4` (16px) icon | 🔴 Below 44px today. Fix while building the new grid: apply the `p-3 -m-3` pattern already used correctly in `signer-interface.tsx:350,358` for its close/reset icon-buttons — grows the hit area without growing the visible icon. Apply this to both the existing stacked-dropzone remove button and the new grid-tile remove button. |
| Tap targets — new grid tiles | New (§2) | Design at `min-h-[96px]` square — comfortably above 44px, and `gap-3` (12px) between tiles is enough spacing to avoid accidental adjacent-tile taps on a phone. |
| Color contrast — signature canvas (if drawn signature stays) | Ink `#0a0a0a` on `bg-white` — `signer-interface.tsx:375,367` | ✅ ~21:1, no issue. |
| Color contrast — signature guideline hint | `text-[11px] text-zinc-400` on white — `signer-interface.tsx:385` | 🟡 zinc-400 on white is roughly 2.8:1, fails WCAG AA for text (needs 4.5:1). It's a decorative dashed-line label so low severity, but if touched, bump to zinc-500 (~4.6:1) or darker. |
| Color contrast — error text | `text-red-600` at `text-xs` — `public-form-renderer.tsx:557-559` | ✅ Contrast is fine; size is the same 12px note as above. |

## 5. Reuse-vs-invent check — where I was tempted to add something new

Going through the brief point by point, flagging every place a "just build a new component" instinct would have fired, and what stopped it:

1. **Hero + form card shell** — no temptation, `apply-client.tsx` is a direct fit as-is.
2. **35 of the 41 question fields** (everything except the 6 file uploads) — no new component needed, `renderInput`'s existing switch (`public-form-renderer.tsx:591-830`) already covers `short_text/long_text/yes_no/dropdown/radio/checkbox/range/number/date`.
3. **Multi-document grid** — *was* tempted to design a standalone uploader widget. Stopped: the actual upload/remove/validate logic already exists in `PublicFormRenderer` (§2); the only real gap is the container layout. Built as a layout variant, not a new data path.
4. **"Document verified" badge** — was tempted to invent a new small checkmark-pill style for the grid tiles. Stopped: `face-capture.tsx:168-170` already has this exact pattern (green rounded pill + `CheckCircle2` + short label) and `signer-interface.tsx:198-201` uses the same visual idea for "ลงนามแล้ว". Reusing it also makes "this step is done" read identically everywhere in the flow, which is the actual goal.
5. **Live-selfie viewfinder** — was tempted to write a fresh `getUserMedia` component. Stopped hard: `face-capture.tsx` already solved the annoying cross-browser permission/fallback problem correctly; rewriting it risks reintroducing bugs (denied-permission handling, iOS Safari quirks) that are already fixed there. Reuse the logic, reskin the chrome only (§3).
6. **Contract-reading scroll-gate** (button disabled until scrolled to bottom) — genuinely new, I grepped for `scrollHeight|onScroll.*bottom|scroll-gate` and found no existing "must-scroll-to-enable" pattern anywhere in the repo (only chat auto-scroll-to-latest, a different thing). This one has to be built new — but it's a ~15-line `onScroll` height-check, not a new design language: wrap it in the plain `Card`/`CardBody` primitives already used everywhere, sticky bottom CTA using the same `Button size="xl" fullWidth` pattern as everything else in this doc.
7. **Risk-summary pre-screen** — no temptation to invent; the workshop doc (§0) already names `SignerRiskSummary` (`components/docuflow/signer-risk-summary.tsx`) as the fork target, and having read it, its 🟢🟡🔴 collapsible-card language (`<details>`-based, zero client JS in the read-only form) is worth carrying over as the visual idiom even though the interactive per-clause checkbox version needs client state the current server component doesn't have.
8. **Sign / verify screen shell** — no temptation; `signer-interface.tsx`'s fullscreen-modal takeover (top bar / content / bottom action bar, scroll-locked, `z-50`) is reused wholesale for both the signature-or-typed-name step and the selfie step (§3), so the two steps share one chrome instead of two different ones.

---

**Bottom line for the roundtable:** every screen in this flow maps to an existing component or an existing visual pattern except the document-upload grid (genuine, small, built from existing atoms) and the contract scroll-gate (genuine, small, ~15 lines). Nothing here needs a new token, a new color, or a new component library. The one thing that needs a decision before FE starts building is §0 — drawn signature vs typed-name, and whether live-selfie is actually in scope — because it changes what goes *inside* the reused fullscreen-modal shell, not the shell itself.
