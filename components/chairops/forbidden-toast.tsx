"use client";

// Surfaces the silent `?error=forbidden` bounce. requireRole / requireExactRole /
// requireBranch redirect a user who lacks access to /chairops?error=forbidden —
// previously the param was dropped by a legacy /dashboard redirect and the user
// just "landed on the dashboard" with no explanation (e.g. an OFFICE/ADMIN
// tapping a MAID-only LINE menu). This fires a one-time toast and cleans the URL.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function ForbiddenToast({
  show,
  redirectTo = "/chairops",
}: {
  show: boolean;
  /** ultramobileux audit 2026-10-07: was hardcoded to "/chairops" (office
   * only) — the (maid) side sends the same ?error=forbidden param (e.g.
   * viewing another maid's collection record) but nothing ever read it,
   * so the bounce was completely silent. Made the clean-URL target
   * configurable so this component works on both sides. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (!show || fired.current) return;
    fired.current = true;
    toast.error("หน้านั้นเปิดได้เฉพาะบางสิทธิ์ · พากลับหน้าหลักให้แล้ว", {
      description: "เช่น เมนูของแม่บ้านต้องเข้าด้วยบัญชีแม่บ้าน",
    });
    // ลบ ?error=forbidden ออกจาก URL กัน toast เด้งซ้ำตอน refresh
    router.replace(redirectTo);
  }, [show, router, redirectTo]);

  return null;
}
