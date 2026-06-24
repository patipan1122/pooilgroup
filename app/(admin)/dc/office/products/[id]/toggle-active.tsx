"use client";

// DC · สวิตช์เปิด/ปิดการใช้งานสินค้า (edit page). เรียก toggleProductActive
// ผ่าน useTransition แล้วรีเฟรช.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleProductActive } from "@/lib/dc/product-actions";
import { Button } from "@/components/ui/button";

export function ToggleActive({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await toggleProductActive(id, !active);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="dc-card" style={{ maxWidth: 640, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          สถานะ: {active ? "ใช้งานอยู่" : "ปิดการใช้งาน"}
        </div>
        <div style={{ fontSize: 13, color: "#71717a" }}>
          {active
            ? "สินค้าใช้งานได้ตามปกติ — ปิดเพื่อซ่อนจากการเบิก/ขายโดยไม่ลบ"
            : "สินค้าถูกปิด — เปิดเพื่อกลับมาใช้งาน"}
        </div>
        {error && (
          <div style={{ fontSize: 13, color: "var(--color-danger, #dc2626)", fontWeight: 600 }}>
            {error}
          </div>
        )}
      </div>
      <Button
        variant={active ? "outline" : "primary"}
        size="md"
        onClick={handleClick}
        loading={pending}
      >
        {active ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
      </Button>
    </div>
  );
}
