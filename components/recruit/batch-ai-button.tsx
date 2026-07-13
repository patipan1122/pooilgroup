"use client";

// ปุ่มประเมินหลายคนด้วย AI (batch) — ไล่ประเมินทีละคน (อ่านเรซูเม่ถ้ามี ไม่มีก็ดูคำตอบ)
// รันฝั่ง client ทีละใบ = ไม่ชน serverless timeout + โชว์ความคืบหน้า + กดหยุดได้
// เลือกได้: เฉพาะที่ติ๊ก / ยังไม่ประเมิน / ทั้งหมด · บังคับกรอกข้อมูลตำแหน่งก่อน (ถ้ายังไม่มี)
// budget guard เดิมยิงต่อใบ · ถ้าถึงลิมิต AI จะหยุดอัตโนมัติ

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, X, Info } from "lucide-react";
import { smartScoreApplicationAction } from "@/app/(admin)/recruit/_actions/ai";

type Scope = "selected" | "unscored" | "all";

interface Props {
  selectedIds: string[]; // ติ๊กในหน้านี้
  targets: Array<{ id: string; scored: boolean }>; // ทั้งตัวกรอง (cap 500)
  postingSelected: boolean; // เลือกตำแหน่งแล้วหรือยัง
  hasBrief: boolean; // มีข้อมูลตำแหน่งให้ AI แล้วหรือยัง
  onEditBrief: () => void; // เปิดกล่องกรอกข้อมูลตำแหน่ง
}

