"use client";

// ตั้งค่า TRCloud สาขา: รหัสโครงการ + แผนก (นิติบุคคล) ต่อสาขา
// ข้อมูลเก็บใน Branch.settings.trcloudProject + trcloudDepartment
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, AlertCircle, Search } from "lucide-react";
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
  const [filterText, setFilterText] = useState("");

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

  // Re-hydrate edits when branches prop changes after router.refresh() — the useState
  // initializer only runs once; new prop values are silently discarded without this.
  // NOTE: intentionally NOT clearing saved{} here — doing so kills the ✓ checkmark
  // because router.refresh() triggers this effect within ms of the save response.
  // Saved state auto-expires via setTimeout in save() instead.
  useEffect(() => {
    setEdits(
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
  }, [branches]);

  async function save(branchId: string) {
    const { project, department } = edits[branchId] ?? { project: "", department: "" };
    setErrors((prev) => ({ ...prev, [branchId]: "" }));
    setSaved((prev) => ({ ...prev, [branchId]: false }));
    setPending((prev) => ({ ...prev, [branchId]: true }));
    try {
      const res = await updateBranchTrcloud({
        branchId,
        companyId,
        trcloudProject: project,
        trcloudDepartment: department,
      });
      if (res.ok) {
        setSaved((prev) => ({ ...prev, [branchId]: true }));
        // Auto-expire the ✓ after 3s so it doesn't mislead after subsequent edits
        setTimeout(() => setSaved((prev) => ({ ...prev, [branchId]: false })), 3000);
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

  const configuredCount = branches.filter(
    (b) => !!b.settings?.trcloudDepartment, // โครงการ optional — นับครบเมื่อมีแผนก (CEO 2026-06-23)
  ).length;
  const unconfiguredCount = branches.length - configuredCount;

  const filteredBranches = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q),
    );
  }, [branches, filterText]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="mb-0.5 text-sm font-bold text-zinc-800">ผูกสาขา → TRCloud</h2>
          <p className="text-xs text-zinc-500">
            แผนก = รหัสนิติบุคคล (เช่น JPS_00001) · จำเป็น — โครงการ = รหัสสาขา · ไม่บังคับ (ค่าใช้จ่ายส่วนกลางเว้นว่างได้)
          </p>
          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  configuredCount === branches.length
                    ? "bg-[var(--color-leaf-600,theme(colors.emerald.600))]"
                    : "bg-amber-400"
                }`}
                // eslint-disable-next-line react/forbid-component-props -- dynamic % width cannot be expressed as a static Tailwind class
                style={{ width: `${branches.length > 0 ? Math.round((configuredCount / branches.length) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-zinc-500">
              เสร็จสิ้น{" "}
              <span className={configuredCount === branches.length ? "text-emerald-600" : "text-amber-600"}>
                {configuredCount}/{branches.length} สาขา
              </span>
            </span>
          </div>
        </div>
        {unconfiguredCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            <AlertCircle className="size-3" />
            {unconfiguredCount} สาขายังไม่ผูก
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          placeholder="ค้นหาสาขาตามชื่อหรือรหัส..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-xs outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-brand-200)]"
        />
      </div>

      <div className="divide-y divide-zinc-100">
        {filteredBranches.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-400">ไม่พบสาขาที่ค้นหา</p>
        ) : null}
        {filteredBranches.map((b) => {
          const edit = edits[b.id] ?? { project: "", department: "" };
          const isConfigured = !!b.settings?.trcloudDepartment; // โครงการ optional
          const isBusy = !!pending[b.id];
          const isSaved = !!saved[b.id];
          const branchError = errors[b.id];
          return (
            <div key={b.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-zinc-800">{b.name}</span>
                <span className="ml-1 font-mono text-[11px] text-zinc-500">{b.code}</span>
                {!isConfigured && (
                  <span className="ml-1.5 inline-block rounded bg-amber-100 px-1 py-px text-[11px] font-medium text-amber-700">
                    ยังไม่ผูก
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[11px] text-zinc-500">โครงการ (project) · ไม่บังคับ</label>
                    <input
                      className={input}
                      placeholder="AMAZON-001-สาขาเทศบาลจักราช"
                      value={edit.project}
                      onChange={(e) => {
                        setEdits((prev) => ({
                          ...prev,
                          [b.id]: { ...edit, project: e.target.value },
                        }));
                        setSaved((prev) => ({ ...prev, [b.id]: false }));
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[11px] text-zinc-500">แผนก (department) · จำเป็น</label>
                    <input
                      className={input}
                      placeholder="JPS_00001"
                      value={edit.department}
                      onChange={(e) => {
                        setEdits((prev) => ({
                          ...prev,
                          [b.id]: { ...edit, department: e.target.value },
                        }));
                        setSaved((prev) => ({ ...prev, [b.id]: false }));
                      }}
                    />
                  </div>
                  <div className="flex items-end pb-0.5">
                    <button
                      type="button"
                      onClick={() => save(b.id)}
                      disabled={isBusy}
                      className="flex h-8 min-w-[52px] items-center justify-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-2.5 text-xs font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
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

      <p className="mt-3 text-[11px] text-zinc-500">
        สาขาที่ยังไม่ได้กรอก “แผนก” จะส่งใบเสร็จเข้า TRCloud ไม่ได้ · “โครงการ” เว้นว่างได้ (ค่าใช้จ่ายส่วนกลาง)
      </p>
    </div>
  );
}
