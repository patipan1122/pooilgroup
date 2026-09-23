# Post-mortem: ChairOps maid onboarding — camera capture broken by 3 stacked bugs

**Summary.** The "ยืนยันตัวตน" step of the maid self-onboarding form (`app/(admin)/chairops/(maid-public)/m/onboarding/onboarding-form.tsx`), used by a broker walking a maid through her first contract, had three independent bugs in `components/chairops/selfie-capture.tsx` and `components/chairops/id-card-upload.tsx` that together made photo capture unusable on a real phone: (1) the live-camera "ถ่ายเลย" button stayed permanently disabled due to a React ref race, (2) the "เลือกรูปจากเครื่อง" button forced the native camera open instead of offering the photo gallery, and (3) uploading a captured photo always failed with a bare "Load failed" because the upload path's `fetch(dataUrl)` call was blocked by the site's own Content-Security-Policy. Branch `claude/chairops-onboarding-camera-fix-2026-09-23`, merged onto `setup` at `92a2c3ca`. **Deployed live 2026-09-23.**

**Symptom.** CEO forwarded a mobile screenshot from a broker mid-onboarding, annotated with three numbered complaints: (1) "กดปุ่มถ่ายเลยไม่ได้" — the shoot button does nothing; (2) "เลือกรูปจากเครื่องแต่กดไปแล้วเลือกรูปจากเครื่องไม่ได้ให้ถ่ายอย่างเดียว" — chose "pick from device" but it only opens the camera; (3) "กดถ่ายแล้วขึ้นโหลดรูปไม่สำเร็จ" — after taking the photo, "Load failed" appears. The feature had been deployed the previous day (`fbb12bad`, see [chairops-contract-selfie-built-2026-09-22]) with an open risk flagged at the time: nobody had tried it live on a real phone yet.

**Root cause — bug 1 (video ref race, `selfie-capture.tsx`).**
```tsx
// before
const stream = await navigator.mediaDevices.getUserMedia({...});
streamRef.current = stream;
setCameraOn(true);
if (videoRef.current) {              // always null here
  videoRef.current.srcObject = stream;
  await videoRef.current.play();
  setReady(true);
}
```
The `<video>` element only renders once `cameraOn` becomes `true` (`{cameraOn ? <video ref={videoRef} .../> : <button onClick={startCamera}>}`). React state updates don't commit synchronously — at the point `if (videoRef.current)` runs, the DOM still reflects the pre-click render, so the `<video>` element doesn't exist yet and the ref is always `null`. The whole block silently no-ops: `ready` never becomes `true`, so the "ถ่ายเลย" button (`disabled={!ready}`) is stuck disabled forever, on every device, every time — not a flaky/intermittent bug. `components/playland/face-capture.tsx`, the component this one was explicitly modelled on ("same getUserMedia error classification, because those are the parts that took real device testing to get right"), has the identical structural bug — left untouched, out of scope per CEO instruction (ChairOps-only this round).

**Root cause — bug 2 (forced camera-only, both components).**
```tsx
<input type="file" accept="image/*" capture="user" onChange={onFilePicked} className="hidden" />       // selfie-capture.tsx
<input type="file" accept="image/*,application/pdf" capture="environment" onChange={onPick} ... />       // id-card-upload.tsx
```
The `capture` attribute is a UA hint to skip the file chooser and go straight to the camera. Several mobile browsers and most in-app webviews (LINE, Messenger, etc.) honor it literally — tapping a button explicitly labeled "เลือกรูปจากเครื่อง" (choose from device) or "ถ่าย / เลือกรูปบัตรประชาชน" opened the camera only, with no way to reach the photo gallery. Both components had this; the CEO's report only called out the selfie step because that's as far as the broker got, but `id-card-upload.tsx`'s single combined button had the exact same defect and was fixed in the same pass.

