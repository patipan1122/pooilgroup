# Post-mortem: Playland Wave 2 (face-scan checkout) shipping session — 1 process bug + 5 product bugs

**Summary.** Shipping the wristband-vs-face-scan checkout choice (Playland, `pooilgroup-web`) surfaced five independent product bugs, all found by the CEO clicking through the real product on a real phone and fixed same-session (`f893e763` → `c56936b6`, branch `setup`). Separately, and the direct trigger for this write-up: I launched four `run_in_background` shell loops to watch Vercel deploys finish, verified each deploy myself through a separate foreground check, and then moved on without ever stopping the background loops — they sat polling `vercel ls` every 8 seconds for 50+ minutes with no purpose left, visible in the CEO's remote-control "Background tasks" panel as apparently-stuck work. CEO: *"ทำไมมันเดี๋ยวนี้มันนานจังมันติดอะไร ... อย่าไปเปิดค้างในคอมสิ"* ("why is this taking so long, what's it stuck on ... don't leave things open on the computer"). Both classes are documented here per the CEO's explicit request to not repeat either.

---

## Incident 1 — orphaned background watcher tasks

**Symptom.** CEO's remote-control client showed 4 background Shell tasks still `Running`, ages 52m, 52m, 5m, and (implicitly) a 4th — all named "Wait for the \<X\> deploy to finish building/finish." All 4 corresponding deploys had actually finished (and been independently confirmed by me) minutes after each was launched.

**Root cause.** Each wait was a `Bash` call of the shape:
```bash
until vercel ls 2>/dev/null | sed -n '5p' | grep -qE "Ready|Error"; do sleep 8; done
vercel ls 2>&1 | sed -n '5p'
```
launched with `run_in_background: true`. In every case, I *separately* ran a plain foreground `vercel ls` / `vercel inspect` a short time later, confirmed the deploy was `Ready` and aliased to `pooilgroup.com`, and reported that to the CEO — then continued to the next task without ever calling `TaskStop` on the background loop I'd also launched for the identical purpose. Nothing about the polling loop itself was broken — it's plausible each one *did* eventually match and exit, or is still legitimately polling because a later deploy's row pushed the target off the fixed `sed -n '5p'` line position — but either way, the task was never closed out by me, so its liveness was never verified past the point where I'd already gotten my answer another way.

**Why it produced the symptom.** A `run_in_background` task's lifecycle is independent of whatever else confirms the same fact — verifying a deploy manually does not stop a parallel watcher I also started for that deploy. With four deploys shipped in quick succession this session, four such orphans accumulated, all visible together in the CEO's task panel, reading as "something is stuck" even though the underlying deploys were all fine.

**Fix.** Called `TaskStop` on all four (`b8535ucu9`, `bpazmf50b`, `bsg3vu1g3`, `bskzwlvin`) as soon as the CEO flagged the panel. Going forward: **every `run_in_background` task must be explicitly stopped once its purpose is served, even when the outcome is separately confirmed by another method.** "I know the answer already" is not the same as "the background task is done" — if I'm not going to let a background task's own completion be the signal I act on, I shouldn't leave it running to consume it.

**Validation.** All four `TaskStop` calls returned `"Successfully stopped task: ..."`. Confirmed no further background deploy-watcher tasks were left running at end of session.

**Action items.**
- None — the fix is behavioral (a rule for this and future sessions), not a code change. No class-of-bug follow-up beyond "call TaskStop when a background task's job is done," which is now written down here and in a feedback memory.

---

## Incident 2 — five bugs found shipping Wave 2 (wristband/face-scan choice)

Deployed in sequence, each found live by the CEO (or, for bug 2 and the second confirmation of bug 3, reproduced directly by me against the real production branch), fixed, redeployed, and re-verified the same session.

### Bug 1 — checkout method cards overflowed off-screen on mobile
**Symptom.** On a real 390px-wide phone, the "สแกนหน้า" (face-scan) card on the new method-choice screen rendered mostly off the right edge of the viewport (`getBoundingClientRect()`: `x: 373.9, width: 59` against a 390px viewport — only ~16px on-screen), making it effectively untappable. The pre-existing "เคยมาแล้ว / มาครั้งแรก" first screen of the same check-in flow had the identical defect.

**Root cause.** Both screens used a hard-coded inline `style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}` with no responsive collapse. `app/(admin)/playland/playland.css` already defines `.pl-grid-2e` for exactly this shape (`grid-template-columns: 1fr 1fr`) with a `@media (max-width: 760px) { grid-template-columns: 1fr; }` override — the established pattern from the June 2026 Playland-mobile project (`playland-mobile-version-2026-06-24`) — but the new method-choice screen was written with a fresh inline style instead of that class, and the older "choose" screen had never been migrated either.

**Fix.** `components/playland/playland-app.tsx` (commit `1a0c1912`): both card grids switched from the inline style to `className="pl-grid-2e"`, plus `minWidth: 0` on the card and its text wrapper so long labels don't force the column back open.

