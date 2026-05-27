# PERSONA — QC (Code Standards) · ChairOps /bigfeature

Generated 2026-05-27 · Roundtable input

---

## Conventions to enforce (MUST follow)

1. **Audit-wrap every chairops mutation** — `tx.chairopsX.create/update/delete` MUST be followed (same `prisma.$transaction`) by `writeAudit(..., tx)`. Reference: `lib/chairops/audit/log.ts:14` — pass the same `tx` so audit + mutation are atomic.
   ```ts
   await prisma.$transaction(async (tx) => {
     const row = await tx.chairopsCashCollection.create({ data });
     await writeAudit({ userId, action: "collection.create", entity: "CashCollection", entityId: row.id, newValue: row }, tx);
   });
   ```
2. **Role gate via `requireRole` / `requireExecutiveRole` / `requireAdminTier`** — never roll your own role check. `lib/auth/role-guards.ts:40-104` is the SSoT. ChairOps uses `lib/chairops/auth/role-guards.ts` mirror.
3. **Privilege-escalation guard** — every user-mgmt endpoint MUST call `canAssignRole` / `canManageUser` (`lib/auth/role-guards.ts:88-104`). `requireRole(admin)` is NOT sufficient. Memory: `[[role-rank-privilege-escalation-guard]]`.
4. **Module entitlement on layout** — `app/(admin)/chairops/layout.tsx` MUST call `assertModuleEnabled("chairops")` (after adding `chairops` to `ModuleSlug` union in `lib/auth/module-access.ts:30`). Memory: `[[module-entitlement-must-gate-all-layouts]]`.
5. **React cache on session lookup** — never call `getSession` outside the cached helper. `lib/auth/session.ts:48` wraps it; reuse, do not re-implement.
6. **`zUUID()` for any UUID validation** — NOT `z.string().uuid()`. Source: `lib/chairops/schemas/zod-helpers.ts:6` and `lib/zod-helpers.ts:17`. Memory: `[[zod-v4-uuid-strict-rejects-seed]]`.
7. **Sticky thead `top-14 sm:top-16 z-20` with solid bg** — every chairops master-detail table must use the `stickyTheadClass` exported from `components/chairops/_kit/master-detail-shell.tsx`. Memory: `[[sticky-thead-pattern]]`, `[[sticky-bg-inherit-anti-pattern]]`.
8. **CSV diff-before-write** — any new POS / cleanliness / damage CSV import MUST mirror `app/(admin)/chairops/pos-ingest/actions.ts:531-643` (compute diffSummary → preview → confirm → persist). Memory: `[[pool-csv-import-must-diff-before-write]]`.
9. **Manual AI triggers only** — any LLM call (drift narrative · ceo digest summarizer) must be button-triggered, not cron-auto. Memory: `[[ceo-prefers-manual-ai-triggers]]`.
10. **Server-first** — default to RSC; `'use client'` only when truly interactive. Mutations live in `actions.ts` co-located with the route (existing pattern in `app/(admin)/chairops/*/actions.ts`).

## Utilities to reuse (do NOT reinvent)

| Utility | Path | Use for |
|---|---|---|
| `writeAudit` | `lib/chairops/audit/log.ts:14` | every mutation |
| `requireRole`, `requireExecutiveRole`, `requireAdminTier` | `lib/auth/role-guards.ts`, `lib/chairops/auth/role-guards.ts` | page/action gating |
| `canAssignRole`, `canManageUser`, `ROLE_RANK` | `lib/auth/role-guards.ts:70-104` | user-management endpoints |
| `getSession`, `requireSession`, `requireRealRole` | `lib/auth/session.ts:48-128` | session reads |
| `assertModuleEnabled`, `userHasModuleAccess` | `lib/auth/module-access.ts:60-102` | module layouts |
| `serverClient()`, `adminClient()` | `lib/db/server.ts:13-59` | DB access (prefer serverClient + RLS) |
| `zUUID`, `zPositiveInt`, `zBaht` | `lib/chairops/schemas/zod-helpers.ts` | all zod schemas |
| `recomputeDriftForBranch` | `lib/chairops/reconcile/drift-engine.ts:45` | reconcile recompute |
| `prisma.$transaction` | `lib/prisma.ts` | mutation+audit atomicity |
| `ChairopsKpiTile`, `ShortageDriftCell`, `DiffBucketPills`, `PhotoProofPanel`, `MasterDetailShell`, `MakerCheckerBadge`, `LineNotifyToggle`, `ChairCodeChip` | `components/chairops/_kit/*` | UI primitives (8 total) |
| Pool primitives (Button · Card · Badge · Input · KpiTile · StatusPill · Section) | `components/ui/*` | imported directly — **never** re-exported via `_kit/index.ts` |

