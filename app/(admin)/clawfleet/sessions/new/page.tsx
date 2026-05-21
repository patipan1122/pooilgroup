import { listGroups, getOpenSessionForGroup } from "@/lib/clawfleet/queries";
import { StartSessionForm } from "@/components/clawfleet/start-session-form";

export const dynamic = "force-dynamic";

export default async function StartSessionPage() {
  const groups = await listGroups();
  const openMap: Record<string, string> = {};
  for (const g of groups) {
    const open = await getOpenSessionForGroup(g.id);
    if (open) openMap[g.id] = open.id;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">เริ่มรอบเก็บใหม่</h1>
        <p className="text-sm text-zinc-500">เลือกกลุ่มตู้คีบ (1 ตู้แลก + N ตู้คีบ)</p>
      </header>

      <StartSessionForm
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          branch: g.branch,
          exchanger: g.exchanger,
          _count: { machines: g._count.machines },
        }))}
        existingOpen={openMap}
      />
    </div>
  );
}
