// /repairs/recurring — Recurring failure report (Pooil App vocab: .panel .dtable)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { prisma } from "@/lib/prisma";
import { formatBaht, downtimeCostBaht } from "@/lib/repair/types";
import { AlertTriangle, MapPin, ChevronRight, TrendingUp } from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

export const dynamic = "force-dynamic";

interface Search { days?: string }

export default async function RecurringFailurePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const params = await searchParams;
  const days = Math.max(7, Math.min(365, parseInt(params.days ?? "90", 10)));
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const tickets = await prisma.repairTicket.findMany({
    where: {
      orgId: session.user.org_id,
      createdAt: { gte: since },
      branchId: { not: null },
      categoryId: { not: null },
    },
    select: {
      id: true, ticketCode: true, title: true, status: true,
      createdAt: true, resolvedAt: true,
      partsCostCents: true, laborCostCents: true,
      branch: { select: { id: true, code: true, name: true, businessType: true } },
      category: { select: { id: true, label: true, emoji: true } },
    },
  });

  type Row = {
    key: string;
    branchId: string;
    branchCode: string;
    branchName: string;
    businessType: string;
    categoryId: string;
    categoryLabel: string;
    categoryEmoji: string | null;
    tickets: typeof tickets;
    totalCostCents: number;
    downtimeBaht: number;
  };
  const map = new Map<string, Row>();
  for (const t of tickets) {
    if (!t.branch || !t.category) continue;
    const key = `${t.branch.id}|${t.category.id}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        branchId: t.branch.id, branchCode: t.branch.code, branchName: t.branch.name,
        businessType: t.branch.businessType as string,
        categoryId: t.category.id, categoryLabel: t.category.label, categoryEmoji: t.category.emoji,
        tickets: [], totalCostCents: 0, downtimeBaht: 0,
      });
    }
    const row = map.get(key)!;
    row.tickets.push(t);
    row.totalCostCents += t.partsCostCents + t.laborCostCents;
    row.downtimeBaht += downtimeCostBaht({
      businessType: t.branch.businessType as string,
      startedAt: t.createdAt,
      endedAt: t.resolvedAt,
    });
  }

  const offenders = Array.from(map.values())
    .filter((r) => r.tickets.length >= 2)
    .sort((a, b) => b.tickets.length - a.tickets.length);

  const totalSpent = offenders.reduce((s, r) => s + r.totalCostCents, 0);
  const totalDowntime = offenders.reduce((s, r) => s + r.downtimeBaht * 100, 0);

  return (
    <>
      <RepairSubHeader
        icon={AlertTriangle}
        eyebrow="Insights · Recurring failures"
        title="ของพังซ้ำ"
        subtitle={`สาขา + หมวด ที่ซ่อมซ้ำ ≥ 2 ครั้ง ใน ${days} วัน · เปลี่ยนของใหม่อาจคุ้มกว่าซ่อมซ้ำ`}
        stats={[
          { label: "จุดที่ซ้ำ", value: offenders.length, tone: offenders.length > 0 ? "warn" : "default" },
          { label: "ค่าซ่อมรวม", value: formatBaht(totalSpent) },
          { label: "ค่าเสียโอกาส", value: formatBaht(totalDowntime), tone: "danger" },
        ]}
        actions={
          <div style={{ display: "flex", gap: 4 }}>
            {[30, 60, 90, 180, 365].map((d) => (
              <Link
                key={d}
                href={`/repairs/recurring?days=${d}`}
                className={"table-filter " + (days === d ? "is-active" : "")}
              >
                {d} วัน
              </Link>
            ))}
          </div>
        }
      />

      <div className="repair-content">
        {offenders.length === 0 ? (
          <div className="panel" style={{
            padding: 48, textAlign: "center",
            borderStyle: "dashed", borderColor: "#A7F3D0",
            background: "#ECFDF5",
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 28,
              background: "#fff", color: "var(--good)",
              display: "grid", placeItems: "center",
              margin: "0 auto",
            }}>
              <TrendingUp size={26} />
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--ink-900)", marginTop: 14 }}>
              ไม่มีของพังซ้ำใน {days} วัน
            </p>
            <p style={{ fontSize: 12, color: "var(--ink-600)", marginTop: 4 }}>
              เครื่อง / อุปกรณ์ของทุกสาขาเสถียร · ไม่ต้องห่วง capex
            </p>
          </div>
        ) : (
          <div className="panel">
            <div style={{ overflowX: "auto" }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>สาขา · หมวด</th>
                    <th className="num">ครั้งที่ซ่อม</th>
                    <th className="num">ค่าซ่อมรวม</th>
                    <th className="num">ค่าเสียโอกาส</th>
                    <th>ใบล่าสุด</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {offenders.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <p style={{
                          fontWeight: 600, color: "var(--ink-900)", margin: 0,
                          display: "flex", alignItems: "center", gap: 6,
                        }}>
                          <span style={{ fontSize: 18 }}>{row.categoryEmoji ?? "🛠"}</span>
                          {row.categoryLabel}
                        </p>
                        <p style={{
                          fontSize: 11, color: "var(--ink-500)",
                          display: "flex", alignItems: "center", gap: 4,
                          marginTop: 2,
                        }}>
                          <MapPin size={10} />
                          <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)" }}>
                            {row.branchCode}
                          </span>
                          {row.branchName}
                        </p>
                      </td>
                      <td className="num">
                        <span className={
                          "pill " +
                          (row.tickets.length >= 5 ? "pill-urgent" :
                           row.tickets.length >= 3 ? "pill-approval" : "pill-low")
                        } style={{ fontSize: 13, padding: "2px 8px" }}>
                          {row.tickets.length} ครั้ง
                        </span>
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {formatBaht(row.totalCostCents)}
                      </td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--bad)" }}>
                        {formatBaht(row.downtimeBaht * 100)}
                      </td>
                      <td>
                        <Link
                          href={`/repairs/${row.tickets[0].id}`}
                          style={{
                            fontSize: 11.5, fontWeight: 600,
                            color: "var(--brand-700)", textDecoration: "none",
                          }}
                        >
                          <span className="num" style={{ fontFamily: "var(--font-mono)" }}>
                            {row.tickets[0].ticketCode}
                          </span>
                          <span style={{ color: "var(--ink-400)", marginLeft: 4 }}>
                            · {new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(row.tickets[0].createdAt)}
                          </span>
                        </Link>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link
                          href={`/repairs/triage?branch=${row.branchId}&category=${row.categoryId}`}
                          style={{
                            fontSize: 11, fontWeight: 600,
                            color: "var(--brand-700)", textDecoration: "none",
                            display: "inline-flex", alignItems: "center", gap: 2,
                          }}
                        >
                          ดูทั้งหมด <ChevronRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
