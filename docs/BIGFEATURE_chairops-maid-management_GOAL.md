# ChairOps Maid Management — Goal Lock

> Phase 2 of `/bigfeature` · 2026-06-05

## Goal Lock

- **Feature**: ChairOps Maid Management (ระบบจัดการแม่บ้าน)
- **Who uses**: ADMIN / MANAGER / OFFICE (admin side) · MAID (LINE LIFF)
- **Business goal**: ให้ admin จัดการแม่บ้านได้จากหน้าเดียว (เชิญ / ดูสถานะ / ไล่ออก) โดยไม่ต้องเปลี่ยนหน้า · และให้แม่บ้านกรอกข้อมูลตัวเองตอน onboard ครั้งแรก
- **Success metric**: 
  - Admin สามารถเชิญแม่บ้านใหม่ได้ภายใน 3 คลิก โดยเห็นว่าสาขาไหนว่างอยู่
  - แม่บ้านกรอกข้อมูล 5 ฟิลด์ครบก่อนใช้งาน /m/*
  - ไล่ออกแม่บ้านและ block LINE ได้ในขั้นตอนเดียว
- **Touches**: ChairOps module (users, maid LIFF, deactivate flow, LINE OA)
- **Mode**: extend existing
- **Deadline**: สิ้นสุด session นี้ (full ship mode)
- **Build mode**: Full ship — spec + build + deploy + verify

## Feature List (9 Must-have)

| # | Feature | Status |
|---|---|---|
| F1 | iOS LIFF fix (`?openExternalBrowser=1`) | PARTIAL — add to invite link |
| F2 | Vacancy badge per branch on /users | MISSING |
| F3 | Inline side panel (no page-change) | MISSING |
| F4 | Self-onboarding form (5 fields) + gate | MISSING |
| F5 | Auto-revoke old invite on new invite | MISSING |
| F6 | Settle gate before deactivate | MISSING |
| F7 | Deactivation reason dropdown + note | MISSING |
| F8 | LINE blockMember on deactivate | MISSING (pending LINE perm check) |
| F9 | Graceful deactivated screen | MISSING |
| S1 | Cover branch (secondaryBranchId) | Should-have if time |

## Project Consistency Requirements

- **Must use**: `.co-` CSS design tokens (ChairOps scope) · `.ch-scope` on admin layouts
- **Must gate**: 
  - User-management mutations: `requireRole(ADMIN)` + `canManageUser(actor, target)` always
  - MAID-only routes: `requireExactRole("MAID")`
- **Must audit**: every `$transaction` that mutates a user → `writeAudit(...)` inside tx
- **Must filter by orgId**: every Prisma query
- **Must NOT**: bypass RLS · auto-run LINE operations without reason · auto-block without explicit deactivate intent
- **Respect**: 
  - [[chairops-no-cumulative-shortage]] — deactivate blocked if ยอดค้างฝาก (F6)
  - [[role-rank-privilege-escalation-guard]] — always double-check rank before mutation
  - [[liff-magic-link-ios-webview-cookie-drop]] — iOS Safari is the only safe context
  - [[ceo-prefers-manual-ai-triggers]] — no auto-runs
  - [[chairops-maid-one-per-branch-collect-only]] — 1 active maid per branch max

## Schema Changes Required (before F4/F5/F6/F7/F8)

Migration `20260605_chairops_maid_management.sql`:
```sql
-- New enum
CREATE TYPE "chairops"."OffboardingReason" AS ENUM ('RESIGNED', 'TERMINATED', 'TRANSFERRED', 'OTHER');

-- New columns on ChairopsUser (all nullable for backward compat)
ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS invite_token         TEXT        UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_phone         TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact    TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone      TEXT,
  ADD COLUMN IF NOT EXISTS current_main_employer TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_complete  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deactivated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by_id    UUID,
  ADD COLUMN IF NOT EXISTS offboarding_reason   "chairops"."OffboardingReason",
  ADD COLUMN IF NOT EXISTS offboarding_note     TEXT,
  ADD COLUMN IF NOT EXISTS secondary_branch_id  UUID;
```

## Open Questions (F8 prerequisite)
1. LINE OA มี Messaging API + blockMember/unfollow permission หรือยัง? → ต้องตรวจก่อน F8
2. Self-onboarding form แสดงใน /m/profile (editable) ด้วยไหม? → ถามหลัง F4 build
