// DC · ใบรับสินค้า — ปุ่มสลับแหล่งที่มา: "รับจากสั่งซื้อ (PO)" vs "รับจากใบโอน"
//   ใช้ ?tab=po|transfer ผ่าน <Link> (server-nav ตาม pattern เดิมของ DC เช่น /dc/office/issue)
//   → deep-link ได้ · โหลดข้อมูลเฉพาะแท็บที่เปิด · segmented pill อันเดียว ~40px (RULE L density)
//   แทนการซ้อนแถวแท็บใต้เส้นอีกแถว (จะกลายเป็น 2 แถวแท็บ = หนัก/งง)
import Link from "next/link";

export type ReceiptSource = "po" | "transfer";

const TABS: { key: ReceiptSource; href: string; label: string }[] = [
  { key: "po", href: "/dc/office/receipts?tab=po", label: "รับจากสั่งซื้อ (PO)" },
  { key: "transfer", href: "/dc/office/receipts?tab=transfer", label: "รับจากใบโอน" },
];

export function ReceiptsSourceTabs({ active }: { active: ReceiptSource }) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "#EDF1F7",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 3,
        gap: 3,
        marginBottom: 18,
      }}
    >
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            style={{
              padding: "7px 15px",
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: "none",
              borderRadius: 8,
              whiteSpace: "nowrap",
              color: on ? "#fff" : "var(--ink2)",
              background: on ? "var(--primary)" : "transparent",
              boxShadow: on ? "0 1px 3px rgba(31,79,214,.28)" : "none",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
