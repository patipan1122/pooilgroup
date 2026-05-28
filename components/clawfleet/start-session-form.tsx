"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startSession } from "@/lib/clawfleet/actions";

type Group = {
  id: string;
  name: string;
  branch: { name: string; code: string };
  exchanger: { code: string } | null;
  _count: { machines: number };
};

export function StartSessionForm({
  groups,
  existingOpen,
}: {
  groups: Group[];
  existingOpen: Record<string, string>; // groupId → sessionId
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!selectedGroup) {
      setError("เลือกกลุ่มก่อน");
      return;
    }
    if (existingOpen[selectedGroup]) {
      router.push(`/clawfleet/sessions/${existingOpen[selectedGroup]}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await startSession({ groupId: selectedGroup });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/clawfleet/sessions/${r.data?.id}`);
    });
  }

  return (
    <div className="space-y-3">
      {groups.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ยังไม่มีกลุ่มตู้ใน scope ของคุณ · ขอให้หัวหน้าสาขาสร้างกลุ่มก่อน
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => {
            const isOpen = !!existingOpen[g.id];
            const selected = selectedGroup === g.id;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setSelectedGroup(g.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-blue-500 bg-blue-50/50 ring-2 ring-blue-200"
                      : "border-zinc-200 bg-white hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-zinc-900">{g.name}</div>
                      <div className="text-xs text-zinc-500">
                        {g.branch.name} · ตู้ {g._count.machines} ตู้
                        {g.exchanger ? ` · ตู้แลก ${g.exchanger.code}` : " · ไม่มีตู้แลก"}
                      </div>
                    </div>
                    {isOpen && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        เปิดอยู่ → ทำต่อ
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!selectedGroup || pending}
        className="w-full rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "กำลังเปิด..." : "เริ่มรอบเก็บ →"}
      </button>
    </div>
  );
}