**Validation.** Headless Playwright at a real 390×844 mobile viewport, pre- and post-deploy: pre-fix bounding box `x:373.9, width:59` (mostly off-screen); post-fix `x:162, width:152` (fully within the 390px viewport). Screenshot sent to CEO for visual confirmation.

### Bug 2 — production branch had zero packages, silently running in demo mode
**Symptom.** CEO's real checkout on the actual production branch ("ปตท ชุมพวง") produced a receipt (`#745`, ฿70, 30 min) and printed a wristband — every time, regardless of which checkout method was selected — even though the CTA button text correctly reflected the face-scan choice.

**Root cause.** `pickPackage`/`confirmCheckin` in `playland-app.tsx` gate the real backend path on `props.branchId && isRealId(pkg.id)`. `packages = props.packages.length ? props.packages : PRESET_PACKAGES` — and `playland.packages` had **zero active rows** for that branch (confirmed via direct query), so every checkout fell through to `PRESET_PACKAGES` (ids like `"pk30"`, which fail `isRealId`) and the component's "optimistic fallback" branch at the bottom of `confirmCheckin` ran instead: pure client-side state, `randReceiptNo()` (client-random `"#" + 740..799`, matching the observed `#745`), and an **unconditional** `printWristband()` call written before Wave 2 existed, with no knowledge of `s.ckMethod` at all. No `createMember`/`checkInSession` call ever happened — the "Pim" test member the CEO created did not exist in the database.

**Fix.** Data/config, not code: created 4 real `PlaylandPackage` rows for the branch (30/60/120 min + day pass, prices matching the already-configured Demo branch, confirmed with the CEO first) and moved the 2 real ACS-F606 devices from the Demo branch onto the real branch so face-scan sync has real hardware to target.

**Validation.** Post-fix, CEO's live checkout (`"มก"`, then `"Z"`) created real `PlaylandMember`/`PlaylandSession` rows and reached the real face-sync pipeline (see bug 3) — confirmed both by DB query and by the CEO reaching "รับเงินแล้ว · ลงทะเบียนหน้าสำเร็จ" (bug 3's fix, below) on a real branch checkout.

### Bug 3 — captured photo never uploaded to R2, so real-device sync always failed
**Symptom.** After bug 2's fix, the face-scan path reached the real backend, but every attempt against real hardware failed with `PlaylandFaceSync.error_message = "ไม่มีรูป (R2 อ่านไม่ได้)"` ("no photo, can't read from R2") on both devices, reported by the shop-floor agent.

**Root cause.** `syncMemberFaceToDevices` (new shared helper in `lib/playland/actions.ts`, factored out of `createMember` to also serve the new `addMemberFacePhoto` action) queues a `PlaylandFaceSync` `PENDING` row per real device but never persisted the actual photo bytes anywhere durable — it only held the decoded buffer in memory for the duration of the request. The shop-floor agent (`app/api/playland/acs/agent/face-sync/route.ts:70-74`) picks up `PENDING` jobs *asynchronously*, on its own poll cycle, and reads the photo via `getObject(job.member.photoR2Path)` — which was `null`, since nothing had ever set it. `app/api/playland/public/register-face/route.ts` (the pre-existing public mobile self-register endpoint) already does this correctly — uploads to R2 via `putObject` and sets `member.photoR2Path` *before* queueing the sync row, with an explicit comment explaining exactly why ("this HTTP request's buffer won't exist anymore by the time [the agent runs]") — the new helper didn't mirror that step. `createMember`'s original synchronous-only version of this code predates the real-hardware queueing path entirely, so the gap was latent there too and had simply never been exercised end-to-end against real hardware before today.

**Fix.** `lib/playland/actions.ts` (commit `51ead0e8`): `syncMemberFaceToDevices` now uploads to R2 (`putObject`, key `playland/faces/<orgId>/<memberId>/<uuid>.jpg`) and sets `member.photoR2Path` before the device loop, whenever a real (non-mock) device is present — matching `register-face/route.ts`'s existing, working pattern exactly.

**Validation.** Direct reproduction against the real branch (my own test, after opening a shift for the test account): `photo_r2_path` correctly populated post-fix (`playland/faces/00000000-.../26e1ea12-.../f6396d5e-....jpg`), and the sync attempt progressed to a *different*, expected failure — `"รูปไม่ผ่าน: Check Face Picture Failure"` — the device correctly rejecting a screenshot (no face in it) rather than failing to read a photo at all. CEO's own subsequent live attempt with a real face photo completed successfully end-to-end: `"รับเงินแล้ว · ลงทะเบียนหน้าสำเร็จ"`.

