"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addMachineToGroup } from "@/lib/clawfleet/actions";

export function AssignMachineGroupForm({
  machineId,
  currentGroupId,
  groups,
}: {
  machineId: string;
  currentGroupId: string | null;
  groups: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [selected, setSelected] = useState(currentGroupId ?? "");

  function submit() {
    if (!selected || selected === currentGroupId) return;
    setError(null); setOk(false);
    startTransition(async () => {
      const r = await addMachineToGroup(machineId, selected);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 text-sm text-amber-800">
        ยังไม่มีกลุ่มในสาขานี้ ·{" "}
        <Link href="/clawfleet/groups" className="font-medium underline">
          สร้างกลุ่มก่อน
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="mb-2 font-semibold text-zinc-900">กลุ่ม</h2>
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="">— ไม่อยู่ในกลุ่ม —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !selected || selected === currentGroupId}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
        >
          {pending ? "..." : "ย้าย"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {ok && <p className="mt-2 text-xs text-emerald-700">✅ ย้ายแล้ว</p>}
    </div>
  );
}
