"use client";

// Playland · ปุ่มจัดการ "ข้อมูลตัวอย่าง" บนหัว Dashboard หลังบ้าน (เฉพาะผู้ดูแล)
//   • เติมข้อมูลตัวอย่าง (เขียว) — ให้หน้าจอมีชีวิต ไม่ใช่ ฿0 ทั้งหน้า
//   • ล้างข้อมูลตัวอย่าง (เส้นขอบจาง) — คืนสภาพเดิม ลบเฉพาะของตัวอย่าง
// สไตล์ตาม LOCKED tokens (ขาว/น้ำเงิน/เขียว · Mitr) · confirm ก่อนทำ · ล็อกระหว่างทำงาน · refresh เมื่อสำเร็จ
import { useState } from "react";
import { useRouter } from "next/navigation";
import { seedDemoData, clearDemoData } from "@/lib/playland/demo-seed";
import { Sparkles, Eraser } from "lucide-react";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const GREEN = "#1F8A5B";
const MUTED = "#8a7f70";
const LINE = "#ece5d8";
const RED = "#c0392b";

export function DemoSeedButton({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "seed" | "clear">(null);
  const [msg, setMsg] = useState<string | null>(null);

  const runSeed = async () => {
    if (busy) return;
    if (!confirm("เติมข้อมูลตัวอย่าง (สินค้า · ยอดขาย 14 วัน · สมาชิก · คนกำลังเล่น) เข้าสาขานี้?\n\nกดซ้ำได้ — ระบบจะล้างตัวอย่างเดิมแล้วเติมใหม่")) return;
    setBusy("seed");
    setMsg(null);
    try {
      const res = await seedDemoData({ branchId });
      if (res.ok) {
        setMsg(`✓ เติมแล้ว · ${res.data.sales} บิล · ${res.data.products} สินค้า · ${res.data.members} สมาชิก`);
        router.refresh();
      } else {
        setMsg("❌ " + res.error);
      }
    } catch {
      setMsg("❌ เติมไม่สำเร็จ · ลองใหม่");
    } finally {
      setBusy(null);
    }
  };

  const runClear = async () => {
    if (busy) return;
    if (!confirm("ล้างข้อมูลตัวอย่างทั้งหมดของสาขานี้?\n\nลบเฉพาะรายการตัวอย่าง — ข้อมูลจริงไม่ถูกแตะ")) return;
    setBusy("clear");
    setMsg(null);
    try {
      const res = await clearDemoData({ branchId });
      if (res.ok) {
        setMsg(`✓ ล้างแล้ว · ${res.data.sales} บิล · ${res.data.products} สินค้า · ${res.data.members} สมาชิก`);
        router.refresh();
      } else {
        setMsg("❌ " + res.error);
      }
    } catch {
      setMsg("❌ ล้างไม่สำเร็จ · ลองใหม่");
    } finally {
      setBusy(null);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        onClick={runSeed}
        disabled={busy !== null}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MITR,
          cursor: busy ? "default" : "pointer", background: GREEN, color: "#fff",
          border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600,
          opacity: busy === "seed" ? 0.6 : busy ? 0.5 : 1,
        }}
      >
        <Sparkles size={15} /> {busy === "seed" ? "กำลังเติม…" : "เติมข้อมูลตัวอย่าง"}
      </button>
      <button
        onClick={runClear}
        disabled={busy !== null}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MITR,
          cursor: busy ? "default" : "pointer", background: "#fff", color: MUTED,
          border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600,
          opacity: busy === "clear" ? 0.6 : busy ? 0.5 : 1,
        }}
      >
        <Eraser size={15} /> {busy === "clear" ? "กำลังล้าง…" : "ล้างข้อมูลตัวอย่าง"}
      </button>
      {msg && (
        <span style={{ fontSize: 12.5, color: msg.startsWith("✓") ? GREEN : RED }}>{msg}</span>
      )}
    </span>
  );
}
