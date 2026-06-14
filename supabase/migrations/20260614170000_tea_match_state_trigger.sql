-- CashHub ร้านชา — แก้ race: match_state เคยถูกคำนวณฝั่ง JS แล้วเขียนทับกัน
-- (pull IV กับ import POS พร้อมกัน → อ่านอีกฝั่งเป็น stale → verdict ผิด).
-- ย้ายให้ DB เป็นเจ้าของ: trigger คำนวณ match_state จาก iv_gross/pos_gross "หลัง merge" เสมอ
-- (BEFORE UPDATE: NEW มีค่า merge แล้ว · ส่งจาก payload มาก็โดน override ให้ถูก). idempotent.

CREATE OR REPLACE FUNCTION public.tea_set_match_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.match_state := CASE
    WHEN NEW.iv_gross IS NULL THEN 'no_iv'        -- ยังไม่มี IV (หรือไม่มีทั้งคู่)
    WHEN NEW.pos_gross IS NULL THEN 'no_pos'      -- มี IV แต่ยังไม่มี POS
    WHEN abs(NEW.iv_gross - NEW.pos_gross) < 1 THEN 'match'
    ELSE 'mismatch'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tea_match_state_trg ON public.cashhub_tea_daily;
CREATE TRIGGER tea_match_state_trg
  BEFORE INSERT OR UPDATE ON public.cashhub_tea_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.tea_set_match_state();

-- backfill ให้แถวเดิมถูกต้องตามสูตรเดียวกัน
UPDATE public.cashhub_tea_daily SET match_state = match_state;
