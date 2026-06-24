"use client";

// Playland · ACS / face-reader devices — สไตล์ Play a lot · พื้นขาว · การ์ดสถานะ online/offline · เต็มความกว้าง
// ครอบ header strip + locked wrapper เอง (page render <DevicesClient> ตรง ๆ)
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertDevice } from "@/lib/playland/actions";
import { fmtDateTime } from "@/lib/playland/format";
import { ScanFace, PlusCircle, ArrowLeft, Copy, Check } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

interface Branch { id: string; name: string; }
interface Device {
  id: string; branchId: string; branchName: string; vendor: string;
  deviceId: string; deviceName: string; baseUrl: string | null;
  protocol: string; modelVersion: string; status: string;
  lastSeenAt: string | null; webhookSecret: string | null;
}

// สถานะอุปกรณ์ → สีป้าย (online เขียว · offline/error แดง · pairing เหลือง · disabled เทา)
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  ONLINE: { bg: "#eaf3eb", fg: GREEN, label: "ออนไลน์" },
  OFFLINE: { bg: "#fdeceb", fg: RED, label: "ออฟไลน์" },
  ERROR: { bg: "#fdeceb", fg: RED, label: "ผิดพลาด" },
  PAIRING: { bg: "#fdf3df", fg: AMBER, label: "กำลังจับคู่" },
  DISABLED: { bg: "#f4efe6", fg: MUTED, label: "ปิดใช้งาน" },
};

export function DevicesClient({ branches, devices }: { branches: Branch[]; devices: Device[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Device | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
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
  const offlineCount = devices.filter((d) => d.status === "OFFLINE" || d.status === "ERROR").length;

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <Link href="/playland/settings" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontSize: 12, color: MUTED }}><ArrowLeft size={12} /> Settings</Link>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}><ScanFace size={20} color={BLUE} /> เครื่องสแกนหน้า (ACS)</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {devices.length} เครื่อง{offlineCount > 0 ? <span style={{ color: RED }}> · ออฟไลน์ {offlineCount}</span> : null}
          </div>
        </div>
        <button type="button" onClick={startNew} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, background: BLUE, color: "#fff", cursor: "pointer", fontFamily: MITR }}>
          <PlusCircle size={15} /> เพิ่มเครื่อง
        </button>
      </div>

      <div className={showForm ? "pl-grid-2" : undefined} style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px", ...(showForm ? { alignItems: "start" } : {}) }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14, alignContent: "start" }}>
          {devices.length === 0 && (
            <div style={{ ...card, padding: 48, textAlign: "center", gridColumn: "1 / -1" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f4efe6", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><ScanFace size={22} color={MUTED} /></div>
              <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>ยังไม่มีเครื่องสแกน</div>
              <div style={{ fontSize: 13, color: MUTED }}>ใส่ ACS-F606 หลังจากซื้อมาถึง</div>
            </div>
          )}
          {devices.map((d) => {
            const st = STATUS_STYLE[d.status] ?? STATUS_STYLE.DISABLED;
            return (
              <div key={d.id} style={{ ...card, padding: 18, cursor: "pointer" }} onClick={() => startEdit(d)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{d.deviceName}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{d.branchName} · {d.vendor} · {d.protocol.toUpperCase()} · Version {d.modelVersion}</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 500, background: st.bg, color: st.fg, whiteSpace: "nowrap" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.fg }} /> {st.label}
                  </span>
                </div>
                <div style={{ fontSize: 12, marginBottom: 4 }}><span style={{ color: MUTED }}>Device ID:</span> <code style={{ fontFamily: MONO }}>{d.deviceId}</code></div>
                <div style={{ fontSize: 12, marginBottom: 8 }}><span style={{ color: MUTED }}>ออนไลน์ล่าสุด:</span> <span style={{ fontFamily: MONO }}>{d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : "ยังไม่เคย"}</span></div>
                <div style={{ fontSize: 11, padding: 10, background: "#faf7f1", border: `1px solid ${LINE}`, borderRadius: 9, fontFamily: MONO, wordBreak: "break-all" }}>
                  <button
                    type="button"
                    style={{ float: "right", display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${LINE}`, borderRadius: 7, padding: "3px 9px", fontSize: 11, fontWeight: 600, background: "#fff", color: copied === d.id ? GREEN : MUTED, cursor: "pointer", fontFamily: MITR }}
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(webhookUrl(d)); setCopied(d.id); setTimeout(() => setCopied(null), 1500); }}
                  >
                    {copied === d.id ? <><Check size={11} /> คัดลอกแล้ว</> : <><Copy size={11} /> คัดลอก</>}
                  </button>
                  <span style={{ color: MUTED, fontFamily: MITR }}>Webhook URL (ใส่ในหน้า config ของเครื่อง):</span><br />
                  {webhookUrl(d)}
                </div>
              </div>
            );
          })}
        </div>

        {showForm && (
          <form onSubmit={submit} style={{ ...card, padding: 18, display: "grid", gap: 10, position: "sticky", top: 16 }}>
            <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 14 }}>{editing ? "แก้เครื่อง" : "เครื่องใหม่"}</div>
            <div>
              <label style={lbl}>สาขา</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inp}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Device ID (serial vendor)</label>
              <input required value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="เช่น ACS-F606-001234" style={inp} />
            </div>
            <div>
              <label style={lbl}>ชื่อเรียก (จดจำง่าย)</label>
              <input required value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="เช่น ประตูทางเข้าสาขาเซ็นทรัล" style={inp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div>
                <label style={lbl}>Vendor</label>
                <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={inp}>
                  <option value="acs-auto">acs-auto</option>
                  <option value="mock">mock (test)</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Protocol</label>
                <select value={protocol} onChange={(e) => setProtocol(e.target.value as "http" | "tcp")} style={inp}>
                  <option value="http">HTTP</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Version</label>
                <select value={modelVersion} onChange={(e) => setModelVersion(e.target.value as "B" | "C")} style={inp}>
                  <option value="C">C (mixed)</option>
                  <option value="B">B (online-only)</option>
                </select>
              </div>
            </div>
            <div>
              <label style={lbl}>Base URL (ถ้าจะ push face จาก server)</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="เช่น http://192.168.1.50:80" style={inp} />
            </div>
            <div>
              <label style={lbl}>Webhook secret (ใส่ในเครื่อง ?secret=)</label>
              <input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} style={inp} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, background: "#fff", color: MUTED, cursor: "pointer", fontFamily: MITR }}>ยกเลิก</button>
              <button type="submit" disabled={pending} style={{ flex: 1, border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, background: BLUE, color: "#fff", cursor: pending ? "wait" : "pointer", fontFamily: MITR, opacity: pending ? 0.6 : 1 }}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, color: MUTED, display: "block", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none", boxSizing: "border-box" };
