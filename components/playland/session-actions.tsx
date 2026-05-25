"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkOutSession, extendSession } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { LogOut, Plus } from "lucide-react";

export function SessionActions({
  sessionId,
  memberName,
  packages,
}: {
  sessionId: string;
  memberName: string;
  packages: Array<{ id: string; name: string; price: number; minutes: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showExtend, setShowExtend] = useState(false);

  function doCheckout() {
    if (!confirm(`Check-out "${memberName}"? · ขั้นตอนนี้ปิด session ถาวร · ห้าม refund`)) return;
    start(async () => {
      const res = await checkOutSession(sessionId);
      if (!res.ok) alert(res.error); else router.refresh();
    });
  }

  function doExtend(packageId: string) {
    start(async () => {
      const res = await extendSession({ sessionId, extraPackageId: packageId, paymentMethod: "CASH" });
      if (!res.ok) alert(res.error); else { setShowExtend(false); router.refresh(); }
    });
  }

  return (
    <div style={{ display: "flex", gap: 4, position: "relative" }}>
      <button className="pl-btn pl-btn-sm" onClick={() => setShowExtend((s) => !s)} disabled={pending} title="ต่อเวลา"><Plus size={11} /></button>
      <button className="pl-btn pl-btn-sm" onClick={doCheckout} disabled={pending} title="Check-out (ปิด session ถาวร)"><LogOut size={11} /></button>

      {showExtend && (
        <div style={{
          position: "absolute", right: 0, top: 28, zIndex: 50, background: "white",
          border: "1px solid var(--pl-line-strong)", borderRadius: 8, padding: 8, minWidth: 220,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}>
          <div className="pl-eyebrow" style={{ marginBottom: 6 }}>ต่อเวลา · เลือก package</div>
          {packages.slice(0, 5).map((p) => (
            <button
              key={p.id}
              className="pl-btn pl-btn-sm"
              style={{ width: "100%", justifyContent: "space-between", marginBottom: 4 }}
              onClick={() => doExtend(p.id)}
              disabled={pending}
            >
              <span>{p.name}</span>
              <span>{thb(p.price)}</span>
            </button>
          ))}
          <button className="pl-btn pl-btn-sm" style={{ width: "100%", marginTop: 4 }} onClick={() => setShowExtend(false)}>ยกเลิก</button>
        </div>
      )}
    </div>
  );
}
