// เวฟ 2 — แท็บย่อยของกลุ่ม "เอกสารคลัง" — รวม ใบรับสินค้า · ใบโอน · ใบย้ายที่ · ใบเบิก ไว้ที่เดียว
// (เดิมเป็น 4 เมนูแยกใน sidebar → ยุบเป็นแท็บ ตามแบบเดียวกับ PurchasingSubnav #16)
// ใช้ภายใต้ DcOfficeShell (สืบทอด CSS vars --primary/--border/--muted จาก dc-redesign.css)
import Link from "next/link";

export type DcDocsTab = "receipts" | "transfers" | "moves" | "issues";

const TABS: { key: DcDocsTab; href: string; label: string }[] = [
  { key: "receipts", href: "/dc/office/receipts", label: "ใบรับสินค้า" },
  { key: "transfers", href: "/dc/office/transfers", label: "ใบโอน" },
  { key: "moves", href: "/dc/office/moves", label: "ใบย้ายที่" },
  { key: "issues", href: "/dc/office/issues", label: "ใบเบิก" },
];

export function DcDocsSubnav({ active }: { active: DcDocsTab }) {
  return (
    <div style={{ display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
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
