"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createCategory } from "../../actions";

export function CreateCategoryForm() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await createCategory(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOk(true);
      form.reset();
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-700">
          รหัส
        </span>
        <input
          type="text"
          name="code"
          required
          maxLength={40}
          pattern="[A-Z][A-Z0-9_]*"
          placeholder="เช่น PEST_CONTROL"
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm uppercase"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-700">
          ชื่อหมวด (ภาษาไทย)
        </span>
        <input
          type="text"
          name="label"
          required
          maxLength={80}
          placeholder="เช่น ค่ากำจัดแมลง"
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-700">
          ลำดับการแสดงผล
        </span>
        <input
          type="number"
          name="sortOrder"
          defaultValue={100}
          min={0}
          max={9999}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm tabular-nums"
        />
      </label>
      {error ? (
        <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
          เพิ่มแล้ว
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {isPending ? "กำลังเพิ่ม…" : "เพิ่มหมวด"}
      </button>
    </form>
  );
}
