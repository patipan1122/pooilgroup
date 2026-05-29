"use client";

// Bot settings form — overall behaviour of the chatbot for this business.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveBotSettings } from "@/lib/inbox/bot/knowledge-actions";
import { Save, Phone } from "lucide-react";

export interface BotSettings {
  botEnabled: boolean;
  tone: string;
  botName: string;
  contactPhone: string;
  fallbackText: string;
  escalateText: string;
  dailySummary: boolean;
}

const inputCls =
  "w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm";
const areaCls =
  "w-full px-3 py-2 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm leading-relaxed resize-y";

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[var(--color-brand-600)]" : "bg-zinc-300"
      }`}
    >
      <span
        className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function BotSettingsForm({
  businessTag,
  initialSettings,
}: {
  businessTag: string;
  initialSettings: BotSettings;
}) {
  const [s, setS] = useState(initialSettings);
  const [pending, start] = useTransition();

  function set<K extends keyof BotSettings>(key: K, value: BotSettings[K]) {
    setS((cur) => ({ ...cur, [key]: value }));
  }

  function save() {
    start(async () => {
      try {
        await saveBotSettings({
          businessTag,
          botEnabled: s.botEnabled,
          tone: s.tone,
          botName: s.botName || undefined,
          contactPhone: s.contactPhone || undefined,
          fallbackText: s.fallbackText,
          escalateText: s.escalateText || undefined,
          dailySummary: s.dailySummary,
        });
        toast.success("บันทึกการตั้งค่าบอทแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Master switch */}
      <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-zinc-900">เปิดบอทตอบอัตโนมัติ</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            ปิดสวิตช์นี้ = บอทหยุดตอบทุกช่องทาง · ลูกค้าจะรอทีมงานตอบเองทั้งหมด
          </p>
        </div>
        <Toggle checked={s.botEnabled} onChange={(v) => set("botEnabled", v)} disabled={pending} />
      </div>

      {/* Daily summary */}
      <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-zinc-900">สรุปรายวัน</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            ส่งสรุปแชทประจำวัน (จำนวนคำถาม · เรื่องที่ลูกค้าถามบ่อย) ให้ทีมงาน
          </p>
        </div>
        <Toggle
          checked={s.dailySummary}
          onChange={(v) => set("dailySummary", v)}
          disabled={pending}
        />
      </div>

      {/* Text fields */}
      <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 space-y-4">
        <label className="block">
          <span className="text-xs font-bold text-zinc-700 mb-1.5 block">ชื่อบอท (ไม่บังคับ)</span>
          <input
            type="text"
            value={s.botName}
            onChange={(e) => set("botName", e.target.value)}
            placeholder="เช่น น้องนวด"
            className={inputCls}
          />
          <span className="text-[10px] text-zinc-500 mt-1 block">
            ชื่อที่บอทใช้แนะนำตัวกับลูกค้า · ว่างไว้ได้
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-bold text-zinc-700 mb-1.5 block">น้ำเสียงการตอบ</span>
          <input
            type="text"
            value={s.tone}
            onChange={(e) => set("tone", e.target.value)}
            placeholder="เช่น สุภาพ สั้น เป็นกันเอง"
            className={inputCls}
          />
          <span className="text-[10px] text-zinc-500 mt-1 block">
            บอกบุคลิกที่อยากให้บอทตอบ เช่น &ldquo;สุภาพ เป็นกันเอง ลงท้ายด้วยค่ะ&rdquo;
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
            เบอร์ติดต่อ
          </span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <Phone className="size-4" />
            </span>
            <input
              type="tel"
              value={s.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
              placeholder="เช่น 02-123-4567"
              className={`${inputCls} pl-9`}
            />
          </div>
          <span className="text-[10px] text-amber-700 mt-1 block">
            สำคัญ: บอทจะส่งเบอร์นี้ให้ลูกค้าเมื่อเกิดปัญหาเรื่องสแกนไม่ได้ / เงินหาย — กรอกให้ถูกต้อง
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
            ข้อความเมื่อบอทตอบไม่ได้ (fallback)
          </span>
          <textarea
            value={s.fallbackText}
            onChange={(e) => set("fallbackText", e.target.value)}
            placeholder="เช่น ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ"
            rows={2}
            className={areaCls}
          />
          <span className="text-[10px] text-zinc-500 mt-1 block">
            ข้อความที่บอทตอบเมื่อไม่รู้คำตอบ · จะถูกบันทึกไว้ในแท็บ &ldquo;ตอบไม่ได้&rdquo; ให้สอนเพิ่ม
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
            ข้อความส่งต่อทีมงาน (escalate · ไม่บังคับ)
          </span>
          <textarea
            value={s.escalateText}
            onChange={(e) => set("escalateText", e.target.value)}
            placeholder="เช่น กำลังโอนสายให้เจ้าหน้าที่ดูแลเรื่องนี้ค่ะ"
            rows={2}
            className={areaCls}
          />
          <span className="text-[10px] text-zinc-500 mt-1 block">
            ข้อความเมื่อบอทตัดสินใจส่งต่อให้คนตอบ (เช่น ลูกค้าโกรธ / เรื่องเงิน) · ว่างไว้ได้
          </span>
        </label>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[var(--color-brand-600)] px-5 h-11 rounded-xl hover:bg-[var(--color-brand-700)] disabled:opacity-40"
        >
          <Save className="size-4" />
          {pending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
        </button>
      </div>
    </div>
  );
}
