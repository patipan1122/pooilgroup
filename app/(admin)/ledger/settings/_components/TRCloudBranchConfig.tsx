"use client";

// ตั้งค่า TRCloud สาขา: รหัสโครงการ + แผนก (นิติบุคคล) ต่อสาขา
// ข้อมูลเก็บใน Branch.settings.trcloudProject + trcloudDepartment
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { updateBranchTrcloud } from "../../_actions";

type Branch = {
  id: string;
  code: string;
  name: string;
  settings: Record<string, unknown> | null;
};

export function TRCloudBranchConfig({
  companyId: _companyId,
  branches,
}: {
  companyId: string;
  branches: Branch[];
}) {
  const router = useRouter();
  // Per-branch pending map — saving one row doesn't disable all others
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  async function save(branchId: string) {
    const { project, department } = edits[branchId] ?? { project: "", department: "" };
    setErrors((prev) => ({ ...prev, [branchId]: "" }));
    setSaved((prev) => ({ ...prev, [branchId]: false }));
    setPending((prev) => ({ ...prev, [branchId]: true }));
    try {
      const res = await updateBranchTrcloud({
        branchId,
        trcloudProject: project,
        trcloudDepartment: department,
      });
      if (res.ok) {
        setSaved((prev) => ({ ...prev, [branchId]: true }));
        router.refresh();
      } else {
        setErrors((prev) => ({ ...prev, [branchId]: res.error ?? "บันทึกไม่สำเร็จ" }));
      }
    } finally {
      setPending((prev) => ({ ...prev, [branchId]: false }));
    }
  }

  const input =
    "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] w-full";

  if (branches.length === 0) return null;

  const unconfiguredCount = branches.filter(
    (b) => !b.settings?.trcloudProject || !b.settings?.trcloudDepartment,
  ).length;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="mb-0.5 text-sm font-bold text-zinc-800">ผูกสาขา → TRCloud</h2>
          <p className="text-xs text-zinc-500">
            โครงการ = รหัสสาขาใน TRCloud · แผนก = รหัสนิติบุคคล (เช่น JPS_00001)
          </p>
        </div>
        {unconfiguredCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            <AlertCircle className="size-3" />
            {unconfiguredCount} สาขายังไม่ผูก
          </span>
        )}
      </div>

      <div className="divide-y divide-zinc-100">
        {branches.map((b) => {
          const edit = edits[b.id] ?? { project: "", department: "" };
          const isConfigured = !!(b.settings?.trcloudProject && b.settings?.trcloudDepartment);
          const isBusy = !!pending[b.id];
          const isSaved = !!saved[b.id];
          const branchError = errors[b.id];
          return (
            <div key={b.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-zinc-800">{b.name}</span>
                <span className="ml-1 text-[10px] text-zinc-400">{b.code}</span>
                {!isConfigured && (
                  <span className="ml-1.5 inline-block rounded bg-amber-100 px-1 py-px text-[9px] font-medium text-amber-700">
                    ยังไม่ผูก
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex gap-2">
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
                      disabled={isBusy}
                      className="flex h-8 min-w-[52px] items-center justify-center gap-1 rounded-lg bg-zinc-800 px-2.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : isSaved ? (
                        <Check className="size-3 text-emerald-400" />
                      ) : (
                        "บันทึก"
                      )}
                    </button>
                  </div>
                </div>
                {branchError && (
                  <p className="text-[10px] text-rose-600">{branchError}</p>
                )}
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
