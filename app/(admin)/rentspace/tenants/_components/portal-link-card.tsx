"use client";

import { useState } from "react";
import { Link2, Copy, Check, RefreshCw, Ban, MessageCircle, Mail } from "lucide-react";
import {
  actGenerateTenantPortalLink,
  actResetTenantPortalLink,
  actRevokeTenantPortalLink,
} from "../../_actions";

export function PortalLinkCard({
  tenantId,
  initialUrl,
  revoked,
  lineLinked,
  emailOptIn,
}: {
  tenantId: string;
  initialUrl: string | null;
  revoked: boolean;
  lineLinked: boolean;
  emailOptIn: boolean;
}) {
  const [url, setUrl] = useState<string | null>(revoked ? null : initialUrl);
  const [isRevoked, setIsRevoked] = useState(revoked);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  async function run(fn: () => Promise<{ url?: string }>, revokeAfter = false) {
    setErr("");
    setBusy(true);
    try {
      const r = await fn();
      if (revokeAfter) {
        setUrl(null);
        setIsRevoked(true);
      } else if (r.url) {
        setUrl(r.url);
        setIsRevoked(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr("คัดลอกไม่สำเร็จ — กดค้างที่ลิงก์เพื่อคัดลอกเอง");
    }
  }

  return (
    <div className="rs-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <Link2 className="h-4 w-4" style={{ color: "var(--rs-brand)" }} /> ลิงก์เชิญเข้าพอร์ทัลผู้เช่า
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="rs-chip inline-flex items-center gap-1"
            style={lineLinked ? { background: "var(--rs-ok-soft)", color: "var(--rs-ok)" } : { background: "var(--rs-bg-2)", color: "var(--rs-text-3)" }}
          >
            <MessageCircle className="h-3 w-3" /> {lineLinked ? "เชื่อม LINE" : "ยังไม่เชื่อม LINE"}
          </span>
          <span
            className="rs-chip inline-flex items-center gap-1"
            style={emailOptIn ? { background: "var(--rs-ok-soft)", color: "var(--rs-ok)" } : { background: "var(--rs-bg-2)", color: "var(--rs-text-3)" }}
          >
            <Mail className="h-3 w-3" /> {emailOptIn ? "รับอีเมล" : "ไม่รับอีเมล"}
          </span>
        </div>
      </div>

      <p className="text-[12.5px] mt-1.5" style={{ color: "var(--rs-text-2)" }}>
        ส่งลิงก์นี้ให้ผู้เช่า → เปิดดูใบแจ้งหนี้ · จ่ายเงินแนบสลิป · ข่าวสาร · เชื่อม LINE รับแจ้งเตือน (ลิงก์จะถูกสร้างอัตโนมัติเมื่อส่งบิลด้วย)
      </p>

      {url && !isRevoked ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md px-2.5 py-2 text-[12.5px]"
              style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)", color: "var(--rs-text)" }}
            />
            <button onClick={copy} className="rs-btn text-[13px] inline-flex items-center gap-1.5" style={{ background: "var(--rs-brand)", color: "#fff" }}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (confirm("ออกลิงก์ใหม่? ลิงก์เดิมที่ส่งไปแล้วจะเปิดไม่ได้")) run(() => actResetTenantPortalLink(tenantId)); }} disabled={busy} className="rs-btn-ghost text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60">
              <RefreshCw className="h-3.5 w-3.5" /> ออกลิงก์ใหม่
            </button>
            <button onClick={() => { if (confirm("ยกเลิกลิงก์นี้? ผู้เช่าจะเปิดไม่ได้จนกว่าจะสร้างใหม่")) run(async () => { await actRevokeTenantPortalLink(tenantId); return {}; }, true); }} disabled={busy} className="rs-btn-ghost text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60" style={{ color: "var(--rs-danger)" }}>
              <Ban className="h-3.5 w-3.5" /> ยกเลิกลิงก์
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {isRevoked && <div className="text-[12.5px] mb-2" style={{ color: "var(--rs-danger)" }}>ลิงก์ถูกยกเลิกแล้ว</div>}
          <button onClick={() => run(() => actGenerateTenantPortalLink(tenantId))} disabled={busy} className="rs-btn text-[13px] inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: "var(--rs-brand)", color: "#fff" }}>
            <Link2 className="h-4 w-4" /> {busy ? "กำลังสร้าง…" : isRevoked ? "สร้างลิงก์ใหม่" : "สร้างลิงก์เชิญ"}
          </button>
        </div>
      )}

      {err && <div className="text-[12px] mt-2" style={{ color: "var(--rs-danger)" }}>{err}</div>}
    </div>
  );
}
