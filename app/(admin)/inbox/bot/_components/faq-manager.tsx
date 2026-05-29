"use client";

// FAQ manager — keyword→answer pairs the bot uses to reply for free (no AI cost).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createFaq, updateFaq, deleteFaq } from "@/lib/inbox/bot/knowledge-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Pencil, Trash2, Check, X, MessageSquareText } from "lucide-react";

export interface Faq {
  id: string;
  keywords: string;
  answer: string;
  intent: string | null;
  enabled: boolean;
  priority: number;
  hits: number;
}

const inputCls =
  "w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm";
const areaCls =
  "w-full px-3 py-2 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm leading-relaxed resize-y";

export function FaqManager({
  businessTag,
  initialFaqs,
}: {
  businessTag: string;
  initialFaqs: Faq[];
}) {
  const [faqs, setFaqs] = useState(initialFaqs);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // add form
  const [keywords, setKeywords] = useState("");
  const [answer, setAnswer] = useState("");
  const [priority, setPriority] = useState(0);
  // edit form
  const [eKeywords, setEKeywords] = useState("");
  const [eAnswer, setEAnswer] = useState("");
  const [ePriority, setEPriority] = useState(0);

  function resetAdd() {
    setKeywords("");
    setAnswer("");
    setPriority(0);
    setShowAdd(false);
  }

  function add() {
    if (!keywords.trim() || !answer.trim()) {
      toast.error("กรอกคำค้นและคำตอบ");
      return;
    }
    start(async () => {
      try {
        await createFaq({ businessTag, keywords, answer, priority });
        // optimistic-ish: prepend with a temp row then trust revalidate on next load
        setFaqs((cur) => [
          {
            id: `tmp-${Date.now()}`,
            keywords: keywords.trim(),
            answer: answer.trim(),
            intent: null,
            enabled: true,
            priority,
            hits: 0,
          },
          ...cur,
        ]);
        toast.success("เพิ่มคำตอบแล้ว");
        resetAdd();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function startEdit(f: Faq) {
    setEditingId(f.id);
    setEKeywords(f.keywords);
    setEAnswer(f.answer);
    setEPriority(f.priority);
  }

  function saveEdit(f: Faq) {
    if (!eKeywords.trim() || !eAnswer.trim()) {
      toast.error("กรอกคำค้นและคำตอบ");
      return;
    }
    start(async () => {
      try {
        await updateFaq(f.id, { keywords: eKeywords, answer: eAnswer, priority: ePriority });
        setFaqs((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? { ...x, keywords: eKeywords.trim(), answer: eAnswer.trim(), priority: ePriority }
              : x,
          ),
        );
        toast.success("บันทึกแล้ว");
        setEditingId(null);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function toggleEnabled(f: Faq) {
    const next = !f.enabled;
    start(async () => {
      try {
        await updateFaq(f.id, { enabled: next });
        setFaqs((cur) => cur.map((x) => (x.id === f.id ? { ...x, enabled: next } : x)));
        toast.success(next ? "เปิดใช้คำตอบนี้" : "ปิดคำตอบนี้");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function remove(f: Faq) {
    try {
      await deleteFaq(f.id);
      setFaqs((cur) => cur.filter((x) => x.id !== f.id));
      toast.success("ลบแล้ว");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="rounded-2xl bg-[var(--color-brand-50)]/50 border border-[var(--color-brand-200)] p-4 flex items-start gap-3">
        <MessageSquareText className="size-5 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-700 leading-relaxed">
          บอทจะเทียบคำที่ลูกค้าพิมพ์กับ &ldquo;คำค้น&rdquo; (คั่นด้วยจุลภาค) ถ้าตรงจะตอบด้วย
          &ldquo;คำตอบ&rdquo; นี้ทันที (ฟรี ไม่เสียค่า AI) · ตั้ง &ldquo;ลำดับ&rdquo; สูง = ตรวจก่อน
        </p>
      </div>

      {/* Header + add button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-bold text-zinc-900">
          คำตอบสำเร็จรูป{" "}
          <span className="text-zinc-400 tabular-nums font-normal">({faqs.length})</span>
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[var(--color-brand-600)] px-3 h-10 rounded-xl hover:bg-[var(--color-brand-700)]"
        >
          <Plus className="size-4" />
          เพิ่มคำตอบ
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-2xl border-2 border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40 p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              คำค้น (คั่นด้วยจุลภาค) <span className="text-red-500">*</span>
            </span>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="เช่น ราคา, กี่บาท, นาทีละ"
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
              placeholder="เช่น เก้าอี้นวดของเรานาทีละ 1 บาทค่ะ"
              rows={3}
              className={areaCls}
            />
          </label>
          <label className="block max-w-[180px]">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">ลำดับความสำคัญ</span>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
              className={inputCls}
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetAdd}
              className="text-sm font-bold text-zinc-700 px-3 h-10 rounded-lg hover:bg-zinc-100"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={add}
              disabled={pending || !keywords.trim() || !answer.trim()}
              className="text-sm font-bold text-white bg-[var(--color-brand-600)] px-4 h-10 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              {pending ? "กำลังบันทึก..." : "เพิ่มคำตอบ"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {faqs.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500">
          <p className="font-bold text-zinc-900 mb-1">ยังไม่มีคำตอบสำเร็จรูป</p>
          <p>กด &ldquo;เพิ่มคำตอบ&rdquo; เพื่อสอนบอทตอบคำถามที่เจอบ่อย</p>
        </div>
      ) : (
        <div className="space-y-2">
          {faqs.map((f) =>
            editingId === f.id ? (
              <div
                key={f.id}
                className="rounded-2xl border-2 border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40 p-4 space-y-3"
              >
                <label className="block">
                  <span className="text-xs font-bold text-zinc-700 mb-1.5 block">คำค้น</span>
                  <input
                    type="text"
                    value={eKeywords}
                    onChange={(e) => setEKeywords(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-700 mb-1.5 block">คำตอบ</span>
                  <textarea
                    value={eAnswer}
                    onChange={(e) => setEAnswer(e.target.value)}
                    rows={3}
                    className={areaCls}
                  />
                </label>
                <label className="block max-w-[180px]">
                  <span className="text-xs font-bold text-zinc-700 mb-1.5 block">ลำดับความสำคัญ</span>
                  <input
                    type="number"
                    value={ePriority}
                    onChange={(e) => setEPriority(Number(e.target.value) || 0)}
                    className={inputCls}
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="inline-flex items-center gap-1 text-sm font-bold text-zinc-700 px-3 h-9 rounded-lg hover:bg-zinc-100"
                  >
                    <X className="size-4" /> ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(f)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 text-sm font-bold text-white bg-[var(--color-brand-600)] px-3 h-9 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
                  >
                    <Check className="size-4" /> บันทึก
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={f.id}
                className={`rounded-2xl border-2 p-4 transition-colors ${
                  f.enabled
                    ? "border-zinc-200 bg-white hover:border-[var(--color-brand-300)]"
                    : "border-zinc-200 bg-zinc-50/60 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-[10px] font-bold text-zinc-500">คำค้น:</span>
                      {f.keywords
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean)
                        .map((k, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700"
                          >
                            {k}
                          </span>
                        ))}
                    </div>
                    <p className="text-sm text-zinc-800 whitespace-pre-wrap leading-relaxed">
                      {f.answer}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-1.5 tabular-nums">
                      ลำดับ {f.priority} · ใช้ตอบไปแล้ว {f.hits} ครั้ง
                      {!f.enabled && " · ปิดอยู่"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(f)}
                      disabled={pending}
                      role="switch"
                      aria-checked={f.enabled}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        f.enabled ? "bg-[var(--color-brand-600)]" : "bg-zinc-300"
                      }`}
                      title={f.enabled ? "ปิดคำตอบนี้" : "เปิดคำตอบนี้"}
                    >
                      <span
                        className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                          f.enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(f)}
                      className="size-9 inline-flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg"
                      title="แก้ไข"
                      aria-label="แก้ไขคำตอบ"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <ConfirmDialog
                      title="ลบคำตอบนี้?"
                      body="บอทจะไม่ใช้คำตอบนี้อีก · ลบแล้วกู้คืนไม่ได้"
                      confirmLabel="ลบ"
                      onConfirm={() => remove(f)}
                      trigger={
                        <button
                          type="button"
                          className="size-9 inline-flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="ลบ"
                          aria-label="ลบคำตอบ"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      }
                    />
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
