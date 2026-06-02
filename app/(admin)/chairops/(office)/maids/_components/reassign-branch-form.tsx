"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { reassignMaidBranch } from "../actions";

export function ReassignBranchForm({
  maidId,
  currentBranchId,
  branches,
}: {
  maidId: string;
  currentBranchId: string | null;
  branches: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState<string>(currentBranchId ?? "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (branchId === (currentBranchId ?? "")) {
      toast.info("สาขาเดิมอยู่แล้ว");
      return;
    }
    if (
      currentBranchId &&
      !window.confirm(
        "การย้ายสาขาจะปิด assignment เดิมและเริ่ม assignment ใหม่ · ดำเนินการ?",
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("maidId", maidId);
    fd.set("branchId", branchId);
    startTransition(async () => {
      const res = await reassignMaidBranch(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ย้ายสาขาเรียบร้อย");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="block text-xs">
        <span className="mb-1 block text-zinc-600">สาขาปัจจุบัน</span>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">— ไม่ผูกสาขา —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "กำลังย้าย..." : "ยืนยันย้ายสาขา"}
      </button>
    </form>
  );
}
