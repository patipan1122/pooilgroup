"use client";

// DC settings · การ์ด Google Drive — โชว์สถานะเชื่อม + ปุ่มเชื่อม + ลิงก์เปิดโฟลเดอร์ "DC-รูปสินค้า".
//   self-contained: โหลดสถานะเองตอน mount (ไม่ต้องแก้ page state).

import { useEffect, useState } from "react";
import { HardDrive, CheckCircle2, ExternalLink, FolderOpen } from "lucide-react";
import { startDcDriveConnect, getDcDriveStatus } from "./dc-drive-actions";

export function DcDriveCard() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getDcDriveStatus()
      .then((r) => {
        if (!alive) return;
        setConnected(r.connected);
        setFolderUrl(r.folderUrl);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await startDcDriveConnect();
      if (!res.ok) {
        setError(res.error);
        setConnecting(false);
        return;
      }
      window.location.href = res.url; // ไปหน้ายินยอม Google → callback เด้งกลับ /dc/office/settings
    } catch (e) {
      setError((e as Error).message);
      setConnecting(false);
    }
  }

  return (
    <div
      className="dc-card"
      style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: 18, boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 46, height: 46, borderRadius: 12, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: connected ? "#E1F0E8" : "#E7EEFF",
            color: connected ? "#1F8A55" : "var(--primary)",
          }}
        >
          <HardDrive size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>เก็บรูปสินค้าใน Google Drive</span>
            {loading ? (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>กำลังเช็ค…</span>
            ) : connected ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, background: "#E1F0E8", color: "#1F8A55", padding: "2px 9px", borderRadius: 999 }}>
                <CheckCircle2 size={13} /> เชื่อมแล้ว
              </span>
            ) : (
              <span style={{ fontSize: 11.5, fontWeight: 700, background: "#FEF1DE", color: "#B45309", padding: "2px 9px", borderRadius: 999 }}>
                ยังไม่เชื่อม
              </span>
            )}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.55 }}>
            รูปสินค้า (ที่ AI ตัดจากออเดอร์ 1688) จะเก็บ<b>ต้นฉบับในโฟลเดอร์ &quot;DC-รูปสินค้า&quot;</b> ใน Google Drive ของบริษัท
            — แยกจากเรซูเม่คนสมัคร/ไฟล์เก้าอี้นวด (คนละโฟลเดอร์)
            <br />
            <span style={{ color: "var(--muted)" }}>
              เป็นการล็อกอิน Google ครั้งเดียวของทั้งบริษัท (ใช้ร่วมทุกโปรแกรม) · เฉพาะเจ้าของระบบเชื่อมได้
            </span>
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10,
                padding: "10px 16px", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                cursor: connecting ? "default" : "pointer", opacity: connecting ? 0.7 : 1,
                boxShadow: "0 2px 6px rgba(31,79,214,.25)",
              }}
            >
              <ExternalLink size={16} />
              {connecting ? "กำลังเปิด Google…" : connected ? "เชื่อมใหม่ / เปลี่ยนบัญชี Google" : "เชื่อม Google Drive"}
            </button>

            {connected && folderUrl && (
              <a
                href={folderUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  background: "#E1F0E8", color: "#1F8A55", border: "1px solid #C7E4D4", borderRadius: 10,
                  padding: "10px 16px", fontSize: 14, fontWeight: 700, textDecoration: "none",
                }}
              >
                <FolderOpen size={16} />
                เปิดโฟลเดอร์ &quot;DC-รูปสินค้า&quot;
              </a>
            )}
          </div>

          {error && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#B45309", background: "#FEF1DE", border: "1px solid #F3D9C0", borderRadius: 9, padding: "8px 12px" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
