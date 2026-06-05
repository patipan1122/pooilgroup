"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { assignSecondaryBranch } from "@/app/(admin)/chairops/users/actions";

interface Branch {
  id: string;
  name: string;
}

export function SecondaryBranchPicker({
  maidId,
  currentSecondaryBranchId,
  branches,
}: {
  maidId: string;
  currentSecondaryBranchId: string | null;
  branches: ReadonlyArray<Branch>;
}) {
  const [value, setValue] = useState(currentSecondaryBranchId ?? "");
  const [pending, startTransition] = useTransition();

  function save(branchId: string | null) {
    startTransition(async () => {
      const res = await assignSecondaryBranch(maidId, branchId);
      if (res.ok) {
        toast.success(branchId ? "กำหนดสาขาสำรองแล้ว" : "ล้างสาขาสำรองแล้ว");
        setValue(branchId ?? "");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="text-xs font-semibold text-zinc-700">
        🔀 สาขาสำรอง (Cover ชั่วคราว)
      </div>
      <p className="text-[11px] text-zinc-500">
        แม่บ้านคนนี้จะเห็นงานสาขาสำรองด้วยเมื่อแม่บ้านประจำลาหยุด
      </p>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <option value="">— ไม่มีสาขาสำรอง —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => save(value || null)}
          className="rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "..." : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
