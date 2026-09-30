"use client";

// ตัวเลือกตำแหน่ง (สมาชิก / แอดมินโปรแกรม) ต่อพนักงาน 1 แถวในตาราง —
// เรียก setDocuflowMemberRole (lib/docuflow/settings-actions.ts) ตรงๆ
// ไม่มี toggle "แอดมินโปรแกรม" ให้กดถ้าคนที่ล็อกอินอยู่ไม่ใช่ super_admin —
// ตาม pattern เดียวกับที่แก้ไว้ใน /users/[id]/edit (postmortem 2026-09-30):
// UI ต้องไม่เสนอปุ่มที่ server จะปฏิเสธอยู่แล้ว.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setDocuflowMemberRole } from "@/lib/docuflow/settings-actions";

export function RoleCell({
  userId,
  initialRole,
  callerIsSuperAdmin,
}: {
  userId: string;
  initialRole: "member" | "admin";
  callerIsSuperAdmin: boolean;
}) {
  const [role, setRole] = useState<"member" | "admin">(initialRole);
  const [pending, startTransition] = useTransition();

  function onChange(next: "member" | "admin") {
    if (next === role) return;
    const prev = role;
    setRole(next); // optimistic
    startTransition(async () => {
      const res = await setDocuflowMemberRole(userId, next);
      if (!res.ok) {
        setRole(prev);
        toast.error(res.error);
        return;
      }
      toast.success(
        next === "admin" ? "ตั้งเป็นแอดมินโปรแกรมแล้ว" : "ปรับเป็นสมาชิกแล้ว",
      );
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select
        value={role}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as "member" | "admin")}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 8px",
          borderRadius: 8,
          border: "1px solid var(--df-line)",
          background: "var(--df-surface)",
          color: "var(--df-ink)",
          cursor: pending ? "wait" : "pointer",
        }}
        aria-label="ตำแหน่งใน DocuFlow"
      >
        <option value="member">สมาชิก</option>
        {/* ปิดตัวเลือก "แอดมินโปรแกรม" ถ้าคนล็อกอินไม่ใช่ super_admin — server
            จะปฏิเสธอยู่แล้ว (CEO 2026-06-15) แต่ไม่ควรให้กดแล้วเจอ error ลอยๆ.
            ถ้าตำแหน่งปัจจุบันเป็นแอดมินอยู่แล้วก็ยังต้องเห็นตัวเลือกนี้
            (ไม่งั้น dropdown จะไม่มีค่าปัจจุบันให้เลือก). */}
        {(callerIsSuperAdmin || role === "admin") && (
          <option value="admin">แอดมินโปรแกรม</option>
        )}
      </select>
      {pending && <Loader2 className="animate-spin" size={12} aria-hidden />}
    </div>
  );
}
