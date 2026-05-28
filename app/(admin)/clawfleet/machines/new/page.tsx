import { listAccessibleBranches, listGroups } from "@/lib/clawfleet/queries";
import { NewMachineForm } from "@/components/clawfleet/new-machine-form";

export const dynamic = "force-dynamic";

export default async function NewMachinePage() {
  const [branches, groups] = await Promise.all([listAccessibleBranches(), listGroups()]);
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-zinc-900">เพิ่มตู้ใหม่</h1>
      <p className="text-sm text-zinc-500">
        กรอกมิเตอร์เริ่มต้น 1 ครั้ง · รอบต่อไประบบดึงจากรอบก่อน
      </p>
      <NewMachineForm
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          branchId: g.branch.id,
        }))}
      />
    </div>
  );
}
