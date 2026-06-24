import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import {
  getPrimaryProject,
  listUnitsWithState,
  projectKpis,
  billingCycle,
  expiringContracts,
} from "@/lib/rentspace/data";
import { formatBaht, tenantDisplayName, toNum, periodLabel } from "@/lib/rentspace/format";
import { PlanWithDrawer } from "@/components/rentspace/plan-with-drawer";
import { CycleCta } from "./_components/cycle-cta";

export const dynamic = "force-dynamic";

function Step({
  n,
  title,
  sub,
  state,
  subDanger,
  first,
  last,
}: {
  n: number;
  title: string;
  sub: string;
  state: "done" | "active" | "todo";
  subDanger?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const done = state === "done";
  const active = state === "active";
  const blue = "#2563EB";
  return (
    <div className="flex-1 flex flex-col items-center text-center min-w-0">
      <div className="flex items-center w-full justify-center mb-2.5 sm:mb-3">
        <div className="flex-1 h-0.5" style={{ background: first ? "transparent" : done || active ? blue : "#E8EBEF" }} />
        <div
          className="w-[32px] h-[32px] sm:w-[38px] sm:h-[38px] rounded-full shrink-0 flex items-center justify-center font-bold text-[13px] sm:text-sm"
          style={{
            background: done ? blue : active ? "#EEF3FE" : "#F1F3F6",
            color: done ? "#fff" : active ? blue : "#A7AEB9",
            border: `2px solid ${done ? blue : active ? blue : "#E3E7ED"}`,
          }}
        >
          {done ? "✓" : n}
        </div>
        <div className="flex-1 h-0.5" style={{ background: last ? "transparent" : done ? blue : "#E8EBEF" }} />
      </div>
      <div className="font-semibold text-[13px] sm:text-sm leading-tight" style={{ color: done || active ? "#1F2733" : "#A7AEB9" }}>{title}</div>
      <div className="text-[11px] sm:text-xs mt-0.5 leading-tight px-0.5" style={{ color: subDanger ? "#C0322B" : active ? blue : "#9098A4", fontWeight: subDanger || active ? 600 : 400 }}>{sub}</div>
    </div>
  );
}

export default async function RentSpaceOverview() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <div className="px-4 py-10 sm:px-8 max-w-3xl mx-auto text-center">
        <div className="text-5xl mb-3">🏬</div>
        <h1 className="text-2xl font-bold" style={{ color: "#1F2733" }}>ยังไม่มีโครงการ</h1>
        <p className="text-sm mt-1 mb-5" style={{ color: "#7A828F" }}>สร้างโครงการแรก แล้วเพิ่มห้อง · ผู้เช่า · สัญญา · ออกบิลอัตโนมัติ</p>
        <Link href="/rentspace/settings" className="inline-flex rounded-xl bg-[#2563EB] px-6 py-3 text-white font-semibold">ตั้งค่าโครงการ</Link>
      </div>
    );
  }

  const [kpi, cycle, units, expiring] = await Promise.all([
    projectKpis(orgId, project.id),
    billingCycle(orgId, project.id),
    listUnitsWithState(orgId, project.id),
    expiringContracts(orgId, project.id),
  ]);

  const mapUnits = units.map((u) => ({
    id: u.id,
    code: u.code,
    name: u.name,
    building: u.building,
    status: u.status as string,
    baseRentThb: toNum(u.baseRentThb),
    tenantName: u.tenant ? tenantDisplayName(u.tenant) : null,
    outstanding: u.outstanding,
    hasOverdue: u.hasOverdue,
    endDate: u.contract?.endDate ? new Date(u.contract.endDate).toISOString() : null,
    mapX: u.mapX != null ? toNum(u.mapX) : null,
    mapY: u.mapY != null ? toNum(u.mapY) : null,
    mapW: u.mapW != null ? toNum(u.mapW) : null,
    mapH: u.mapH != null ? toNum(u.mapH) : null,
  }));

  const attention = units
    .filter((u) => u.hasOverdue || u.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 6);

  const occupancyPct = kpi.units > 0 ? Math.round((kpi.occupied / kpi.units) * 100) : 0;

  // billing-cycle states
  const { total, metersDone, billsDone, paidCount } = cycle;
  const metersComplete = total > 0 && metersDone === total;
  const billsComplete = total > 0 && billsDone === total;
  const payComplete = total > 0 && paidCount === total;

  const cta = !billsComplete
    ? { mode: "bill" as const, title: "ยังไม่ออกบิลงวดนี้", hint: `${total - billsDone} ห้องรอออกบิล${metersDone < total ? ` · ${total - metersDone} ห้องยังไม่จดมิเตอร์` : ""}`, label: "ออกบิลทั้งโครงการ" }
    : !payComplete
    ? { mode: "pay" as const, title: "ออกบิลครบแล้ว · รอรับชำระ", hint: `${total - paidCount} ห้องยังไม่ชำระ`, label: "ไปหน้ารับชำระ" }
    : { mode: "done" as const, title: "รอบบิลเดือนนี้เสร็จสมบูรณ์", hint: "เก็บครบทุกห้องแล้ว", label: "รอบบิลเสร็จแล้ว" };

  const kpis = [
    { label: "ห้องที่ถูกเช่า", value: `${kpi.occupied}/${kpi.units}`, sub: `เข้าใช้ ${occupancyPct}% · ว่าง ${kpi.vacant}`, color: "#1F2733", icon: <path d="M4 21V8l8-5 8 5v13" /> , stroke: "#2563EB" },
    { label: "ค้างชำระรวม", value: formatBaht(kpi.outstanding), sub: kpi.overdueCount > 0 ? `${kpi.overdueCount} ห้องค้างจ่าย` : "ไม่มีค้างชำระ", color: kpi.outstanding > 0 ? "#C0322B" : "#15803D", icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, stroke: "#DC2626" },
    { label: "ออกบิลเดือนนี้", value: formatBaht(kpi.billedThisMonth), sub: `${billsDone}/${total} ห้อง${billsDone === 0 ? " · ยังไม่ออก" : ""}`, color: "#1F2733", icon: <path d="M6 2h9l3 3v17l-2.2-1.4L13.6 22l-2.3-1.4L9 22l-2.3-1.4L4 22V4a2 2 0 012-2z" />, stroke: "#E08A00" },
    { label: "เก็บได้เดือนนี้", value: formatBaht(kpi.collectedThisMonth), sub: `${paidCount} รายการ`, color: "#15803D", icon: <path d="M20 6L9 17l-5-5" />, stroke: "#16A34A" },
  ];

  return (
    <div className="px-4 py-4 sm:px-8 sm:py-8 max-w-[1180px] mx-auto" style={{ color: "#0F1729" }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{project.name}</h1>
          <p className="text-[13px] sm:text-sm mt-0.5" style={{ color: "#7A828F" }}>ภาพรวมโครงการ · งวด {periodLabel(kpi.period)}</p>
        </div>
        <Link href="/rentspace/contracts" className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-3.5 py-2.5 min-h-[44px] text-[13px] sm:text-sm font-semibold text-white shrink-0" style={{ boxShadow: "0 1px 2px rgba(37,99,235,.25)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>ทำสัญญาใหม่
        </Link>
      </div>

      {/* near-expiry contract alert (adopted from Horganice) */}
      {expiring.length > 0 && (
        <Link href="/rentspace/contracts" className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-4" style={{ background: "#FFF8E6", border: "1px solid #F3E0A6" }}>
          <span className="w-[34px] h-[34px] rounded-lg shrink-0 flex items-center justify-center text-base" style={{ background: "#FCEFC6" }}>⏳</span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[13.5px]" style={{ color: "#7A5B00" }}>มีห้องใกล้หมดสัญญาเช่า {expiring.length} ห้อง</span>
            <span className="block text-xs truncate" style={{ color: "#9A7B1F" }}>{expiring.slice(0, 5).map((c) => c.unit.code).join(" · ")}{expiring.length > 5 ? " · …" : ""} — กดต่อสัญญาก่อนหมดอายุ</span>
          </span>
          <span className="text-[11.5px] font-semibold self-center shrink-0" style={{ color: "#B45309" }}>ดูสัญญา</span>
        </Link>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
        {kpis.map((k, i) => (
          <div key={i} className="rounded-2xl bg-white p-4" style={{ border: "1px solid #E9EBEF", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
            <div className="flex items-center gap-2 text-[12.5px] mb-2" style={{ color: "#7A828F" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={k.stroke} strokeWidth="1.8">{k.icon}</svg>{k.label}
            </div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs mt-0.5" style={{ color: "#9098A4" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* billing cycle */}
      <div className="rounded-2xl bg-white p-4 sm:p-5 mb-4" style={{ border: "1px solid #E9EBEF", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center shrink-0" style={{ background: "#EEF3FE" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.8"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[14.5px] sm:text-[15.5px] truncate">รอบบิลเดือนนี้ · {periodLabel(kpi.period)}</div>
              <div className="text-[12px] sm:text-[12.5px]" style={{ color: "#8A929E" }}>ทำตามขั้นตอนให้ครบ ระบบจะกันไม่ให้ลืมวางบิล</div>
            </div>
          </div>
          <div className="text-[12.5px] hidden sm:block shrink-0" style={{ color: "#8A929E" }}>ตัดรอบทุกวันที่ 1 ของเดือน</div>
        </div>

        {total === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: "#8A929E" }}>
            ยังไม่มีสัญญาที่ใช้งาน — <Link href="/rentspace/contracts" className="font-semibold" style={{ color: "#2563EB" }}>ทำสัญญาใหม่</Link> เพื่อเริ่มรอบบิล
          </div>
        ) : (
          <>
            <div className="flex items-stretch">
              <Step n={1} title="จดมิเตอร์" state={metersComplete ? "done" : "active"} sub={metersDone < total ? `${total - metersDone} ห้องยังไม่จด` : `ครบ ${metersDone} ห้อง`} first />
              <Step n={2} title="ออกบิล" state={billsComplete ? "done" : "active"} sub={billsComplete ? `ออกครบ ${billsDone} ใบ` : billsDone > 0 ? `${billsDone}/${total} ห้อง` : "ยังไม่ออกบิล!"} subDanger={!billsComplete && billsDone === 0} />
              <Step n={3} title="รับชำระ" state={payComplete ? "done" : billsComplete ? "active" : "todo"} sub={`${paidCount}/${total} ห้อง`} last />
            </div>
            <CycleCta mode={cta.mode} projectId={project.id} period={kpi.period} title={cta.title} hint={cta.hint} label={cta.label} />
          </>
        )}
      </div>

      {/* quick links */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { href: "/rentspace/matrix", label: "📊 ตารางค่าเช่า (Excel)" },
          { href: "/rentspace/analytics", label: "📈 วิเคราะห์รายได้" },
          { href: "/rentspace/collections", label: "🔴 ตามเก็บ (ค้างชำระ)" },
          { href: "/rentspace/meters", label: "จดมิเตอร์" },
          { href: "/rentspace/bills", label: "บิล / ใบแจ้งหนี้" },
          { href: "/rentspace/payments", label: "รับชำระ / ส่วนลด" },
          { href: "/rentspace/tenants", label: "ผู้เช่า" },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="inline-flex items-center rounded-full px-4 min-h-[44px] sm:min-h-0 sm:py-1.5 text-[12.5px] font-medium" style={{ background: "#fff", border: "1px solid #E6E9F1", color: "#475569" }}>{q.label}</Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
        {/* plan (keep SiteMap3D) */}
        <div className="rounded-2xl bg-white overflow-hidden" style={{ border: "1px solid #E9EBEF", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
          <div className="px-5 pt-4 pb-1">
            <div className="font-semibold text-[15.5px]">ผังโครงการ</div>
            <div className="text-[12px]" style={{ color: "#9098A4" }}>คลิกห้องเพื่อดูข้อมูล · สลับ 2D / 3D · หมุน + ซูมได้</div>
          </div>
          <PlanWithDrawer units={mapUnits} view3dEnabled={project.view3dEnabled} canEdit={isSuperAdmin(session.user.role)} />
        </div>

        {/* attention */}
        <div className="rounded-2xl bg-white p-5" style={{ border: "1px solid #E9EBEF", boxShadow: "0 1px 2px rgba(16,23,41,.04)" }}>
          <div className="flex items-center gap-2 mb-1">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#E08A00" strokeWidth="1.9"><path d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
            <div className="font-semibold text-[15px]">ต้องติดตาม</div>
            <span className="ml-auto text-[11.5px] font-semibold px-2 py-0.5 rounded-md" style={{ background: "#FDECEC", color: "#C0322B" }}>{attention.length + (!billsComplete && total > 0 ? 1 : 0)}</span>
          </div>
          <p className="text-xs mb-3.5" style={{ color: "#9098A4" }}>เรียงตามความเร่งด่วน</p>
          <div className="flex flex-col gap-2.5">
            {!billsComplete && total > 0 && (
              <Link href="/rentspace/bills" className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: "#FFF8F8", border: "1px solid #F6D9D9" }}>
                <span className="w-[30px] h-[30px] rounded-lg shrink-0 flex items-center justify-center text-sm" style={{ background: "#FDECEC" }}>🧾</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[13px]" style={{ color: "#1F2733" }}>ยังไม่ออกบิลงวดนี้</span>
                  <span className="block text-xs" style={{ color: "#C0322B" }}>{total - billsDone} ห้องรอออกบิล</span>
                </span>
                <span className="text-[11.5px] font-semibold self-center" style={{ color: "#2563EB" }}>วางบิล</span>
              </Link>
            )}
            {attention.map((u) => (
              <Link key={u.id} href={`/rentspace/units/${u.id}`} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: "#fff", border: "1px solid #ECEEF1" }}>
                <span className="w-[30px] h-[30px] rounded-lg shrink-0 flex items-center justify-center text-sm" style={{ background: "#FDECEC" }}>⏰</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[13px] truncate" style={{ color: "#1F2733" }}>{u.code} ค้างจ่าย {formatBaht(u.outstanding)}</span>
                  <span className="block text-xs truncate" style={{ color: "#9098A4" }}>{u.tenant ? tenantDisplayName(u.tenant) : "ว่าง"}</span>
                </span>
                <span className="text-[11.5px] font-semibold self-center" style={{ color: "#2563EB" }}>ตามเก็บ</span>
              </Link>
            ))}
            {attention.length === 0 && billsComplete && (
              <div className="text-center py-6 text-sm" style={{ color: "#A7AEB9" }}>ไม่มีห้องค้างชำระ 🎉</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
