"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewSession } from "@/lib/clawfleet/actions";

export function ReviewSessionPanel({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(decision: "APPROVE" | "REJECT") {
    if (note.length < 10) {
      setError("ใส่เหตุผลอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await reviewSession({ sessionId, decision, reviewNote: note });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h3 className="mb-3 font-semibold text-zinc-900">Review โดยหัวหน้า</h3>
      <textarea
        className="w-full rounded-xl border border-zinc-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        rows={3}
        placeholder="เหตุผล / หลักฐาน / สิ่งที่ตรวจสอบ (อย่างน้อย 10 ตัวอักษร)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <div className="mt-2 rounded-xl border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => submit("APPROVE")}
          disabled={pending}
          className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
        >
          อนุมัติ (Lock)
        </button>
        <button
          type="button"
          onClick={() => submit("REJECT")}
          disabled={pending}
          className="flex-1 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          ขอ Recheck (กลับ OPEN)
        </button>
      </div>
    </section>
  );
}
