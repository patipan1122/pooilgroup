// Playland · จังหวะ 3 "เช็คเอาท์" (Checkout)
//
// 2-pane: ซ้าย=รายชื่อเด็กที่กำลังเล่น (เลือก) · ขวา=สรุปยอด + ปุ่มปิดรอบ + จอขอบคุณ
// reuse getActiveSessions + checkOutSession (ไม่เก็บเงินซ้ำ · ชำระแล้วตอนเช็คอิน)

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, listBranches } from "@/lib/playland/queries";
import { fmtTime, fmtElapsed, memberTypeLabel } from "@/lib/playland/format";
import { RhythmNav } from "@/components/playland/rhythm-nav";
import { PlaylandModeSwitch } from "@/components/playland/mode-switch";
import { CheckoutPanel } from "@/components/playland/checkout-panel";
import { NavSelect } from "@/components/playland/nav-select";
import { Sparkles, LogOut } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "เช็คเอาท์ · Playland" };

export default async function PlaylandCheckout({ searchParams }: { searchParams: Promise<{ branch?: string; selected?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland");

  const branch = branches.find((b) => b.id === branchId)!;
  const sessions = await getActiveSessions(orgId, branchId);

  const selectedId = sp.selected;
  const selected = selectedId ? sessions.find((s) => s.id === selectedId) ?? null : null;

  return (
    <div className="pl-page">
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
            เช็คเอาท์
            <span style={{ marginLeft: 12, fontSize: 13, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)", fontWeight: 400 }}>
              เลือกเด็กที่จะปิดรอบ · {sessions.length} คนในร้าน
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

      <div className="pl-two-pane">
        {/* ซ้าย — รายชื่อเด็กในร้าน */}
        <aside className="pl-pane">
          <div className="pl-pane-head">
            <div>
              <div className="pl-pane-title">ในร้านตอนนี้</div>
              <div className="pl-pane-count">{sessions.length} คน</div>
            </div>
          </div>
          {sessions.length === 0 ? (
            <div className="pl-empty">
              <div className="pl-empty-title">ไม่มีใครในร้าน</div>
              <div className="pl-empty-message">ทุกคนเช็คเอาท์หมดแล้ว 🎉</div>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sessions.map((s) => {
                const isSel = selectedId === s.id;
                const href = `/playland/checkout?branch=${branchId}&selected=${s.id}`;
                return (
                  <li key={s.id}>
                    <Link href={href} className={`pl-session-row${isSel ? " is-selected" : ""}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div className="pl-session-top">
                        <span className="pl-session-name">{s.member.nickname ?? s.member.name}</span>
                      </div>
                      <div className="pl-session-meta">
                        {memberTypeLabel(s.member.type).toLowerCase()} · {s.package?.name ?? "—"} · เข้า {fmtTime(s.checkInAt)} ({fmtElapsed(s.checkInAt)})
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ขวา — สรุปยอด + ปิดรอบ */}
        <main className="pl-pane" style={{ display: "grid", placeItems: "center", padding: 24 }}>
          {selected ? (
            <CheckoutPanel
              sessionId={selected.id}
              name={selected.member.nickname ?? selected.member.name}
              typeLabel={memberTypeLabel(selected.member.type)}
              packageName={selected.package?.name ?? "—"}
              packagePriceCents={selected.packagePriceCents}
              checkInLabel={fmtTime(selected.checkInAt)}
              usedLabel={fmtElapsed(selected.checkInAt)}
            />
          ) : (
            <div className="pl-empty" style={{ maxWidth: 380 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/playland/brand/mascot-rocky.png" alt="" width={96} height={96} style={{ objectFit: "contain", marginBottom: 8 }} />
              <div className="pl-empty-icon" style={{ display: "none" }}><LogOut size={22} /></div>
              <div className="pl-empty-title">เลือกเด็กที่จะเช็คเอาท์</div>
              <div className="pl-empty-message">กดชื่อเด็กทางซ้าย เพื่อดูยอดและปิดรอบ</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
