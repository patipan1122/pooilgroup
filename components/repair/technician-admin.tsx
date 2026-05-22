"use client";

// Pooil App · technicians admin · uses .panel .workload-row tech-chip + .table-filter pills

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
      if (!r.ok) { setError(r.error ?? "เพิ่มไม่สำเร็จ"); return; }
      setName(""); setPhone(""); setLineId(""); setSpecialties(""); setNotes("");
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
        const s = (t.name + " " + (t.phone ?? "") + " " + t.specialties.join(" ")).toLowerCase();
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Toolbar */}
      <div className="panel" style={{ padding: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <div className="table-search" style={{ maxWidth: 280, flex: 1 }}>
          <Search size={13} style={{ color: "var(--ink-400)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นชื่อ · เบอร์ · ทักษะ"
          />
        </div>
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
            className={"table-filter " + (filter === f.key ? "is-active" : "")}
          >
            {f.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="num" style={{ fontSize: 11.5, color: "var(--ink-500)" }}>
          {sorted.length} / {technicians.length} คน
        </span>
        <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
          <Plus />
          เพิ่มช่าง
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-900)", margin: 0 }}>
              เพิ่มช่างใหม่
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-icon btn-ghost"
            >
              <X />
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["INTERNAL", "VENDOR"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={"btn btn-sm " + (kind === k ? "btn-primary" : "")}
              >
                {k === "INTERNAL" ? <Wrench /> : <Building2 />}
                {TECHNICIAN_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="ชื่อ-นามสกุล"
            className="composer-input"
            style={{
              width: "100%", height: 36, padding: "0 12px",
              borderRadius: 8, border: "1px solid var(--line)",
              fontFamily: "inherit", fontSize: 13, outline: 0,
              background: "var(--surface)",
            }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เบอร์โทร"
              inputMode="tel"
              style={{
                height: 36, padding: "0 12px",
                borderRadius: 8, border: "1px solid var(--line)",
                fontFamily: "inherit", fontSize: 13, outline: 0,
                background: "var(--surface)",
              }}
            />
            <input
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              placeholder="LINE ID (ไม่บังคับ)"
              style={{
                height: 36, padding: "0 12px",
                borderRadius: 8, border: "1px solid var(--line)",
                fontFamily: "inherit", fontSize: 13, outline: 0,
                background: "var(--surface)",
              }}
            />
          </div>
          <input
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="ทักษะ คั่นด้วย comma เช่น แอร์, ไฟฟ้า, ท่อ"
            style={{
              height: 36, padding: "0 12px",
              borderRadius: 8, border: "1px solid var(--line)",
              fontFamily: "inherit", fontSize: 13, outline: 0,
              background: "var(--surface)",
            }}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="โน้ตเพิ่มเติม (ไม่บังคับ)"
            style={{
              padding: 12,
              borderRadius: 8, border: "1px solid var(--line)",
              fontFamily: "inherit", fontSize: 13, outline: 0,
              background: "var(--surface)", resize: "vertical",
            }}
          />
          {error && (
            <div style={{
              background: "#FEF2F2", border: "1px solid #FECACA",
              borderRadius: 8, padding: 10,
              display: "flex", alignItems: "flex-start", gap: 8,
              color: "var(--bad)", fontSize: 12.5,
            }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={isPending || name.trim().length < 2}
              className="btn btn-primary"
              style={{ background: "var(--ink-900)", borderColor: "var(--ink-1000)" }}
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Roster grid */}
      {sorted.length === 0 ? (
        <div className="panel" style={{
          padding: 40, textAlign: "center",
          borderStyle: "dashed", borderColor: "var(--ink-300)",
        }}>
          <Wrench size={32} style={{ color: "var(--ink-300)" }} />
          <p style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--ink-900)" }}>
            ไม่พบช่างตรงเงื่อนไข
          </p>
          <p style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}>
            ลองล้างตัวกรอง หรือเพิ่มช่างใหม่
          </p>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}>
          {sorted.map((t) => {
            const loadPct = Math.min(100, (t.activeJobs / maxLoad) * 100);
            const tone = t.activeJobs >= 7 ? "is-high" : t.activeJobs >= 4 ? "is-med" : "is-low";
            return (
              <div
                key={t.id}
                className="panel"
                style={{
                  padding: 14, display: "flex", flexDirection: "column", gap: 10,
                  opacity: t.isActive ? 1 : 0.6,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span
                    className="tech-chip"
                    style={{
                      width: 40, height: 40, fontSize: 15,
                      background: techColor(t.id),
                    }}
                  >
                    {t.name.charAt(0)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-900)" }}>
                      {t.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span className={
                        "pill " +
                        (t.kind === "INTERNAL" ? "pill-new" : "pill-assess")
                      }>
                        {TECHNICIAN_KIND_LABELS[t.kind]}
                      </span>
                      {!t.isActive && (
                        <span className="pill pill-low">ปิด</span>
                      )}
                    </div>
                    {t.userName && (
                      <div style={{ fontSize: 10.5, color: "var(--ink-500)", marginTop: 2 }}>
                        user: {t.userName}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(t.id)}
                    disabled={isPending}
                    title={t.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    className="btn btn-icon btn-ghost"
                  >
                    <Power />
                  </button>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4 }}>
                    <span style={{ color: "var(--ink-500)" }}>Workload</span>
                    <span className="num" style={{ color: "var(--ink-900)", fontWeight: 600 }}>
                      {t.activeJobs}
                      {t.urgentJobs > 0 && (
                        <span style={{ color: "var(--bad)", marginLeft: 6, fontWeight: 600 }}>
                          · {t.urgentJobs} ด่วน
                        </span>
                      )}
                    </span>
                  </div>
                  <div className={"workload-bar " + tone}>
                    <div style={{ width: `${Math.max(2, loadPct)}%` }} />
                  </div>
                </div>

                {(t.phone || t.lineId) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {t.phone && (
                      <a
                        href={`tel:${t.phone}`}
                        className="tag"
                        style={{ fontSize: 11.5, padding: "2px 8px" }}
                      >
                        <Phone size={10} /> {t.phone}
                      </a>
                    )}
                    {t.lineId && (
                      <span className="tag" style={{
                        fontSize: 11.5, padding: "2px 8px",
                        background: "#ECFDF5", color: "#047857",
                      }}>
                        LINE · {t.lineId}
                      </span>
                    )}
                  </div>
                )}

                {t.specialties.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {t.specialties.map((s) => (
                      <span key={s} className="tag">{s}</span>
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
