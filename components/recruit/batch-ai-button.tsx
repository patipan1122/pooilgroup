"use client";

// ปุ่มประเมินหลายคนรวดด้วย AI (batch) — ไล่ประเมินทีละคน (อ่านเรซูเม่ถ้ามี ไม่มีก็ดูคำตอบ)
// รันฝั่ง client ทีละใบ = ไม่ชน serverless timeout + โชว์ความคืบหน้า + กดหยุดได้
// budget guard เดิมยิงต่อใบ · ถ้าถึงลิมิต AI จะหยุดอัตโนมัติ

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, X } from "lucide-react";
import { smartScoreApplicationAction } from "@/app/(admin)/recruit/_actions/ai";

interface Props {
  targets: Array<{ id: string; scored: boolean }>;
}

export function BatchAiButton({ targets }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"unscored" | "all">("unscored");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, ok: 0, fail: 0, total: 0 });
  const stopRef = useRef(false);

  const unscored = targets.filter((t) => !t.scored);
  if (targets.length === 0) return null;

  async function start() {
    const ids = (scope === "unscored" ? unscored : targets).map((t) => t.id);
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
            done++;
            setProgress({ done, ok, fail, total: ids.length });
            break;
          }
        }
      } catch (e) {
        fail++;
        toast.error("หยุด — " + (e as Error).message);
        done++;
        setProgress({ done, ok, fail, total: ids.length });
        break;
      }
      done++;
      setProgress({ done, ok, fail, total: ids.length });
    }

    setRunning(false);
    stopRef.current = false;
    toast.success(
      `ประเมินเสร็จ ${ok} คน${fail > 0 ? ` · พลาด/ข้าม ${fail}` : ""}`,
    );
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
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)]"
      >
        <Sparkles className="size-4" />
        ประเมินด้วย AI
        {unscored.length > 0 && (
          <span className="ml-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] tabular-nums">
            {unscored.length} ยังไม่ประเมิน
          </span>
        )}
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
            <p className="text-sm font-bold text-zinc-900">ประเมินหลายคนรวดด้วย AI</p>
            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
              AI จะอ่าน<b>เรซูเม่ที่แนบมา</b> (ถ้ามี) ไม่มีก็ดูจากคำตอบในฟอร์ม แล้วให้คะแนน 0-100
              · ไม่ดูรูป/อายุ/เพศ
            </p>

            <div className="mt-3 space-y-1.5">
              <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 cursor-pointer has-[:checked]:border-[var(--color-brand-400)] has-[:checked]:bg-[var(--color-brand-50)]/50">
                <input
                  type="radio"
                  name="batch-scope"
                  checked={scope === "unscored"}
                  onChange={() => setScope("unscored")}
                  className="accent-[var(--color-brand-600)]"
                />
                <span className="text-xs text-zinc-700">
                  เฉพาะที่ยังไม่ประเมิน{" "}
                  <b className="tabular-nums">({unscored.length} คน)</b>
                </span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 cursor-pointer has-[:checked]:border-[var(--color-brand-400)] has-[:checked]:bg-[var(--color-brand-50)]/50">
                <input
                  type="radio"
                  name="batch-scope"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                  className="accent-[var(--color-brand-600)]"
                />
                <span className="text-xs text-zinc-700">
                  ทั้งหมดในรายการนี้{" "}
                  <b className="tabular-nums">({targets.length} คน)</b> · ประเมินซ้ำของเดิมด้วย
                </span>
              </label>
            </div>

            <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-2">
              ⚠️ ยิ่งประเมินหลายคน ยิ่งใช้เวลา + มีค่าใช้จ่าย AI · กด "หยุด" ระหว่างทางได้
            </p>

            <div className="mt-3 flex items-center justify-end gap-2">
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
                className="h-9 px-4 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)]"
              >
                เริ่มประเมิน
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
