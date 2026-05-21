"use client";

// Triage Stack — swipe interface for fast-classifying NEW applications
// Per Recruit Redesign canvas Section 04 (HR5Triage)
//
// Right swipe / right arrow / ✓ button = pass to SCREENING
// Left swipe / left arrow / ✗ button = reject
// Up arrow / 👁 button = open detail in new tab (defer decision)

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { changeApplicationStatus } from "@/lib/recruit/actions";
import { ChevronLeft, Check, X, Eye, Sparkles, ShieldAlert, Star } from "lucide-react";

interface Application {
  id: string;
  refId: string;
  applicantName: string;
  phone: string;
  email: string | null;
  postingTitle: string;
  aiScore: number | null;
  aiSummary: string | null;
  tags: string[];
  flaggedBlacklist: boolean;
  submittedAt: string;
}

export function TriageStack({
  applications,
  postingFilter,
}: {
  applications: Application[];
  postingFilter: string | null;
}) {
  const [queue, setQueue] = useState(applications);
  const [stats, setStats] = useState({ passed: 0, rejected: 0, skipped: 0 });
  const [isProcessing, setIsProcessing] = useState(false);

  const current = queue[0];
  const next = queue[1];

  const handleDecision = useCallback(
    async (decision: "pass" | "reject" | "skip") => {
      if (!current || isProcessing) return;
      setIsProcessing(true);

      try {
        if (decision === "pass") {
          await changeApplicationStatus(current.id, "SCREENING");
          setStats((s) => ({ ...s, passed: s.passed + 1 }));
          toast.success(`${current.applicantName} → คัดกรอง`, { duration: 1500 });
        } else if (decision === "reject") {
          await changeApplicationStatus(current.id, "REJECTED");
          setStats((s) => ({ ...s, rejected: s.rejected + 1 }));
          toast.success(`${current.applicantName} → ไม่ผ่าน`, { duration: 1500 });
        } else {
          setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
        }
        setQueue((q) => q.slice(1));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setIsProcessing(false);
      }
    },
    [current, isProcessing],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === "ArrowRight" || e.key === "p") {
        e.preventDefault();
        handleDecision("pass");
      } else if (e.key === "ArrowLeft" || e.key === "r") {
        e.preventDefault();
        handleDecision("reject");
      } else if (e.key === "ArrowUp" || e.key === "s") {
        e.preventDefault();
        handleDecision("skip");
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleDecision]);

  const totalProcessed = stats.passed + stats.rejected + stats.skipped;
  const totalRemaining = queue.length;

  if (queue.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-3xl font-extrabold font-display">เสร็จแล้ว!</h1>
        <p className="text-sm opacity-80 mt-2 text-center max-w-md">
          คัดใบสมัครหมดแล้ว · {stats.passed} ผ่าน · {stats.rejected} ไม่ผ่าน · {stats.skipped} ข้าม
        </p>
        <div className="flex items-center gap-2 mt-8">
          <Link
            href="/recruit"
            className="h-11 px-5 rounded-xl bg-white text-zinc-900 font-bold text-sm hover:bg-zinc-100"
          >
            กลับกล่องใบสมัคร
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-white/10">
        <Link
          href={postingFilter ? `/recruit?posting=${postingFilter}` : "/recruit"}
          className="size-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="flex-1">
          <p className="text-[11px] opacity-70">Triage · คัดเร็ว ใหม่ → คัดกรอง</p>
          <p className="text-sm font-bold">
            {totalProcessed + 1} / {totalProcessed + totalRemaining}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-green-300">✓ {stats.passed}</span>
          <span className="text-red-300">✗ {stats.rejected}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-green-400 to-emerald-300"
          style={{
            width: `${(totalProcessed / (totalProcessed + totalRemaining)) * 100}%`,
          }}
        />
      </div>

      {/* Card stack */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        {/* Background card (next) */}
        {next && (
          <div
            className="absolute bg-white text-zinc-900 rounded-3xl shadow-xl p-6 w-full max-w-md opacity-40"
            style={{ transform: "scale(0.95) translateY(8px)" }}
          >
            <p className="text-sm font-bold">{next.applicantName}</p>
          </div>
        )}

        {/* Main card */}
        <ApplicationCard application={current} />
      </div>

      {/* Action bar */}
      <div className="px-6 pt-4 pb-8 border-t border-white/10 bg-black/20 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => handleDecision("reject")}
          disabled={isProcessing}
          className="size-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-transform shadow-lg flex items-center justify-center disabled:opacity-50"
          title="ไม่ผ่าน (← / r)"
        >
          <X className="size-7" strokeWidth={3} />
        </button>
        <button
          type="button"
          onClick={() => handleDecision("skip")}
          disabled={isProcessing}
          className="size-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-transform flex items-center justify-center disabled:opacity-50"
          title="ข้าม (↑ / s)"
        >
          <Eye className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => handleDecision("pass")}
          disabled={isProcessing}
          className="size-16 rounded-full bg-green-500 hover:bg-green-600 active:scale-95 transition-transform shadow-lg flex items-center justify-center disabled:opacity-50"
          title="ผ่าน → คัดกรอง (→ / p)"
        >
          <Check className="size-7" strokeWidth={3} />
        </button>
      </div>

      {/* Keyboard hints */}
      <div className="text-center text-[10px] opacity-50 pb-3">
        ⌨️ ← ไม่ผ่าน · → ผ่าน · ↑ ข้าม
      </div>
    </div>
  );
}

