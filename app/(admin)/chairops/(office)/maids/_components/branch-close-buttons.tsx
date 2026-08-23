"use client";

// Close / reopen a branch from the maid activity table (CEO 2026-08-23).
//
// CEO 2026-08-23 follow-up: "กดปิดสาขาไม่ได้" — CloseBranchButton originally
// used window.confirm() for the "are you sure" step. ResignMaidButton (which
// worked fine, per no complaint) uses the app's own Dialog component instead.
// window.confirm() is the one thing structurally different between the two —
// some embedding/CSP contexts silently suppress native confirm()/alert() with
// no visible dialog and no error, which reads exactly as "the button does
// nothing". Switched to Dialog to match the proven-working pattern, and the
// failure reason (e.g. the settle-gate blocking on undeposited cash) now
// renders inside the dialog itself instead of only a toast that's easy to miss.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { closeBranch, reopenBranch } from "@/app/(admin)/chairops/branches/actions";

export function CloseBranchButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await closeBranch(branchId);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(`ปิดสาขา "${branchName}" แล้ว`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100"
      >
        ปิดสาขา
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`ปิดสาขา "${branchName}"?`}>
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            สาขานี้จะไม่ขึ้นในหน้าตรวจยอด/dashboard อื่นทั้งระบบอีก จนกว่าจะกด &quot;เปิดสาขาใหม่&quot;
          </p>
          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          <Button type="button" variant="danger" size="sm" disabled={pending} loading={pending} onClick={submit} className="w-full">
            ยืนยันปิดสาขา
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function ReopenBranchButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const res = await reopenBranch(branchId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`เปิดสาขา "${branchName}" ใหม่แล้ว`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
    >
      เปิดสาขาใหม่
    </button>
  );
}
