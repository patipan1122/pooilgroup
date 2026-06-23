// Playland · จังหวะ 2 "ระหว่างเล่น" (Board)
//
// กระดานเด็กที่กำลังเล่น — การ์ดมาสคอต + นาฬิกานับถอยหลังตัวใหญ่ + ปุ่ม +เวลา/+ขนม/เช็คเอาท์
// reuse getActiveSessions + action เดิม (ไม่แตะ logic เงิน) · จัดเรียงคนใกล้หมดเวลาขึ้นก่อน

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, getTodayStats, listPackages, listBranches } from "@/lib/playland/queries";
import { fmtTime, memberTypeLabel, thbShort } from "@/lib/playland/format";
import { RhythmNav } from "@/components/playland/rhythm-nav";
import { PlaylandModeSwitch } from "@/components/playland/mode-switch";
import { BoardCard, type BoardSession } from "@/components/playland/board-card";
import { NavSelect } from "@/components/playland/nav-select";
import { Sparkles, Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "ระหว่างเล่น · Playland" };

export default async function PlaylandBoard({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland"); // ยังไม่มีสาขา → ไป onboarding ที่หน้าหลัก

  const branch = branches.find((b) => b.id === branchId)!;
  const [sessions, stats, packages] = await Promise.all([
    getActiveSessions(orgId, branchId),
    getTodayStats(orgId, branchId),
    listPackages(orgId, branchId),
  ]);

  const pkgs = packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes ?? 0 }));
  const now = Date.now();

  // เรียง: ใกล้หมดเวลาขึ้นก่อน (ไม่จำกัด/ยังเหลือเยอะ ลงท้าย)
  const sorted = [...sessions].sort((a, b) => {
    const ax = a.packageMinutes === 0 ? Infinity : a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const bx = b.packageMinutes === 0 ? Infinity : b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    return ax - bx;
  });
  const expiringCount = sessions.filter(
    (s) => s.packageMinutes !== 0 && s.expiresAt && new Date(s.expiresAt).getTime() - now < 600_000,
  ).length;

  return (
    <div className="pl-page" style={{ overflowY: "auto" }}>
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">
            <Sparkles size={11} />
            <span className="pl-logo-text" style={{ fontSize: "1rem" }}>
              Play <span className="pl-logo-a">a</span> lot
            </span>
            · {branch.name}
          </div>
          <h1>
            ระหว่างเล่น
            <span style={{ marginLeft: 12, fontSize: 13, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)", fontWeight: 400 }}>
              {sessions.length} คนกำลังเล่น
              {expiringCount > 0 && <> · {expiringCount} ใกล้หมดเวลา</>}
              {" · "}{thbShort(stats.totalRevenueCents)} วันนี้
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <RhythmNav branchId={branchId} />
          {branches.length > 1 && (
            <NavSelect param="branch" value={branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 160 }} />
          )}
          <PlaylandModeSwitch />
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className="pl-empty" style={{ margin: "auto", maxWidth: 460 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/playland/brand/mascot-sunny.png" alt="" width={96} height={96} style={{ objectFit: "contain", marginBottom: 8 }} />
          <div className="pl-empty-title">ยังไม่มีใครเล่นตอนนี้</div>
          <div className="pl-empty-message">กด “เริ่มเช็คอิน” เพื่อรับเด็กคนแรกเข้าเล่น</div>
          <Link href={`/playland?branch=${branchId}`} className="pl-btn pl-btn-primary pl-btn-lg" style={{ marginTop: 14 }}>
            <Plus size={16} /> เริ่มเช็คอิน
          </Link>
        </div>
      ) : (
        <div className="pl-board-grid">
          {sorted.map((s) => {
            const bs: BoardSession = {
              id: s.id,
              name: s.member.nickname ?? s.member.name,
              typeLabel: memberTypeLabel(s.member.type),
              packageName: s.package?.name ?? "—",
              packageMinutes: s.packageMinutes,
              expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
              checkedInLabel: fmtTime(s.checkInAt),
            };
            return <BoardCard key={s.id} session={bs} packages={pkgs} branchId={branchId} />;
          })}
          <Link href={`/playland?branch=${branchId}`} className="pl-board-add">
            <Plus size={26} />
            เริ่มเช็คอิน
          </Link>
        </div>
      )}
    </div>
  );
}
