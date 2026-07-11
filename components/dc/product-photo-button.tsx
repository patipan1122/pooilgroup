"use client";

// DC · ปุ่ม "ถ่าย / อัปโหลดรูปสินค้า" (self-contained)
//   แตะปุ่ม → เปิดกล้องมือถือ (capture="environment") หรือเลือกไฟล์ →
//   ส่งขึ้น /api/dc/product-image → ได้ R2 display url กลับ → เรียก onUploaded(url).
//   มีสถานะ "กำลังอัป…" + รูปตัวอย่างเล็ก + ข้อความ error.
//
//   ใช้ได้ทั้งฟอร์มหลังบ้าน (เติม imageR2Path) และหน้าหน้าบ้าน (ตั้งรูปสินค้าเลย).

import { useRef, useState } from "react";
import { Camera } from "lucide-react";

type UploadResp = { ok: true; url: string; driveUrl?: string | null } | { ok: false; error?: string };

export function DcProductPhotoButton({
  onUploaded,
  label = "📷 ถ่าย / อัปโหลดรูป",
}: {
  onUploaded: (url: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // เคลียร์ value ทันที → เลือกไฟล์เดิมซ้ำได้ (onChange ไม่ยิงถ้า value เท่าเดิม)
    e.target.value = "";
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dc/product-image", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as UploadResp | null;
      if (!res.ok || !data || !data.ok) {
        setError((data && !data.ok && data.error) || "อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง");
        return;
      }
      setPreview(data.url);
      onUploaded(data.url);
    } catch {
      setError("อัปโหลดรูปไม่สำเร็จ (เครือข่ายมีปัญหา) ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 12,
            border: "1.5px solid var(--primary, var(--color-brand-600, #2563eb))",
            background: "#fff",
            color: "var(--primary, var(--color-brand-700, #1d4ed8))",
            fontWeight: 700,
            fontSize: 14.5,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.65 : 1,
            minHeight: 44,
          }}
        >
          <Camera size={18} />
          {busy ? "กำลังอัป…" : label}
        </button>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="รูปที่อัปโหลด"
            style={{
              width: 56,
              height: 56,
              objectFit: "cover",
              borderRadius: 10,
              border: "1px solid var(--dc-line, #e4e4e7)",
            }}
          />
        ) : null}
      </div>

      {error ? (
        <p style={{ margin: 0, color: "var(--color-danger, #dc2626)", fontSize: 13, fontWeight: 600 }}>
          {error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: "none" }}
      />
    </div>
  );
}
