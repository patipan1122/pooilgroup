"use client";

// Playland · ปุ่มลบรายการ care-log (อุบัติเหตุ/ตรวจปลอดภัย/ของหาย/ซ่อม) — manager only
// ใช้ในหน้าหลังบ้านที่กลายเป็น "ดูอย่างเดียว" · ปุ่มถังขยะเล็ก ๆ ขอบขวาของแถว · ยืนยันก่อนลบ
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteIncident } from "@/lib/playland/incidents";
import { deleteSafetyCheck } from "@/lib/playland/safety";
import { deleteLostFound } from "@/lib/playland/lost-found";
import { deleteRepair } from "@/lib/playland/stock";

type Kind = "incident" | "safety" | "lostfound" | "repair";

const ACTIONS: Record<Kind, (id: string) => Promise<{ ok: true } | { ok: false; error: string }>> = {
  incident: deleteIncident,
  safety: deleteSafetyCheck,
  lostfound: deleteLostFound,
  repair: deleteRepair,
};

export function CareDeleteButton({ kind, id, label }: { kind: Kind; id: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onDelete = () => {
    if (pending) return;
    if (!confirm("ลบรายการนี้? ลบแล้วกู้คืนไม่ได้")) return;
    start(async () => {
      const res = await ACTIONS[kind](id);
      if (!res.ok) {
        alert(res.error || "ลบไม่สำเร็จ");
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      aria-label={label ?? "ลบรายการ"}
      title={label ?? "ลบรายการ"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        flexShrink: 0,
        padding: 0,
        borderRadius: 8,
        border: "1px solid #ece5d8",
        background: "#fff",
        color: "#a89c8b",
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.5 : 1,
        transition: "color .12s, border-color .12s, background .12s",
      }}
      onMouseEnter={(e) => {
        if (pending) return;
        e.currentTarget.style.color = "#E74C3C";
        e.currentTarget.style.borderColor = "#f3c4bf";
        e.currentTarget.style.background = "#fdecea";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "#a89c8b";
        e.currentTarget.style.borderColor = "#ece5d8";
        e.currentTarget.style.background = "#fff";
      }}
    >
      <Trash2 size={15} />
    </button>
  );
}
