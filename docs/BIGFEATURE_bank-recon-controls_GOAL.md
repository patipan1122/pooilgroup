# BIGFEATURE — Bank-Recon Controls & Workspace · Goal Lock

> CEO decisions 2026-06-15. Companion to BIGFEATURE_bank-recon-controls_CONTEXT.md.

## Goal lock
- **Feature**: Bank-recon controls & workspace — bulk undo, searchable matched archive, approval-to-revert-confirmed, richer statement detail, richer pending detail + filters + diff, internal-transfer page, cross-account special-items hub.
- **Who uses**: super_admin (CEO, approver+direct-revert), admin/org_admin (accountants/office — request revert, do matching), area_manager/viewer (read). Staff at branches indirectly (their matches reviewed here).
- **Business goal**: ลดความผิดพลาดตอนกระทบยอด — กดผิดแล้วแก้กลับได้ปลอดภัย, มีของให้ตรวจครบ (ข้อมูลธนาคารละเอียด, รายได้/จ่ายอ่านรู้เรื่อง), และคุมว่าใครแก้ของที่ลงบัญชีแล้วได้บ้าง.
- **Success metric**: (1) ย้อนรายการที่กดผิดได้เองโดยไม่ต้องเรียก dev / แก้ DB มือ; (2) สีรุ้งใน CashHub เด้งกลับถูกต้องเมื่อย้อน; (3) ทุกการย้อน "ที่ยืนยันแล้ว" มีร่องรอย+คนอนุมัติ; (4) แมชยอดได้แม่นขึ้นเพราะเห็นรายละเอียดธนาคาร+IV ครบ.
- **Touches**: LedgerLine bank-recon (host) · CashHub (iridescent revert) · Pool core (roles/audit/notifications).
- **Mode**: Extend existing module + add 2 new pages. Full ship, all 7 at once.
- **Deadline**: ไม่ระบุ (build all, deploy as one gated step).

## CEO decisions (locked)
1. **Build mode** = Full ship (spec + build + deploy + verify). Deploy + migration-apply remain explicit CEO gates per lessons.
2. **Revert authority**:
   - Revert a **SUGGESTED** (รอยืนยัน, not yet confirmed) match → anyone with edit role does it directly, no approval (current removeGroupAction behaviour).
   - Revert a **CONFIRMED** (ยืนยันแล้ว / posted) match → **super_admin reverts directly AND is the approver**. **Anyone not super_admin must file an approval request** ("ขออนุมัติแก้"); super_admin approves → revert executes. Mirrors [[ledgerline-superadmin-only-connection-gating-2026-06-12]] + maker≠checker (ChairopsWriteOff).
3. **โยกเงิน** = internal transfer = pair 2 bank txns across DIFFERENT accounts (debit on A ↔ credit on B). Neither counts as revenue/expense. New match concept spanning accounts. Has history.
4. **Scope** = all 7 features, single build (not phased).

## Project consistency requirements
- **Must use**: ledger design tokens (app/globals.css --color-brand-*/success/danger/warning, --radius-card/modal, .tabular-num, --ring-focus), ledger _kit components, BankLogo. NO new ad-hoc tokens.
- **Must gate**: edit actions requireRole(super_admin, org_admin, admin); revert-confirmed = super_admin direct OR approved-request; respect role-rank (canManageUser). Respect period lock (batch.locked_at blocks edits — revert of locked period needs unlock first).
- **Must audit**: every revert / bulk-undo / transfer / approval-decision via audit({action,resourceType,resourceId,diff}) + new AuditAction enum values.
- **Must respect**:
  - [[ledgerline-superadmin-only-connection-gating-2026-06-12]] — sensitive ops super_admin.
  - [[cashhub-amazon-matched-iridescent-2026-06-15]] — iridescent reads live match_state; reverting state must flip it back (verify query).
  - [[ledgerline-trcloud-error-sentinel-shows-as-sent-2026-06-15]] — don't let a state flag misrepresent reality (apply same care to revert states).
  - [[audit-bank-recon-2026-06-12]] — the 12 P0s already fixed (dedup, false-green, IDOR, lock, write-back). Don't regress them.
  - RULE I — accountant/auditor domain lens required (money/GL).
  - RULE J — any new env namespaced (none expected here).
- **Must NOT**: bypass RLS / org_id; auto-run anything (manual triggers only); break period-lock invariant; double-count or hit P&L on internal transfers; let revert leave half-written GL/provisional.

## The 7 deliverables (locked)
1. **Bulk undo** ("นำออกทั้งหมด/ย้อนทั้งหมด") — bulk wrapper over removeGroupAction for SUGGESTED groups on the page; CONFIRMED groups in the batch route through approval. Confirm modal + count + scope (this account/period).
2. **Matched archive** — searchable list of confirmed (+reversed history) match groups, type-to-find, revert button (→ direct if super_admin, else file request). Shows what each group matched.
3. **Approval-to-revert** — new table ledger_recon_edit_request (PENDING→APPROVED/REJECTED), notify super_admin via bell, super_admin approve → executes revert (atomic + audit). maker≠checker.
4. **Statement detail (left)** — surface ref1/ref2/description/channel/balance + counterparty/raw-row detail (expander or richer row). No re-import (raw_row_json already stored).
5. **Pending detail (right)** — full human line per item from source (รายได้ {customer} {biz} {channel} {date} · IV doc_no · vendor). Enrich listMatchGroups join.
6. **Pending filters + diff** — reuse match-tab filter bar (search/today/type/biz/branch/channel/amount) on confirm tab + both-side totals + diff.
7. **โยกเงิน + special-items hub** — page to create internal transfers (pick 2 cross-account legs) with history; hub beside รอยืนยัน listing transfers + skipped-no-match (with reason) across ALL accounts.

## Build sequencing (proposed, migration-before-code)
- W1 Schema: ledger_recon_edit_request table + (transfer modelled as match_group with match_type='transfer' across accounts OR ledger_bank_match_item allowing cross-account — SA to decide) + AuditAction enum + indexes + RLS. Apply+verify in prod DB BEFORE code (flag-aware).
- W2 Backend actions: bulkUndo, archive query, requestRevert/approveRevert/rejectRevert, createTransfer/listTransfers, listSkipped, enriched listMatchGroups + listBankMovements.
- W3 UI: reconcile page (bulk-undo btn, statement detail, pending detail+filters+diff), archive view, approval inbox, transfer page, special-items hub.
- W4 Verify: tsc + lint + build green; CashHub iridescent-revert manual check; then CEO deploy gate.
