import Link from "next/link";
import { getDashboardKpis, listAnomalies } from "@/lib/clawfleet/queries";
import { formatTHB } from "@/lib/clawfleet/validation";
import { Gamepad2, Coins, AlertTriangle, PackageOpen } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClawfleetDashboardPage() {
  const [kpi, anomalies] = await Promise.all([getDashboardKpis(), listAnomalies()]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">ภาพรวม ClawFleet</h1>
        <p className="text-sm text-zinc-500">รายได้รวม · anomaly · สต๊อกแอลเลิร์ต</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Coins className="h-5 w-5" />}
          label="รายได้วันนี้"
          value={formatTHB(kpi.cashTodayCents)}
          sub={`${kpi.sessionsToday} รอบที่ปิดแล้ว`}
          tone="brand"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Anomaly รอ review"
          value={String(kpi.anomalyCount)}
          sub={kpi.anomalyCount > 0 ? "กดดูที่ Anomaly" : "ปกติ"}
          tone={kpi.anomalyCount > 0 ? "danger" : "ok"}
        />
        <KpiCard
          icon={<PackageOpen className="h-5 w-5" />}
          label="สต๊อกใกล้หมด"
          value={String(kpi.lowStockMachines)}
          sub="ตู้ที่เหลือ < 10 ตัว"
          tone={kpi.lowStockMachines > 0 ? "warn" : "ok"}
        />
        <KpiCard
          icon={<Gamepad2 className="h-5 w-5" />}
          label="ตู้ active"
          value={String(kpi.activeMachines)}
          sub="ตู้คีบ + ตู้แลก"
          tone="brand"
        />
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <header className="flex items-center justify-between border-b border-zinc-100 p-4">
          <h2 className="font-semibold text-zinc-900">Anomaly ล่าสุด</h2>
          <Link
            href="/clawfleet/anomalies"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ดูทั้งหมด →
          </Link>
        </header>
        {anomalies.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">ไม่มี anomaly รอ review</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {anomalies.slice(0, 5).map((s) => (
              <li key={s.id} className="p-4">
                <Link
                  href={`/clawfleet/sessions/${s.id}`}
                  className="flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="font-medium text-zinc-900">{s.sessionCode}</div>
                    <div className="text-xs text-zinc-500">
                      {s.group.name} · {s.group.branch.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-zinc-900">
                      {formatTHB(s.totalCashCents)}
                    </div>
                    <div className="text-xs text-red-600">
                      {s.anomalyFlags.slice(0, 2).join(" · ")}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <QuickLink
          href="/clawfleet/sessions/new"
          icon={<Coins className="h-5 w-5" />}
          label="เริ่มรอบเก็บใหม่"
          desc="เลือกกลุ่ม · เริ่ม session"
        />
        <QuickLink
          href="/clawfleet/reports"
          icon={<Gamepad2 className="h-5 w-5" />}
          label="รีพอตรายวัน"
          desc="filter วัน · สาขา · ตู้"
        />
      </section>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "danger" | "brand";
}) {
  const toneClass = {
    ok: "border-emerald-200 bg-emerald-50/40 text-emerald-700",
    warn: "border-amber-200 bg-amber-50/40 text-amber-700",
    danger: "border-red-200 bg-red-50/40 text-red-700",
    brand: "border-blue-200 bg-blue-50/40 text-blue-700",
  }[tone];

  return (
    <div className={`rounded-2xl border bg-white p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-zinc-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"
    >
      <div className="flex items-center gap-2 text-blue-600">{icon}</div>
      <div className="mt-2 font-semibold text-zinc-900">{label}</div>
      <div className="text-xs text-zinc-500">{desc}</div>
    </Link>
  );
}
