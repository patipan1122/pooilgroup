// Playland · หน้าหลัก (Launcher) — ตามต้นแบบ "Play a lot"
//
// Mission-control launcher: ทักทาย + KPI วันนี้ + 4 การ์ดใหญ่ (รับเด็ก/กำลังเล่น/ขายขนม/Monitor)
// + 3 ปุ่มล่าง (หลังร้าน). ไม่ใช่ cockpit แน่น ๆ — งานลงทะเบียนอยู่ที่ /playland/checkin
// ดูต้นแบบ: docs/PLAYALOT_PROTOTYPE_SCREENS.md §1

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getTodayStats, getExpiringSoon, listBranches } from "@/lib/playland/queries";
import { prisma } from "@/lib/prisma";
import { thbShort } from "@/lib/playland/format";
import { MonitorTickClient } from "@/components/playland/monitor-tick-client";
import { NavSelect } from "@/components/playland/nav-select";
import { UserRound, Clock, ShoppingBag, Tv, BarChart3, Package, Users, Smile } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "หน้าหลัก · Play a lot" };

function greetingByHour(h: number): string {
  if (h < 11) return "สวัสดีตอนเช้า";
  if (h < 15) return "สวัสดีตอนบ่าย";
  if (h < 18) return "สวัสดีตอนเย็น";
  return "สวัสดีตอนค่ำ";
}

export default async function PlaylandHome({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const cashier = session.user.name || session.user.email || "พนักงาน";
  const firstChar = cashier.trim().charAt(0) || "?";

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;

  // ยังไม่มีสาขา → onboarding
  if (!branchId) {
    return (
      <div className="pl-page">
        <div className="pl-home-top">
          <span className="pl-logo-text" style={{ fontSize: "1.5rem" }}>Play <span className="pl-logo-a">a</span> lot</span>
        </div>
        <div style={{ display: "grid", placeItems: "center", padding: 48 }}>
          <div className="pl-card pl-card-accent" style={{ maxWidth: 560 }}>
            <div className="pl-empty-icon" style={{ marginBottom: 12 }}><Smile size={28} /></div>
            <div className="pl-empty-title" style={{ marginBottom: 6 }}>ยังไม่มีสาขา</div>
            <div className="pl-empty-message" style={{ marginBottom: 16 }}>สร้างสาขาแรกก่อน จากนั้นจะตั้ง package · device · สินค้า POS ได้</div>
            <Link href="/playland/settings/branches" className="pl-btn pl-btn-primary pl-btn-lg">ไปสร้างสาขาแรก →</Link>
          </div>
        </div>
      </div>
    );
  }

  const branch = branches.find((b) => b.id === branchId)!;
  const qs = `?branch=${branchId}`;
  const [stats, expiring, openShift] = await Promise.all([
    getTodayStats(orgId, branchId),
    getExpiringSoon(orgId, 10, branchId),
    prisma.playlandShift.findFirst({
      where: { orgId, branchId, cashierUserId: session.user.id, status: "OPEN" },
      select: { id: true },
    }),
  ]);
  const nearCount = expiring.length;
  const greeting = greetingByHour(new Date().getHours());

  return (
    <div className="pl-page">
      <MonitorTickClient />

      {/* Top bar */}
      <div className="pl-home-top">
        <span className="pl-logo-text" style={{ fontSize: "1.5rem" }}>Play <span className="pl-logo-a">a</span> lot</span>
        <Link href={`/playland/shifts${qs}`} className={`pl-shift-pill${openShift ? " is-open" : ""}`}>
          {openShift ? <><span className="pl-shift-dot" /> กะเปิดอยู่</> : "เปิดกะ"}
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {branches.length > 1 && (
            <NavSelect param="branch" value={branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 150 }} />
          )}
          {openShift && <Link href={`/playland/shifts${qs}`} className="pl-home-chip">ปิดกะ</Link>}
          <span className="pl-home-avatar" title={cashier}>{firstChar}</span>
        </div>
      </div>

      {/* Content */}
      <div className="pl-home">
        <div>
          <div className="pl-home-greet">{greeting} {cashier} <span aria-hidden>👋</span></div>
          <div className="pl-home-kpi">
            มีเด็กเล่นอยู่ <b style={{ color: "var(--pl-blue)" }}>{stats.activeSessions}</b> คน · รายได้ <b style={{ color: "var(--pl-ok)" }}>{thbShort(stats.totalRevenueCents)}</b>
            <span style={{ color: "var(--pl-text-faint)", fontWeight: 400 }}> · {branch.name}</span>
          </div>
        </div>

        <div className="pl-home-tiles">
          {/* 1 · รับเด็กเข้าเล่น (blue) */}
          <Link href={`/playland/checkin${qs}`} className="pl-home-tile pl-home-tile--blue">
            <div className="pl-home-tile-ico"><UserRound size={26} /></div>
            <div className="pl-home-tile-text">
              <div className="pl-home-tile-title">รับเด็กเข้าเล่น</div>
              <div className="pl-home-tile-sub">ลงทะเบียน · เลือกแพ็กเกจ</div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pl-home-tile-mascot" src="/playland/brand/mascot-skye.png" alt="" />
          </Link>

          {/* 2 · เด็กที่กำลังเล่น (red) */}
          <Link href={`/playland/board${qs}`} className="pl-home-tile pl-home-tile--red">
            <div className="pl-home-tile-ico"><Clock size={26} /></div>
            {nearCount > 0 && <span className="pl-home-tile-badge">{nearCount} ใกล้หมดเวลา</span>}
            <div className="pl-home-tile-text">
              <div className="pl-home-tile-title">เด็กที่กำลังเล่น</div>
              <div className="pl-home-tile-sub">ต่อเวลา · เพิ่มขนม · เช็คเอาท์</div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pl-home-tile-mascot" src="/playland/brand/mascot-rocky.png" alt="" />
          </Link>

          {/* 3 · ขายขนม (yellow) */}
          <Link href={`/playland/pos${qs}`} className="pl-home-tile pl-home-tile--yellow">
            <div className="pl-home-tile-ico"><ShoppingBag size={26} /></div>
            <div className="pl-home-tile-text">
              <div className="pl-home-tile-title">ขายขนม · เครื่องดื่ม</div>
              <div className="pl-home-tile-sub">POS · คิดเงิน</div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pl-home-tile-mascot" src="/playland/brand/mascot-sunny.png" alt="" />
          </Link>

          {/* 4 · จอ Monitor (dark) */}
          <Link href={`/playland/monitor?tv=1&branch=${branchId}`} className="pl-home-tile pl-home-tile--dark">
            <div className="pl-home-tile-ico"><Tv size={26} /></div>
            <div className="pl-home-tile-text">
              <div className="pl-home-tile-title">จอ Monitor (TV)</div>
              <div className="pl-home-tile-sub">โชว์เวลาให้ทั้งร้านเห็น</div>
            </div>
          </Link>
        </div>

        <div className="pl-home-foot">
          <Link href={`/playland/office`} className="pl-home-foot-btn"><BarChart3 size={16} /> Dashboard</Link>
          <Link href={`/playland/settings/packages`} className="pl-home-foot-btn"><Package size={16} /> แพ็กเกจ &amp; สต๊อก</Link>
          <Link href={`/playland/settings`} className="pl-home-foot-btn"><Users size={16} /> พนักงาน &amp; สิทธิ์</Link>
        </div>
      </div>
    </div>
  );
}
