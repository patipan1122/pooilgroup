"use client";

// Pooil App · categories admin · uses design vocab (.panel, .btn, .pill)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategory } from "@/lib/repair/actions";
import { URGENCY_LABELS } from "@/lib/repair/types";
import type { RepairUrgency } from "@/lib/generated/prisma/enums";
import { Plus, AlertCircle, X } from "lucide-react";

interface Cat {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
  defaultUrgency: RepairUrgency;
  sortOrder: number;
}

const URGENCY_CLS: Record<RepairUrgency, string> = {
  URGENT: "pill-urgent",
  NORMAL: "pill-normal",
  LOW: "pill-low",
};

export function CategoryAdmin({ categories }: { categories: Cat[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("🛠");
  const [urgency, setUrgency] = useState<RepairUrgency>("NORMAL");
  const [sortOrder, setSortOrder] = useState(100);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createCategory({
        slug: slug.trim().toLowerCase(),
        label: label.trim(),
        emoji: emoji.trim() || undefined,
        defaultUrgency: urgency,
        sortOrder,
      });
      if (!r.ok) { setError(r.error ?? "เพิ่มไม่สำเร็จ"); return; }
      setSlug(""); setLabel(""); setEmoji("🛠"); setSortOrder(100);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!open ? (
        <div>
          <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
            <Plus />
            เพิ่มหมวด
          </button>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="panel"
          style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--ink-900)" }}>
              เพิ่มหมวดใหม่
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-icon btn-ghost">
              <X />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                ชื่อแสดง
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                placeholder="เช่น แอร์ / เครื่องปรับอากาศ"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Emoji
              </label>
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={4}
                style={{ ...inputStyle, fontSize: 22, textAlign: "center" }}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Slug
              </label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                pattern="[a-z0-9\-]+"
                placeholder="เช่น ac"
                style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                เร่งด่วน default
              </label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as RepairUrgency)}
                style={inputStyle}
              >
                {(["URGENT", "NORMAL", "LOW"] as const).map((u) => (
                  <option key={u} value={u}>{URGENCY_LABELS[u]}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                ลำดับแสดง
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value || "0", 10))}
                style={inputStyle}
              />
            </div>
          </div>
          {error && (
            <div style={{
              background: "#FEF2F2", border: "1px solid #FECACA",
              borderRadius: 8, padding: 8,
              display: "flex", gap: 6, color: "var(--bad)", fontSize: 12,
            }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={isPending || !label.trim() || !slug.trim()}
              className="btn btn-primary"
              style={{ background: "var(--ink-900)", borderColor: "var(--ink-1000)" }}
            >
              บันทึก
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn">
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        {categories.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}>
            ยังไม่มีหมวด
          </div>
        ) : (
          categories.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px",
                borderBottom: i === categories.length - 1 ? 0 : "1px solid var(--line-2)",
              }}
            >
              <span style={{ fontSize: 24 }}>{c.emoji ?? "🛠"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-900)" }}>
                  {c.label}
                </div>
                <div style={{
                  fontSize: 11, color: "var(--ink-500)",
                  display: "flex", alignItems: "center", gap: 8, marginTop: 1,
                }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{c.slug}</span>
                  <span style={{ color: "var(--ink-300)" }}>·</span>
                  <span>default</span>
                  <span className={"pill " + URGENCY_CLS[c.defaultUrgency]} style={{ fontSize: 10 }}>
                    {URGENCY_LABELS[c.defaultUrgency]}
                  </span>
                  <span style={{ color: "var(--ink-300)" }}>·</span>
                  <span>sort {c.sortOrder}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  marginTop: 4,
  width: "100%", height: 34, padding: "0 10px",
  borderRadius: 8, border: "1px solid var(--line)",
  fontFamily: "inherit", fontSize: 13, outline: 0,
  background: "var(--surface)",
};
