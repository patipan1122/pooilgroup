"use client";

// "เล่นเป็น" — super_admin impersonates ANY ChairOps user to test their view.
// MAID → lands at /chairops/m (maid PWA hub).
// Other roles (OFFICE, MANAGER, CEO, ADMIN, TECHNICIAN) → lands at /chairops.
//
// Render only when target has authUserId (Pool users row exists via
// ensurePoolMembership) — without it the impersonation cookie can't resolve.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserCog } from "lucide-react";

interface Props {
  authUserId: string;
  displayName: string;
  /** ChairopsUserRole — determines which hub to navigate to after impersonation. */
  role: string;
}

export function PlayAsUserButton({ authUserId, displayName, role }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const dest = role === "MAID" ? "/chairops/m" : "/chairops";

  function onClick() {
    if (pending) return;
    if (
      !confirm(
        `เข้าใช้งานเป็น "${displayName}"?\n\nระบบจะแสดงผลเหมือนคุณเป็นคนนี้ ` +
          `จนกว่าจะกด "กลับเป็นตัวเอง" (1 ชม.) · ทุก action จะถูกบันทึก audit`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/users/${authUserId}/impersonate`, {
          method: "POST",
          credentials: "include",
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(json?.error ?? `เปิดไม่สำเร็จ (${res.status})`);
          return;
        }
        toast.success(`กำลังเข้าเป็น ${displayName}`);
        router.push(dest);
        router.refresh();
      } catch (e) {
        toast.error(
          `ติดต่อ server ไม่ได้: ${e instanceof Error ? e.message : "unknown"}`,
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
      aria-label={`เข้าใช้งานเป็น ${displayName}`}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <UserCog className="size-3" aria-hidden />
      )}
      เล่นเป็น
    </button>
  );
}
