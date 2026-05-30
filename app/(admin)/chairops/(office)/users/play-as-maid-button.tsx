"use client";

// "เล่นเป็นแม่บ้าน" — office/CEO impersonates a specific maid for the rare
// day they want to test the maid flow OR actually do a cash-collect run
// themselves (CEO 2026-05-30). Posts to the existing Pool impersonation
// endpoint (relaxed to org_admin/admin from super_admin-only in this round),
// then navigates straight to /chairops/m so they land in the maid hub.
//
// Render only when (a) caller is admin-tier (parent page already filters)
// AND (b) the target maid has an authUserId (Pool users row exists — see
// ensurePoolMembership). Without authUserId the impersonation cookie can't
// resolve a Pool session.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserCog } from "lucide-react";

interface Props {
  authUserId: string;
  maidDisplayName: string;
}

export function PlayAsMaidButton({ authUserId, maidDisplayName }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (pending) return;
    if (
      !confirm(
        `เข้าใช้งานเป็น "${maidDisplayName}"?\n\nระบบจะแสดงผลเหมือนคุณเป็นแม่บ้านคนนี้ ` +
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
        toast.success(`กำลังเข้าเป็น ${maidDisplayName}`);
        router.push("/chairops/m");
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
      aria-label={`เข้าใช้งานเป็น ${maidDisplayName}`}
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
