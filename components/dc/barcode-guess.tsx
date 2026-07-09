"use client";

// DC · การ์ด "เดาชื่อสินค้าจากอินเทอร์เน็ต" — โชว์เมื่อยิงบาร์โค้ดแล้ว "ไม่พบในระบบเรา"
//   • ช่วยพนักงานรู้ว่าของชิ้นนั้นคืออะไร แม้ยังไม่ได้ลงทะเบียน
//   • ใช้ Open Food Facts (ฟรี) ผ่าน server action · เจอเฉพาะของกิน/แบรนด์ · จีน/อะไหล่มักไม่เจอ (ไม่โชว์อะไร)

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { lookupBarcodeInfo, type BarcodeLookupResult } from "@/lib/dc/barcode-lookup";

export function DcBarcodeGuess({ code }: { code: string }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<BarcodeLookupResult | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setResult(null);
    lookupBarcodeInfo(code)
      .then((r) => { if (alive) setResult(r); })
      .catch(() => { if (alive) setResult({ found: false, reason: "error" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

  if (loading) {
    return (
      <div className="dc-card" style={{ padding: "12px 14px", fontSize: 14, color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}>
        🌐 กำลังลองดูจากอินเทอร์เน็ตว่าของชิ้นนี้คืออะไร…
      </div>
    );
  }

  if (!result || !result.found) {
    // รหัสไม่ใช่บาร์โค้ดสากล (เช่น SKU ภายใน) → เงียบ ไม่เกี่ยวกับฐานสินค้าโลก
    if (!result || result.reason === "invalid") return null;
    // เป็นบาร์โค้ดจริงแต่ฐานโลกไม่มี → บอกชัด (ไม่เงียบ จะได้ไม่ดูเหมือนพัง)
    return (
      <div className="dc-card" style={{ padding: "12px 14px", fontSize: 14, color: "var(--dc-muted, #6b7785)", fontWeight: 600, lineHeight: 1.5 }}>
        🌐 ลองค้นในฐานสินค้าโลกแล้ว — <strong style={{ color: "var(--dc-ink, #1f2733)" }}>ไม่พบของชิ้นนี้</strong>
        <br />
        (ปกติสำหรับของนำเข้าจีน · อะไหล่ · หรือบางถุงที่ยังไม่มีใครลงฐาน) → กรอกชื่อเอง
      </div>
    );
  }

  return (
    <div
      className="dc-card"
      style={{ padding: 14, display: "flex", gap: 12, alignItems: "center", border: "1.5px solid var(--color-brand-200, #c7d7fb)" }}
    >
      {result.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.imageUrl}
          alt=""
          style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "1px solid var(--dc-line, #e6eaf0)" }}
        />
      ) : (
        <Globe size={28} style={{ color: "var(--color-brand-600)", flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700)", marginBottom: 2 }}>
          🌐 ยังไม่ได้ลงทะเบียน · จากอินเทอร์เน็ตน่าจะเป็น
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
          {result.name || "(ไม่มีชื่อในฐาน)"}
        </div>
        {result.brand && (
          <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>{result.brand}</div>
        )}
      </div>
    </div>
  );
}
