"use client";

/**
 * ClawFleet v2 — Anomaly detail (ไส้ใน · drill-in จาก Anomaly inbox) client.
 *
 * คลิกแถว anomaly → เปิดหน้าไส้ในเต็มจอ. Reuse `AnomalyReview` overlay ตัวเดิม
 * (มี cross-check เงิน/ตุ๊กตา · ใครกรอก · มิเตอร์ก่อน→หลัง · "ตรงมิเตอร์ไหม" รายตู้ ·
 * รูปยืนยันกดขยาย) — ไม่ build ซ้ำ. ปุ่มตรวจ (อนุมัติ/ตรวจซ้ำ/ส่งต่อ) ต่อ
 * `reviewV2Session` ของจริง แล้วเด้งกลับ inbox.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnomalyReview } from "@/components/clawfleet/v2/anomaly-review";
import { reviewV2Session } from "@/lib/clawfleet/v2-actions";
import type { Anomaly } from "@/lib/clawfleet/v2-data";

type ToastKind = "approve" | "recheck" | "escalate";

export function AnomalyDetailClient({ anomaly }: { anomaly: Anomaly }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(null);

  const back = () => router.push("/clawfleet/v2/anomalies");

  const decide = async (decision: string, note: string) => {
    const kind = decision as ToastKind;
    await reviewV2Session(anomaly.id, kind, note);
    setToast({
      kind,
      text:
        kind === "approve"
          ? "อนุมัติแล้ว · เข้ารายงาน"
          : kind === "recheck"
            ? "แจ้งให้พนักงานตรวจซ้ำ · LINE ส่งแล้ว"
            : "ส่งให้ผู้จัดการ · รออนุมัติ",
    });
    // เด้งกลับ inbox หลังโชว์ toast สั้น ๆ
    setTimeout(() => {
      setToast(null);
      back();
    }, 1200);
  };

  return (
    <>
      <AnomalyReview anomaly={anomaly} onClose={back} onNext={back} onDecision={decide} />
      {toast && (
        <div className={`cf-toast cf-toast-${toast.kind}`}>
          <span className="cf-toast-icon">
            {toast.kind === "approve" ? "✓" : toast.kind === "recheck" ? "↻" : "⚑"}
          </span>
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}
