"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMachine } from "@/lib/clawfleet/actions";

export function NewMachineForm({
  branches,
  groups,
}: {
  branches: { id: string; name: string }[];
  groups: { id: string; name: string; branchId: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    branchId: branches[0]?.id ?? "",
    groupId: "",
    code: "",
    nickname: "",
    kind: "CLAW" as "CLAW" | "EXCHANGER",
    initialCoinMeter: "0",
    initialDollMeter: "0",
    notes: "",
  });

  const branchGroups = groups.filter((g) => g.branchId === form.branchId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createMachine({
        branchId: form.branchId,
        groupId: form.groupId || undefined,
        code: form.code,
        nickname: form.nickname || undefined,
        kind: form.kind,
        initialCoinMeter: Number(form.initialCoinMeter) || 0,
        initialDollMeter: Number(form.initialDollMeter) || 0,
        notes: form.notes || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/clawfleet/machines/${form.code}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <Field label="สาขา">
        <select
          required
          value={form.branchId}
          onChange={(e) =>
            setForm((f) => ({ ...f, branchId: e.target.value, groupId: "" }))
          }
          className="w-full rounded-xl border border-zinc-300 px-3 py-2"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="ชนิดตู้">
        <select
          value={form.kind}
          onChange={(e) =>
            setForm((f) => ({ ...f, kind: e.target.value as "CLAW" | "EXCHANGER" }))
          }
          className="w-full rounded-xl border border-zinc-300 px-3 py-2"
        >
          <option value="CLAW">ตู้คีบ</option>
          <option value="EXCHANGER">ตู้แลกเหรียญ</option>
        </select>
      </Field>
      <Field label="รหัสตู้ (เฉพาะตัว · ห้ามซ้ำในสาขา)">
        <input
          required
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2"
          placeholder="เช่น CW-CPW-001 หรือ EX-CPW-01"
        />
      </Field>
      <Field label="ชื่อเล่น (ถ้ามี)">
        <input
          value={form.nickname}
          onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2"
          placeholder="เช่น ตู้ใกล้ลิฟต์"
        />
      </Field>
      <Field label="กลุ่ม (ถ้ามี)">
        <select
          value={form.groupId}
          onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2"
        >
          <option value="">ไม่กำหนด</option>
          {branchGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="มิเตอร์เหรียญเริ่มต้น">
          <input
            inputMode="numeric"
            value={form.initialCoinMeter}
            onChange={(e) =>
              setForm((f) => ({ ...f, initialCoinMeter: e.target.value.replace(/[^0-9]/g, "") }))
            }
            className="w-full rounded-xl border border-zinc-300 px-3 py-2"
          />
        </Field>
        {form.kind === "CLAW" && (
          <Field label="มิเตอร์ตุ๊กตาเริ่มต้น">
            <input
              inputMode="numeric"
              value={form.initialDollMeter}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  initialDollMeter: e.target.value.replace(/[^0-9]/g, ""),
                }))
              }
              className="w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
          </Field>
        )}
      </div>
      <Field label="หมายเหตุ">
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={2}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2"
        />
      </Field>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "กำลังบันทึก..." : "เพิ่มตู้"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
