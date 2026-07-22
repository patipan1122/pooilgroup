"use client";

// AI ค้นหาประวัติ — HR พิมพ์ภาษาคน ("เคยทำร้านกาแฟ") → AI อ่านเรซูเม่จริง + คำตอบ
// ของผู้สมัครในตัวกรองปัจจุบัน แล้วคัดคนที่ตรง + บอกเหตุผล.
// รันฝั่ง client ทีละคน (ไม่ชน serverless timeout) + โชว์ความคืบหน้า + กดหยุดได้.
// ครั้งแรกช้า (อ่าน PDF จริง) · ครั้งต่อไปเร็ว (ใช้เนื้อหาที่ AI แกะไว้แล้ว).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, X, Loader2, Search, ThumbsUp, ExternalLink } from "lucide-react";
import { aiSearchApplicantAction } from "@/app/(admin)/recruit/_actions/ai";
import { setScreeningVerdict } from "@/lib/recruit/actions";

const MAX_PER_SEARCH = 40; // อ่านเรซูเม่จริง = แพง/ช้า → จำกัดต่อครั้ง (แคบตัวกรองก่อน)
const MATCH_THRESHOLD = 50; // ≥ นี้ = ถือว่า "ตรง"

interface Match {
  id: string;
  name: string;
  relevance: number;
  reason: string;
  highlighted?: boolean;
}

export function AiSearchButton({
  targets,
  canWrite,
}: {
  targets: string[]; // application ids ในตัวกรองปัจจุบัน
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Match[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const stopRef = useRef(false);

  if (!canWrite || targets.length === 0) return null;

  const scope = targets.slice(0, MAX_PER_SEARCH);
  const overCap = targets.length > MAX_PER_SEARCH;

  async function run() {
    const q = query.trim();
    if (q.length < 2) {
      toast.info("พิมพ์คำค้นก่อน เช่น 'เคยทำร้านกาแฟ'");
      return;
    }
    setRunning(true);
    setResults(null);
    stopRef.current = false;
    const found: Match[] = [];
    let done = 0;
    let stopped = false;
    setProgress({ done: 0, total: scope.length });

    for (const id of scope) {
      if (stopRef.current) break;
      try {
        const res = await aiSearchApplicantAction(id, q);
        if (res.ok) {
          if (res.relevance >= MATCH_THRESHOLD) {
            found.push({
              id: res.id,
              name: res.name,
              relevance: res.relevance,
              reason: res.reason,
            });
          }
        } else if (res.stop) {
          toast.error(`หยุดที่ ${done + 1} คน — ${res.error}`);
          stopped = true;
          done++;
          setProgress({ done, total: scope.length });
          break;
        }
      } catch (e) {
        toast.error("หยุด — " + (e as Error).message);
        stopped = true;
        done++;
        setProgress({ done, total: scope.length });
        break;
      }
      done++;
      setProgress({ done, total: scope.length });
      // อัปเดตผลระหว่างทาง (เห็นคนตรงก่อนโดยไม่ต้องรอครบ)
      setResults([...found].sort((a, b) => b.relevance - a.relevance));
    }

    setScanned(done);
    setResults([...found].sort((a, b) => b.relevance - a.relevance));
    setRunning(false);
    stopRef.current = false;
    if (!stopped) {
      if (found.length > 0) toast.success(`เจอ ${found.length} คนที่ตรง จาก ${done} คน`);
      else toast.info(`ไม่เจอคนที่ตรงกับ "${q}" (อ่าน ${done} คน)`);
    }
  }

  async function highlight(id: string) {
    try {
      await setScreeningVerdict(id, "INTERESTING");
      setResults((prev) =>
        prev
          ? prev.map((m) => (m.id === id ? { ...m, highlighted: true } : m))
          : prev,
      );
      toast.success("เล็งไว้แล้ว (ไฮไลต์ในตาราง)");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function close() {
    if (running) return;
    setOpen(false);
    // refresh เพื่อให้ไฮไลต์ที่กดในผลค้นหาขึ้นในตาราง
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)] text-xs font-bold hover:bg-[var(--color-brand-100)]"
      >
        <Sparkles className="size-4" />
        AI ค้นหาประวัติ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            {/* หัว */}
            <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[var(--color-brand-700)]" />
                <h3 className="text-sm font-extrabold text-zinc-900">
                  AI ค้นหาประวัติ
                </h3>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={running}
                className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 disabled:opacity-40"
                aria-label="ปิด"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* ช่องค้น */}
              <div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !running) run();
                      }}
                      disabled={running}
                      placeholder='เช่น "เคยทำงานร้านกาแฟ" · "มีประสบการณ์ขาย"'
                      className="w-full h-10 pl-8 pr-3 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={run}
                    disabled={running || query.trim().length < 2}
                    className="h-10 px-4 rounded-xl bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-40 whitespace-nowrap"
                  >
                    ค้นหา
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed">
                  AI อ่านเรซูเม่จริง + คำตอบของผู้สมัคร{" "}
                  <b className="text-zinc-600">{scope.length} คน</b> ในตัวกรองนี้
                  {overCap && (
                    <>
                      {" "}· มี {targets.length} คน — ค้นได้ทีละ {MAX_PER_SEARCH} · เลือกตำแหน่ง/สถานะให้แคบลงก่อนเพื่อค้นครบ
                    </>
                  )}
                  <br />
                  ครั้งแรกช้า (อ่านไฟล์จริง · มีค่าใช้จ่าย AI) · ครั้งต่อไปเร็วขึ้น
                </p>
              </div>

              {/* กำลังทำงาน */}
              {running && (
                <div className="rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] p-3">
                  <div className="flex items-center justify-between">
                    <p className="inline-flex items-center gap-2 text-xs font-bold text-[var(--color-brand-800)]">
                      <Loader2 className="size-4 animate-spin" />
                      กำลังอ่าน {progress.done}/{progress.total}
                    </p>
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
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--color-brand-100)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-brand-600)] transition-all"
                      style={{
                        width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* ผลลัพธ์ */}
              {results && (
                <div className="space-y-2">
                  {results.length === 0 ? (
                    <p className="text-center text-sm text-zinc-500 py-6">
                      {running ? "กำลังค้น…" : `ไม่เจอคนที่ตรง (อ่าน ${scanned} คน)`}
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                        ตรงกับที่ค้น {results.length} คน · เรียงจากตรงมากสุด
                      </p>
                      {results.map((m) => (
                        <div
                          key={m.id}
                          className="rounded-xl border border-zinc-200 p-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              href={`/recruit/applications/${m.id}`}
                              className="font-bold text-sm text-zinc-900 hover:text-[var(--color-brand-700)] inline-flex items-center gap-1"
                            >
                              {m.name}
                              <ExternalLink className="size-3 text-zinc-400" />
                            </Link>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                                m.relevance >= 70
                                  ? "bg-green-100 text-green-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              ตรง {m.relevance}%
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] text-zinc-600 leading-snug">
                            {m.reason}
                          </p>
                          <button
                            type="button"
                            onClick={() => highlight(m.id)}
                            disabled={m.highlighted}
                            className={`mt-2 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-bold ${
                              m.highlighted
                                ? "bg-amber-100 text-amber-700"
                                : "border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-700"
                            }`}
                          >
                            <ThumbsUp className="size-3" />
                            {m.highlighted ? "เล็งไว้แล้ว" : "เล็งคนนี้"}
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
