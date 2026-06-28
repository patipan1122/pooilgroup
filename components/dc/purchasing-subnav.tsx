// #16 แท็บย่อยของกลุ่ม "จัดซื้อ & นำเข้า" — รวม ใบสั่งซื้อ · ผู้ขาย · ขนส่ง ไว้ที่เดียว
// (เดิมเป็น 3 เมนูแยกใน sidebar → CEO ว่ารก · ยุบเป็นแท็บในหน้าเดียว)
// ใช้ภายใต้ DcOfficeShell (สืบทอด CSS vars --primary/--border/--muted จาก dc-redesign.css)
import Link from "next/link";

export type PurchasingTab = "po" | "suppliers" | "ship";

const TABS: { key: PurchasingTab; href: string; label: string }[] = [
  { key: "po", href: "/dc/office/purchasing", label: "ใบสั่งซื้อ" },
  { key: "suppliers", href: "/dc/office/suppliers", label: "ผู้ขาย" },
  { key: "ship", href: "/dc/office/shipments", label: "ขนส่ง / ชิปเมนต์" },
];

export function PurchasingSubnav({ active }: { active: PurchasingTab }) {
  return (
    <div style={{ display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid var(--border)" }}>
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            style={{
              padding: "9px 16px",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              color: on ? "var(--primary)" : "var(--muted)",
              borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
