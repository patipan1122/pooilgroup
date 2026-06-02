# AUDIT · ClawFleet Unify (2026-06-02)

> `/auditbigteam` · 15 personas (core 13 + A11Y + SRE) · 32 agents · adversarial-verify pass on every P0
> Target: the freshly-built unified ClawFleet (branch claude/clawfleet-design-impl, commits c198db0→guard)
> Method: each "P0" claim was re-traced against the actual code → REAL vs REFUTED. Most P0 claims were REFUTED (false alarms) — only verified-real findings are actioned.

## Executive summary
The unified build is **structurally sound** for an anti-fraud money module: F1 (฿100 cash floor) + F2 (no self-approval) + F5 (netting guard) intact; Type B 3-way token cross-check fires via the Postgres trigger; v1 fully deleted; full build passes. The adversarial verify pass **refuted 11 of 12 "P0" claims** (false alarms incl. the FE "action mismatch", LIFF-missing, A11Y-contrast, trigger-no-retry). **2 genuine code bugs were found and FIXED this pass.** Remaining work is go-live ops (migrations + config), not code correctness.

## ✅ Verified-REAL findings — FIXED this pass
| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | P0 | **Empty-group wedge** — a group with an exchanger but 0 active CLAW machines could OPEN a session but never CLOSE (close needs ≥1 claw), and the OPEN session then blocked any retry — stuck forever, no recovery path. | `startGroupSession` now counts active CLAW machines and refuses to open an empty group ("กลุ่มนี้ยังไม่มีตู้คีบ"). |
| 2 | P1 | **Cross-group CLAW pollution** — `submitBranchEvent` validated only branchId; a claw from group B could be submitted into group A's round (same branch) → corrupts the 3-way denominator (trigger sums A+B claws vs A's exchanger). | `submitBranchEvent` now rejects a claw whose `groupId` ≠ the session's `groupId`. |

## ❌ "P0" claims REFUTED by the verify pass (false alarms — no fix needed)
- FE "submitBranchEvent action mismatch in group flow" → **REFUTED**: startGroupSession sets `branchId = group.branchId`, so claw submits pass the branch check. Group flow works.
- "TOKEN expectedCash=0 breaks reconciliation / divide-by-zero" → REFUTED (bps guarded; exchanger cash is the recorded cash).
- "Guard migration unapplied floods ANOMALY_REVIEW / blocks CASH settlements" → REFUTED: a stray flag is cosmetic P2 noise; status stays CLOSED (the cash/doll app-checks pass). Still worth applying for clean UX.
- "LIFF ID missing → staff auth fails with error" → REFUTED (web fallback works).
- "Trigger 3-way has no retry → silent CLOSED on failure" → REFUTED.
- A11Y "disabled-button contrast / focus indicator fails WCAG" → REFUTED as P0 (real but P1/P2 polish).

## 🚦 Go-live gaps (ops, not code) — CEO/admin actions
1. **Apply migration 20260531000001** to prod DB (psql DIRECT_URL) — guards CASH groups from cosmetic false flags. (Now in repo.)
2. **Set NEXT_PUBLIC_LIFF_ID** (LINE channel) — enables in-LINE auto-login; web fallback works without it.
3. **Configure groups + exchangers + machines** per branch (greenfield — staff can't start a round without a seeded group). Needs an admin setup step.
4. **Confirm data wipe** of cf_* (CEO already approved "ลบได้หมด").

## 🟡 P1/P2 hardening (recommended, not blocking M1) — DEFERRED
- Photo upload: timeout (30–60s) + retry/backoff + local draft auto-save (field-network resilience). [STAFF P1]
- UX: ~50 taps per 4-claw group collection — consider faster numeric entry / fewer photos later. [STAFF P1]
- A11Y: focus rings, semantic tables, label htmlFor, disabled-state contrast. [A11Y P1]
- Cancel/abandon action for a stuck OPEN session (the wedge is now prevented, but a mid-round claw-deactivation could still strand a session). [P2 resilience]
- Hub dashboard still reads some mock (v2-data.ts) — not blocking M1 (collect flow is real). [PM P1]

## 🎯 Top 5 Decisions Needing CEO Eyes
1. **Apply guard migration 20260531000001 + the cf_* config** before staff use — owner: SRE/DBA · cost-if-wrong: med (cosmetic flags) · ☐ approve
2. **Provide LINE LIFF channel/ID** — owner: CEO · cost-if-wrong: high (no LINE entry) · ☐ approve
3. **Greenfield wipe + seed real groups/exchangers/machines** — owner: CEO · cost-if-wrong: high (empty app) · ☐ approve
4. **Pilot 1 branch × 1–2 days before 10-branch rollout** (STAFF persona) — measure time/round + abandon rate · ☐ approve
5. **Defer photo-retry/A11Y polish to post-pilot?** — owner: PM · ☐ approve

## Sign-off (after verify + 2 fixes)
| Persona | Status | Note |
|---|---|---|
| SA · BA · QA · BE · IA · STAFF · SRE · A11Y · DEVIL · OWN · MGR · PM | 🟡 CONDITIONAL | conditions = the 4 go-live ops gaps above |
| FE · AUD · SEC | was 🔴 BLOCKED → now 🟡 CONDITIONAL | their blockers were REFUTED by verify (FE action-mismatch) or are the go-live ops gaps; the 2 real code bugs are fixed |

**Verdict:** code-correctness is GO (M1 logic sound, 2 real bugs fixed, build green). Go-live is gated on the 4 ops actions above, not on code. Next: deploy → `/bigsolvebug` runtime pass (post-seed).
