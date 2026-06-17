// ClawHub (JOLLY PLAY) — monthly figures. Points issued / redeemed / expired,
// refund counts by status, and top machines/branches by refund count. Plain tables.
// Month is chosen via ?month=YYYY-MM (defaults to current month).

import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { PageHeader } from "../_components/ui";
import { fmtNum } from "../_lib";

export const dynamic = "force-dynamic";

function monthRange(monthParam: string | undefined): {
  start: Date;
  end: Date;
  value: string;
  label: string;
} {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-based
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [yy, mm] = monthParam.split("-").map(Number);
    y = yy;
    m = mm - 1;
  }
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  const value = `${y}-${String(m + 1).padStart(2, "0")}`;
  const label = start.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  return { start, end, value, label };
}

export default async function ClawhubReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await clawhubOrgId();
  const { start, end, value, label } = monthRange(sp.month);

  const inMonth = { gte: start, lt: end };

  const [
    earned,
    redeemed,
    expired,
    refundStatusGroups,
    topMachinesRaw,
  ] = await Promise.all([
    // Points issued from refunds (EARN_REFUND deltas, positive).
    prisma.clawhubPointEntry.aggregate({
      where: { orgId, kind: "EARN_REFUND", createdAt: inMonth },
      _sum: { delta: true },
    }),
    // Points redeemed (REDEEM deltas are negative → take abs).
    prisma.clawhubPointEntry.aggregate({
      where: { orgId, kind: "REDEEM", createdAt: inMonth },
      _sum: { delta: true },
    }),
    // Points expired (EXPIRE deltas negative → abs).
    prisma.clawhubPointEntry.aggregate({
      where: { orgId, kind: "EXPIRE", createdAt: inMonth },
      _sum: { delta: true },
    }),
    // Refund counts by status this month.
    prisma.clawhubRefundRequest.groupBy({
      by: ["status"],
      where: { orgId, createdAt: inMonth },
      _count: { _all: true },
    }),
    // Top machines by refund count this month.
    prisma.clawhubRefundRequest.groupBy({
      by: ["machineCode"],
      where: { orgId, createdAt: inMonth, machineCode: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { machineCode: "desc" } },
      take: 10,
    }),
  ]);

  const pointsIssued = earned._sum.delta ?? 0;
  const pointsRedeemed = Math.abs(redeemed._sum.delta ?? 0);
  const pointsExpired = Math.abs(expired._sum.delta ?? 0);

  const statusMap = new Map(refundStatusGroups.map((g) => [g.status, g._count._all]));
  const refundTotal = refundStatusGroups.reduce((s, g) => s + g._count._all, 0);

  // Month picker — last 12 months.
  const monthOptions = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const l = d.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
    return { v, l };
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="รายงาน"
        accent={label}
        subtitle="แต้มออก/ใช้/หมดอายุ · คำขอคืนแยกสถานะ · ตู้ที่คืนบ่อย"
        right={
          <form action="/clawhub/reports" method="get">
            <select
              name="month"
              defaultValue={value}
              className="rounded-full border px-4 py-2 text-sm"
              style={{ borderColor: "var(--cw-border)", background: "var(--cw-surface)" }}
              // submit on change via inline JS-free approach: wrap in button
            >
              {monthOptions.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
            <button type="submit" className="cw-btn cw-btn-ghost ml-2">
              ดู
            </button>
          </form>
        }
      />

      {/* Points */}
      <h2 className="cw-title mb-2 text-lg">แต้ม (เดือนนี้)</h2>
      <div className="cw-card mb-6 overflow-x-auto">
        <table className="cw-table w-full text-sm">
          <thead>
            <tr style={{ color: "var(--cw-text-2)" }}>
              <th className="px-3 py-2.5 text-left text-xs font-semibold">รายการ</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold">แต้ม</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold">≈ บาท</th>
            </tr>
          </thead>
          <tbody>
            <ReportRow label="แต้มออก (คืนตู้)" points={pointsIssued} tone="ok" />
            <ReportRow label="แต้มที่ใช้ไป (แลกของ)" points={pointsRedeemed} />
            <ReportRow label="แต้มหมดอายุ" points={pointsExpired} tone="danger" />
          </tbody>
        </table>
      </div>

      {/* Refunds by status */}
      <h2 className="cw-title mb-2 text-lg">คำขอคืนแต้มแยกสถานะ</h2>
      <div className="cw-card mb-6 overflow-x-auto">
        <table className="cw-table w-full text-sm">
          <thead>
            <tr style={{ color: "var(--cw-text-2)" }}>
              <th className="px-3 py-2.5 text-left text-xs font-semibold">สถานะ</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold">จำนวน</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["AUTO_APPROVED", "อนุมัติอัตโนมัติ"],
              ["PENDING_REVIEW", "รอตรวจ"],
              ["APPROVED", "อนุมัติ (คน)"],
              ["REJECTED", "ปฏิเสธ"],
            ].map(([k, lbl]) => (
              <tr key={k} className="border-t" style={{ borderColor: "var(--cw-border)" }}>
                <td className="px-3 py-2.5">{lbl}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="cw-tnum">{fmtNum(statusMap.get(k as never) ?? 0)}</span>
                </td>
              </tr>
            ))}
            <tr className="border-t font-bold" style={{ borderColor: "var(--cw-border-strong)" }}>
              <td className="px-3 py-2.5">รวม</td>
              <td className="px-3 py-2.5 text-right">
                <span className="cw-tnum">{fmtNum(refundTotal)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Top machines */}
      <h2 className="cw-title mb-2 text-lg">ตู้ที่ถูกขอคืนบ่อยสุด</h2>
      <div className="cw-card overflow-x-auto">
        <table className="cw-table w-full text-sm">
          <thead>
            <tr style={{ color: "var(--cw-text-2)" }}>
              <th className="px-3 py-2.5 text-left text-xs font-semibold">รหัสตู้</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold">จำนวนคำขอ</th>
            </tr>
          </thead>
          <tbody>
            {topMachinesRaw.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center" style={{ color: "var(--cw-text-3)" }}>
                  ไม่มีข้อมูลเดือนนี้
                </td>
              </tr>
            ) : (
              topMachinesRaw.map((m) => (
                <tr
                  key={m.machineCode ?? "?"}
                  className="border-t"
                  style={{ borderColor: "var(--cw-border)" }}
                >
                  <td className="px-3 py-2.5">{m.machineCode ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="cw-tnum">{fmtNum(m._count._all)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportRow({
  label,
  points,
  tone,
}: {
  label: string;
  points: number;
  tone?: "ok" | "danger";
}) {
  const color = tone === "ok" ? "var(--cw-ok)" : tone === "danger" ? "var(--cw-danger)" : undefined;
  return (
    <tr className="border-t" style={{ borderColor: "var(--cw-border)" }}>
      <td className="px-3 py-2.5">{label}</td>
      <td className="px-3 py-2.5 text-right">
        <span className="cw-tnum font-bold" style={{ color }}>
          {fmtNum(points)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="cw-tnum" style={{ color: "var(--cw-text-2)" }}>
          {fmtNum(points * 10)}
        </span>
      </td>
    </tr>
  );
}
