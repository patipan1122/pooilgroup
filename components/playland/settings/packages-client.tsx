"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertPackage } from "@/lib/playland/actions";
import { thb, packageTypeLabel } from "@/lib/playland/format";
import { Package, PlusCircle, ArrowLeft } from "lucide-react";

interface Branch { id: string; name: string; }
interface Pkg {
  id: string; branchId: string | null; type: string; name: string; description: string | null;
  minutes: number | null; price: number; perMinuteRate: number | null; active: boolean;
}

const TYPES = [
  { v: "FIXED", label: "Fixed (เหมา)" },
  { v: "PER_MINUTE", label: "Pay-per-minute" },
  { v: "DAY_PASS", label: "Day Pass" },
] as const;

export function PackagesClient({ branches, packages }: { branches: Branch[]; packages: Pkg[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]["v"]>("FIXED");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [price, setPrice] = useState("100");
  const [perMinute, setPerMinute] = useState("2");
  const [branchId, setBranchId] = useState<string | "">("");
  const [active, setActive] = useState(true);

  function startEdit(p: Pkg) {
    setEditing(p);
    setType(p.type as (typeof TYPES)[number]["v"]);
    setName(p.name);
    setDescription(p.description ?? "");
    setMinutes(String(p.minutes ?? 60));
    setPrice(((p.price ?? 0) / 100).toString());
    setPerMinute(((p.perMinuteRate ?? 200) / 100).toString());
    setBranchId(p.branchId ?? "");
    setActive(p.active);
    setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setType("FIXED"); setName(""); setDescription(""); setMinutes("60"); setPrice("100"); setPerMinute("2"); setBranchId(""); setActive(true);
    setShowForm(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const priceCents = Math.round(parseFloat(price || "0") * 100);
      const perMinuteCents = Math.round(parseFloat(perMinute || "0") * 100);
      const res = await upsertPackage({
        id: editing?.id,
        branchId: branchId || null,
        type,
        name,
        description: description || undefined,
        minutes: type === "DAY_PASS" ? undefined : parseInt(minutes || "0"),
        price: priceCents,
        perMinuteRate: type === "PER_MINUTE" ? perMinuteCents : undefined,
        active,
      });
      if (res.ok) { setShowForm(false); router.refresh(); }
    });
  }

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}><ArrowLeft size={12} /> Settings</Link>
          <h1>Packages · {packages.length}</h1>
        </div>
        <button className="pl-btn pl-btn-primary" onClick={startNew}><PlusCircle size={14} /> เพิ่ม Package</button>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: showForm ? "1fr 380px" : "1fr", gap: 16 }}>
        <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="pl-table">
            <thead><tr><th>ชื่อ</th><th>ประเภท</th><th>นาที</th><th>ราคา</th><th>สาขา</th><th>Active</th></tr></thead>
            <tbody>
              {packages.length === 0 && <tr><td colSpan={6}><div className="pl-empty"><Package size={28} opacity={0.4} />ยังไม่มี package</div></td></tr>}
              {packages.map((p) => (
                <tr key={p.id} onClick={() => startEdit(p)}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><span className="pl-chip pl-chip-brand">{packageTypeLabel(p.type)}</span></td>
                  <td>{p.type === "DAY_PASS" ? "ทั้งวัน" : p.type === "PER_MINUTE" ? `${(p.perMinuteRate ?? 0) / 100}฿/min` : `${p.minutes ?? 0}`}</td>
                  <td style={{ fontWeight: 600 }}>{thb(p.price)}</td>
                  <td>{branches.find((b) => b.id === p.branchId)?.name ?? "ทุกสาขา"}</td>
                  <td>{p.active ? <span className="pl-chip pl-chip-ok">ใช้</span> : <span className="pl-chip pl-chip-muted">ปิด</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showForm && (
          <form className="pl-card" onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            <div className="pl-eyebrow">{editing ? "แก้ package" : "package ใหม่"}</div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ประเภท *</label>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {TYPES.map((t) => (
                  <button type="button" key={t.v} className="pl-btn pl-btn-sm" onClick={() => setType(t.v)} style={type === t.v ? { background: "var(--pl-brand)", color: "white", borderColor: "var(--pl-brand)" } : {}}>{t.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อ *</label>
              <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น 60 นาที / Day Pass" />
            </div>
            {type !== "DAY_PASS" && (
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>นาที</label>
                <input className="pl-input" type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </div>
            )}
            {type === "PER_MINUTE" && (
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ราคาต่อนาที (บาท)</label>
                <input className="pl-input" type="number" step="0.01" value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ราคา (บาท)</label>
              <input className="pl-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>สาขา</label>
              <select className="pl-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">ทุกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ marginRight: 6 }} /> Active</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="pl-btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={pending}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
