"use client";

// Audit category filter (IN-PAGE filter ไม่ใช่ tab หน้า/หลัง) · สไตล์ Play a lot locked tokens
// ทั้งหมด / คืนเงิน / แก้ราคา / เปิดประตู → map เข้า category ของ log (money / device / general)

import { useRouter, useSearchParams } from "next/navigation";

const BLUE = "#2D6CB1", MUTED = "#8a7f70", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";

const TABS = [
  { v: null,      label: "ทั้งหมด" },
  { v: "money",   label: "เงิน · คืนเงิน" },
  { v: "device",  label: "เปิดประตู" },
  { v: "general", label: "ทั่วไป" },
] as const;

export function AuditCategoryTabs({ current }: { current: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(v: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (v) sp.set("category", v); else sp.delete("category");
    router.push(`/playland/audit${sp.toString() ? `?${sp.toString()}` : ""}`);
  }

  return (
    <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "#faf7f1", border: `1px solid ${LINE}`, borderRadius: 11, maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
      {TABS.map((t) => {
        const active = current === t.v;
        return (
          <button
            type="button"
            key={t.v ?? "all"}
            onClick={() => go(t.v)}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontFamily: MITR,
              cursor: "pointer",
              background: active ? "#fff" : "transparent",
              color: active ? BLUE : MUTED,
              boxShadow: active ? "0 1px 2px rgba(58,48,38,.08)" : "none",
              whiteSpace: "nowrap",
              flex: "0 0 auto",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
