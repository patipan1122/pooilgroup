// Playland · ระหว่างเล่น (Board) — ตามต้นแบบ §2
// กระดานเด็กที่กำลังเล่น · การ์ดมาสคอต + นาฬิกานับถอยหลัง + ปุ่ม +เวลา/+ขนม/เช็คเอาท์
// reuse getActiveSessions + action เดิม · เรียงคนใกล้หมดเวลาขึ้นก่อน

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, listPackages, listBranches } from "@/lib/playland/queries";
import { MonitorTickClient } from "@/components/playland/monitor-tick-client";
import { BoardCard, type BoardSession } from "@/components/playland/board-card";
import { NavSelect } from "@/components/playland/nav-select";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "เด็กที่กำลังเล่น · Play a lot" };

export default async function PlaylandBoard({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland");
  const qs = `?branch=${branchId}`;

  const [sessions, packages] = await Promise.all([
    getActiveSessions(orgId, branchId),
    listPackages(orgId, branchId),
  ]);
  const pkgs = packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes ?? 0 }));
  const now = Date.now();

  const sorted = [...sessions].sort((a, b) => {
    const ax = a.packageMinutes === 0 ? Infinity : a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const bx = b.packageMinutes === 0 ? Infinity : b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    return ax - bx;
  });
  const nearCount = sessions.filter(
    (s) => s.packageMinutes !== 0 && s.expiresAt && new Date(s.expiresAt).getTime() - now < 600_000,
  ).length;

  return (
    <div className="pl-page">
      <MonitorTickClient />
      <div className="pl-subhead">
        <Link href={`/playland${qs}`} className="pl-back">‹ หน้าหลัก</Link>
        <span className="pl-subhead-div" />
        <span className="pl-subhead-title">เด็กที่กำลังเล่น</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="pl-stat-chip">กำลังเล่น <b>{sessions.length}</b></span>
          <span className="pl-stat-chip is-red">ใกล้หมด <b>{nearCount}</b></span>
          {branches.length > 1 && (
            <NavSelect param="branch" value={branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 140 }} />
          )}
          <Link href={`/playland/checkin${qs}`} className="pl-btn pl-btn-primary">+ รับเด็กเข้า</Link>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="pl-empty" style={{ margin: "auto", maxWidth: 460 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/playland/brand/mascot-sunny.png" alt="" width={96} height={96} style={{ objectFit: "contain", marginBottom: 8 }} />
          <div className="pl-empty-title">ยังไม่มีใครเล่นตอนนี้</div>
          <div className="pl-empty-message">กด “รับเด็กเข้า” เพื่อรับเด็กคนแรกเข้าเล่น</div>
          <Link href={`/playland/checkin${qs}`} className="pl-btn pl-btn-primary pl-btn-lg" style={{ marginTop: 14 }}>
            <Plus size={16} /> รับเด็กเข้าเล่น
          </Link>
        </div>
      ) : (
        <div className="pl-board-grid">
          {sorted.map((s) => {
            const bs: BoardSession = {
              id: s.id,
              name: s.member.nickname ?? s.member.name,
              packageName: s.package?.name ?? "—",
              packageMinutes: s.packageMinutes,
              expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
            };
            return <BoardCard key={s.id} session={bs} packages={pkgs} branchId={branchId} />;
          })}
          <Link href={`/playland/checkin${qs}`} className="pl-board-add">
            <Plus size={26} />
            รับเด็กเข้าเล่น
          </Link>
        </div>
      )}
    </div>
  );
}
