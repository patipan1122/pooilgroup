"use client";

// DC หน้าบ้าน · แก้ "รูปสินค้า" ตรงหน้ารายละเอียดสินค้า
//   พนักงานถ่ายรูปของจริง → กลายเป็นรูปสินค้าทันที (setProductImage + refresh).
//   โชว์รูปปัจจุบัน (คลิกซูมได้ผ่าน DcThumb) + ปุ่มถ่าย/อัปโหลด.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DcThumb } from "@/components/dc/product-image";
import { DcProductPhotoButton } from "@/components/dc/product-photo-button";
import { setProductImage } from "@/lib/dc/product-actions";

export function ProductPhotoEditor({
  productId,
  imageUrl,
  productName,
}: {
  productId: string;
  imageUrl: string | null;
  productName?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  function handleUploaded(url: string) {
    setError(null);
    startTransition(async () => {
      const res = await setProductImage(productId, url);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? "บันทึกรูปไม่สำเร็จ");
      }
    });
  }

  return (
    <div
      className="dc-card"
      style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}
    >
      <DcThumb url={imageUrl} alt={productName} size={64} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--dc-ink)", marginBottom: 6 }}>
          รูปสินค้า
        </div>
        <DcProductPhotoButton
          onUploaded={handleUploaded}
          label={imageUrl ? "📷 เปลี่ยนรูป" : "📷 ถ่าย / อัปโหลดรูป"}
        />
        {saving ? (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--dc-muted)", fontWeight: 600 }}>
            กำลังบันทึกรูป…
          </p>
        ) : null}
        {error ? (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger, #dc2626)", fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
