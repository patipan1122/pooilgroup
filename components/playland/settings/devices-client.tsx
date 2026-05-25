"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertDevice } from "@/lib/playland/actions";
import { fmtDateTime, deviceStatusChipClass } from "@/lib/playland/format";
import { ScanFace, PlusCircle, ArrowLeft, Copy } from "lucide-react";

interface Branch { id: string; name: string; }
interface Device {
  id: string; branchId: string; branchName: string; vendor: string;
  deviceId: string; deviceName: string; baseUrl: string | null;
  protocol: string; modelVersion: string; status: string;
  lastSeenAt: string | null; webhookSecret: string | null;
}

export function DevicesClient({ branches, devices }: { branches: Branch[]; devices: Device[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Device | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [vendor, setVendor] = useState("acs-auto");
  const [baseUrl, setBaseUrl] = useState("");
  const [protocol, setProtocol] = useState<"http" | "tcp">("http");
  const [modelVersion, setModelVersion] = useState<"B" | "C">("C");
  const [webhookSecret, setWebhookSecret] = useState("");

  function startEdit(d: Device) {
    setEditing(d);
    setBranchId(d.branchId); setDeviceId(d.deviceId); setDeviceName(d.deviceName); setVendor(d.vendor);
    setBaseUrl(d.baseUrl ?? ""); setProtocol(d.protocol as "http" | "tcp"); setModelVersion(d.modelVersion as "B" | "C");
    setWebhookSecret(d.webhookSecret ?? ""); setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setBranchId(branches[0]?.id ?? ""); setDeviceId(""); setDeviceName(""); setVendor("acs-auto");
    setBaseUrl(""); setProtocol("http"); setModelVersion("C");
    setWebhookSecret(crypto.randomUUID().replace(/-/g, "").slice(0, 24));
    setShowForm(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await upsertDevice({
        id: editing?.id, branchId, deviceId, deviceName, vendor,
        baseUrl: baseUrl || undefined, protocol, modelVersion, webhookSecret: webhookSecret || undefined,
      });
      if (res.ok) { setShowForm(false); router.refresh(); }
    });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://pooilgroup.vercel.app";
  const webhookUrl = (d: Device) => `${origin}/api/playland/acs/event?device=${encodeURIComponent(d.deviceId)}&secret=${encodeURIComponent(d.webhookSecret ?? "")}`;

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}><ArrowLeft size={12} /> Settings</Link>
          <h1>ACS Devices · {devices.length}</h1>
        </div>
        <button className="pl-btn pl-btn-primary" onClick={startNew}><PlusCircle size={14} /> เพิ่ม Device</button>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: showForm ? "1fr 420px" : "1fr", gap: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {devices.length === 0 && (
            <div className="pl-card pl-empty">
              <ScanFace size={28} opacity={0.4} />ยังไม่มี device · ใส่ ACS-F606 หลังจากซื้อมาถึง
            </div>
          )}
          {devices.map((d) => (
            <div key={d.id} className="pl-card" style={{ cursor: "pointer" }} onClick={() => startEdit(d)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{d.deviceName}</div>
                  <div style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{d.branchName} · {d.vendor} · {d.protocol.toUpperCase()} · Version {d.modelVersion}</div>
                </div>
                <span className={deviceStatusChipClass(d.status)}>{d.status}</span>
              </div>
              <div style={{ fontSize: 12, marginBottom: 4 }}><span style={{ color: "var(--pl-text-muted)" }}>Device ID:</span> <code>{d.deviceId}</code></div>
              <div style={{ fontSize: 12, marginBottom: 4 }}><span style={{ color: "var(--pl-text-muted)" }}>Last seen:</span> {d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : "ยังไม่เคย"}</div>
              <div style={{ fontSize: 12, padding: 8, background: "var(--pl-canvas)", borderRadius: 6, fontFamily: "ui-monospace, monospace", wordBreak: "break-all", marginTop: 6 }}>
                <button className="pl-btn pl-btn-sm" style={{ float: "right" }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(webhookUrl(d)); }}><Copy size={11} /> copy</button>
                <span style={{ color: "var(--pl-text-muted)" }}>Webhook URL (ใส่ในหน้า config ของ device):</span><br />
                {webhookUrl(d)}
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <form className="pl-card" onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            <div className="pl-eyebrow">{editing ? "แก้ device" : "device ใหม่"}</div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>สาขา</label>
              <select className="pl-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Device ID (serial vendor)</label>
              <input className="pl-input" required value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="เช่น ACS-F606-001234" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อเรียก (จดจำง่าย)</label>
              <input className="pl-input" required value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="เช่น ประตูทางเข้าสาขาเซ็นทรัล" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Vendor</label>
                <select className="pl-select" value={vendor} onChange={(e) => setVendor(e.target.value)}>
                  <option value="acs-auto">acs-auto</option>
                  <option value="mock">mock (test)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Protocol</label>
                <select className="pl-select" value={protocol} onChange={(e) => setProtocol(e.target.value as "http" | "tcp")}>
                  <option value="http">HTTP</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Version</label>
                <select className="pl-select" value={modelVersion} onChange={(e) => setModelVersion(e.target.value as "B" | "C")}>
                  <option value="C">C (mixed)</option>
                  <option value="B">B (online-only)</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Base URL (ถ้าจะ push face จาก server)</label>
              <input className="pl-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="เช่น http://192.168.1.50:80" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Webhook secret (ใส่ใน device ?secret=)</label>
              <input className="pl-input" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
            </div>
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
