# BIGFEATURE — Bank-Recon Controls & Workspace · Consolidated SPEC

> Phase 4 synthesis. Base = `origin/setup` (worktree /private/tmp/recon-setup, branch `bigfeature/bank-recon-controls`).
> Synthesizes: SA architecture, Thai-CPA/Auditor (C1–C7), Devil's Advocate (cuts + races + branch blocker), verified against real setup code.

## Verified facts (origin/setup)
- Iridescent reads LIVE `ledger_revenue_entry.match_state` (lib/cashhub/amazon-data.ts:256-289). Revert→match_state='unmatched' auto-reverts colour. (Verify amazon page is dynamic, not cached.)
- confirmGroupsInternal (_actions.ts:1115) sets revenue match_state='matched' only (1141-1144). removeGroupAction (1176) reverts revenue only (1196-1198) + DELETE match_items (1199). Both guard locked_at.
- "matched" for expense/payment = existence of active match_item (listBookEntries excludes those in match_item). So revenue-only state mgmt is consistent — NOT a live bug.
- Bank-recon writes ZERO audit logs (confirmed). Add audit on all mutations.
- Old 1:1 model still present (confirmMatchAction/createManualMatchAction/unconfirmMatchAction/rejectMatchAction + excludeTxnAction writes ledger_bank_match match_type='exclusion'). Board uses group model. Hub must UNION both.

## Scope (CEO: all 7, full ship)
P0 (highest value, lowest risk — read-enrichment + safe controls):
1. Statement detail (left) — show ref2/counterparty, channel, balance, value_date; lazy raw-row expander.
2. Pending detail (right) — full human line per item from source joins.
3. Pending filters + diff — shared filter bar on confirm tab + both-side totals + diff.
4. Bulk undo — suggested→direct; confirmed→super_admin direct / non-super routes to approval; per-group tx; lock-skip.
Controls:
5. Matched archive — searchable tab (confirmed live + reversed via snapshot) with revert button.
6. Approval-to-revert — ledger_recon_edit_request, maker≠checker, super_admin approves, notify via bell.
Largest/riskiest:
7. โยกเงิน internal transfer (cross-account pair) + special-items hub (transfers + skipped) across all accounts.

## Migration (one file, migration-before-code, apply+verify in prod = CEO gate)
`supabase/migrations/2026061600XXXX_ledger_recon_controls.sql`:
```sql
-- transfer support
ALTER TABLE ledger_bank_match_group ALTER COLUMN bank_account_id DROP NOT NULL;
ALTER TABLE ledger_bank_match_group ADD COLUMN IF NOT EXISTS match_type varchar(20) NOT NULL DEFAULT 'standard';
ALTER TABLE ledger_bank_match_group ADD CONSTRAINT chk_group_match_type CHECK (match_type IN ('standard','transfer'));
ALTER TABLE ledger_bank_match_group ADD CONSTRAINT chk_transfer_acct
  CHECK ((match_type='transfer' AND bank_account_id IS NULL) OR (match_type='standard' AND bank_account_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS ledger_bank_match_group_transfer_idx
  ON ledger_bank_match_group (org_id, company_id, status) WHERE match_type='transfer';
-- archive snapshot (avoids index surgery + EXISTS-check blast radius)
ALTER TABLE ledger_bank_match_group ADD COLUMN IF NOT EXISTS reversed_snapshot jsonb;
-- approval-to-revert
CREATE TABLE IF NOT EXISTS ledger_recon_edit_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, company_id uuid NOT NULL,
  target_group_id uuid NOT NULL REFERENCES ledger_bank_match_group(id) ON DELETE CASCADE,
  action varchar(20) NOT NULL DEFAULT 'revert' CHECK (action IN ('revert')),
  reason text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  snapshot_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ledger_recon_edit_request_org_status_idx ON ledger_recon_edit_request (org_id, company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_recon_edit_request_one_pending_uniq ON ledger_recon_edit_request (target_group_id) WHERE status='PENDING';
ALTER TABLE ledger_recon_edit_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_recon_edit_request_org ON ledger_recon_edit_request
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
```
Verify: existing groups all match_type='standard' (default) + bank_account_id NOT NULL → chk_transfer_acct passes.

