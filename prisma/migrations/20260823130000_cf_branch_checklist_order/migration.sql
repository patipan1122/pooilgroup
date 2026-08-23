-- ClawFleet · ลำดับการแสดงผลสาขาในตารางเช็คลิสต์ (สาขา × วัน) ที่ CEO จัดเรียงเอง
-- (CEO 2026-08-23 · แยกเป็นตารางใหม่แทนการ ADD COLUMN บน Branch เพราะ Branch เป็น
--  ตารางที่ใช้ร่วมกับอีก 8 โปรแกรม — เหตุผลเดียวกับ 20260823120000_cf_branch_reconcile_config.
--  ไม่ reuse ตารางนั้นเพราะ company_id/bank_account_id เป็น NOT NULL — สาขาที่ยังไม่ผูก
--  บัญชีธนาคารจะจัดลำดับเช็คลิสต์ไม่ได้ถ้าใช้ตารางร่วมกัน).
-- 1 แถวต่อสาขา (branch_id unique) · ADDITIVE · สาขาที่ไม่มีแถว = ใช้ค่าเริ่มต้นเรียง ก-ฮ.
CREATE TABLE IF NOT EXISTS public.cf_branch_checklist_order (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_branch_checklist_order_org_idx
  ON public.cf_branch_checklist_order (org_id);
