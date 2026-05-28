"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createRule, type RuleCondition, type RuleAction } from "@/lib/recruit/rule-actions";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/recruit/types";
import { Plus } from "lucide-react";

export function RuleEditor() {
  const [name, setName] = useState("");
  const [field, setField] = useState<"ai_score" | "tag" | "blacklist">("ai_score");
  const [op, setOp] = useState<">=" | "<=" | "==" | "contains">(">=");
  const [value, setValue] = useState<string>("85");
  const [setStatus, setSetStatus] = useState<ApplicationStatus | "">("");
  const [addTag, setAddTag] = useState("");
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();

  // When field changes, reset op + value to sensible defaults
  function changeField(f: typeof field) {
    setField(f);
    if (f === "ai_score") {
      setOp(">=");
      setValue("85");
    } else if (f === "tag") {
      setOp("contains");
      setValue("");
    } else {
      setOp("==");
      setValue("true");
    }
  }

  function submit() {
    if (!name.trim()) return toast.error("ตั้งชื่อกฎก่อน");
    if (!setStatus && !addTag.trim() && !comment.trim()) {
      return toast.error("ต้องเลือก action อย่างน้อย 1 อย่าง");
    }

    const condition: RuleCondition = {
      field,
      op,
      value:
        field === "ai_score"
          ? Number(value)
          : field === "blacklist"
            ? value === "true"
            : value,
    };
    const action: RuleAction = {
      ...(setStatus ? { setStatus } : {}),
      ...(addTag.trim() ? { addTag: addTag.trim() } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };

    startTransition(async () => {
      try {
        await createRule({ name, enabled: true, condition, action });
        toast.success("สร้างกฎแล้ว");
        setName("");
        setSetStatus("");
        setAddTag("");
        setComment("");
        if (field === "ai_score") setValue("85");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="rounded-2xl border-2 border-[var(--color-brand-200)] bg-gradient-to-br from-[var(--color-brand-50)]/40 to-white p-5 h-fit sticky top-4">
      <h3 className="font-bold text-zinc-900 mb-4 flex items-center gap-2">
        <Plus className="size-4 text-[var(--color-brand-600)]" />
        สร้างกฎใหม่
      </h3>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1.5">ชื่อกฎ *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='เช่น "AI score ≥ 85 → คัดผ่าน"'
            className="w-full h-10 px-3 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
          />
        </div>

        <div>
          <p className="text-xs font-bold text-zinc-700 mb-1.5">เงื่อนไข *</p>
          <div className="space-y-2">
            <select
              value={field}
              onChange={(e) => changeField(e.target.value as typeof field)}
              className="w-full h-10 px-3 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            >
              <option value="ai_score">AI score</option>
              <option value="tag">ป้ายกำกับ</option>
              <option value="blacklist">ติด Blacklist</option>
            </select>
            <div className="flex gap-2">
              {field === "ai_score" && (
                <>
                  <select
                    value={op}
                    onChange={(e) => setOp(e.target.value as typeof op)}
                    className="w-24 h-10 px-3 rounded-lg border border-zinc-300 text-sm"
                  >
                    <option value=">=">≥</option>
                    <option value="<=">≤</option>
                    <option value="==">=</option>
                  </select>
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    min={0}
                    max={100}
                    className="flex-1 h-10 px-3 rounded-lg border border-zinc-300 text-sm"
                  />
                </>
              )}
              {field === "tag" && (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder='เช่น "VIP"'
                  className="flex-1 h-10 px-3 rounded-lg border border-zinc-300 text-sm"
                />
              )}
              {field === "blacklist" && (
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-lg border border-zinc-300 text-sm"
                >
                  <option value="true">ติด Blacklist</option>
                  <option value="false">ไม่ติด</option>
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-zinc-200">
          <p className="text-xs font-bold text-zinc-700 mb-1.5">การทำ (เลือกอย่างน้อย 1)</p>
          <div className="space-y-2">
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">เปลี่ยน status เป็น</p>
              <select
                value={setStatus}
                onChange={(e) => setSetStatus(e.target.value as ApplicationStatus | "")}
                className="w-full h-10 px-3 rounded-lg border border-zinc-300 text-sm"
              >
                <option value="">— ไม่เปลี่ยน —</option>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">เพิ่ม tag</p>
              <input
                type="text"
                value={addTag}
                onChange={(e) => setAddTag(e.target.value)}
                placeholder='เช่น "green:ผ่านเกณฑ์"'
                className="w-full h-10 px-3 rounded-lg border border-zinc-300 text-sm"
              />
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">เพิ่ม note</p>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder='เช่น "ผ่านเกณฑ์อัตโนมัติ"'
                className="w-full h-10 px-3 rounded-lg border border-zinc-300 text-sm"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="w-full h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-bold text-sm hover:bg-[var(--color-brand-700)] disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : "+ สร้างกฎใหม่"}
        </button>
      </div>
    </div>
  );
}
