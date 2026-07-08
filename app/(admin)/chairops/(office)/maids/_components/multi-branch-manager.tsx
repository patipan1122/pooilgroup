"use client";

// จัดการ "สาขาที่แม่บ้านดูแล" — เพิ่มได้หลายสาขา (CEO 2026-07-08 · multi-branch).
// แทนที่ ReassignBranchForm (dropdown เดี่ยว 1:1) เดิม.
//   - แสดงสาขาที่ผูกอยู่เป็นแถว · สาขาหลัก ⭐ (ถอดไม่ได้ · ตั้งใหม่ได้)
//   - สาขาอื่น: "ตั้งเป็นหลัก" / "ถอด" (ถอดถูก block ถ้ายังมีเงินค้างฝาก — เช็คที่ server)
//   - เพิ่มสาขา: เลือกจาก dropdown สาขาที่ยังไม่ผูก

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Star, Plus, X } from "lucide-react";
import { addMaidBranch, removeMaidBranch, setHomeBranch } from "../actions";

type Branch = { id: string; name: string };
type Action = (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;

export function MultiBranchManager({
  maidId,
  homeBranchId,
  assignedBranches,
  addableBranches,
}: {
  maidId: string;
  homeBranchId: string | null;
  assignedBranches: Branch[];
  addableBranches: Branch[];
}) {
  const [pending, startTransition] = useTransition();
  const [toAdd, setToAdd] = useState("");

  function run(
    action: Action,
    branchId: string,
    okMsg: string,
    confirmMsg?: string,
  ) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const fd = new FormData();
    fd.set("maidId", maidId);
    fd.set("branchId", branchId);
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(okMsg);
      setToAdd("");
    });
  }

  return (
    <div className="space-y-3">
      {/* สาขาที่ผูกอยู่ */}
      {assignedBranches.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ยังไม่ได้ผูกสาขา — เพิ่มสาขาแรกด้านล่าง (สาขาแรกจะเป็นสาขาหลักอัตโนมัติ)
        </p>
      ) : (
        <ul className="space-y-1.5">
          {assignedBranches.map((b) => {
            const isHome = b.id === homeBranchId;
            return (
              <li
                key={b.id}
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0 grow truncate font-medium text-zinc-800">
                  {b.name}
                </span>
                {isHome ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    <Star className="size-3 fill-amber-400 text-amber-500" /> สาขาหลัก
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(setHomeBranch, b.id, `ตั้ง ${b.name} เป็นสาขาหลักแล้ว`)
                      }
                      className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      ตั้งเป็นหลัก
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(
                          removeMaidBranch,
                          b.id,
                          `ถอด ${b.name} แล้ว`,
                          `ถอดสาขา ${b.name} ออกจากแม่บ้านคนนี้?`,
                        )
                      }
                      className="inline-flex items-center gap-0.5 rounded border border-rose-200 px-1.5 py-0.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    >
                      <X className="size-3" /> ถอด
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* เพิ่มสาขา */}
      {addableBranches.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            disabled={pending}
            className="min-w-0 grow rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">+ เพิ่มสาขา…</option>
            {addableBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !toAdd}
            onClick={() => run(addMaidBranch, toAdd, "เพิ่มสาขาแล้ว")}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            เพิ่ม
          </button>
        </div>
      )}
    </div>
  );
}
