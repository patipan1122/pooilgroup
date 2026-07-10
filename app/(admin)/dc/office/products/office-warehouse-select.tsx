"use client";

// DC · หลังบ้าน · สินค้า — ตัวเลือกคลัง (office-only)
// ใช้ ?wh= ใน searchParams (ไม่แตะ cookie dc_wh ของหน้าคลัง → กัน regression หน้าบ้าน).
// ค่าเริ่มต้น "รวมทุกคลัง" (ไม่มี param) → ตัวเลขเท่าเดิม. สิทธิ์ถูก assert ที่ฝั่ง server แล้ว.

import { useRouter } from "next/navigation";

export type OfficeWarehouseOption = { id: string; name: string };

export function OfficeWarehouseSelect({
  warehouses,
  value,
}: {
  warehouses: OfficeWarehouseOption[];
  value: string; // "all" | warehouseId (current from searchParams)
}) {
  const router = useRouter();

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <span style={{ color: "var(--ink2)", fontWeight: 600 }}>คลัง</span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v === "all" ? "?wh=all" : `?wh=${encodeURIComponent(v)}`);
        }}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: "7px 11px",
          fontSize: 13,
          fontWeight: 600,
          background: "#fff",
          color: "var(--ink)",
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        <option value="all">รวมทุกคลัง</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  );
}
