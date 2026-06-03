"use client";

// ลบงบรายแถว (พร้อมยืนยัน).
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { deleteBudget } from "../../_actions";

export function BudgetRowActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!confirm("ลบงบนี้?")) return;
    startTransition(async () => {
      await deleteBudget(id);
      router.refresh();
    });
  }

  return (
    <button
      onClick={remove}
      disabled={pending}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
      aria-label="ลบงบ"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </button>
  );
}
