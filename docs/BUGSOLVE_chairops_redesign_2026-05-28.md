# BugSolve · ChairOps redesign · 2026-05-28

## §summary (Thai)
- รัน /bigsolvebug โหมด compressed (code-wiring audit · live-click ทำไม่ได้เพราะ auth 307) บน 5 surface ที่ /bigfeature เพิ่ง redesign
- เจอ **4 บั๊กจริง** (3×P1 security/UX + 1×P0 dead-button) · **แก้หมดแล้ว** · เหลือ P2 อีก 6 ตัว defer
- **บั๊กใหญ่สุด: cross-org data leak 3 จุด** — query/recompute ไม่ filter orgId → tenant อื่นเห็น/เขียนทับ drift ข้ามองค์กร · ปิดหมดแล้ว
Status: ✅ 4 bugs fixed · ⏳ 6 P2 deferred · 🔴 0 need CEO

## §scope
5 surfaces (Dashboard · Branches 3-pane · Reconcile 3-view · Maid LINE app · kit/tokens) · 3 parallel verify agents · tsc+build clean after fixes · ~320k tokens

## §bugs-fixed (P0+P1)
| # | sev | file:line | desc | fix |
|---|---|---|---|---|
| B1 | P1🔴 | `lib/chairops/reconcile/drift-engine.ts:388` getDashboardRows | no orgId filter → exec dashboard (KPI · critical-branches · missed-maids) aggregated ALL tenants' drift | added optional orgId param + wired from 3 exec-home callers |
| B2 | P1🔴 | `lib/chairops/reconcile/drift-engine.ts:371` recomputeAllDrifts | "Recompute" button + pos-ingest commit recomputed & PERSISTED ChairopsDrift rows for EVERY tenant | added optional orgId param · reconcile page + pos-ingest pass session org |
| B3 | P1🔴 | `lib/chairops/reconcile/alerts.ts:13` evaluateAndEmitAlerts (R4) | same cross-org class in alert pipeline — emitted alerts across all orgs | added orgId param → recomputeAllDrifts(orgId) · 4 authenticated callers (reconcile/write-offs/dashboard/pos-ingest actions) pass session org · cron stays unscoped (correct) |
| B4 | P1 | `app/(admin)/chairops/branches/page.tsx:73` driftClass | inverted coloring — cash SHORTAGE shown GREEN, surplus RED (backwards vs engine + dashboard) | flipped: n>1000→crit · n>100→warn · n<0→ok |
| B5 | P0 | `app/(admin)/chairops/(maid)/m/profile/page.tsx` logout | `<form action="/logout">` → route doesn't exist (real = `/api/auth/logout`) · maid's only logout was 404 no-op | new `logout-button.tsx` client → POST /api/auth/logout + supabase signOut + redirect /login |

## §drift-sign verification (CRITICAL for cash-control tool)
**VERIFIED CORRECT end-to-end.** buildLedger: `diff = deposit − expectedCash` (neg=shortage). Sidebar inverts drift-engine's positive=shortage to `cumDrift = -driftAmount` (neg=shortage) — consistent. Tone: negative→red, surplus→green. Periods label `diff<0→"ขาด"`, `diff>0→"เกิน"`. **No sign flip — CEO will NOT see "เกิน" when it's actually "ขาด".** (per [[chairops-no-cumulative-shortage]])

## §bugs-deferred (P2 · no runtime risk)
| # | desc | action |
|---|---|---|
| P2-1 | Branches Timeline tab badge hard-coded "42" | wire to real count · cosmetic |
| P2-2 | dashboard resolves maid via primaryBranchId, workspace via MaidAssignment | data-model nuance · align in Wave 2 |
| P2-3 | +/− sign display differs dashboard vs branches | mockup-fidelity polish |
| P2-4 | reconcile sidebar `missed` status dot overrides shortage dot color | cumDrift chip still red · shortage not hidden |
| P2-5 | recomputeDriftForBranch writes on every GET of maid home (force-dynamic) | write-on-read · service-role · perf note |
| P2-6 | maid part-request has no office approval-queue UI (writes real audited movement, just no filter view) | Wave-2 feature |

## §remaining mockup stubs (no backend · marked TODO[claude-design] W2)
- maid part-approval queue · profile change-PIN/view-branch rows · mobile damage form (redirects to desktop form)

## §verdict
**SAFE to prod-deploy.** All cross-org leaks (the only true blockers) closed. Drift sign correct. Maid submit chains (cleanliness + parts) fully wired with orgId + audit + revalidate. tsc clean · next build 77/77.

## §next-actions (CEO)
- Approve prod deploy (classifier needs explicit "deploy")
- Decide P2-6 (part-approval queue) priority for Wave 2

## §lessons-this-run
- 💚 code-wiring audit (no live browser) still caught 3 cross-org leaks + 1 dead button — the highest-value bugs, all in the authenticated path curl can't reach
- 💚 surface-split verify agents (3 parallel) found non-overlapping bugs cleanly
- 💔 agents correctly flagged R4 but deferred it "to avoid scope creep" — security leaks should NOT be deferred · parent fixed it
- 🔧 next: when a verify agent finds a cross-org leak, instruct it to trace ALL callers of the leaky fn, not just the one in its surface
- 📊 ~320k tokens / 3 agents
