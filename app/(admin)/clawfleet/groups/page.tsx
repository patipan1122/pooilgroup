import Link from "next/link";
import { listGroups, listAccessibleBranches, listMachines } from "@/lib/clawfleet/queries";
import { CreateGroupForm } from "@/components/clawfleet/create-group-form";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const [groups, branches, exchangers] = await Promise.all([
    listGroups(),
    listAccessibleBranches(),
    listMachines({ kind: "EXCHANGER" }),
  ]);
  const unattached = exchangers.filter((e) => !e.group);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">กลุ่มตู้แลก</h1>
        <p className="text-sm text-zinc-500">
          1 กลุ่ม = 1 ตู้แลก + N ตู้คีบ · cross-check ทุกครั้งที่ปิด session
        </p>
      </header>

      <CreateGroupForm
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        unattachedExchangers={unattached.map((e) => ({
          id: e.id,
          code: e.code,
          branchId: e.branchId,
        }))}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {groups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 sm:col-span-2">
            ยังไม่มีกลุ่ม · สร้างกลุ่มแรกข้างบน
          </p>
        ) : (
          groups.map((g) => (
            <Link
              key={g.id}
              href={`/clawfleet/groups/${g.id}`}
              className="rounded-2xl border border-zinc-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm"
            >
              <div className="text-xs text-zinc-500">{g.branch.name}</div>
              <h3 className="text-lg font-semibold text-zinc-900">{g.name}</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <Mini label="ตู้แลก" value={g.exchanger?.code ?? "-"} />
                <Mini label="ตู้คีบ" value={String(g._count.machines)} />
                <Mini label="Tolerance" value={`${(g.toleranceBps / 100).toFixed(1)}%`} />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-2 text-center">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-900">{value}</div>
    </div>
  );
}
