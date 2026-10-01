-- Playland: ทะเบียนเครื่องพิมพ์ฉลาก/สายรัด (NIIMBOT K2) + คิวงานพิมพ์
-- เว็บแอป (เบราว์เซอร์แคชเชียร์) วาดสายรัดเป็นบิตแมป → ใส่คิว → playland-agent หน้าร้านดึงไปสั่งเครื่องพิมพ์ผ่าน USB
-- ตารางใหม่ล้วน ไม่แตะตารางเดิม · ไม่ใช้ playland.devices เพราะโค้ดเดิมถือว่าทุก device ที่ไม่ใช่ "mock" คือประตู
-- (ใส่ใน face-sync queue) ถ้าเอาเครื่องพิมพ์ไปใส่จะโดนส่งข้อมูลใบหน้าไปให้

CREATE TYPE playland."PlaylandPrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'DONE', 'FAILED');

CREATE TABLE playland.printers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL REFERENCES playland.branches(id) ON DELETE CASCADE,
  code         text NOT NULL UNIQUE,                       -- agent ใช้ระบุตัวเอง เช่น K2-TEST-01
  name         text NOT NULL,
  model        text NOT NULL DEFAULT 'niimbot-k2',
  secret_hash  text NOT NULL,                              -- sha256(hex) ของรหัสลับที่ agent ส่งมา · ไม่เก็บรหัสจริง
  enabled      boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,                                -- agent ถามคิวทุกครั้ง = หัวใจ "ออนไลน์"
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX printers_org_branch_idx ON playland.printers (org_id, branch_id);

CREATE TABLE playland.print_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  branch_id          uuid NOT NULL REFERENCES playland.branches(id) ON DELETE CASCADE,
  printer_id         uuid NOT NULL REFERENCES playland.printers(id) ON DELETE CASCADE,
  kind               text NOT NULL DEFAULT 'WRISTBAND',
  status             playland."PlaylandPrintJobStatus" NOT NULL DEFAULT 'PENDING',
  bitmap_base64      text NOT NULL,                        -- 1648 แถว x 25 ไบต์ (1 บิต/จุด · 1 = จุดดำ) = 41,200 ไบต์
  meta               jsonb,                                -- {wristbandCode, memberId, name} ไว้ตรวจย้อนหลัง
  attempts           integer NOT NULL DEFAULT 0,
  last_attempt_at    timestamptz,
  printed_at         timestamptz,
  error_message      text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX print_jobs_queue_idx ON playland.print_jobs (printer_id, status, created_at);
CREATE INDEX print_jobs_org_idx ON playland.print_jobs (org_id, created_at DESC);

ALTER TABLE playland.printers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playland_printers_isolation" ON playland.printers;
CREATE POLICY "playland_printers_isolation" ON playland.printers FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "playland_print_jobs_isolation" ON playland.print_jobs;
CREATE POLICY "playland_print_jobs_isolation" ON playland.print_jobs FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
