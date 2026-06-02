"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteDayOff } from "../actions";

export function DeleteLeaveButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm("ลบรายการลานี้?")) return;
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const res = await deleteDayOff(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ลบรายการลาแล้ว");
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
      aria-label="ลบรายการลา"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
