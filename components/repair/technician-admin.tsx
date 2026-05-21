"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTechnician, toggleTechnicianActive } from "@/lib/repair/actions";
import { TECHNICIAN_KIND_LABELS } from "@/lib/repair/types";
import {
  Plus,
  AlertCircle,
  Phone,
  Power,
  Search,
  Building2,
  Wrench,
  X,
} from "lucide-react";

interface Tech {
  id: string;
  name: string;
  kind: "INTERNAL" | "VENDOR";
  phone: string | null;
  lineId: string | null;
  specialties: string[];
  isActive: boolean;
  userName: string | null;
  activeJobs: number;
  urgentJobs: number;
}

export function TechnicianAdmin({ technicians }: { technicians: Tech[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "INTERNAL" | "VENDOR" | "active" | "inactive">("all");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return technicians.filter((t) => {
      if (filter === "INTERNAL" && t.kind !== "INTERNAL") return false;
      if (filter === "VENDOR" && t.kind !== "VENDOR") return false;
      if (filter === "active" && !t.isActive) return false;
      if (filter === "inactive" && t.isActive) return false;
      if (q) {
        const s = (
          t.name +
          " " +
          (t.phone ?? "") +
          " " +
          t.specialties.join(" ")
        ).toLowerCase();
        if (!s.includes(q)) return false;
      }
      return true;
    });
  }, [technicians, filter, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (a.activeJobs !== b.activeJobs) return b.activeJobs - a.activeJobs;
      return a.name.localeCompare(b.name, "th");
    });
  }, [filtered]);

  const maxLoad = Math.max(1, ...technicians.map((t) => t.activeJobs));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-zinc-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-[280px] min-w-[200px]">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ · เบอร์ · ทักษะ"
            className="w-full h-8 pl-8 pr-2 rounded-md border border-zinc-200 text-[12.5px] focus:border-blue-400 outline-none"
          />
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          {(
            [
              { key: "all", label: "ทั้งหมด" },
              { key: "INTERNAL", label: "ช่างใน" },
              { key: "VENDOR", label: "Vendor" },
              { key: "active", label: "ใช้งาน" },
              { key: "inactive", label: "ปิด" },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center h-6 px-2 rounded border text-[11px] font-medium ${
                filter === f.key
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11.5px] text-zinc-500 tabular-nums">
          {sorted.length} / {technicians.length} คน
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[12px] shadow-sm shadow-blue-600/20"
        >
          <Plus className="size-3.5" />
          เพิ่มช่าง
        </button>
      </div>

      {/* Add form (slide-in) */}
      {open && (
        <form
          onSubmit={submit}
          className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-zinc-900">เพิ่มช่างใหม่</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="size-7 grid place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="flex gap-2">
            {(["INTERNAL", "VENDOR"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-9 px-3 rounded-lg font-semibold text-[12.5px] border ${
                  kind === k
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200"
                }`}
              >
                {k === "INTERNAL" ? (
                  <Wrench className="size-3.5 inline mr-1.5" />
                ) : (
                  <Building2 className="size-3.5 inline mr-1.5" />
                )}
                {TECHNICIAN_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="ชื่อ-นามสกุล"
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-[13px] focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none"
          />
          <div className="grid sm:grid-cols-2 gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เบอร์โทร"
              inputMode="tel"
              className="h-10 px-3 rounded-lg border border-zinc-200 text-[13px] focus:border-blue-400 outline-none"
            />
            <input
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              placeholder="LINE ID (ไม่บังคับ)"
              className="h-10 px-3 rounded-lg border border-zinc-200 text-[13px] focus:border-blue-400 outline-none"
            />
          </div>
          <input
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="ทักษะ คั่นด้วย comma เช่น แอร์, ไฟฟ้า, ท่อ"
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-[13px] focus:border-blue-400 outline-none"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="โน้ตเพิ่มเติม (ไม่บังคับ)"
            className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-[13px] focus:border-blue-400 outline-none resize-y"
          />
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex gap-2 text-red-800 text-[12.5px]">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending || name.trim().length < 2}
              className="h-10 px-4 rounded-lg bg-zinc-900 text-white font-semibold text-[12.5px] hover:bg-zinc-700 disabled:opacity-50"
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 px-4 rounded-lg bg-white border border-zinc-200 text-zinc-700 font-semibold text-[12.5px] hover:bg-zinc-50"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Roster grid */}
      {sorted.length === 0 ? (
        <div className="bg-white border border-dashed border-zinc-300 rounded-xl p-10 text-center">
          <Wrench className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 text-sm font-semibold text-zinc-900">ไม่พบช่างที่ตรงเงื่อนไข</p>
          <p className="mt-1 text-[12px] text-zinc-500">ลองล้างตัวกรอง หรือ เพิ่มช่างใหม่</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sorted.map((t) => {
            const loadPct = Math.min(100, (t.activeJobs / maxLoad) * 100);
            const loadTone =
              t.activeJobs >= 7
                ? "bg-red-500"
                : t.activeJobs >= 4
                  ? "bg-amber-500"
                  : "bg-emerald-500";
            return (
              <div
                key={t.id}
                className={`bg-white border border-zinc-200 rounded-xl p-4 flex flex-col gap-3 ${
                  !t.isActive ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="size-10 rounded-full grid place-items-center text-white font-bold text-sm shrink-0"
                    style={{ background: techColor(t.id) }}
                  >
                    {t.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 truncate">{t.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold border ${
                          t.kind === "INTERNAL"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-violet-50 text-violet-700 border-violet-200"
                        }`}
                      >
                        {TECHNICIAN_KIND_LABELS[t.kind]}
                      </span>
                      {!t.isActive && (
                        <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold border bg-zinc-100 text-zinc-600 border-zinc-200">
                          ปิดใช้งาน
                        </span>
                      )}
                    </div>
                    {t.userName && (
                      <p className="text-[10.5px] text-zinc-500 mt-0.5">
                        user: {t.userName}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(t.id)}
                    disabled={isPending}
                    title={t.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    className="size-7 grid place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
                  >
                    <Power className="size-3.5" />
                  </button>
                </div>

                {/* Workload */}
                <div>
                  <div className="flex items-center justify-between text-[11.5px] mb-1">
                    <span className="text-zinc-500">Workload</span>
                    <span className="tabular-nums font-bold text-zinc-900">
                      {t.activeJobs}
                      {t.urgentJobs > 0 && (
                        <span className="text-red-600 font-semibold ml-1.5">
                          · {t.urgentJobs} ด่วน
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${loadTone}`}
                      style={{ width: `${Math.max(2, loadPct)}%` }}
                    />
                  </div>
                </div>

                {/* Contact */}
                {(t.phone || t.lineId) && (
                  <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                    {t.phone && (
                      <a
                        href={`tel:${t.phone}`}
                        className="inline-flex items-center gap-1 px-2 h-6 rounded bg-zinc-100 text-zinc-700 hover:bg-zinc-200 font-medium tabular-nums"
                      >
                        <Phone className="size-3" />
                        {t.phone}
                      </a>
                    )}
                    {t.lineId && (
                      <span className="inline-flex items-center gap-1 px-2 h-6 rounded bg-emerald-50 text-emerald-700 font-medium">
                        LINE · {t.lineId}
                      </span>
                    )}
                  </div>
                )}

                {/* Skills */}
                {t.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.specialties.map((s) => (
                      <span
                        key={s}
                        className="text-[10.5px] bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded font-medium"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function techColor(id: string): string {
  const palette = [
    "#2563EB", "#7C3AED", "#DB2777", "#059669",
    "#EA580C", "#0891B2", "#CA8A04", "#475569",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
