"use client";

// ClawFleet · Operations · "+ เริ่มรอบใหม่" CTA in page header
// Opens modal with group picker (reuses existing StartSessionForm).

import { useState } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { StartSessionForm } from "@/components/clawfleet/start-session-form";

type Group = {
  id: string;
  name: string;
  branch: { name: string; code: string };
  exchanger: { code: string } | null;
  _count: { machines: number };
};

interface Props {
  groups: Group[];
  existingOpen: Record<string, string>;
}

export function StartSessionCta({ groups, existingOpen }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">เริ่มรอบใหม่</span>
        <span className="sm:hidden">รอบใหม่</span>
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="เลือกกลุ่มที่จะเริ่มเก็บ">
        <StartSessionForm groups={groups} existingOpen={existingOpen} />
      </Dialog>
    </>
  );
}
