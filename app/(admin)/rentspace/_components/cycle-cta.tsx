"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { actGenerateMonthlyBills } from "../_actions";

type Props = {
  mode: "bill" | "pay" | "done";
  projectId: string;
  period: string;
  title: string;
  hint: string;
  label: string;
};

export function CycleCta({ mode, projectId, period, title, hint, label }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const dot = mode === "bill" ? "#DC2626" : mode === "pay" ? "#F59E0B" : "#16A34A";
  const titleColor = mode === "bill" ? "#C0322B" : mode === "done" ? "#15803D" : "#1F2733";

  function run() {
    start(async () => {
      try {
        const res = await actGenerateMonthlyBills(projectId, period);
        toast.success(`ออกบิลแล้ว ${res.created} ใบ${res.skipped ? ` · มีอยู่แล้ว ${res.skipped}` : ""}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ออกบิลไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4" style={{ borderColor: "#F0F2F5" }}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dot }} />
        <div className="min-w-0">
          <div className="font-semibold text-sm" style={{ color: titleColor }}>{title}</div>
          <div className="text-[12.5px] truncate" style={{ color: "#8A929E" }}>{hint}</div>
        </div>
      </div>
      {mode === "bill" ? (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shrink-0 disabled:opacity-60"
          style={{ background: "#DC2626", boxShadow: "0 1px 2px rgba(220,38,38,.3)", animation: pending ? "none" : "rsPulse 2s infinite" }}
        >
          {pending ? "กำลังออกบิล…" : label}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      ) : mode === "pay" ? (
        <Link href="/rentspace/payments" className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shrink-0" style={{ background: "#2563EB", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }}>
          {label}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </Link>
      ) : (
        <span className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shrink-0" style={{ background: "#EAF7EF", color: "#15803D" }}>
          {label}
        </span>
      )}
      <style jsx global>{`
        @keyframes rsPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,.3); }
          50% { box-shadow: 0 0 0 7px rgba(220,38,38,0); }
        }
      `}</style>
    </div>
  );
}
