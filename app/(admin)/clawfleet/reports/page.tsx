import Link from "next/link";
import { getReportEvents, listAccessibleBranches } from "@/lib/clawfleet/queries";
import { formatTHB, severityLight } from "@/lib/clawfleet/validation";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branch?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const sevenDays = new Date(now); sevenDays.setDate(now.getDate() - 7); sevenDays.setHours(0, 0, 0, 0);
  const from = params.from ? new Date(params.from) : sevenDays;
  const to = params.to ? new Date(params.to) : now;

  const [events, branches] = await Promise.all([
    getReportEvents({ from, to, branchId: params.branch }),
    listAccessibleBranches(),
  ]);

  const totalCash = events.reduce((s, e) => s + e.cashCountedCents, 0);
  const totalFlagged = events.filter((e) => e.anomalyFlags.length > 0).length;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">รีพอตการเก็บเงิน</h1>
          <p className="text-sm text-zinc-500">รายเหตุการณ์ · filter วัน · สาขา · ตู้</p>
        </div>
        <Link
          href={`/api/clawfleet/reports/export?from=${from.toISOString()}&to=${to.toISOString()}${params.branch ? `&branch=${params.branch}` : ""}`}
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:border-blue-300"
        >
          ⤓ CSV
        </Link>
      </header>

      <form className="flex flex-wrap items-end gap-2" method="GET">
        <label className="block text-xs">
          <span className="text-zinc-500">จาก</span>
          <input
            type="date"
            name="from"
            defaultValue={from.toISOString().slice(0, 10)}
            className="mt-1 block rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="text-zinc-500">ถึง</span>
          <input
            type="date"
            name="to"
            defaultValue={to.toISOString().slice(0, 10)}
            className="mt-1 block rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        <select
          name="branch"
          defaultValue={params.branch ?? ""}
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          ดู
        </button>
      </form>

      <div className="rounded-xl border border-blue-200 bg-blue-50/40 px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            รวม <span className="font-bold">{formatTHB(totalCash)}</span>
          </span>
          <span>
            {events.length} รายการ
          </span>
          <span className={totalFlagged > 0 ? "text-amber-700" : ""}>
            🟡 flag {totalFlagged}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">ไม่มีรายการในช่วงที่เลือก</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-14 z-10 bg-zinc-50 text-xs text-zinc-500 sm:top-16">
              <tr className="text-left">
                <th className="px-3 py-3 font-medium">เวลา</th>
                <th className="px-3 py-3 font-medium">สาขา</th>
                <th className="px-3 py-3 font-medium">ตู้</th>
                <th className="px-3 py-3 font-medium">พนักงาน</th>
                <th className="px-3 py-3 font-medium text-right">เหรียญ</th>
                <th className="px-3 py-3 font-medium text-right">เงินสด</th>
                <th className="px-3 py-3 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {events.map((e) => {
                const expected = (e.coinMeterAfter - e.coinMeterBefore) * 1000;
                const variance = e.cashCountedCents - expected;
                const L = severityLight(variance);
                const dot =
                  L === "ok" ? "🟢" : L === "warn" ? "🟡" : "🔴";
                return (
                  <tr key={e.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 text-xs">
                      {new Date(e.collectedAt).toLocaleString("th-TH", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{e.machine.branch.name}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/clawfleet/machines/${e.machine.code}`}
                        className="font-mono text-xs text-blue-600 hover:underline"
                      >
                        {e.machine.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-zinc-600">{e.collectedBy.name}</td>
                    <td className="px-3 py-2 text-right">
                      {(e.coinMeterAfter - e.coinMeterBefore).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatTHB(e.cashCountedCents)}
                    </td>
                    <td className="px-3 py-2">{dot}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