export function BatchAiButton({
  selectedIds,
  targets,
  postingSelected,
  hasBrief,
  onEditBrief,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("unscored");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, ok: 0, fail: 0, total: 0 });
  const stopRef = useRef(false);

  const unscoredIds = targets.filter((t) => !t.scored).map((t) => t.id);
  const allIds = targets.map((t) => t.id);
  if (targets.length === 0) return null;

  // ต้องกรอกข้อมูลตำแหน่งก่อน (เฉพาะเมื่อเลือกตำแหน่งแล้ว — AI จะได้ประเมินตรงงาน)
  const needsBrief = postingSelected && !hasBrief;

  function openMenu() {
    // ตั้ง default scope ตามสถานการณ์: มีติ๊ก→ติ๊ก · ไม่มี→ยังไม่ประเมิน · หมดแล้ว→ทั้งหมด
    setScope(
      selectedIds.length > 0
        ? "selected"
        : unscoredIds.length > 0
          ? "unscored"
          : "all",
    );
    setOpen(true);
  }

  function idsForScope(s: Scope): string[] {
    if (s === "selected") return selectedIds;
    if (s === "unscored") return unscoredIds;
    return allIds;
  }

  async function start() {
    if (needsBrief) {
      toast.error("กรอกข้อมูลตำแหน่งก่อนถึงจะประเมินได้ครับ");
      onEditBrief();
      return;
    }
    const ids = idsForScope(scope);
    if (ids.length === 0) {
      toast.info("ไม่มีคนที่ต้องประเมิน");
      return;
    }
    setOpen(false);
    setRunning(true);
    stopRef.current = false;
    let ok = 0;
    let fail = 0;
    let done = 0;
    let stopped = false; // หยุดกลางคัน (AI ล่ม/หมดสิทธิ์/เกิน budget) — โชว์ error ไปแล้ว
    setProgress({ done: 0, ok: 0, fail: 0, total: ids.length });

    for (const id of ids) {
      if (stopRef.current) break;
      try {
        const res = await smartScoreApplicationAction(id);
        if (res.ok) ok++;
        else {
          fail++;
          if (res.stop) {
            toast.error(`หยุดไว้ที่ ${done + 1} คน — ${res.error}`);
            stopped = true;
            done++;
            setProgress({ done, ok, fail, total: ids.length });
            break;
          }
        }
      } catch (e) {
        fail++;
        toast.error("หยุด — " + (e as Error).message);
        stopped = true;
        done++;
        setProgress({ done, ok, fail, total: ids.length });
        break;
      }
      done++;
      setProgress({ done, ok, fail, total: ids.length });
    }

    setRunning(false);
    stopRef.current = false;
    // ห้ามเด้ง "เสร็จ" ปลอมเมื่อไม่มีใครสำเร็จ — ให้ error จริงเด่นแทน
    if (ok > 0) {
      toast.success(
        `ประเมินเสร็จ ${ok} คน${fail > 0 ? ` · พลาด/ข้าม ${fail}` : ""}`,
      );
    } else if (!stopped && fail > 0) {
      toast.error(
        `ประเมินไม่สำเร็จสักคน (${fail}) — ระบบ AI อาจมีปัญหาชั่วคราว · ลองใหม่อีกครั้ง`,
      );
    }
    router.refresh();
  }

  if (running) {
    const pct =
      progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : 0;
    return (
      <div className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)]">
        <Loader2 className="size-4 animate-spin text-[var(--color-brand-700)]" />
        <div className="min-w-[120px]">
          <p className="text-[11px] font-bold text-[var(--color-brand-800)] tabular-nums">
            กำลังประเมิน {progress.done}/{progress.total}
          </p>
          <div className="mt-0.5 h-1 w-full rounded-full bg-[var(--color-brand-100)] overflow-hidden">
            <div
              className="h-full bg-[var(--color-brand-600)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            stopRef.current = true;
          }}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 hover:underline"
        >
          <X className="size-3.5" />
          หยุด
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openMenu}
        className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)]"
      >
        <Sparkles className="size-4" />
        ประเมินด้วย AI
        {selectedIds.length > 0 ? (
          <span className="ml-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] tabular-nums">
            ติ๊ก {selectedIds.length}
          </span>
        ) : unscoredIds.length > 0 ? (
          <span className="ml-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] tabular-nums">
            {unscoredIds.length} ยังไม่ประเมิน
          </span>
        ) : null}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="ปิด"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl">
            <p className="text-sm font-bold text-zinc-900">ประเมินด้วย AI</p>
            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
              AI จะอ่าน<b>เรซูเม่ที่แนบมา</b> (ถ้ามี) ไม่มีก็ดูจากคำตอบ แล้วให้คะแนน + สรุปว่าเหมาะกับตำแหน่งไหม
              · ไม่ดูรูป/อายุ/เพศ
            </p>

            {needsBrief ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <Info className="size-4" />
                  ยังไม่ได้บอก AI ว่าตำแหน่งนี้คืออะไร
                </p>
                <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                  กรอกข้อมูลตำแหน่งสั้น ๆ ก่อน (ทำอะไร · สาขา · ดูแลกี่คน) AI จะได้ประเมินตรงงานเราจริง
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEditBrief();
                  }}
                  className="mt-2 h-9 w-full rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600"
                >
                  กรอกข้อมูลตำแหน่ง →
                </button>
              </div>
            ) : (
              <>
                <div className="mt-3 space-y-1.5">
                  <ScopeOption
                    checked={scope === "selected"}
                    onChange={() => setScope("selected")}
                    disabled={selectedIds.length === 0}
                    label="เฉพาะที่ติ๊กไว้"
                    count={selectedIds.length}
                  />
                  <ScopeOption
                    checked={scope === "unscored"}
                    onChange={() => setScope("unscored")}
                    label="เฉพาะที่ยังไม่ประเมิน"
                    count={unscoredIds.length}
                  />
                  <ScopeOption
                    checked={scope === "all"}
                    onChange={() => setScope("all")}
                    label="ทั้งหมดในรายการนี้"
                    count={allIds.length}
                    note="ประเมินซ้ำของเดิมด้วย"
                  />
                </div>

                <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-2">
                  ⚠️ ยิ่งประเมินหลายคน ยิ่งใช้เวลา + มีค่าใช้จ่าย AI · กด "หยุด" ระหว่างทางได้
                </p>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={onEditBrief}
                    className="text-[11px] font-bold text-zinc-500 hover:text-zinc-800 hover:underline"
                  >
                    แก้ข้อมูลตำแหน่ง
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="h-9 px-3 rounded-lg text-xs font-bold text-zinc-600 hover:bg-zinc-100"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={start}
                      disabled={idsForScope(scope).length === 0}
                      className="h-9 px-4 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-40"
                    >
                      เริ่มประเมิน ({idsForScope(scope).length})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScopeOption({
  checked,
  onChange,
  disabled,
  label,
  count,
  note,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  count: number;
  note?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
        disabled
          ? "border-zinc-100 opacity-50 cursor-not-allowed"
          : "border-zinc-200 cursor-pointer has-[:checked]:border-[var(--color-brand-400)] has-[:checked]:bg-[var(--color-brand-50)]/50"
      }`}
    >
      <input
        type="radio"
        name="batch-scope"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="accent-[var(--color-brand-600)]"
      />
      <span className="text-xs text-zinc-700">
        {label} <b className="tabular-nums">({count} คน)</b>
        {note && <span className="text-[10px] text-zinc-400"> · {note}</span>}
      </span>
    </label>
  );
}
