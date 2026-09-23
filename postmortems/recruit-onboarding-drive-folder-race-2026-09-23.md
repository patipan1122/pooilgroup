# Recruit Onboarding — submission rejected at the final step by our own Drive folder race

**Date:** 2026-09-23
**Severity:** P0 — blocked 100% of real submissions; the CEO hit it on the very first one.
**Fixed in:** `30d95b8e` (branch `claude/recruit-onboarding-workshop-2026-09-20` → `setup`)

## Symptom

CEO completed the entire onboarding flow on an iPhone — 41 fields, 4 attached
documents, read the contract to the end, drew a signature, took the selfie —
pressed **ยืนยันและส่งสัญญา**, and got:

> ไฟล์แนบไม่ตรงกับแบบฟอร์มนี้ · กรุณาอัปโหลดเอกสารใหม่อีกครั้ง

There was no recovery path: the message asks the candidate to re-upload, but
re-uploading from that screen produces the same result, and the flow has no
per-person code for HR to look the person up by.

## Root cause

`POST /api/recruit/onboarding/submit` enforced that every file descriptor in a
submission sat in exactly one Drive folder:

```ts
const folderIds = new Set(allDescriptors.map((d) => d.folderId));
if (folderIds.size !== 1) return bad("ไฟล์แนบไม่ตรงกับแบบฟอร์มนี้ · ...");
```

The descriptors legitimately spanned two folders, because of how the folder was
resolved in `lib/recruit/onboarding-drive.ts`:

```ts
const root   = await ensureFolder(token, ONBOARDING_ROOT, null);
const folder = await ensureFolder(token, safeFolderName(submissionId), root);
```

`ensureFolder()` is search-then-create against the Drive API, whose search index
is **eventually consistent**, and Google Drive permits duplicate folder names.
A candidate attaching several documents in quick succession fires several of
these concurrently; none of them sees the folder the others just created, so
Drive creates several folders with the same name and the files scatter across
them. The check then rejected an entirely honest submission.

This is the same bug class as the duplicate Drive folders the CEO reported on
2026-06-07 — the incident that RULE I (architecture review: race conditions,
idempotency) was written for. The review question "what happens if two of these
run at once?" was asked of the *submission* path and answered with a DB
transaction, but was never asked of the *upload* path.

## Why the guard made it worse

The check was cheap anti-tamper: stop a submission stitching in a file from
another candidate's folder. But file ids are unguessable random strings, so that
attack already requires knowing the target id — while the false-positive cost
was destroying a completed, signed submission with no recovery. The guard was
strictly worse than the risk it covered.

## Fix

1. **Root cause** — `uploadOnboardingDocumentToDrive` now takes an optional
   `knownFolderId`. The first upload of a draft resolves the folder by name as
   before and returns its id; the client passes that id back on every later
   upload, and the server writes straight into it. No second lookup, no race.
2. **Blast radius** — the same-folder check is downgraded from a hard reject to
   `driveFolderAnomaly: true` recorded on the submission, so HR is told the
   folder may not hold every file instead of the candidate losing their work.

## How it slipped through

- `/verify` covers typecheck, lint, build and HTTP smoke — none of which can
  reach a code path that only fires when a real person uploads several files to
  a real Google Drive within a few seconds.
- No end-to-end submission was ever completed before shipping. This was called
  out in the spec and the briefing as the top outstanding gap ("ยังไม่เคยส่งฟอร์ม
  จบ flow จริงสักครั้ง") — and it is exactly where the bug was.
- 13 personas reviewed the design; the QA persona explicitly listed
  "Drive-succeeds/DB-fails" partial-failure cases, but nobody modelled
  concurrent uploads *within* the Drive helper itself.

## Prevention

- When reusing a search-then-create helper against an eventually-consistent
  remote store, treat concurrent callers as the default case, not the edge case
   — resolve the container once and thread its id, never re-resolve by name.
- A validation rule that can reject a completed, irreversible user action needs
  its false-positive cost weighed explicitly against what it prevents. If the
  false positive destroys work and the attack it blocks needs a secret the
  attacker doesn't have, the rule should log, not reject.
