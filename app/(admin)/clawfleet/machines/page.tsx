import Link from "next/link";
import { listMachines, listAccessibleBranches } from "@/lib/clawfleet/queries";
import { Gamepad2, Plus, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; kind?: "CLAW" | "EXCHANGER"; q?: string }>;
}) {
  const params = await searchParams;
  const [machines, branches] = await Promise.all([
    listMachines({ branchId: params.branch, kind: params.kind, search: params.q }),
    listAccessibleBranches(),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">ตู้</h1>
          <p className="text-sm text-zinc-500">รายการตู้คีบ + ตู้แลกเหรียญ</p>
        </div>
        <Link
          href="/clawfleet/machines/new"
          className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> เพิ่มตู้
        </Link>
      </header>

      <form className="flex flex-wrap gap-2" method="GET">
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
        <select
          name="kind"
          defaultValue={params.kind ?? ""}
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุก kind</option>
          <option value="CLAW">ตู้คีบ</option>
          <option value="EXCHANGER">ตู้แลก</option>
        </select>
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="ค้นหา code..."
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          กรอง
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {machines.length === 0 ? (
          <div className="p-8 text-center">
            <Gamepad2 className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-2 text-sm text-zinc-500">ยังไม่มีตู้</p>
            <Link
              href="/clawfleet/machines/new"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
            >
              เพิ่มตู้แรก <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">รหัส</th>
                <th className="px-4 py-3 font-medium">ชนิด</th>
                <th className="px-4 py-3 font-medium">สาขา</th>
                <th className="px-4 py-3 font-medium">กลุ่ม</th>
                <th className="px-4 py-3 font-medium text-right">มิเตอร์ล่าสุด</th>
                <th className="px-4 py-3 font-medium text-right">สต๊อก</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {machines.map((m) => (
                <tr key={m.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/clawfleet/machines/${m.code}`}
                      className="text-blue-600 hover:underline"
                    >
                      {m.code}
                    </Link>
                    {m.nickname && (
                      <div className="text-xs text-zinc-500">{m.nickname}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.kind === "CLAW" ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        ตู้คีบ
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        ตู้แลก
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{m.branch.name}</td>
                  <td className="px-4 py-3 text-zinc-700">{m.group?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-right text-zinc-900">
                    {m.lastCoinMeter.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.kind === "CLAW" ? (
                      <span
                        className={
                          m.lastDollStock < 10
                            ? "font-bold text-red-600"
                            : "text-zinc-700"
                        }
                      >
                        {m.lastDollStock}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.isActive ? (
                      <span className="text-emerald-600">●</span>
                    ) : (
                      <span className="text-zinc-400">○ ปิด</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
