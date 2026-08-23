"use client";

import { useState, useTransition } from "react";
import { Check, Lock } from "lucide-react";
import { saveMatchRuleAction } from "../_actions";

interface RuleRow {
  conceptKey: string;
  label: string;
  defaultDateWindowDays: number;
  defaultTolBaht: number;
  override: { dateWindowDays: number | null; tolBaht: number | null };
}

export function MatchRuleManager({
  bankAccountId,
  rules,
  canEdit,
}: {
  bankAccountId: string;
  rules: RuleRow[];
  canEdit: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, { dateWindowDays: string; tolBaht: string }>>(() =>
    Object.fromEntries(
      rules.map((r) => [
        r.conceptKey,
        { dateWindowDays: r.override.dateWindowDays?.toString() ?? "", tolBaht: r.override.tolBaht?.toString() ?? "" },
      ]),
    ),
  );
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (key: string, p: Partial<{ dateWindowDays: string; tolBaht: string }>) => {
    setSaved((s) => ({ ...s, [key]: false }));
    setEdits((e) => ({ ...e, [key]: { ...e[key], ...p } }));
  };

  function save(conceptKey: string) {
    const v = edits[conceptKey] ?? { dateWindowDays: "", tolBaht: "" };
    const dw = v.dateWindowDays.trim() === "" ? null : Number(v.dateWindowDays);
    const tol = v.tolBaht.trim() === "" ? null : Number(v.tolBaht);
    setErr(null);
    start(async () => {
      const res = await saveMatchRuleAction({
        bankAccountId,
        conceptKey,
        dateWindowDays: dw != null && Number.isFinite(dw) ? dw : null,
        tolBaht: tol != null && Number.isFinite(tol) ? tol : null,
      });
      if (!res.ok) setErr(res.error ?? "บันทึกไม่สำเร็จ");
      else setSaved((s) => ({ ...s, [conceptKey]: true }));
    });
  }

  return (
    <div className="space-y-3">
      {rules.map((r) => {
        const v = edits[r.conceptKey] ?? { dateWindowDays: "", tolBaht: "" };
        return (
          <div key={r.conceptKey} className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="font-medium text-zinc-900">{r.label}</h2>
              <span className="text-xs text-zinc-400">{r.conceptKey}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">วันต้องตรงกัน (0 = วันเดียวกันเท่านั้น)</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  step="1"
                  disabled={!canEdit}
                  value={v.dateWindowDays}
                  onChange={(e) => patch(r.conceptKey, { dateWindowDays: e.target.value })}
                  placeholder={`ค่าเริ่มต้น ${r.defaultDateWindowDays} วัน`}
                  className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">ยอดห่างกันได้ (บาท)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!canEdit}
                  value={v.tolBaht}
                  onChange={(e) => patch(r.conceptKey, { tolBaht: e.target.value })}
                  placeholder={`ค่าเริ่มต้น ${r.defaultTolBaht} บาท`}
                  className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm disabled:opacity-50"
                />
              </div>
            </div>
            {canEdit && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => save(r.conceptKey)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  บันทึก
                </button>
                {saved[r.conceptKey] && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> บันทึกแล้ว
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!canEdit && (
        <div className="flex items-center gap-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
          <Lock className="h-3.5 w-3.5" /> ดูได้อย่างเดียว — เฉพาะ super_admin แก้ได้
        </div>
      )}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
