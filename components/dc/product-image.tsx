"use client";

// DC · รูปสินค้าคลิกซูมได้ (shared) — ใช้ได้ทุกลิสต์/การ์ด/ตารางในโมดูล DC.
//
//   <DcThumb url={imageUrl} alt={ชื่อสินค้า} size={44} />
//     • มีรูป  → สี่เหลี่ยมมีขอบ + cursor-zoom-in · คลิก → เปิด lightbox รูปใหญ่
//     • ไม่มีรูป → ไอคอน ImageIcon (lucide) เป็น fallback · คลิกไม่ทำอะไร
//
//   Lightbox = overlay เต็มจอ (พื้นหลังดำ) · คลิกพื้นหลัง / ปุ่ม ✕ / กด Escape = ปิด.
//   z-index 10000 → สูงกว่า .dc-msheet (70) และ bottom-sheet ต่าง ๆ (9998) ในโมดูล.
//   self-contained: แต่ละ Thumb ถือ state เปิด/ปิดของตัวเอง → ทำให้รูปไหนก็คลิกซูมได้ทันที.

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, X } from "lucide-react";

// ── รูปใหญ่เต็มจอ (แยกไว้ให้ reuse ได้ถ้าอยากคุม state เอง) ────────────────
export function DcLightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt?: string;
  onClose: () => void;
}) {
  // คลิกที่รูป → ซูมเข้า/ออก (ไม่ปิด lightbox) · reset ทุกครั้งที่เปิดรูปใหม่
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    setZoomed(false);
  }, [url]);

  // ปิดด้วย Escape + ล็อกสกอลล์พื้นหลังตอนเปิด
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `รูปสินค้า: ${alt}` : "รูปสินค้า"}
      onClick={(e) => {
        // กันคลิกปิด bubble ไปหา parent (แถวที่เป็น <Link>/onClick) → เผลอเปิดหน้าอื่น
        e.stopPropagation();
        onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(8,12,20,0.86)",
        display: "flex",
        alignItems: zoomed ? "flex-start" : "center",
        justifyContent: zoomed ? "flex-start" : "center",
        // ตอนซูม → เลื่อน/แพนดูรูปใหญ่ได้ (backdrop คลิกปิดยังทำงานเพราะเป็น div ตัวนี้)
        overflow: zoomed ? "auto" : "hidden",
        padding: 24,
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="ปิด"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          width: 44,
          height: 44,
          borderRadius: 12,
          border: "none",
          background: "rgba(255,255,255,0.14)",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          zIndex: 1, // อยู่เหนือรูปตอนซูม (รูปใหญ่ไม่ทับปุ่มปิด)
        }}
      >
        <X size={24} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? ""}
        onClick={(e) => {
          // คลิกรูป = สลับซูม (ไม่ปิด lightbox) → กัน bubble ไปโดน backdrop
          e.stopPropagation();
          setZoomed((z) => !z);
        }}
        style={{
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
          ...(zoomed
            ? {
                // ซูมเข้า → ขยายใหญ่ + ปล่อยให้ overflow scroll ของ backdrop พาแพนดู
                width: "min(170vw, 1400px)",
                height: "auto",
                maxHeight: "none",
                margin: "auto", // จัดกลางเมื่อรูปเล็กกว่าจอ
                cursor: "zoom-out",
              }
            : {
                // ปกติ → พอดีจอ (รูปครอป 1688 ตัวเล็ก → ขยายเต็ม ไม่โชว์จิ๋วกลางจอ)
                width: "min(92vw, 720px)",
                height: "auto",
                maxHeight: "86vh",
                objectFit: "contain",
                cursor: "zoom-in",
              }),
        }}
      />
    </div>
  );
}

// ── รูปสินค้าเล็ก (คลิกซูม) ─────────────────────────────────────────────
export function DcThumb({
  url,
  alt,
  size = 44,
}: {
  url?: string | null;
  alt?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const clickable = !!url;

  // กันคลิกทะลุไปหา parent (เช่น <Link>/<button> ที่ครอบแถวอยู่) — เปิดเฉพาะ lightbox
  const openLightbox = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    },
    [url],
  );

  return (
    <>
      <span
        onClick={clickable ? openLightbox : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? (alt ? `ดูรูปใหญ่: ${alt}` : "ดูรูปใหญ่") : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") openLightbox(e);
              }
            : undefined
        }
        style={{
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: 9,
          overflow: "hidden",
          background: "var(--dc-canvas, #f1f4f9)",
          border: "1px solid var(--dc-line, #e6eaf0)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: clickable ? "zoom-in" : "default",
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={alt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <ImageIcon size={Math.round(size * 0.42)} color="var(--dc-subtle, #9aa4b2)" />
        )}
      </span>
      {open && url ? <DcLightbox url={url} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
