"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { actSyncSalesNow } from "../actions";

// อัปเดตอัตโนมัติเมื่อเปิดหน้า ถ้าข้อมูลเก่ากว่า 6 ชม. (แทน cron — Vercel เต็มโควต้า)
// ยิงครั้งเดียวต่อการเปิดหน้า · ไม่บล็อกการแสดงผล (ข้อมูลเก่าโชว์ก่อน แล้วรีเฟรช)
export function AutoRefresh({ stale }: { stale: boolean }) {
  const fired = useRef(false);
  const [running, setRunning] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!stale || fired.current) return;
    fired.current = true;
    setRunning(true);
    actSyncSalesNow()
      .then(() => router.refresh())
      .catch(() => {})
      .finally(() => setRunning(false));
  }, [stale, router]);

  if (!running) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
      <RefreshCw className="size-3.5 animate-spin" /> กำลังอัปเดตยอดล่าสุด…
    </span>
  );
}
