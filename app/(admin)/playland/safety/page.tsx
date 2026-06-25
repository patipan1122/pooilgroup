// Playland · ตรวจความปลอดภัย + ทำความสะอาดรายวัน — หลังบ้าน (AdminShell · พื้นขาว · LOCKED tokens)
// กรมอนามัย/ประกันต้องการ log ก่อนเปิด-ปิดร้านทุกวัน → เก็บไว้เคลม/กันคดีประมาท
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { CareDeleteButton } from "@/components/playland/care-delete-button";
import { ShieldCheck, CheckCircle2, XCircle, Clock } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "ตรวจความปลอดภัย · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

type Item = { label: string; ok: boolean; note?: string };
const parseItems = (j: unknown): Item[] =>
  Array.isArray(j) ? (j as unknown[]).filter((x): x is Item => !!x && typeof x === "object" && "label" in x) : [];

const typeLabel = (t: string) => (t === "cleaning" ? "🧼 ทำความสะอาด" : "🛡️ ความปลอดภัย");

export default async function SafetyPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role)); // ดูอย่างเดียว · ผู้จัดการเท่านั้น (ตรวจ+บันทึกย้ายไปหน้าร้าน)
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId;
  if (!branchId) redirect("/playland/settings/branches");

  const checks = await prisma.playlandSafetyCheck.findMany({
    where: { orgId, branchId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, checkType: true, shiftLabel: true, allPass: true, itemsJson: true, note: true, createdAt: true },
  });

  // KPI — ตรวจวันนี้แล้วยัง? + ผ่าน/ไม่ผ่านล่าสุด + ครั้งล่าสุดเมื่อไหร่
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const checkedToday = checks.filter((c) => new Date(c.createdAt) >= todayStart).length;
  const latest = checks[0] ?? null;
  const latestFails = latest ? parseItems(latest.itemsJson).filter((i) => !i.ok).length : 0;
  const fmtAgo = (d: Date) => {
    const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 1) return "เมื่อกี้";
    if (mins < 60) return `${mins} นาทีก่อน`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ชม.ก่อน`;
    return new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
  };

  const kpis = [
    {
      label: "ตรวจวันนี้แล้ว?",
      value: checkedToday > 0 ? "✓ ตรวจแล้ว" : "ยังไม่ตรวจ",
      sub: checkedToday > 0 ? `วันนี้ ${checkedToday} ครั้ง` : "ตรวจก่อนเปิดร้าน",
      icon: <ShieldCheck size={16} color={checkedToday > 0 ? GREEN : RED} />,
      valColor: checkedToday > 0 ? GREEN : RED,
    },
    {
      label: "ผลตรวจล่าสุด",
      value: !latest ? "—" : latest.allPass ? "ผ่าน" : `พบ ${latestFails} จุด`,
      sub: latest ? typeLabel(latest.checkType) + (latest.shiftLabel ? ` · ${latest.shiftLabel}` : "") : "ยังไม่มีการตรวจ",
      icon: !latest ? <Clock size={16} color={MUTED} /> : latest.allPass ? <CheckCircle2 size={16} color={GREEN} /> : <XCircle size={16} color={RED} />,
      valColor: !latest ? MUTED : latest.allPass ? GREEN : RED,
    },
    {
      label: "ครั้งล่าสุดเมื่อ",
      value: latest ? fmtAgo(latest.createdAt) : "—",
      sub: latest ? new Date(latest.createdAt).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "ยังไม่เริ่มบันทึก",
      icon: <Clock size={16} color={BLUE} />,
      valColor: INK,
    },
  ];

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={19} /> ตรวจความปลอดภัย · ทำความสะอาด</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>เช็กก่อนเปิด-ปิดร้านทุกวัน · บันทึกไว้เคลมประกัน/กันคดีประมาท</div>
        </div>
        <div style={{ marginLeft: "auto" }}><BranchSwitcher branches={branches} activeId={activeId} /></div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        {/* KPI row */}
        <div className="pl-kpi-row" style={{ marginBottom: 18 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ ...card, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED, marginBottom: 8 }}>{k.icon} {k.label}</div>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24, color: k.valColor }}>{k.value}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ดูอย่างเดียว — ประวัติการตรวจเต็มกว้าง (ตรวจ+บันทึกย้ายไปหน้าร้าน) */}
        <section style={{ ...card, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "0 0 14px" }}>
            <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: 0 }}>ประวัติการตรวจล่าสุด</h2>
            <span style={{ fontSize: 12, color: MUTED }}>ดูอย่างเดียว · บันทึกที่หน้าร้าน</span>
          </div>
          {checks.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีการตรวจ · เริ่มเช็กรายการแรกก่อนเปิดร้าน</div>
          ) : (
            <div style={{ border: `1px solid #f2ebdd`, borderRadius: 12, overflow: "hidden" }}>
              {checks.map((c) => {
                const fails = parseItems(c.itemsJson).filter((i) => !i.ok);
                return (
                  <div key={c.id} style={{ padding: "14px 16px", borderBottom: "1px solid #f2ebdd" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{typeLabel(c.checkType)}{c.shiftLabel ? <span style={{ color: MUTED, fontSize: 13 }}> · {c.shiftLabel}</span> : null}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 999, color: "#fff", background: c.allPass ? GREEN : RED }}>
                        {c.allPass ? "ผ่าน" : `พบปัญหา ${fails.length} จุด`}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: "#a89c8b" }}>{new Date(c.createdAt).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                      <CareDeleteButton kind="safety" id={c.id} />
                    </div>
                    {fails.length > 0 && (
                      <div style={{ fontSize: 13, color: "#c0392b", marginTop: 6 }}>
                        {fails.map((f, i) => (
                          <div key={i} style={{ marginTop: 2 }}>✗ {f.label}{f.note ? ` — ${f.note}` : ""}</div>
                        ))}
                      </div>
                    )}
                    {c.note && <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>หมายเหตุ: {c.note}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
