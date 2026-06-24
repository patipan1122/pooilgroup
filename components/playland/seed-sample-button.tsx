"use client";

// Playland · ปุ่มเพิ่มสินค้าตัวอย่าง (ขนม/น้ำ + อะไหล่) ให้เห็นภาพ · กดซ้ำไม่เพิ่มซ้ำ (กันด้วยบาร์โค้ด)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { seedSampleProducts } from "@/lib/playland/stock";
import { Sparkles } from "lucide-react";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";

export function SeedSampleButton({ branchId, compact }: { branchId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    if (!confirm("เพิ่มสินค้าตัวอย่าง (ขนม·น้ำ + อะไหล่) เข้าสาขานี้?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await seedSampleProducts({ branchId });
      if (res.ok) {
        setMsg(res.data.created > 0 ? `✓ เพิ่ม ${res.data.created} รายการ` : "มีตัวอย่างครบแล้ว");
        router.refresh();
      } else setMsg("❌ " + res.error);
    } catch {
      setMsg("❌ เพิ่มไม่สำเร็จ · ลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button onClick={run} disabled={busy} style={{
        display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MITR, cursor: busy ? "default" : "pointer",
        background: compact ? "#fff" : "#1F8A5B", color: compact ? "#1F8A5B" : "#fff",
        border: compact ? "1px solid #bfe0cd" : "none", borderRadius: 999,
        padding: compact ? "9px 15px" : "12px 22px", fontSize: compact ? 14 : 16, fontWeight: 600, opacity: busy ? 0.6 : 1,
      }}>
        <Sparkles size={compact ? 15 : 18} /> {busy ? "กำลังเพิ่ม…" : "เพิ่มสินค้าตัวอย่าง"}
      </button>
      {msg && <span style={{ fontSize: 13.5, color: msg.startsWith("✓") ? "#1F8A5B" : msg.startsWith("❌") ? "#c0392b" : "#8a7f70" }}>{msg}</span>}
    </span>
  );
}
