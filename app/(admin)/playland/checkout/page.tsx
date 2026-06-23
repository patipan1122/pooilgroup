// Playland · เช็คเอาท์ (Checkout) — คอลัมน์เดียว ใบเสร็จ (ตามต้นแบบ §4)
// เลือกเด็กจากกระดาน (?selected) → ใบเสร็จ + ปุ่มชำระ + ปิดรอบ → จอขอบคุณ
// reuse checkOutSession เดิม (ระบบเก็บเงินตอนเช็คอิน → ปุ่ม = ปิดรอบ)

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getActiveSessions, listBranches } from "@/lib/playland/queries";
import { fmtTime, fmtElapsed } from "@/lib/playland/format";
import { CheckoutPanel } from "@/components/playland/checkout-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "เช็คเอาท์ · Play a lot" };

const MASCOTS = ["sunny", "skye", "rocky"];
function mascotFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MASCOTS[h % MASCOTS.length];
}

export default async function PlaylandCheckout({ searchParams }: { searchParams: Promise<{ branch?: string; selected?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland");
  const qs = `?branch=${branchId}`;

  const sessions = await getActiveSessions(orgId, branchId);
  const selected = sp.selected ? sessions.find((s) => s.id === sp.selected) ?? null : null;

  return (
    <div className="pl-page" style={{ overflowY: "auto" }}>
      <div className="pl-subhead">
        <Link href={`/playland/board${qs}`} className="pl-back">‹ กลับกระดาน</Link>
        <span className="pl-subhead-div" />
        <span className="pl-subhead-title">เช็คเอาท์</span>
      </div>

      {selected ? (
        <CheckoutPanel
          sessionId={selected.id}
          name={selected.member.nickname ?? selected.member.name}
          mascot={mascotFor(selected.id)}
          packageName={selected.package?.name ?? "—"}
          packagePriceCents={selected.packagePriceCents}
          packageMinutes={selected.packageMinutes}
          expiresAt={selected.expiresAt ? selected.expiresAt.toISOString() : null}
        />
      ) : sessions.length === 0 ? (
        <div className="pl-empty" style={{ margin: "auto", maxWidth: 420 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/playland/brand/mascot-rocky.png" alt="" width={96} height={96} style={{ objectFit: "contain", marginBottom: 8 }} />
          <div className="pl-empty-title">ไม่มีใครในร้าน</div>
          <div className="pl-empty-message">ทุกคนเช็คเอาท์หมดแล้ว 🎉</div>
          <Link href={`/playland${qs}`} className="pl-btn pl-btn-primary pl-btn-lg" style={{ marginTop: 14 }}>กลับหน้าหลัก</Link>
        </div>
      ) : (
        <div className="pl-co" style={{ paddingTop: 8 }}>
          <div className="pl-co-pick-label">เลือกเด็กที่จะเช็คเอาท์</div>
          <div className="pl-co-pick">
            {sessions.map((s) => (
              <Link key={s.id} href={`/playland/checkout?branch=${branchId}&selected=${s.id}`} className="pl-co-pick-row">
                <div className="pl-co-ava" style={{ width: 44, height: 44 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/playland/brand/mascot-${mascotFor(s.id)}.png`} alt="" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pl-co-name" style={{ fontSize: "1.05rem" }}>{s.member.nickname ?? s.member.name}</div>
                  <div className="pl-co-sub">{s.package?.name ?? "—"} · เข้า {fmtTime(s.checkInAt)} ({fmtElapsed(s.checkInAt)})</div>
                </div>
                <span className="pl-back">เลือก ›</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
