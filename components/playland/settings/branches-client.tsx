"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertBranch } from "@/lib/playland/actions";
import { Building2, PlusCircle, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

interface Branch {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  active: boolean;
}

export function BranchesClient({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showForm, setShowForm] = useState(branches.length === 0);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [active, setActive] = useState(editing?.active ?? true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function startEdit(b: Branch) {
    setEditing(b);
    setName(b.name); setSlug(b.slug); setAddress(b.address ?? ""); setPhone(b.phone ?? ""); setActive(b.active);
    setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setName(""); setSlug(""); setAddress(""); setPhone(""); setActive(true);
    setShowForm(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await upsertBranch({ id: editing?.id, name, slug, address: address || undefined, phone: phone || undefined, active });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: editing ? "อัปเดตสาขาแล้ว" : "สร้างสาขาใหม่แล้ว" });
      setShowForm(false);
      router.refresh();
    });
  }

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}><ArrowLeft size={12} /> Settings</Link>
          <h1>สาขา · {branches.length}</h1>
        </div>
        <button className="pl-btn pl-btn-primary" onClick={startNew}><PlusCircle size={14} /> เพิ่มสาขา</button>
      </header>

      {msg && <div style={{ padding: "8px 16px", background: msg.kind === "ok" ? "#dcfce7" : "#fee2e2", color: msg.kind === "ok" ? "#166534" : "#991b1b", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>{msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}</div>}

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: showForm ? "1fr 380px" : "1fr", gap: 16 }}>
        <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="pl-table">
            <thead><tr><th>ชื่อ</th><th>Slug (URL)</th><th>ที่อยู่</th><th>เบอร์</th><th>Active</th></tr></thead>
            <tbody>
              {branches.length === 0 && <tr><td colSpan={5}><div className="pl-empty"><Building2 size={28} opacity={0.4} />ยังไม่มีสาขา</div></td></tr>}
              {branches.map((b) => (
                <tr key={b.id} onClick={() => startEdit(b)}>
                  <td style={{ fontWeight: 600 }}>{b.name}</td>
                  <td><code style={{ fontSize: 12 }}>{b.slug}</code></td>
                  <td>{b.address ?? "—"}</td>
                  <td>{b.phone ?? "—"}</td>
                  <td>{b.active ? <span className="pl-chip pl-chip-ok">ใช้งาน</span> : <span className="pl-chip pl-chip-muted">ปิด</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showForm && (
          <form className="pl-card" onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            <div className="pl-eyebrow">{editing ? "แก้สาขา" : "สาขาใหม่"}</div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อสาขา *</label>
              <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Slug (สำหรับ URL public · ใช้ภาษาอังกฤษ) *</label>
              <input className="pl-input" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="เช่น central-westgate" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ที่อยู่</label>
              <input className="pl-input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>เบอร์</label>
              <input className="pl-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ marginRight: 6 }} /> เปิดใช้งานสาขา</label>
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
