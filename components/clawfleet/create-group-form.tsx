"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGroup } from "@/lib/clawfleet/actions";

export function CreateGroupForm({
  branches,
  unattachedExchangers,
}: {
  branches: { id: string; name: string }[];
  unattachedExchangers: { id: string; code: string; branchId: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    branchId: branches[0]?.id ?? "",
    name: "",
    exchangerId: "",
    toleranceBps: "500",
  });

  const branchExchangers = unattachedExchangers.filter((e) => e.branchId === form.branchId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createGroup({
        branchId: form.branchId,
        name: form.name,
        exchangerId: form.exchangerId || undefined,
        toleranceBps: Number(form.toleranceBps) || 500,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setForm({ branchId: branches[0]?.id ?? "", name: "", exchangerId: "", toleranceBps: "500" });
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        + สร้างกลุ่ม
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4"
    >
      <h3 className="font-semibold text-zinc-900">สร้างกลุ่มใหม่</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-xs text-zinc-600">สาขา</span>
          <select
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value, exchangerId: "" }))}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-600">ชื่อกลุ่ม</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
            placeholder="เช่น โซน A ชุมพวง"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-600">ตู้แลก (ถ้ามี)</span>
          <select
            value={form.exchangerId}
            onChange={(e) => setForm((f) => ({ ...f, exchangerId: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
          >
            <option value="">ไม่กำหนด</option>
            {branchExchangers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-600">Tolerance (bps · 500=5%)</span>
          <input
            inputMode="numeric"
            value={form.toleranceBps}
            onChange={(e) =>
              setForm((f) => ({ ...f, toleranceBps: e.target.value.replace(/[^0-9]/g, "") }))
            }
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
          />
        </label>
      </div>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
        >
          {pending ? "กำลังสร้าง..." : "สร้าง"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
