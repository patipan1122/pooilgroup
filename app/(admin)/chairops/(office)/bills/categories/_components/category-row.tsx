"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { archiveCategory, restoreCategory } from "../../actions";

interface Props {
  category: {
    id: string;
    code: string;
    label: string;
    sortOrder: number;
    archivedAt: Date | null;
  };
  variant: "active" | "archived";
}

export function CategoryRow({ category, variant }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", category.id);
    startTransition(async () => {
      const result =
        variant === "active"
          ? await archiveCategory(fd)
          : await restoreCategory(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">{category.label}</p>
        <p className="text-xs text-zinc-500">
          <code>{category.code}</code> · ลำดับ {category.sortOrder}
        </p>
        {error ? (
          <p className="mt-1 text-xs text-rose-700">{error}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className={
          variant === "active"
            ? "rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            : "rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        }
      >
        {isPending
          ? "…"
          : variant === "active"
            ? "ซ่อน"
            : "กู้คืน"}
      </button>
    </li>
  );
}
