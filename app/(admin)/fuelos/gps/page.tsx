import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import {
  latestReportDate,
  listDailyReport,
  listFleetVehicles,
  listFleetGroups,
} from "@/lib/fuelos/gps/report-data";
import { bkkDate } from "@/lib/fuelos/utils/format";
import { Gauge, MapPin, Truck, BarChart3, Fuel } from "lucide-react";
import { FleetTable } from "./fleet-table";

export const dynamic = "force-dynamic";

export default async function GpsReportPage() {
  const user = await requireUser();
  if (!atLeast(user.role, "DISPATCH")) redirect("/fuelos/dashboard");
  const canConfig = atLeast(user.role, "ADMIN");

  const [fleet, groups, date] = await Promise.all([listFleetVehicles(), listFleetGroups(), latestReportDate()]);
  const report = date ? await listDailyReport(date) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="รถ GPS" subtitle={`รถทั้งหมด ${fleet.length} คัน · เตรียมจัดรถ + รายงาน กม./น้ำมัน`} />

      <div className="flex flex-wrap gap-2">
        <Link href="/fuelos/dispatch/map" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-surface border border-border text-sm text-zinc-600">
          <MapPin className="size-4" /> ดูตำแหน่งสด (แผนที่)
        </Link>
        {canConfig && (
          <Link href="/fuelos/settings?tab=gps" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-surface border border-border text-sm text-zinc-600">
            <Gauge className="size-4" /> ตั้งค่า GPS
          </Link>
        )}
      </div>

      {/* รถทั้งหมด — ตารางจัดเรียง/เตรียมจัดรถ */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Truck className="size-4 text-brand-600" />
          <h2 className="font-bold">รถทั้งหมด</h2>
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand-600/10 text-brand-700 tabular-nums">{fleet.length}</span>
        </div>
        {fleet.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <Truck className="size-8 mx-auto text-zinc-300" />
            <p className="mt-3 font-semibold">ยังไม่มีรถในระบบ</p>
            <p className="text-sm text-zinc-500 mt-1">เปิดหน้าแผนที่สักครั้งเพื่อดึงรถจาก xsense เข้ามาเก็บ · หรือใส่กุญแจในตั้งค่า GPS</p>
          </div>
        ) : (
          <FleetTable vehicles={fleet} groups={groups} />
        )}
      </section>

      {/* สรุปรายวัน — กม./เครื่องเดินเปล่า */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="size-4 text-brand-600" />
          <h2 className="font-bold">สรุปรายวัน</h2>
          {date && <span className="text-xs text-zinc-400">{bkkDate(date)}</span>}
        </div>
        {report.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-zinc-500">
            ระบบจะสรุป กม./เครื่องเดินเปล่า (idle) ของแต่ละคันให้ทุกคืน — เริ่มมีข้อมูลคืนแรก
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 border-b border-border">
                  <th className="px-3 py-2 font-medium">ทะเบียน</th>
                  <th className="px-3 py-2 font-medium">กลุ่ม</th>
                  <th className="px-3 py-2 font-medium text-right">กม.วิ่ง</th>
                  <th className="px-3 py-2 font-medium text-right">ชม.วิ่ง</th>
                  <th className="px-3 py-2 font-medium text-right">จอดติดเครื่อง (idle)</th>
                  <th className="px-3 py-2 font-medium">คนขับ</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.xsenseName} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-medium font-[family-name:var(--font-plex-mono)]">{r.plate}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.groupName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.distanceKm.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.moveHours.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={r.idleHours >= 2 ? "text-warning font-semibold" : "text-zinc-500"}>{r.idleHours.toFixed(1)} ชม.</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-500 truncate max-w-[160px]">{r.driverName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 rounded-xl bg-surface-2 border border-border px-3 py-2 text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
          <Fuel className="size-3.5" /> คอลัมน์ "กระทบยอดน้ำมัน" (กม./ลิตร) จะเปิดเมื่อ xsense คาลิเบรทเซ็นเซอร์น้ำมัน — ฐานข้อมูลเตรียมไว้แล้ว
        </div>
      </section>
    </div>
  );
}
