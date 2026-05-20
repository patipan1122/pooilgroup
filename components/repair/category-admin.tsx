"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategory } from "@/lib/repair/actions";
import { URGENCY_LABELS } from "@/lib/repair/types";
import type { RepairUrgency } from "@/lib/generated/prisma/enums";
import { Plus, AlertCircle } from "lucide-react";

interface Cat {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
  defaultUrgency: RepairUrgency;
  sortOrder: number;
}

export function CategoryAdmin({ categories }: { categories: Cat[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("🛠");
  const [urgency, setUrgency] = useState<RepairUrgency>("NORMAL");
  const [sortOrder, setSortOrder] = useState(100);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createCategory({
        slug: slug.trim().toLowerCase(),
        label: label.trim(),
        emoji: emoji.trim() || undefined,
        defaultUrgency: urgency,
        sortOrder,
      });
      if (!r.ok) {
        setError(r.error ?? "เพิ่มไม่สำเร็จ");
        return;
      }
      setSlug("");
      setLabel("");
      setEmoji("🛠");
      setSortOrder(100);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)]"
        >
          <Plus className="size-4" />
          เพิ่มหมวด
        </button>
      ) : (
        <form onSubmit={submit} className="bg-white rounded-2xl border-2 border-zinc-200 p-4 space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wide">ชื่อแสดง</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                placeholder="เช่น แอร์/เครื่องปรับอากาศ"
                className="mt-1 w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm focus:border-[var(--color-brand-500)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Emoji</label>
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={4}
                className="mt-1 w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-2xl text-center"
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Slug (a-z, dash)</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                pattern="[a-z0-9\-]+"
                placeholder="เช่น ac"
                className="mt-1 w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm font-mono lowercase focus:border-[var(--color-brand-500)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wide">เร่งด่วน default</label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as RepairUrgency)}
                className="mt-1 w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm font-medium"
              >
                {(["URGENT", "NORMAL", "LOW"] as const).map((u) => (
                  <option key={u} value={u}>
                    {URGENCY_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wide">ลำดับแสดง</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value || "0", 10))}
                className="mt-1 w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm font-medium"
              />
            </div>
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex gap-2 text-red-800 text-sm">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending || label.trim().length === 0 || slug.trim().length === 0}
              className="h-10 px-4 rounded-lg bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 px-4 rounded-lg bg-white border-2 border-zinc-200 text-zinc-700 font-bold text-sm hover:bg-zinc-50"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      <ul className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
        {categories.length === 0 ? (
          <li className="p-8 text-center text-zinc-500">ยังไม่มีหมวด</li>
        ) : (
          categories.map((c) => (
            <li key={c.id} className="px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">{c.emoji ?? "🛠"}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-900">{c.label}</p>
                <p className="text-xs text-zinc-500 font-mono">
                  {c.slug} · default {URGENCY_LABELS[c.defaultUrgency]} · sort {c.sortOrder}
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