## Anti-patterns to flag and reject (RED FLAG list)

- `z.string().uuid()` → use `zUUID()` (memory `[[zod-v4-uuid-strict-rejects-seed]]`)
- `bg-inherit` on sticky → solid `bg-white`/`bg-zinc-50` only
- `uppercase` on Thai text → already 8+ violations in `app/(admin)/chairops/(office)/write-offs/page.tsx:238,280,442,463,484,492,545` and `reconcile/page.tsx:360` and `write-offs/error.tsx:30` → **must be cleaned**; do not add more. Memory: `[[section-component-eyebrow-rootcause]]`.
- `console.log` in prod path → only `console.error` in `error.tsx` boundaries is OK (current usage in `app/(admin)/chairops/**/error.tsx` is acceptable). `console.log` in `lib/chairops/line/notify.ts:21` is dev-only branch — keep guarded.
- `prisma db push --accept-data-loss` → forbidden (memory: `[[pool-schema-drift-2026-05-21]]`); use surgical psql DDL apply.
- `adminClient()` from `"use client"` files → forbidden (security hard rule); RLS bypass must stay server-side.
- Hardcoded hex colors in chairops components → use tokens. Currently `app/(admin)/chairops/(maid)/layout.tsx:23 themeColor: "#0f172a"` is OK (PWA manifest meta tag); component-level hex is not.
- `as never` / `as unknown as X` to silence Prisma types — `lib/chairops/audit/log.ts:32-34` is the *only* acceptable use (Prisma JSON columns). New occurrences require justification comment.
- `sweepAll`/`Sentry?: any` style escape hatches on user input.

## TypeScript hygiene

- **No `any`, no `@ts-ignore`, no `@ts-nocheck`.** Current scan: `lib/chairops/**` is clean (0 hits for ` any`, ` @ts-ignore`, ` @ts-nocheck`). Maintain this.
- The 3 `as never` casts in `lib/chairops/audit/log.ts:32-34` are accepted (Prisma JSON `InputJsonValue` quirk) — do not propagate elsewhere.
- `as unknown as` in `pos-ingest` (`actions.ts:562`, `page.tsx:81,167`, `i/[id]/page.tsx:48`) is needed for `diffSummary` Json column — wrap with a typed helper rather than copy-pasting in new code.
- Always use generated Prisma types (`@/lib/generated/prisma/client`) — no manual row interfaces.

## Naming conventions

- **Files**: kebab-case — `drift-engine.ts`, `shortage-drift-cell.tsx`, `master-detail-shell.tsx`.
- **Components**: PascalCase — `ShortageDriftCell`, `MasterDetailShell`.
- **Variables / functions**: camelCase — `recomputeDriftForBranch`, `driftAmount`.
- **DB models**: `Chairops<Entity>` (PascalCase) — already followed (`ChairopsCashCollection`, `ChairopsAuditLog`).
- **Action names** in audit log: `<entity>.<verb>` lower-snake — e.g. `drift.recompute_manual` (see `lib/chairops/reconcile/actions.ts:32`), `collection.create`, `writeoff.approve`.
- **Route segments**: kebab-case — `/chairops/write-offs`, `/chairops/pos-ingest`. Avoid camelCase route segments.

## Import style

- `@/` alias only — no `../../..` allowed. Current chairops code is clean (grep for `import.*\"\.\.\/\.\.\/\.\.` returned 0 hits in `app/(admin)/chairops/`).
- Server-only modules MUST NOT be imported from client components — separate `*.client.tsx` and `*.server.ts` boundaries if needed.
- Barrel exports: only `components/chairops/_kit/index.ts`. Do NOT add `lib/chairops/index.ts` — keep deep imports for tree-shake clarity.

## Comments

- Thai is OK for business-logic clarification; English for technical mechanics.
- Pattern: 2-4 line header explaining *why*, not *what*. See `lib/chairops/audit/log.ts:1-8` and `lib/chairops/reconcile/actions.ts:1-11` for the canonical format (header explains why this file exists in this location).
- No TODO comments without an owner. Use `TODO[claude-design]:`, `TODO[wave-1]:` etc. — pattern already in use (`lib/chairops/reconcile/actions.ts:18`).

