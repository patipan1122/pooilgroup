"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, ArrowLeftCircle } from "lucide-react";

interface Props {
  targetName: string;
  targetRoleLabel: string;
  realAdminName: string;
}

// Sticky bar shown across the whole admin shell when a super_admin is
// browsing as another user. One click returns to their own account.
export function ImpersonationBar({
  targetName,
  targetRoleLabel,
  realAdminName,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function returnToSelf() {
    startTransition(async () => {
      const res = await fetch("/api/admin/users/return-to-self", {
        method: "POST",
      });
      if (!res.ok) {
        toast.error("กลับสู่บัญชีไม่สำเร็จ");
        return;
      }
      toast.success(`กลับสู่บัญชี ${realAdminName} แล้ว`);
      router.refresh();
      router.push("/users");
    });
  }

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-zinc-900 border-b-2 border-amber-600 shadow-soft">
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm font-medium min-w-0">
          <Eye className="size-4 shrink-0" />
          <span className="truncate">
            <span className="font-bold">กำลังเข้าใช้แทน:</span>{" "}
            <span className="font-bold">{targetName}</span>{" "}
            <span className="text-zinc-700">({targetRoleLabel})</span>
            <span className="text-zinc-700 ml-2 hidden sm:inline">
              · บัญชีจริง: {realAdminName}
            </span>
          </span>
        </div>
        <button
          onClick={returnToSelf}
          disabled={pending}
          className="inline-flex items-center gap-1.5 bg-zinc-900 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-zinc-800 active:bg-zinc-950 disabled:opacity-60 transition-colors"
        >
          <ArrowLeftCircle className="size-4" />
          {pending ? "กำลังกลับ..." : "กลับสู่บัญชีของฉัน"}
        </button>
      </div>
    </div>
  );
}
