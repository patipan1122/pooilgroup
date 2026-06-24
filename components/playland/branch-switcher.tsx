"use client";

// Playland · ตัวสลับ "สาขาที่กำลังทำงาน" — เลือกครั้งเดียว คุมทุกหน้าหลังบ้าน (เก็บใน cookie)
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveBranch } from "@/lib/playland/branch-actions";
import { Building2 } from "lucide-react";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";

export function BranchSwitcher({ branches, activeId }: { branches: { id: string; name: string }[]; activeId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (branches.length <= 1) return null; // สาขาเดียว = ไม่ต้องโชว์ (กันรก)

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #ece5d8", borderRadius: 999, padding: "7px 8px 7px 14px", opacity: pending ? 0.55 : 1 }}>
      <Building2 size={16} color="#2D6CB1" />
      <span style={{ fontSize: 12, color: "#8a7f70" }}>สาขา</span>
      <select
        value={activeId ?? ""}
        disabled={pending}
        onChange={(e) => start(async () => { await setActiveBranch(e.target.value); router.refresh(); })}
        style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, fontWeight: 600, color: "#2D6CB1", fontFamily: MITR, cursor: pending ? "wait" : "pointer", maxWidth: 180 }}
      >
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
