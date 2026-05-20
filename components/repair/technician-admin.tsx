"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTechnician, toggleTechnicianActive } from "@/lib/repair/actions";
import { TECHNICIAN_KIND_LABELS } from "@/lib/repair/types";
import { Plus, AlertCircle, Phone, Power } from "lucide-react";

interface Tech {
  id: string;
  name: string;
  kind: "INTERNAL" | "VENDOR";
  phone: string | null;
  lineId: string | null;
  specialties: string[];
  isActive: boolean;
  userName: string | null;
}

export function TechnicianAdmin({ technicians }: { technicians: Tech[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"INTERNAL" | "VENDOR">("VENDOR");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createTechnician({
        kind,
        name: name.trim(),
        phone: phone.trim() || undefined,
        lineId: lineId.trim() || undefined,
        specialties: specialties.split(",").map((s) => s.trim()).filter(Boolean),
        notes: notes.trim() || undefined,
      });
      if (!r.ok) {
        setError(r.error ?? "เพิ่มไม่สำเร็จ");
        return;
      }
      setName("");
      setPhone("");
      setLineId("");
      setSpecialties("");
      setNotes("");
      setOpen(false);
      router.refresh();
    });
  }

  function toggle(id: string) {
    startTransition(async () => {
      await toggleTechnicianActive({ id });
      router.refresh();
    });
  }

  const sorted = [...technicians].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "INTERNAL" ? -1 : 1;
    return a.name.localeCompare(b.name, "th");
  });

  return (
    <div className="space-y-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)]"
        >
          <Plus className="size-4" />
          เพิ่มช่าง
        </button>
      ) : (
        <form onSubmit={submit} className="bg-white rounded-2xl border-2 border-zinc-200 p-4 space-y-3">
          <h2 className="font-extrabold text-zinc-900">เพิ่มช่างใหม่</h2>
          <div className="flex gap-2">
            {(["VENDOR", "INTERNAL"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-9 px-3 rounded-lg font-bold text-sm border-2 ${
                  kind === k
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200"
                }`}
              >
                {TECHNICIAN_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="ชื่อ-นามสกุล"
            className="w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm focus:border-[var(--color-brand-500)] outline-none"
          />
          <div className="grid sm:grid-cols-2 gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เบอร์โทร"
              inputMode="tel"
              className="h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm focus:border-[var(--color-brand-500)] outline-none"
            />
            <input
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              placeholder="LINE ID (ไม่บังคับ)"
              className="h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm focus:border-[var(--color-brand-500)] outline-none"
            />
          </div>
          <input
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="ความถนัด (คั่นด้วย comma) เช่น แอร์, ไฟฟ้า"
            className="w-full h-10 px-3 rounded-lg border-2 border-zinc-200 text-sm focus:border-[var(--color-brand-500)] outline-none"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="โน้ตเพิ่มเติม (ไม่บังคับ)"
            className="w-full px-3 py-2 rounded-lg border-2 border-zinc-200 text-sm focus:border-[var(--color-brand-500)] outline-none resize-y"
          />
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex gap-2 text-red-800 text-sm">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending || name.trim().length < 2}
              className="h-10 px-4 rounded-lg bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 px-4 rounded-lg bg-white border-2 border-zinc-200 text-zinc-700 font-bold text-sm hover:bg-zinc-50"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-bold">ชื่อ</th>
              <th className="px-3 py-2 font-bold">ประเภท</th>
              <th className="px-3 py-2 font-bold">ติดต่อ</th>
              <th className="px-3 py-2 font-bold">ความถนัด</th>
              <th className="px-3 py-2 font-bold text-right">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-zinc-500">
                  ยังไม่มีช่างในระบบ
                </td>
              </tr>
            )}
            {sorted.map((t) => (
              <tr key={t.id} className={t.isActive ? "" : "opacity-50"}>
                <td className="px-3 py-2">
                  <p className="font-bold text-zinc-900">{t.name}</p>
                  {t.userName && (
                    <p className="text-xs text-zinc-500">user: {t.userName}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 h-6 rounded text-[10px] font-bold border ${
                    t.kind === "INTERNAL"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-violet-50 text-violet-700 border-violet-200"
                  }`}>
                    {TECHNICIAN_KIND_LABELS[t.kind]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {t.phone && (
                    <a href={`tel:${t.phone}`} className="inline-flex items-center gap-1 text-zinc-900 hover:underline">
                      <Phone className="size-3" />
                      {t.phone}
                    </a>
                  )}
                  {t.lineId && <p className="text-zinc-500">LINE: {t.lineId}</p>}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-700">
                  {t.specialties.length > 0 ? t.specialties.join(", ") : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(t.id)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-bold border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50"
                  >
                    <Power className="size-3" />
                    {t.isActive ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
