# BugSolve · ClawFleet Unify · 2026-06-02

> `/bigsolvebug` completeness sweep (6 lenses + adversarial-verify) on the unified ClawFleet.
> Mode: static button→handler + action-path tracing (app greenfield/undeployed → runtime click-through limited; verified by code-trace).

## §summary
- Status: ✅ **5 dead-link/dead-button bugs fixed** · ⏳ 0 P0 logic bugs (all "crash" claims REFUTED) · build green.
- "Every button real" (M3) now holds: every office button reaches a live v2 route; no reference to any deleted v1 route remains anywhere (grep = 0).
- The collect group-flow action mapping is correct (exchanger→submitExchangerEvent, claw→submitBranchEvent, close→closeGroupSession); the 8 server actions are guarded (auth + org/branch isolation + ok/error returns, not 500); F1/F2/F5 + the 2 audit fixes verified intact.

## §bugs-fixed (P0/P1)
| # | sev | file:line | bug | fix |
|---|---|---|---|---|
| 1 | P0 | app/(admin)/home/page.tsx:285 | Pool home ClawFleet card → deleted `/clawfleet/dashboard` (404 — main entry) | landingPath → `/clawfleet` (role-aware redirect) |
| 2 | P1 | clawfleet/v2/team/page.tsx:36 | "จัดการตู้" → deleted `/clawfleet/machines` (404) | → `/clawfleet/v2/stock` ("สต๊อก & ตู้") |
| 3 | P1 | clawfleet/v2/team/page.tsx:39 | "ตั้งค่าสาขา" → deleted `/clawfleet/setup` (404) | → `/clawfleet/v2/settings` |
| 4 | P1 | clawfleet/v2/settings/page.tsx:56 | "ไปหน้าตั้งค่าเดิม" → deleted `/clawfleet/setup` (404) | removed dead CTA + fixed subtext + dropped unused imports |
| 5 | P2 | clawfleet/page.tsx:10 | stale comment claiming v1 routes still reachable | corrected |
| 6 | P2 | scripts/test-http-prod.ts:37-45 | smoke test hit deleted v1 routes | repointed to v2 routes |

## §refuted (false alarms — code already guards)
- Sparkline NaN on empty trend7d → REFUTED (guarded).
- Modulo-by-zero in nextAnomaly / decide (hub + anomalies) on empty arrays → REFUTED ×5 (the `if (length === 0) return` guards added earlier hold).

## §verified-clean
- collect-group-client.tsx + /liff/clawfleet: correct step→action wiring, photo validation, close-enable condition, empty-state.
- All 8 v2-actions: requireSession + userBranchIds + org_id isolation + ok/error returns. F1 (฿100 floor), F2 (self-approval block), F5 (netting) intact. The 2 audit fixes (empty-group guard, cross-group claw guard) hold.
- Pool nav (lib/modules.ts clawfleet) — every item → live v2 route. Slim BranchFilterBar wired. Earlier-wired buttons (hub/anomaly filters, สั่งเติม, insights custom date, ops drill) still work.
- clawfleet crons (photo-retention, session-autoclose) — no deleted-lib imports.

## §next-actions (CEO)
Code is GO. Deploy is gated on CEO authorization + the go-live ops gaps (see AUDIT doc): apply migrations 20260521000002(present)+20260531000001, set NEXT_PUBLIC_LIFF_ID, configure groups/exchangers/machines, confirm data wipe.
