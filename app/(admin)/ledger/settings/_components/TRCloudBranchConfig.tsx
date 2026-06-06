"use client";

// ตั้งค่า TRCloud สาขา: รหัสโครงการ + แผนก (นิติบุคคล) ต่อสาขา
// ข้อมูลเก็บใน Branch.settings.trcloudProject + trcloudDepartment
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { updateBranchTrcloud } from "../../_actions";

type Branch = {
  id: string;
  code: string;
  name: string;
  settings: Record<string, unknown> | null;
};

export function TRCloudBranchConfig({
  companyId,
  branches,
}: {
  companyId: string;
  branches: Branch[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local edits: branchId → { project, department }
  const [edits, setEdits] = useState<Record<string, { project: string; department: string }>>(() =>
    Object.fromEntries(
      branches.map((b) => [
        b.id,
        {
          project: String(b.settings?.trcloudProject ?? ""),
          department: String(b.settings?.trcloudDepartment ?? ""),
        },
      ]),
    ),
  );

  function save(branchId: string) {
    const { project, department } = edits[branchId] ?? { project: "", department: "" };
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await updateBranchTrcloud({
        branchId,
        trcloudProject: project,
        trcloudDepartment: department,
      });
      if (res.ok) {
        setSaved(branchId);
        router.refresh();
      } else {
        setError(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  const input =
    "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] w-full";

  if (branches.length === 0) return null;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-bold text-zinc-800">ผูกสาขา → TRCloud</h2>
      <p className="mb-3 text-xs text-zinc-500">
        โครงการ = รหัสสาขาใน TRCloud · แผนก = รหัสนิติบุคคล (เช่น JPS_00001)
      </p>
      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}

      <div className="divide-y divide-zinc-100">
        {branches.map((b) => {
          const edit = edits[b.id] ?? { project: "", department: "" };
          const isSaved = saved === b.id;
          return (
            <div key={b.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-zinc-800">{b.name}</span>
                <span className="ml-1 text-[10px] text-zinc-400">{b.code}</span>
              </div>
              <div className="flex flex-1 gap-2">
                <div className="flex-1">
                  <label className="mb-0.5 block text-[10px] text-zinc-400">โครงการ (project)</label>
                  <input
                    className={input}
                    placeholder="AMAZON-001-สาขาเทศบาลจักราช"
                    value={edit.project}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [b.id]: { ...edit, project: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-0.5 block text-[10px] text-zinc-400">แผนก (department)</label>
                  <input
                    className={input}
                    placeholder="JPS_00001"
                    value={edit.department}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [b.id]: { ...edit, department: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="flex items-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => save(b.id)}
                    disabled={pending}
                    className="flex h-8 items-center gap-1 rounded-lg bg-zinc-800 px-2.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : isSaved ? (
                      <Check className="size-3 text-emerald-400" />
                    ) : (
                      "บันทึก"
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] text-zinc-400">
        สาขาที่ยังไม่ได้ผูก โครงการ+แผนก จะไม่สามารถส่งใบเสร็จเข้า TRCloud ได้
      </p>
    </div>
  );
}
