"use client";

// Unanswered queue — questions the bot couldn't answer. Each row can be turned
// into a new FAQ ("สอนบอท") which resolves it in one step, or just dismissed.

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { resolveUnanswered } from "@/lib/inbox/bot/knowledge-actions";
import { GraduationCap, Check, X, HelpCircle } from "lucide-react";

export interface Unanswered {
  id: string;
  question: string;
  createdAt: string;
}

const inputCls =
  "w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm";
const areaCls =
  "w-full px-3 py-2 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm leading-relaxed resize-y";

export function UnansweredQueue({
  businessTag: _businessTag,
  initialUnanswered,
  onCountChange,
}: {
  businessTag: string;
  initialUnanswered: Unanswered[];
  onCountChange?: (n: number) => void;
}) {
  const [items, setItems] = useState(initialUnanswered);
  const [teachingId, setTeachingId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState("");
  const [answer, setAnswer] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  function startTeaching(u: Unanswered) {
    setTeachingId(u.id);
    // Pre-fill keywords with the question so the CEO can trim it down.
    setKeywords(u.question.slice(0, 80));
    setAnswer("");
  }

  function teach(u: Unanswered) {
    if (!keywords.trim() || !answer.trim()) {
      toast.error("กรอกคำค้นและคำตอบ");
      return;
    }
    start(async () => {
      try {
        await resolveUnanswered(u.id, { keywords, answer });
        setItems((cur) => cur.filter((x) => x.id !== u.id));
        toast.success("สอนบอทแล้ว · เพิ่มเข้าคลังคำตอบเรียบร้อย");
        setTeachingId(null);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function dismiss(u: Unanswered) {
    start(async () => {
      try {
        await resolveUnanswered(u.id);
        setItems((cur) => cur.filter((x) => x.id !== u.id));
        toast.success("ปิดรายการแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 flex items-start gap-3">
        <HelpCircle className="size-5 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-700 leading-relaxed">
          คำถามที่บอทตอบไม่ได้จะมารวมที่นี่ · กด &ldquo;สอนบอท&rdquo; เพื่อตั้งคำค้น + คำตอบ
          แล้วบอทจะตอบคำถามแบบนี้ได้เองในครั้งต่อไป
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500">
          <p className="font-bold text-zinc-900 mb-1">ไม่มีคำถามค้างอยู่</p>
          <p>เยี่ยม! บอทตอบคำถามลูกค้าได้ครบทุกข้อ</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((u) => (
            <div
              key={u.id}
              className="rounded-2xl border-2 border-zinc-200 bg-white p-4 hover:border-[var(--color-brand-300)] transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-800 leading-relaxed">{u.question}</p>
                  <p className="text-[10px] text-zinc-400 mt-1 tabular-nums">
                    เมื่อ {new Date(u.createdAt).toLocaleString("th-TH")}
                  </p>
                </div>
                {teachingId !== u.id && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startTeaching(u)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-white bg-[var(--color-brand-600)] px-3 h-9 rounded-lg hover:bg-[var(--color-brand-700)]"
                    >
                      <GraduationCap className="size-4" />
                      สอนบอท
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(u)}
                      disabled={pending}
                      className="size-9 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 rounded-lg disabled:opacity-50"
                      title="ปิดรายการ (ไม่สอน)"
                      aria-label="ปิดรายการ"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Inline teach form */}
              {teachingId === u.id && (
                <div className="mt-3 pt-3 border-t border-zinc-200 space-y-3">
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
                      คำค้น (คั่นด้วยจุลภาค) <span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="เช่น ราคา, กี่บาท"
                      className={inputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
                      คำตอบ <span className="text-red-500">*</span>
                    </span>
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="พิมพ์คำตอบที่อยากให้บอทตอบคำถามแบบนี้"
                      rows={3}
                      className={areaCls}
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setTeachingId(null)}
                      className="inline-flex items-center gap-1 text-sm font-bold text-zinc-700 px-3 h-9 rounded-lg hover:bg-zinc-100"
                    >
                      <X className="size-4" /> ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={() => teach(u)}
                      disabled={pending || !keywords.trim() || !answer.trim()}
                      className="inline-flex items-center gap-1 text-sm font-bold text-white bg-[var(--color-brand-600)] px-4 h-9 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
                    >
                      <Check className="size-4" />
                      {pending ? "กำลังบันทึก..." : "บันทึก + สอนบอท"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
