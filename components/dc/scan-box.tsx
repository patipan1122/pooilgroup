"use client";

// DC · กล่องสแกน/พิมพ์รหัส (brand-skinned)
//   • เครื่องยิง USB = คีย์บอร์ด → พิมพ์/ยิงโค้ด + Enter
//   • พิมพ์มือได้เสมอ (EndUser hard-line: ไม่บังคับสแกน)
//   • กล้อง = BarcodeDetector (Chrome/Android); iOS Safari → ใช้ USB/พิมพ์ (เติม @zxing เฟส 2)

import { useEffect, useRef, useState } from "react";
import { ScanLine, Camera } from "lucide-react";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> };

export function DcScanBox({ onScan, placeholder }: { onScan: (code: string) => void; placeholder?: string }) {
  const [val, setVal] = useState("");
  const [camOpen, setCamOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // โฟกัสอัตโนมัติเฉพาะอุปกรณ์ไม่ใช่จอสัมผัส (เครื่องยิง USB / เดสก์ท็อป)
  // มือถือ/แท็บเล็ตจอสัมผัส = ไม่ autoFocus เพื่อกันคีย์บอร์ดเด้งขึ้นทุกหน้าจอ
  const isTouch = () =>
    typeof window !== "undefined" &&
    ((typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) || "ontouchstart" in window);

  useEffect(() => {
    if (!isTouch()) inputRef.current?.focus();
  }, []);

  const submit = (code: string) => {
    const c = code.trim();
    if (!c) return;
    onScan(c);
    setVal("");
    // คืนโฟกัสหลังยิงเฉพาะเครื่อง USB/เดสก์ท็อป (ยิงรัวต่อเนื่องได้) · จอสัมผัสไม่เด้งคีย์บอร์ด
    if (!isTouch()) inputRef.current?.focus();
  };

  const camSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <ScanLine size={20} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-brand-600)" }} />
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(val); } }}
          placeholder={placeholder ?? "ยิงบาร์โค้ด / พิมพ์รหัส แล้วกด Enter…"}
          inputMode="text"
          style={{ width: "100%", background: "#fff", border: "1.5px solid var(--dc-line, #e6eaf0)", borderRadius: 12, padding: "14px 14px 14px 40px", fontSize: 17, color: "var(--dc-ink, #1f2733)", outline: "none", boxSizing: "border-box" }}
        />
      </div>
      <button
        type="button"
        onClick={() => setCamOpen(true)}
        aria-label="สแกนด้วยกล้อง"
        style={{ background: "var(--color-brand-50, #eef3fe)", color: "var(--color-brand-700)", border: "1.5px solid var(--color-brand-600)", borderRadius: 12, padding: "13px 16px", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Camera size={18} /> กล้อง
      </button>
      {camOpen && (
        <DcCameraScanner
          supported={camSupported}
          onClose={() => setCamOpen(false)}
          onScan={(code) => { setCamOpen(false); submit(code); }}
        />
      )}
    </div>
  );
}

function DcCameraScanner({ supported, onScan, onClose }: { supported: boolean; onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(
    supported ? null : "อุปกรณ์นี้ (เช่น iPhone/iPad Safari) ยังสแกนกล้องไม่ได้ · ใช้เครื่องยิง USB หรือพิมพ์รหัสแทน",
  );

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    // @ts-expect-error BarcodeDetector = experimental browser API
    const detector: BarcodeDetectorLike = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        timer = setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const hits = await detector.detect(videoRef.current);
            if (hits.length > 0 && hits[0].rawValue) onScan(hits[0].rawValue);
          } catch { /* no frame match = normal */ }
        }, 300);
      } catch {
        setErr("เปิดกล้องไม่ได้ · อนุญาตการใช้กล้อง หรือใช้เครื่องยิง USB");
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [supported, onScan]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: 18, width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: "1.15rem", marginBottom: 12 }}>สแกนด้วยกล้อง</div>
        {err ? (
          <div style={{ padding: "24px 12px", color: "#c0392b", fontSize: 15, lineHeight: 1.5 }}>{err}</div>
        ) : (
          <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "4/3", objectFit: "cover" }} />
        )}
        <button type="button" onClick={onClose} style={{ marginTop: 14, background: "#eef1f6", color: "#475569", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>ปิด</button>
      </div>
    </div>
  );
}
