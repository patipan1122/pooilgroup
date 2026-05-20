"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trackLookup } from "@/lib/repair/actions";
import { AlertCircle, Loader2, Search } from "lucide-react";

export function TrackForm({ initialCode = "", initialError = null as string | null }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await trackLookup({ ticketCode: code, phone });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Pass phone through so detail page can re-verify
      router.push(`/r/track/${encodeURIComponent(code.toUpperCase())}?p=${encodeURIComponent(phone)}`);
    });
  }

  return (
    <form onSubmit={submit} className="rounded-3xl border-2 border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
      <div>
        <label className="text-sm font-bold text-zinc-900">เลขที่ใบ</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus
          placeholder="RP-2569-0001"
          className="mt-1.5 w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-mono font-bold focus:border-[var(--color-brand-500)] outline-none uppercase"
        />
        <p className="mt-1 text-xs text-zinc-500">รูปแบบ RP-25YY-NNNN</p>
      </div>
      <div>
        <label className="text-sm font-bold text-zinc-900">เบอร์โทรที่ใช้ตอนแจ้ง</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          inputMode="tel"
          placeholder="08x-xxx-xxxx"
          className="mt-1.5 w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none"
        />
      </div>
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex gap-2 text-red-800 text-sm">
          <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="w-full h-12 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {isPending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Search className="size-5" />
        )}
        ดูสถานะ
      </button>
    </form>
  );
}