### Bug 4 — live webcam preview never appeared after granting camera permission
**Symptom.** CEO granted the camera permission (confirmed by iOS's own "หยุดใช้กล้อง" / stop-using-camera indicator, proving a live stream existed), but the UI stayed on the pre-permission "ขออนุญาตเปิดกล้อง" placeholder indefinitely. Working around it via the upload-photo fallback succeeded.

**Root cause.** `components/playland/face-capture.tsx`'s `startCamera`:
```tsx
// before
const stream = await navigator.mediaDevices.getUserMedia({...});
streamRef.current = stream;
if (videoRef.current) {              // always null here
  videoRef.current.srcObject = stream;
  await videoRef.current.play();
  setReady(true);
  setCameraStarted(true);
}
```
`<video ref={videoRef}>` only renders once `cameraStarted` is `true`; at the point this code runs (synchronously after `getUserMedia` resolves, but before any state update has committed a re-render), the video element doesn't exist yet, so `videoRef.current` is `null` and the entire block — including the `setCameraStarted(true)` call needed to ever render the video element in the first place — silently no-ops. The stream is captured and then simply abandoned.

This is the *identical* bug already documented in `postmortems/chairops-onboarding-camera-3-bugs-2026-09-23.md` (bug 1 there, in `components/chairops/selfie-capture.tsx`), which explicitly names `face-capture.tsx` as having "the identical structural bug — left untouched, out of scope per CEO instruction (ChairOps-only this round)." That deferred fix came due today.

**Fix.** `components/playland/face-capture.tsx` (commit `c56936b6`): `startCamera` now only sets `streamRef.current` and calls `setCameraStarted(true)`; a new `useEffect` keyed on `cameraStarted` attaches the stream to `videoRef.current` and calls `.play()` once React has actually mounted the `<video>` element — the same fix shape already applied to `selfie-capture.tsx` on 2026-09-23.

**Validation.** `tsc --noEmit`: 0 errors. The fix mirrors an already-validated fix to the identical bug in a sibling component. **Not yet independently re-confirmed live by the CEO on a real device** as of this write-up — that confirmation is a pending follow-up, not assumed.

### Bug 5 — home-screen shift button always read "ปิดกะ"
**Symptom.** CEO screenshot: the status pill correctly read "ยังไม่เปิดกะ" (no shift open), but the button next to it — which navigates to the same shift screen — was hard-coded to always say "ปิดกะ" (close shift), which doesn't match the actual available action (opening one).

**Root cause.** `playland-app.tsx`, home screen header: `<div onClick={() => go("shift")} ...>ปิดกะ</div>` — a static string, unlike the adjacent status pill (`props.hasOpenShift !== false ? <...กะเปิดอยู่> : <...ยังไม่เปิดกะ>`) and the shift screen's own title (`{shift ? "ปิดกะ" : "เปิดกะ"} — {cashierName}`), both of which already branch correctly on shift status.

**Fix.** `playland-app.tsx` (commit `e3edd775`): button label now `{props.hasOpenShift !== false ? "ปิดกะ" : "เปิดกะ"}`, matching the pattern already used two lines away.

**Validation.** `tsc --noEmit`: 0 errors. Trivial, low-risk conditional matching an already-proven pattern in the same component. Not yet independently re-confirmed live by the CEO post-deploy.

### Why these slipped through
Bugs 1, 4, and 5 are runtime/CSS/browser-timing issues invisible to `tsc`/`eslint`/`next build` — no static signal exists for any of them. Bug 4 specifically was a *known*, previously-documented debt (flagged 2026-09-23, deliberately deferred, not forgotten) — today's Wave 2 work was the first time `face-capture.tsx`'s live-camera path was actually exercised end-to-end since that flag was raised. Bug 2 is a workload gap: the real branch's checkout flow had apparently never been exercised against its own backend before, because packages were never configured for it — my own testing this session used the separate Demo branch throughout (deliberately, to avoid creating test data or hardware traffic against the real branch), so the client-fallback path never got triggered until the CEO tested the real branch directly. Bug 3 is latent code exercised by a genuinely new code path (`addMemberFacePhoto`) that had no prior real-hardware test coverage — my own pre-ship verification used the mock device specifically to avoid touching real hardware with test data, which meant it could never have caught an R2-persistence gap that only matters for the real (queued, asynchronous) device path.

### Action items / follow-ups
- Get CEO to re-confirm bug 4 (live camera preview) and bug 5 (shift button label) work on a real device — not yet independently validated post-deploy, only typecheck + code-pattern correctness so far.
- `components/playland/mobile-face-register.tsx` (the public self-register flow) and `components/playland/member-register-form.tsx` (orphaned, unreachable) both also use `FaceCapture` — they inherit bug 4's fix for free since it's the same shared component, no separate action needed, but worth knowing if either is ever exercised on real hardware and still shows a stuck camera, the fix is already in place.
- No further audit of other `gridTemplateColumns: "1fr 1fr"` inline instances in `playland-app.tsx` was done this session (several remain, in form-field pairs rather than large tap targets — lower severity, not confirmed broken, out of scope this round).
