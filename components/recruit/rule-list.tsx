"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleRule, deleteRule } from "@/lib/recruit/rule-actions";
import { Trash2, Bolt } from "lucide-react";

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  condition: { field: string; op: string; value: string | number | boolean };
  action: { setStatus?: string; addTag?: string; comment?: string };
  firesCount: number;
  lastFiredAt: string | null;
  createdByName: string;
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "ใหม่",
  SCREENING: "คัดกรอง",
  INTERVIEW: "สัมภาษณ์",
  OFFERED: "เสนอ",
  HIRED: "รับเข้า",
  REJECTED: "ไม่รับ",
  WITHDRAWN: "ถอน",
};

const FIELD_LABELS: Record<string, string> = {
  ai_score: "AI score",
  tag: "ป้ายกำกับ",
  blacklist: "ติด Blacklist",
};

const OP_LABELS: Record<string, string> = {
  ">=": "≥",
  "<=": "≤",
  "==": "=",
  contains: "มี",
};

export function RuleList({ rules }: { rules: Rule[] }) {
  if (rules.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
        <Bolt className="size-12 mx-auto text-zinc-300" />
        <p className="mt-4 font-bold text-zinc-900">ยังไม่มีกฎ</p>
        <p className="text-sm text-zinc-500 mt-1">
          สร้างกฎแรกในแบบฟอร์มด้านขวา · เช่น &ldquo;AI score ≥ 85 → คัดผ่าน&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} />
      ))}
    </div>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const [isPending, startTransition] = useTransition();

  function onToggle() {
    startTransition(async () => {
      try {
        await toggleRule(rule.id, !rule.enabled);
        toast.success(rule.enabled ? "ปิดกฎแล้ว" : "เปิดใช้กฎแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function onDelete() {
    if (!confirm(`ลบกฎ "${rule.name}"? กู้คืนไม่ได้`)) return;
    startTransition(async () => {
      try {
        await deleteRule(rule.id);
        toast.success("ลบแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const conditionText = `${FIELD_LABELS[rule.condition.field] ?? rule.condition.field} ${
    OP_LABELS[rule.condition.op] ?? rule.condition.op
  } ${String(rule.condition.value)}`;

  const actionParts: string[] = [];
  if (rule.action.setStatus)
    actionParts.push(`→ ${STATUS_LABELS[rule.action.setStatus] ?? rule.action.setStatus}`);
  if (rule.action.addTag) actionParts.push(`+ tag "${rule.action.addTag}"`);
  if (rule.action.comment) actionParts.push(`+ note`);

  return (
    <div
      className={`rounded-2xl border bg-white p-4 ${
        rule.enabled ? "border-zinc-200" : "border-zinc-200 bg-zinc-50/40 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-zinc-900">{rule.name}</p>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                rule.enabled
                  ? "bg-green-100 text-green-800"
                  : "bg-zinc-200 text-zinc-600"
              }`}
            >
              {rule.enabled ? "เปิด" : "ปิด"}
            </span>
            {rule.firesCount > 0 && (
              <span className="text-[10px] text-zinc-400">
                ใช้ไปแล้ว {rule.firesCount} ครั้ง
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-700 mt-2">
            <b>เงื่อนไข:</b> {conditionText}
          </p>
          <p className="text-xs text-zinc-700 mt-1">
            <b>การทำ:</b> {actionParts.join(" · ") || "—"}
          </p>
          <p className="text-[10px] text-zinc-400 mt-2">
            สร้างโดย {rule.createdByName}
            {rule.lastFiredAt &&
              ` · ล่าสุด ${new Date(rule.lastFiredAt).toLocaleString("th-TH", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            className={`h-8 px-3 text-xs font-bold rounded-lg ${
              rule.enabled
                ? "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                : "bg-green-100 text-green-700 hover:bg-green-200"
            }`}
          >
            {rule.enabled ? "ปิด" : "เปิด"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            className="size-8 rounded-lg border border-zinc-200 text-zinc-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
