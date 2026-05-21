"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { closeSession } from "@/lib/clawfleet/actions";

export function CloseSessionButton({
  sessionId,
  ready,
  total,
  collected,
}: {
  sessionId: string;
  ready: boolean;
  total: number;
  collected: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await closeSession({ sessionId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {!ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          เก็บไม่ครบ · ยังเหลือ {total - collected} ตู้ · ต้องกรอกครบ {total} ตู้ก่อนปิดรอบ
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!ready || pending}
        className="w-full rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "กำลังปิด..." : `ปิดรอบ + ตรวจ Cross-check`}
      </button>
    </div>
  );
}
