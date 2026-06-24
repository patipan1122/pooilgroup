"use client";

// DC · ปุ่ม "เพิ่มสินค้าตัวอย่าง" — เรียก seedSampleProducts (idempotent)
// แล้วรีเฟรชหน้า. แสดงผลลัพธ์สั้น ๆ ว่าเพิ่มกี่รายการ.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { seedSampleProducts } from "@/lib/dc/product-actions";
import { Button } from "@/components/ui/button";

export function SeedSampleButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setMsg(null);
    startTransition(async () => {
      const res = await seedSampleProducts();
      if (res.ok) {
        setMsg(
          res.created > 0
            ? `เพิ่มแล้ว ${res.created} รายการ`
            : "มีตัวอย่างครบแล้ว",
        );
        router.refresh();
      } else {
        setMsg(res.error);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Button variant="outline" size="md" onClick={handleClick} loading={pending}>
        เพิ่มสินค้าตัวอย่าง
      </Button>
      {msg && (
        <span style={{ fontSize: 13, color: "#52525b", fontWeight: 600 }}>{msg}</span>
      )}
    </div>
  );
}
