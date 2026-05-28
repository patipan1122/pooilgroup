"use client";

// Universal scanner input · USB barcode scanner sends keystrokes + Enter
// Mobile: paste / type · also accepts QR via future camera (TODO[bigfeature] W2)

import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { lookupWristband, activateWristband, exitWristband, getActiveWristbandsForCache, syncOfflineScans, type WristbandLookup } from "@/lib/playland/wristband";
import { listPackages } from "@/lib/playland/queries";
import { thb } from "@/lib/playland/format";
import { cacheWristbands, lookupCached, enqueueScan, getQueue, clearQueue, queueCount } from "@/lib/playland/offline-db";
import { ScanLine, AlertCircle, CheckCircle2, LogOut, ShoppingBasket, X, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { GateOverrideModal } from "./gate-override-modal";

export function WristbandScanInput({ branchId, packages }: { branchId: string; packages: Array<{ id: string; name: string; price: number; minutes: number | null; type: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<WristbandLookup | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [selectedPkg, setSelectedPkg] = useState<string>(packages[0]?.id ?? "");
  const [pay, setPay] = useState<"CASH" | "PROMPTPAY" | "STRIPE" | "CHARGE_TO_MEMBER">("CASH");
  const [showOverride, setShowOverride] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [lookup]);

  // Refresh the offline whitelist cache (called on mount + on reconnect)
  const refreshCache = useCallback(async () => {
    const res = await getActiveWristbandsForCache(branchId);
    if (res.ok) {
      await cacheWristbands(res.data.map((w) => ({ ...w, cachedAt: Date.now() })));
    }
  }, [branchId]);

  // Flush any scans queued while offline
  const flushQueue = useCallback(async () => {
    const queue = await getQueue();
    if (queue.length === 0) { setPendingSync(0); return; }
    const res = await syncOfflineScans({ branchId, scans: queue.map((q) => ({ code: q.code, scannedAt: q.scannedAt, outcome: q.outcome })) });
    if (res.ok) { await clearQueue(); setPendingSync(0); router.refresh(); }
  }, [branchId, router]);

  // Online/offline tracking + initial cache warm-up
  useEffect(() => {
    setOnline(navigator.onLine);
    queueCount().then(setPendingSync);
    if (navigator.onLine) { refreshCache(); flushQueue(); }
    const goOnline = () => { setOnline(true); refreshCache(); flushQueue(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [refreshCache, flushQueue]);

  // Offline path · validate against cached whitelist + queue the scan
  async function doScanOffline(raw: string) {
    const cached = await lookupCached(raw);
    const open = !!cached && (cached.status === "ACTIVE" || cached.status === "ISSUED") && cached.branchId === branchId;
    await enqueueScan({ code: raw.trim().toUpperCase(), branchId, scannedAt: Date.now(), outcome: open ? "open" : "deny" });
    setPendingSync(await queueCount());
    setCode("");
    inputRef.current?.focus();
    if (open) {
      setMsg({ kind: "ok", text: `(offline) เปิดประตู · ${cached?.memberName ?? raw.trim().toUpperCase()} · จะ sync เมื่อเน็ตกลับ` });
    } else {
      setMsg({ kind: "err", text: `(offline) ไม่พบใน cache · ${raw.trim().toUpperCase()} · ตรวจที่เคาน์เตอร์` });
    }
  }

  function doScan() {
    if (!code.trim()) return;
    setMsg(null);
    if (!navigator.onLine) { void doScanOffline(code); return; }
    start(async () => {
      const res = await lookupWristband(code);
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); setCode(""); inputRef.current?.focus(); return; }
      setLookup(res.data);
      setCode("");
    });
  }

  function doActivate() {
    if (!lookup) return;
    start(async () => {
      const res = await activateWristband({ code: lookup.wristband.code, packageId: selectedPkg, paymentMethod: pay });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: `เปิด gate · session เริ่มแล้ว · ${pay === "PROMPTPAY" ? "ให้ลูกค้าจ่ายผ่าน QR" : "รับเงินสด"}` });
      setLookup(null);
      router.refresh();
    });
  }

  function doExit() {
    if (!lookup) return;
    if (!confirm(`Check-out "${lookup.member?.name}" และคืน wristband?`)) return;
    start(async () => {
      const res = await exitWristband(lookup.wristband.code);
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: `Check-out แล้ว · session ปิด · wristband คืนระบบ` });
      setLookup(null);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && (
        <div className="pl-card" style={{
          background: msg.kind === "ok" ? "var(--pl-ok-soft)" : "var(--pl-danger-soft)",
          color: msg.kind === "ok" ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{msg.text}
        </div>
      )}

      {/* Connection status · offline-first indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        {online ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--pl-ok-ink)" }}>
            <Wifi size={13} /> ออนไลน์
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--pl-danger-ink)", fontWeight: 600 }}>
            <WifiOff size={13} /> ออฟไลน์ · ใช้ cache · จะ sync เมื่อเน็ตกลับ
          </span>
        )}
        {pendingSync > 0 && (
          <span className="pl-chip pl-chip-warn" style={{ fontSize: 11 }}>{pendingSync} รอ sync</span>
        )}
      </div>

      {/* Scan input · always visible · auto-focus */}
      <div className="pl-card">
        <label className="pl-label"><ScanLine size={11} style={{ display: "inline", marginRight: 4 }} /> สแกน QR หรือพิมพ์ code</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            className="pl-input"
            placeholder="PW-XXXXXXXXX · กด Enter"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doScan(); } }}
            style={{ fontFamily: "var(--pl-font-mono)", fontSize: "1.1rem", letterSpacing: "0.06em" }}
            autoFocus
          />
          <button type="button" className="pl-btn pl-btn-primary" onClick={doScan} disabled={pending}>
            <ScanLine size={14} /> สแกน
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--pl-text-muted)", marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>ใช้กับ USB scanner ได้ทันที (ส่ง Enter อัตโนมัติ) · มือถือพิมพ์เองหรือ paste</span>
          <button
            type="button"
            className="pl-btn pl-btn-ghost pl-btn-sm"
            onClick={() => setShowOverride(true)}
            style={{ color: "var(--pl-danger-ink)", whiteSpace: "nowrap" }}
          >
            <ShieldAlert size={12} /> เปิดประตูเอง
          </button>
        </div>
      </div>

      {showOverride && (
        <GateOverrideModal
          branchId={branchId}
          wristbandCode={lookup?.wristband.code}
          onClose={() => setShowOverride(false)}
        />
      )}

      {/* Lookup result · action picker per state */}
      {lookup && (
        <div className="pl-card pl-card-accent" style={{ display: "grid", gap: 14, position: "relative" }}>
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setLookup(null)} style={{ position: "absolute", top: 8, right: 8 }}>
            <X size={14} />
          </button>

          <div>
            <div className="pl-eyebrow">{lookup.wristband.status} · {lookup.hint}</div>
            <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.4rem", fontWeight: 600, marginTop: 2 }}>
              {lookup.member?.name ?? "(ยังไม่ผูกสมาชิก)"}
              {lookup.member?.nickname && <span style={{ color: "var(--pl-text-muted)" }}> · {lookup.member.nickname}</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)", marginTop: 2 }}>
              {lookup.wristband.code} · {lookup.member?.memberCode ?? "—"}
            </div>
          </div>

          {/* ISSUED · pick package + payment + activate */}
          {lookup.allowedActions.includes("ACTIVATE") && (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="pl-eyebrow">เลือก package · ครั้งแรก · จะเปิด gate</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
                {packages.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setSelectedPkg(p.id)}
                    className="pl-card"
                    style={{
                      textAlign: "left", padding: 8,
                      border: selectedPkg === p.id ? "2px solid var(--pl-brand)" : "1px solid var(--pl-line)",
                      background: selectedPkg === p.id ? "var(--pl-brand-soft)" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--pl-brand-dark)" }}>{thb(p.price)}</div>
                  </button>
                ))}
              </div>
              <div>
                <label className="pl-label">ชำระเงิน</label>
                <div className="pl-toggle-group">
                  {(["CASH", "PROMPTPAY", "STRIPE", "CHARGE_TO_MEMBER"] as const).map((m) => (
                    <button type="button" key={m} className={pay === m ? "is-active" : ""} onClick={() => setPay(m)}>
                      {m === "CASH" ? "เงินสด" : m === "PROMPTPAY" ? "PromptPay" : m === "STRIPE" ? "บัตร" : "ใส่บิล"}
                    </button>
                  ))}
                </div>
                {pay === "PROMPTPAY" && (
                  <div style={{ marginTop: 8, padding: 12, background: "white", borderRadius: 10, border: "1px dashed var(--pl-amber-400)", textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginBottom: 6 }}>QR PromptPay (placeholder · API จริง v2)</div>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`promptpay://demo/${lookup.wristband.code}`)}&qzone=1`}
                      alt="QR PromptPay"
                      width={180} height={180}
                      style={{ width: 180, height: 180 }}
                    />
                  </div>
                )}
              </div>
              <button type="button" className="pl-btn pl-btn-primary pl-btn-lg" onClick={doActivate} disabled={pending}>
                {pending ? "กำลังเปิด gate..." : "✅ ยืนยัน · เปิด gate"}
              </button>
            </div>
          )}

          {/* ACTIVE · picker */}
          {lookup.allowedActions.includes("POS_CHARGE") && (
            <div style={{ display: "grid", gap: 8 }}>
              <Link href={`/playland/pos?branch=${branchId}&session=${lookup.session?.id ?? ""}`} className="pl-btn pl-btn-primary pl-btn-lg">
                <ShoppingBasket size={16} /> ขายของให้คนนี้ (charge to bill)
              </Link>
              <button type="button" className="pl-btn pl-btn-danger pl-btn-lg" onClick={doExit} disabled={pending}>
                <LogOut size={16} /> ออก (Check-out · คืน wristband)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