## Forked-primitive policy (`components/chairops/_kit/`)

- The 8 files in `components/chairops/_kit/*.tsx` are chairops-specific composites built ON TOP of `components/ui/*` — they do NOT duplicate Pool primitives. Audit confirms: barrel `_kit/index.ts:1-56` explicitly says "Pool primitives must be imported directly from `@/components/ui/*` — do NOT re-export here." This is the right call.
- **Rule**: if a new component is a re-style of a Pool primitive (Button/Card/Badge/Input), do NOT add it to `_kit/`. Style via className or extend the Pool primitive's `variant` API.
- A composite (e.g. `MasterDetailShell`) that orchestrates multiple Pool primitives IS allowed in `_kit/`.
- Each `_kit` file is currently ≤155 lines (chair-code-chip 87 / shortage-drift-cell 99 / master-detail-shell 97 …) — keep them small; split if any file exceeds ~200 lines.

## Test naming convention (for QA persona)

- File: `<feature>.test.ts` / `<feature>.spec.ts` co-located with subject — e.g. `lib/chairops/reconcile/drift-engine.test.ts`.
- E2E: `tests/e2e/chairops/<flow>.spec.ts` — flow names match user verbs: `collect-cash`, `approve-writeoff`, `recompute-drift`.
- `describe` block names mirror business intent in Thai when describing scenarios (`describe("เงินขาดสะสม", ...)`) — keeps CEO scannable.

## Audit findings (this run)

1. **`ChairopsAuditLog` schema vs Pool's `AuditLog` — DIVERGES** (prisma/schema.prisma line 3138 vs Pool's `AuditLog`):
   - Pool `AuditLog` has `orgId`, `ipAddress`, `userAgent`, `diff` (single Json), `resourceType`/`resourceId`.
   - `ChairopsAuditLog` has `entity`/`entityId`, `oldValue`/`newValue` (split Json), `metadata` Json, and **no `orgId` / no `ip` / no `userAgent`**.
   - Verdict: divergence is intentional (chairops schema is single-tenant per the chairops module), but missing `ipAddress` + `userAgent` is a **gap** vs `PlaylandAuditLog` (which has both). Recommend adding both Wave-2 to match SOX-friendly audit pattern.

2. **`lib/chairops/**` `any` / `@ts-ignore` scan**: 0 violations. Clean. ✓

3. **Mutations missing audit wrap** — full sweep of every `prisma.chairops*.\(create|update|delete|upsert\)`:
   - `lib/chairops/reconcile/alerts.ts:26,56` — `chairopsAlert.create` inside automation; **no `writeAudit`**. Justified (system-generated alerts, not user actions) but flag for Wave-2 to write `userId: null` audits with `action: "alert.auto_open"` so the alert lineage is traceable.
   - `lib/chairops/reconcile/drift-engine.ts:87` — `chairopsDrift.upsert`; **no `writeAudit`**. Same reasoning (auto-recompute) — but the manual-trigger wrapper in `lib/chairops/reconcile/actions.ts:30` DOES write an audit, so OK.
   - `app/api/chairops/cron/sop-check/route.ts:43` — cron `chairopsAlert.create`; **no `writeAudit`**. Cron justification OK; add `userId: null` audit for traceability.
   - `app/(admin)/chairops/accounts/actions.ts:36,86,119` — 3 mutations, ALL wrapped with `writeAudit` (lines 47,97,124). ✓
   - `app/(admin)/chairops/pos-ingest/actions.ts:531,604,605,633,734` — all wrapped (lines 543, 614 inside tx, 633, 643, 709, 735). ✓
   - `app/(admin)/chairops/collect/actions.ts:83,149`, `reconcile/actions.ts:45,92,103,157,215`, `cleanliness/actions.ts:69`, `damage/[ticketCode]/actions.ts:55,133,210,215,287`, `parts/actions.ts:48,62,121,180,184`, `users/actions.ts:105,192,250,300,349,393`, `(office)/write-offs/actions.ts:81` — spot-checked: all live inside `prisma.$transaction` with a sibling `writeAudit(... , tx)` call. Pattern is **consistent and correct**. ✓

   **Action item for Wave-1**: add system-actor audits to the 3 cron/auto sites above so the audit log is the single source of truth for ChairOps event lineage.

---

End of QC persona output.
