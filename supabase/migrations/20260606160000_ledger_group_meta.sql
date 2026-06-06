-- LedgerLine — store a snapshot of each bound LINE group's real name + member
-- count so the web back-office shows "ชื่อกลุ่มจริง · 5 คน" instead of an opaque
-- id tail ("กลุ่ม 0dae3553"). `label` already exists (we now populate it with the
-- LINE group name); this adds the member-count snapshot, refreshed whenever an
-- admin runs a /setting command in the group. Additive + idempotent.
ALTER TABLE public.ledger_line_group
  ADD COLUMN IF NOT EXISTS member_count integer;
