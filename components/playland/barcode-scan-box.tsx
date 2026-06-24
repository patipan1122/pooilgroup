"use client";

// Playland · กล่องยิงบาร์โค้ด (Harborland-style)
//   • เครื่องยิง USB = ทำตัวเป็นคีย์บอร์ด → พิมพ์โค้ดลงช่อง + Enter (ไม่ต้องเขียนโค้ดพิเศษ)
//   • กล้องมือถือ/แท็บเล็ต = ปุ่ม "สแกนกล้อง" → ใช้ BarcodeDetector (Chrome/Android)
//     iOS Safari ยังไม่รองรับ BarcodeDetector → ขึ้นข้อความให้ใช้เครื่องยิง USB แทน (เติม @zxing ภายหลังได้)

import { useEffect, useRef, useState } from "react";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> };

export function BarcodeScanBox({ onScan, placeholder }: { onScan: (code: string) => void; placeholder?: string }) {
  const [val, setVal] = useState("");
  const [camOpen, setCamOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (code: string) => {
    const c = code.trim();
    if (!c) return;
    onScan(c);
    setVal("");
    inputRef.current?.focus();
  };

  const camSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 18 }}>🔫</span>
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(val); } }}
          placeholder={placeholder ?? "ยิงบาร์โค้ด แล้วกด Enter…"}
          autoFocus
          style={{ width: "100%", background: "#fff", border: "1.5px solid #2D6CB1", borderRadius: 12, padding: "12px 14px 12px 42px", fontSize: 16, fontFamily: "var(--font-mitr), 'Mitr', sans-serif", color: "#3A3026", outline: "none", boxSizing: "border-box" }}
        />
      </div>
      <button
        type="button"
        onClick={() => setCamOpen(true)}
        style={{ background: "#eaf3f6", color: "#2D6CB1", border: "1.5px solid #2D6CB1", borderRadius: 12, padding: "12px 16px", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        📷 กล้อง
      </button>
      {camOpen && (
        <CameraScanner
          supported={camSupported}
          onClose={() => setCamOpen(false)}
          onScan={(code) => { setCamOpen(false); submit(code); }}
        />
      )}
    </div>
  );
}

function CameraScanner({ supported, onScan, onClose }: { supported: boolean; onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(supported ? null : "อุปกรณ์นี้ไม่รองรับสแกนด้วยกล้อง · ใช้เครื่องยิงบาร์โค้ด USB แทน");

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    // @ts-expect-error BarcodeDetector เป็น experimental API ของ browser
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
            if (hits.length > 0 && hits[0].rawValue) { onScan(hits[0].rawValue); }
          } catch { /* frame ไม่เจอ = ปกติ */ }
        }, 350);
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: 18, width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-fredoka), 'Fredoka', sans-serif", fontWeight: 700, fontSize: "1.2rem", marginBottom: 12, color: "#3A3026" }}>สแกนด้วยกล้อง</div>
        {err ? (
          <div style={{ padding: "24px 12px", color: "#c0392b", fontSize: 15 }}>{err}</div>
        ) : (
          <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "4/3", objectFit: "cover" }} />
        )}
        <button type="button" onClick={onClose} style={{ marginTop: 14, background: "#f4ede0", color: "#6b6052", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>ปิด</button>
      </div>
    </div>
  );
}
