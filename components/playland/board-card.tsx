"use client";

// การ์ดเด็ก 1 คน บนหน้า "ระหว่างเล่น" — ตามต้นแบบ §2
// มาสคอต+ชื่อ+แพ็กเกจ · นาฬิกานับถอยหลังกลางการ์ด(สด)+ "เหลือ" · ปุ่ม +เวลา(ฟ้า)/+ขนม(เหลือง)/เช็คเอาท์(แดง)
// สี: ≤10น แดง · ≤25น เหลือง · เกินนั้นเขียว · Day Pass=เขียว "ทั้งวัน" · ใกล้หมด=กรอบแดง

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { extendSession } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { Plus, Candy, LogOut } from "lucide-react";

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

function colorClass(sec: number, unlimited: boolean): string {
  if (unlimited) return "is-green";
  if (sec <= 600) return "is-red";
  if (sec <= 1500) return "is-yellow";
  return "is-green";
}

function fmt(sec: number, unlimited: boolean): string {
  if (unlimited) return "ทั้งวัน";
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
  packageName: string;
  packageMinutes: number;
  expiresAt: string | null;
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

  const near = !unlimited && sec <= 600;
  const cc = colorClass(sec, unlimited);
  const mascot = mascotFor(session.id);

  function doExtend(packageId: string) {
    start(async () => {
      const res = await extendSession({ sessionId: session.id, extraPackageId: packageId, paymentMethod: "CASH" });
      if (!res.ok) alert(res.error);
      else { setShowExtend(false); router.refresh(); }
    });
  }

  return (
    <div className={`pl-board-card${near ? " is-near" : ""}`}>
      <div className="pl-board-top">
        <div className="pl-board-ava">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/playland/brand/mascot-${mascot}.png`} alt="" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pl-board-name">{session.name}</div>
          <div className="pl-board-meta">{session.packageName}</div>
        </div>
        {near && <span className="pl-board-near-pill">ใกล้หมด</span>}
      </div>

      <div className="pl-board-clock">
        <div className={`pl-board-count ${cc}`}>{fmt(sec, unlimited)}</div>
        <div className="pl-board-remain">{unlimited ? "Day Pass" : "เหลือ"}</div>
      </div>

      <div className="pl-board-actions">
        <button className="pl-board-btn pl-board-btn--time" onClick={() => setShowExtend((s) => !s)} disabled={pending}>
          <Plus size={14} /> เวลา
        </button>
        <Link href={`/playland/pos?branch=${branchId}`} className="pl-board-btn pl-board-btn--snack">
          <Candy size={14} /> ขนม
        </Link>
        <Link href={`/playland/checkout?branch=${branchId}&selected=${session.id}`} className="pl-board-btn pl-board-btn--out">
          <LogOut size={14} /> เช็คเอาท์
        </Link>
      </div>

      {showExtend && (
        <div className="pl-board-extend">
          <div className="pl-eyebrow" style={{ marginBottom: 6 }}>ต่อเวลา · เลือกแพ็กเกจ (คิดเงินตอนเช็คเอาท์)</div>
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