## Backend (W2) — app/(admin)/ledger/bank-recon/_actions.ts + lib/ledger/bank-reconcile-board.ts
- **revertGroupOps(orgId, groupId, userId, reason)** [refactor] — shared revert: (a) snapshot group items+totals into reversed_snapshot, (b) UPDATE bank txns match_state='unmatched' WHERE ...AND batch not locked (in-tx re-assert), (c) revenue match_state='unmatched'+bank_txn_id=NULL, (d) DELETE match_items, (e) group status='reversed'+reversed_by/at/reason. Used by direct/approval/bulk. Lock re-check INSIDE tx (Devil §3.2). TOCTOU guard: status-guarded UPDATEs + check rowcount.
- **bulkUndoAction({bankAccountId, periodStart, periodEnd, scope})** — partition groups by status+lock; suggested→revert per-group-tx; confirmed→ isSuper revert else insert PENDING request (skip dup via unique idx); return counts {revertedSuggested, revertedConfirmed, requestedForApproval, skippedLocked}.
- **requestRevertAction(groupId, reason)** — requireRole(super,org_admin,admin); group confirmed+unlocked; insert PENDING (unique); audit+notify super_admins.
- **approveRevertAction(requestId)** — requireRole(super_admin); reject if requested_by==self (maker≠checker, mirror write-offs:66); TOCTOU updateMany WHERE status='PENDING' check count; re-check lock at execute; ONE tx = revertGroupOps + request→APPROVED; audit+notify requester.
- **rejectRevertAction(requestId, note)** — super_admin; status→REJECTED; notify.
- **createTransferAction({txnIdA, txnIdB, note})** — both org-scoped, unmatched, NOT locked (both legs), DIFFERENT bank_account_id, sign-opposite, |amount| equal (delta 0); insert group match_type='transfer' bank_account_id=NULL totals 0, two bank items, txns→suggested; audit. (Confirm via existing confirmGroup — zero book items = no P&L.)
- **listTransfersAction()** / **listSpecialItemsAction()** — cross-account (org+company, no account filter): transfers from group model + exclusions from ledger_bank_match (match_type='exclusion') with reason/who/when/account.
- **listMatchedArchiveAction({search,...})** — confirmed groups (live items) + reversed groups (reversed_snapshot), searchable.
- **getBankTxnRawAction(txnId)** — org-scoped, returns whitelisted raw_row_json subset (PDPA: lazy, per-row).
- **unExcludeAction(matchId)** — revert old-table exclusion (status='reversed', txn match_state='unmatched'), lock+role guard.
- Enrich **listBankMovements** (+ref2 counterparty, channel, balanceSatang, valueDate). Enrich **listMatchGroups** items (LEFT JOIN revenue/expense/payment → customerName, sourceType, paymentChannel, docNo, vendor, detail, bizDate).
- Audit: add AuditAction values LEDGER_RECON_BULK_UNDO/REVERT_CONFIRMED/REVERT_REQUESTED/REVERT_APPROVED/REVERT_REJECTED/TRANSFER_CREATED/TRANSFER_REVERSED/PERIOD_REOPENED(exists). Write best-effort post-commit (ledger convention) OR in-tx if Prisma AuditLog model exists (prefer in-tx).

## UI (W3) — reuse ledger tokens/_kit/BankLogo, mobile-first, sticky thead top-14 sm:top-16 z-20
- ReconcileBoard.tsx: add bulk-undo button (confirm modal w/ counts+scope) on match tab; statement-detail expander (left rows); enrich GroupSide labels (right); lift filter bar → shared component used by match AND confirm tabs; confirm-tab totals+diff bar.
- New tab/route "คลัง" (archive): search + list confirmed/reversed groups + revert button (super→direct, else "ขออนุมัติแก้" → request).
- New "ขออนุมัติ" inbox (super_admin): pending requests, approve/reject w/ note. Bell notifications link here.
- New "โยกเงิน" page: pick 2 cross-account legs → create transfer; history list.
- "รายการพิเศษ" hub beside รอยืนยัน: cross-account transfers + skipped(reason). Per-account & all-accounts views.

## Consistency checklist
- [x] ledger tokens/_kit/BankLogo, no new ad-hoc tokens
- [x] requireRole gating; revert-confirmed = super direct / approval; maker≠checker
- [x] audit every destructive op
- [x] respect period lock (no bypass; unlock = super_admin + PERIOD_REOPENED audit)
- [x] no P&L on transfers (zero book items); transfer invariants C6
- [x] iridescent auto-reverts (live match_state) — verify amazon page dynamic
- [x] org_id/RLS self-scoped
- [x] migration-before-code; per-group tx (not mega-tx)
- [x] build in worktree off origin/setup (NOT claude/ledger-redesign -139)

## Risks (ranked)
1. Touching shared spine (listMatchGroups/listBankMovements) on live money module → keep LEFT JOINs (never INNER), additive only, tsc+build+manual verify. (Devil)
2. Iridescent depends on amazon page being dynamic (not cached) → verify in W4.
3. Cross-account/cross-period lock for transfers → check both legs' lock in one query, atomic create/revert. (CPA C6)
4. Double-approve/double-revert race → TOCTOU guards. (CPA C5)
5. Archive history via snapshot — ensure snapshot captured BEFORE item DELETE.

## Acceptance criteria (per role)
- super_admin: bulk-undo; revert any confirmed directly w/ reason; approve/reject requests; create transfers; see hub all-accounts.
- admin/accountant: match/confirm as today; bulk-undo suggested; "ขออนุมัติแก้" for confirmed → goes to super; richer detail+filters+diff.
- viewer/area_manager: read archive/hub/detail.
- Cross-cut: revert a confirmed Amazon match → CashHub Amazon cell rainbow disappears on reload.

## Deploy gates (CEO)
G1: apply migration to prod DB + verify. G2: push HEAD:setup (deploy) after tsc+lint+build green + iridescent-revert manual check.
