"use client";

// ตัวเลือกคลัง (โผล่เมื่อมี >1 คลัง) — เปลี่ยนคลังที่กำลังทำงาน (cookie)
import { useTransition } from "react";
import { Warehouse } from "lucide-react";
import { setActiveWarehouse } from "@/lib/dc/warehouse-actions";
import type { DcWarehouseLite } from "@/lib/dc/access";

export function DcWarehousePicker({
  warehouses,
  activeId,
}: {
  warehouses: DcWarehouseLite[];
  activeId: string | null;
}) {
  const [pending, start] = useTransition();
  if (warehouses.length <= 1) return null;
  return (
    <label className="dc-wh-picker" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>
      <Warehouse size={16} />
      <select
        value={activeId ?? ""}
        disabled={pending}
        onChange={(e) => start(() => void setActiveWarehouse(e.target.value))}
        style={{ border: "1px solid var(--dc-line)", borderRadius: 8, padding: "6px 10px", fontWeight: 600 }}
      >
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
    </label>
  );
}
