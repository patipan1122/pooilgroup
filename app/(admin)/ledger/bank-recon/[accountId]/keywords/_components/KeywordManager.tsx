"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Sparkles, Hand, Lock } from "lucide-react";
import { addBankKeywordAction, removeBankKeywordAction } from "../_actions";

interface BuiltinConcept {
  conceptKey: string;
  label: string;
  keywords: string[];
}
interface CustomRow {
  id: string;
  conceptKey: string;
  keyword: string;
  source: "seed" | "learned" | "manual";
  scope: "account" | "org";
  confirmedCount: number;
}

export function KeywordManager({
  bankAccountId,
  builtin,
  custom,
  canEdit,
}: {
  bankAccountId: string;
  builtin: BuiltinConcept[];
  custom: CustomRow[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<CustomRow[]>(custom);
  const [conceptKey, setConceptKey] = useState(builtin[0]?.conceptKey ?? "");
  const [keyword, setKeyword] = useState("");
  const [orgWide, setOrgWide] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const customByConcept = (key: string) => rows.filter((r) => r.conceptKey === key);

  function add() {
    const kw = keyword.trim();
    if (!kw || !conceptKey) return;
    setErr(null);
    start(async () => {
      const res = await addBankKeywordAction({ bankAccountId, conceptKey, keyword: kw, orgWide });
      if (!res.ok) {
        setErr(res.error ?? "เพิ่มไม่สำเร็จ");
        return;
      }
      // optimistic: เพิ่มลงตาราง (id ชั่วคราว — refresh จริงตอนโหลดหน้าใหม่)
      setRows((p) => [
        ...p,
        { id: `tmp-${Date.now()}`, conceptKey, keyword: kw.toLowerCase(), source: "manual", scope: orgWide ? "org" : "account", confirmedCount: 0 },
      ]);
      setKeyword("");
    });
  }

  function remove(id: string) {
    // optimistic tmp row (ยังไม่ refresh) → ลบฝั่ง client พอ (ยังไม่มีใน DB)
    if (id.startsWith("tmp-")) {
      setRows((p) => p.filter((r) => r.id !== id));
      return;
    }
    start(async () => {
      const res = await removeBankKeywordAction(id);
      if (res.ok) setRows((p) => p.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      {builtin.map((c) => {
        const customs = customByConcept(c.conceptKey);
        return (
          <div key={c.conceptKey} className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium text-zinc-900">{c.label}</h2>
              <span className="text-xs text-zinc-400">{c.conceptKey}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {/* คีย์ในระบบ — แก้ไม่ได้ */}
              {c.keywords.map((k) => (
                <span key={`b-${k}`} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
                  <Lock className="h-3 w-3 text-zinc-400" /> {k}
                </span>
              ))}
              {/* คีย์ที่เพิ่ม/เรียนรู้ */}
              {customs.map((r) => (
                <span
                  key={r.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                    r.source === "learned" ? "bg-violet-50 text-violet-700" : "bg-emerald-50 text-emerald-700"
                  }`}
                  title={r.source === "learned" ? `ระบบจำจากการยืนยัน ${r.confirmedCount} ครั้ง` : "เพิ่มเอง"}
                >
                  {r.source === "learned" ? <Sparkles className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
                  {r.keyword}
                  {r.scope === "org" && <span className="text-[10px] opacity-60">·ทุกบัญชี</span>}
                  {canEdit && (
                    <button onClick={() => remove(r.id)} disabled={pending} className="ml-0.5 text-zinc-400 hover:text-rose-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {c.keywords.length === 0 && customs.length === 0 && (
                <span className="text-xs text-zinc-400">— ยังไม่มีคำหลัก —</span>
              )}
            </div>
          </div>
        );
      })}

      {canEdit && (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <h3 className="mb-2 text-sm font-medium text-zinc-700">เพิ่มคำหลักเอง</h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={conceptKey}
              onChange={(e) => setConceptKey(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            >
              {builtin.map((c) => (
                <option key={c.conceptKey} value={c.conceptKey}>{c.label}</option>
              ))}
            </select>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="ชื่อที่ขึ้นในสเตทเมนต์ (เช่น แกร็บแท็กซี่)"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
            <button
              onClick={add}
              disabled={pending || !keyword.trim()}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> เพิ่ม
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
            <input type="checkbox" checked={orgWide} onChange={(e) => setOrgWide(e.target.checked)} />
            ใช้กับทุกบัญชี (ไม่ใช่แค่บัญชีนี้)
          </label>
          {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