**Root cause — bug 3 (CSP-blocked `fetch(dataUrl)`, `selfie-capture.tsx`).**
```tsx
// before
async function uploadDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();   // fetching a data: URL
  ...
```
The site's CSP `connect-src` allowlists `https://*.supabase.co`, `https://*.upstash.io`, `https://*.r2.cloudflarestorage.com`, `https://api.telegram.org`, `https://*.line.me`, `wss://*.supabase.co` — it does not include `data:`. Browsers apply `connect-src` to `fetch()` regardless of scheme, so `fetch(dataUrl)` was blocked by policy on every device. The resulting rejected promise is a `TypeError`; WebKit/Safari's generic message text for this is literally **"Load failed"**, which is what leaked straight into the app's error UI (`err instanceof Error ? err.message : ...`). This is deterministic, not a flaky-network symptom — it reproduces with a perfect network connection too. `id-card-upload.tsx` was never affected: its upload path uploads the raw `File` object directly and never round-trips through a data URL/fetch.

**Fix.**
- `selfie-capture.tsx`: moved the stream-attach logic out of the inline post-`getUserMedia` check into a `useEffect` keyed on `cameraOn`, which only runs after React commits the `<video>` element to the DOM — `videoRef.current` is guaranteed non-null there.
- `selfie-capture.tsx` + `id-card-upload.tsx`: dropped `capture="user"` / `capture="environment"` from both file inputs so mobile browsers show their normal chooser (camera **and** gallery).
- `selfie-capture.tsx`: replaced `fetch(dataUrl).blob()` with a local `atob()`-based base64 decode (`dataUrlToBlob`), which needs no network call and isn't subject to `connect-src`.
- Both components: added a one-shot retry (`fetchWithRetry`) for genuine network-level `TypeError`s on the two real HTTP calls (presign + PUT), and replaced any leaked raw browser error text with a Thai message ("เน็ตหลุดกลางทางตอนอัปโหลดรูป — เช็คสัญญาณแล้วลองถ่ายใหม่อีกครั้ง") for defense-in-depth against real mobile signal drops, separate from the CSP issue.

**How it was found.** Read `components/chairops/selfie-capture.tsx` and `id-card-upload.tsx` directly against the CEO's three numbered complaints and matched each to a specific code path (video ref timing, `capture` attribute, error-message string). Bug 3's true mechanism (CSP block, not flaky network) was only discovered during headless verification, not code reading alone — see Validation.

**Why it slipped through.** All three bugs are invisible to `tsc`/`eslint`/`next build` — they're runtime, event-driven, browser-API-timing and CSP-policy issues with no static signal. The feature had also never been exercised on a real device before this report (flagged as an open risk at deploy time in [chairops-contract-selfie-built-2026-09-22]); a manual click-through on desktop Chrome, where the `capture` attribute is usually ignored and `connect-src data:` failures don't casually present as "worked fine," would not have caught any of the three.

**Validation.** `./node_modules/.bin/tsc --noEmit`: 0 errors. `next build`: succeeded, all routes generated. Real browser verification (Playwright, headless, `--use-fake-device-for-media-stream` to simulate a camera, run against a temporary un-auth-gated harness page mounting both components — deleted before merge, never shipped): confirmed both file inputs' `capture` attribute is `null` after the fix (bug 2), confirmed "ถ่ายเลย" is not disabled after opening the live camera (bug 1 — previously would have been permanently `disabled`), and confirmed the upload request now reaches the server (a real `401`/"ต้อง login ก่อน upload" from `/api/r2/sign`, since the harness has no session) instead of dying at the browser CSP layer with the old "Load failed" (bug 3). Pre-push gate: `/verify` skill run in full (typecheck, eslint on changed files, `next build`, clean `git status --porcelain`, live smoke test on `pooilgroup.com` — `/`, `/login`, `/health`, `/onboard` all healthy; `/chairops/m/onboarding` correctly 307-redirects unauthenticated). Could not screenshot the actual authenticated maid onboarding page in production — it requires a real, not-yet-onboarded maid session, which no test account exists for; end-to-end confirmation on a real device is pending the broker retrying live.

**Action items / follow-ups.**
- Not done, flagged only: `components/playland/face-capture.tsx` has the identical video-ref race as bug 1 (same author comment says it was the reference implementation). Left untouched — CEO explicitly scoped this fix to ChairOps only.
- Ask the CEO to have the broker retry the onboarding flow live once the Vercel deploy for `92a2c3ca` finishes, since the gallery-picker behavior (bug 2) and full end-to-end upload (bug 3) can only be truly confirmed on a real phone/browser, not headlessly.
