"use client";

// ปิด/เปิดโครงการ (soft-archive) — archiveProjectAction(id, archived). มี confirm กันกดพลาด.
// gate: render เฉพาะ canManage (page ตัดสิน) · server เป็น backstop.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Archive, RotateCcw } from "lucide-react";
import { archiveProjectAction } from "@/app/(admin)/ledger/_actions";

export function ArchiveProjectButton({
  projectId,
  archived,
}: {
  projectId: string;
  /** สถานะปัจจุบัน — true = ปิดอยู่แล้ว (ปุ่มจะกลายเป็น "เปิดใหม่"). */
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run() {
    const next = !archived;
    if (next && !window.confirm("ปิดโครงการนี้? รายงานย้อนหลังยังเปิดดูได้ (ไม่ลบข้อมูล)")) return;
    setErr(null);
    startTransition(async () => {
      const res = await archiveProjectAction(projectId, next);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="press inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : archived ? (
          <RotateCcw className="size-4" aria-hidden />
        ) : (
          <Archive className="size-4" aria-hidden />
        )}
        {archived ? "เปิดโครงการใหม่" : "ปิดโครงการ"}
      </button>
      {err && <span className="mt-1 text-[11px] text-rose-600">{err}</span>}
    </span>
  );
}
