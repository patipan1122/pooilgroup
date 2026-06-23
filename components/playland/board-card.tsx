"use client";

// การ์ดเด็ก 1 คน บนหน้า "ระหว่างเล่น" — มาสคอต + ชื่อ + นาฬิกานับถอยหลังตัวใหญ่ (สด)
// + ปุ่ม +เวลา / +ขนม / เช็คเอาท์ · reuse action เดิม (extendSession/checkOutSession)

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { checkOutSession, extendSession } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { Plus, LogOut, Candy } from "lucide-react";

const MASCOTS = ["sunny", "skye", "rocky"] as const;
function mascotFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MASCOTS[h % MASCOTS.length];
}

function remainingSec(expiresAt: string | null, unlimited: boolean): number {
  if (unlimited) return Number.POSITIVE_INFINITY;
  if (!expiresAt) return 0;
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return "∞";
  if (sec <= 0) return "หมดเวลา";
  const totalMin = Math.floor(sec / 60);
  const s = sec % 60;
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    return `${h}:${String(totalMin % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${totalMin}:${String(s).padStart(2, "0")}`;
}

export type BoardSession = {
  id: string;
  name: string;
  typeLabel: string;
  packageName: string;
  packageMinutes: number;
  expiresAt: string | null;
  checkedInLabel: string;
};

export function BoardCard({
  session,
  packages,
  branchId,
}: {
  session: BoardSession;
  packages: Array<{ id: string; name: string; price: number; minutes: number }>;
  branchId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showExtend, setShowExtend] = useState(false);
  const unlimited = session.packageMinutes === 0;
  const [sec, setSec] = useState(() => remainingSec(session.expiresAt, unlimited));

  useEffect(() => {
    if (unlimited) return;
    setSec(remainingSec(session.expiresAt, unlimited));
    const id = setInterval(() => setSec(remainingSec(session.expiresAt, unlimited)), 1000);
    return () => clearInterval(id);
  }, [session.expiresAt, unlimited]);

  const danger = !unlimited && sec <= 0;
  const warn = !unlimited && sec > 0 && sec < 600;
  const mascot = mascotFor(session.id);

  function doCheckout() {
    if (!confirm(`เช็คเอาท์ "${session.name}"? · ปิดรอบถาวร · ไม่คืนเงิน`)) return;
    start(async () => {
      const res = await checkOutSession(session.id);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  function doExtend(packageId: string) {
    start(async () => {
      const res = await extendSession({ sessionId: session.id, extraPackageId: packageId, paymentMethod: "CASH" });
      if (!res.ok) alert(res.error);
      else { setShowExtend(false); router.refresh(); }
    });
  }

  return (
    <div className={`pl-board-card${danger ? " is-danger" : warn ? " is-warn" : ""}`}>
      <div className="pl-board-top">
        <div className="pl-board-ava">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/playland/brand/mascot-${mascot}.png`} alt="" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="pl-board-name">{session.name}</div>
          <div className="pl-board-meta">{session.typeLabel} · {session.packageName} · เข้า {session.checkedInLabel}</div>
        </div>
      </div>

      <div className="pl-board-count">{fmt(sec)}</div>

      <div className="pl-board-actions">
        <button className="pl-btn pl-btn-sm" onClick={() => setShowExtend((s) => !s)} disabled={pending} title="ต่อเวลา">
          <Plus size={13} /> เวลา
        </button>
        <Link href={`/playland/pos?branch=${branchId}`} className="pl-btn pl-btn-sm" title="ขายขนม/สินค้า">
          <Candy size={13} /> ขนม
        </Link>
        <button className="pl-btn pl-btn-sm pl-btn-danger" onClick={doCheckout} disabled={pending} style={{ marginLeft: "auto" }} title="เช็คเอาท์">
          <LogOut size={13} /> เช็คเอาท์
        </button>
      </div>

      {showExtend && (
        <div className="pl-board-extend">
          <div className="pl-eyebrow" style={{ marginBottom: 6 }}>ต่อเวลา · เลือกแพ็กเกจ</div>
          {packages.slice(0, 6).map((p) => (
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
          <button className="pl-btn pl-btn-sm" style={{ width: "100%", marginTop: 2 }} onClick={() => setShowExtend(false)}>ปิด</button>
        </div>
      )}
    </div>
  );
}
