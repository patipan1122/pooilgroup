"use client";

// "วิเคราะห์ใหม่" — admin-tier trigger for POST /api/docuflow/risk-aggregate
// ────────────────────────────────────────────────────────────────────
// Lives next to the page header on /docuflow/risk. Calls POST and on
// success refreshes the server component to render the new narrative.
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RefreshOrgRiskButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function handleClick() {
    setRunning(true);
    try {
      const res = await fetch("/api/docuflow/risk-aggregate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "วิเคราะห์ใหม่ไม่สำเร็จ");
      }
      toast.success("วิเคราะห์ใหม่เรียบร้อย");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "วิเคราะห์ใหม่ไม่สำเร็จ");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      loading={running}
    >
      <RefreshCw className="size-4" />
      วิเคราะห์ใหม่
    </Button>
  );
}
