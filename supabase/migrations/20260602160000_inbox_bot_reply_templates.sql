-- Inbox bot: make the canned customer replies editable from /inbox/bot.
--
-- The 5 chairops flow replies + the non-text acknowledgement used to be
-- hardcoded in lib/inbox/bot/templates.ts, so training never changed what
-- customers actually received. This adds a reply_templates JSONB column that
-- holds per-flow overrides (keys: money_lost, scan_fail, strong, buy,
-- feedback, feedback_complaint, non_text_ack; value uses the {phone}
-- placeholder). Empty/absent key => the code default is used.
--
-- Also corrects the chairops fallback text that promised a call-back the team
-- does not do ("ติดต่อกลับ") and fixed the doubled-น phone typo (CEO 2026-06-02).
--
-- Pure additive + a guarded one-time wording fix. Safe to re-run.

ALTER TABLE public.inbox_bot_settings
  ADD COLUMN IF NOT EXISTS reply_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.inbox_bot_settings
SET fallback_text = 'ขออภัยค่ะ เดี๋ยวทีมงานช่วยดูแลให้นะคะ สอบถามเพิ่มเติมโทรได้ที่ 084-198-1623 ค่ะ'
WHERE business_tag = 'chairops'
  AND fallback_text LIKE '%ติดต่อกลับ%';
