# Follow-up to Lily — 2026-05-27 (after she answered Q1+Q4)

## Context

Lily answered 2 of 5 prior questions (chat 2026-05-27 15:46):
- ✅ Q1 — same webhook + protocol as F606 (doc-2)
- ✅ Q4 — one device handles both face + QR simultaneously, no mode switch
- ⏳ Q2/Q3/Q5 — "more info waiting for our engineers' feedback"

This follow-up merges:
- The 2 outstanding questions from prior draft (gate relay · HTTPS confirm)
- 2 new questions from parallel chat (cloud sim · sample JSON × 4 event types)

Send when Lily comes back or after a polite delay (24h max).

## Message (copy-paste · Alibaba translator handles fine)

```
Thanks Lily, that's clear for Q1 and Q4. Four things still pending
before we place the order:

A. Sample webhook JSON — please share 3-4 examples covering:
   face match success, face match fail, stranger detected, QR scan.
   Even before the device arrives, we can build and test our parser
   so testing is instant when it ships.

B. Cloud test endpoint or simulator we can point at right now — we
   already have TEST-CLOUD-001 access but the HTTPS issue is blocking it.
   Do you have a simulator with sample events we can validate against?

C. Gate relay for QR — when QR is accepted, does the device open the
   gate locally (like recogRelay=1 for face), or does our server need
   to reply with a specific value?

D. HTTPS — confirm whether this new device's firmware supports HTTPS
   for platformIp, or HTTP-only like F606. We need this to decide
   whether to deploy our HTTP proxy or wait for a firmware update.

With these 4 answers we order the 3 devices same day. Thanks!
```

## Why each question matters (for internal record)

| # | Question | Why we need it |
|---|---|---|
| A | Sample JSON × 4 event types | Build parser ahead of device arrival → install + go-live same day |
| B | Cloud test endpoint | Validate our integration end-to-end before hardware ships → catch regressions in CI |
| C | Gate relay for QR | Decides our UX flow · if device-local = fast · if server-decided = need extra round-trip logic |
| D | HTTPS confirm | Decides whether to deploy our HTTP→HTTPS bridge (cost + ops) or wait for firmware |

## What we do with the answers

| Answer A (sample JSON) | Wire into `lib/playland/acs/acs-auto-adapter.ts` `normalizeEvent()` · add QR branch |
| Answer B (cloud sim) | Hit it from `scripts/e2e-playland-acs.ts` (new) for CI testing |
| Answer C (gate relay local) | Document in adapter · no code change · OR add server-reply value if needed |
| Answer D (HTTPS yes) | Skip bridge deploy · point device direct at Vercel URL |
| Answer D (HTTPS no) | Deploy `tools/acs-http-bridge/worker.js` to Cloudflare per README |