function ApplicationCard({ application }: { application: Application }) {
  const scoreColor =
    application.aiScore == null
      ? "text-zinc-400"
      : application.aiScore >= 75
        ? "text-green-600"
        : application.aiScore >= 50
          ? "text-amber-600"
          : "text-red-600";

  return (
    <div className="bg-white text-zinc-900 rounded-3xl shadow-2xl p-6 w-full max-w-md relative">
      {/* Blacklist warning */}
      {application.flaggedBlacklist && (
        <div className="absolute -top-3 left-3 right-3 bg-red-600 text-white text-xs font-bold rounded-lg px-3 py-1.5 flex items-center gap-1.5">
          <ShieldAlert className="size-3.5" />
          ตรงกับ Blacklist
        </div>
      )}

      <div className="flex items-start gap-3 mb-4 mt-2">
        <div className="size-14 rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 text-white font-extrabold font-display text-xl flex items-center justify-center shrink-0">
          {application.applicantName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] text-zinc-500">#{application.refId.slice(-6)}</p>
          <h2 className="text-xl font-extrabold font-display leading-tight mt-0.5">
            {application.applicantName}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{application.postingTitle}</p>
        </div>
        {application.aiScore != null && (
          <div className="text-center shrink-0">
            <p className={`text-3xl font-extrabold font-display ${scoreColor}`}>
              {application.aiScore}
            </p>
            <p className="text-[10px] text-zinc-500">AI</p>
          </div>
        )}
      </div>

      <div className="text-xs space-y-1 text-zinc-700 mb-3">
        <p>📞 {application.phone}</p>
        {application.email && <p>✉️ {application.email}</p>}
        <p className="text-zinc-400">
          ส่งเมื่อ {new Date(application.submittedAt).toLocaleString("th-TH")}
        </p>
      </div>

      {application.aiSummary && (
        <div className="bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] rounded-2xl p-3 mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="size-3.5 text-[var(--color-brand-600)]" />
            <p className="text-[11px] font-bold text-[var(--color-brand-800)]">AI Summary</p>
          </div>
          <p className="text-xs text-zinc-700 leading-relaxed line-clamp-3">
            {application.aiSummary}
          </p>
        </div>
      )}

      {application.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {application.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700"
            >
              <Star className="size-2.5 mr-0.5" />
              {t.includes(":") ? t.split(":")[1] : t}
            </span>
          ))}
        </div>
      )}

      <Link
        href={`/recruit/applications/${application.id}`}
        target="_blank"
        className="block text-center text-xs text-zinc-500 hover:text-[var(--color-brand-700)] underline pt-2"
      >
        เปิดดูรายละเอียดเต็ม → (แท็บใหม่)
      </Link>
    </div>
  );
}
