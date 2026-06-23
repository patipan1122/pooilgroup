"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DownloadCloud } from "lucide-react";
import { Button } from "@/components/fuelos/ui/button";
import { snapshotPumpPricesNow } from "./actions";

export function SnapshotButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await snapshotPumpPricesNow();
          if (r.ok) {
            toast.success(`บันทึกราคาวันนี้แล้ว (${r.saved} รายการ)`);
            router.refresh();
          } else {
            toast.error(`บันทึกไม่สำเร็จ: ${r.error ?? "ลองใหม่อีกครั้ง"}`);
          }
        })
      }
    >
      <DownloadCloud className="size-4" /> บันทึกราคาวันนี้
    </Button>
  );
}
