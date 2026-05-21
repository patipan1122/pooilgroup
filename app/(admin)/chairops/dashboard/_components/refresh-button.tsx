"use client";

// Manual refresh of drift snapshots · CEO triggers from dashboard
// Per memory [[ceo-prefers-manual-ai-triggers]] — manual triggers, no auto-run
import { useTransition } from "react";
import { Button } from "@/components/chairops/ui/button";
import { refreshDrifts } from "../actions";
import { toast } from "sonner";

export function RefreshButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const r = await refreshDrifts();
            toast.success(
              `อัพเดทเรียบร้อย · ${r.snapshotCount} สาขา · alert ใหม่ ${r.newAlerts} รายการ`
            );
          } catch (e) {
            toast.error("อัพเดทไม่สำเร็จ · ลองอีกครั้ง");
            console.error(e);
          }
        })
      }
    >
      {pending ? "กำลังอัพเดท..." : "อัพเดทยอด"}
    </Button>
  );
}
