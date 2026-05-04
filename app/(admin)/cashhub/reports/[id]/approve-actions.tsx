"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

export function ApproveActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  function act(action: "approve" | "reject", reason?: string) {
    startTransition(async () => {
      const res = await fetch("/api/cashhub/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, action, reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "อัปเดตไม่ได้");
        return;
      }
      toast.success(action === "approve" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว");
      router.refresh();
    });
  }

  if (showReject) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <CardTitle>เหตุผลที่ไม่อนุมัติ</CardTitle>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ยอดน่าจะกรอกผิด ตรวจสอบใหม่"
            className="w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-[--color-brand-500]"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowReject(false)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={!reason.trim()}
              onClick={() => act("reject", reason)}
            >
              ส่งกลับให้แก้
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={pending}
        onClick={() => act("approve")}
      >
        <CheckCircle2 className="size-5" />
        อนุมัติ
      </Button>
      <Button
        variant="outline"
        size="lg"
        loading={pending}
        onClick={() => setShowReject(true)}
      >
        <XCircle className="size-5" />
        ไม่อนุมัติ
      </Button>
    </div>
  );
}
