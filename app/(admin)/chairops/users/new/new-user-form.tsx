"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/chairops/ui/button";
import { Input } from "@/components/chairops/ui/input";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { createUser } from "../actions";

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

interface Props {
  assignableRoles: ChairopsUserRole[];
  branches: { id: string; name: string }[];
}

export function NewUserForm({ assignableRoles, branches }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<ChairopsUserRole>(assignableRoles[0] ?? "TECHNICIAN");

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const r = await createUser(fd);
          if (r.ok) {
            toast.success("สร้างผู้ใช้เรียบร้อย · แจ้งให้ผู้ใช้ reset รหัสผ่าน");
            router.push(`/chairops/users/${r.data!.id}`);
          } else {
            toast.error(r.error);
          }
        })
      }
      className="space-y-3"
    >
      <div>
        <label className="text-sm font-medium">อีเมล *</label>
        <Input
          name="email"
          type="email"
          required
          placeholder="user@example.com"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="text-sm font-medium">ชื่อแสดง *</label>
        <Input name="displayName" required placeholder="เช่น สมหญิง แม่บ้าน" />
      </div>

      <div>
        <label className="text-sm font-medium">สิทธิ์ *</label>
        <select
          name="role"
          required
          value={role}
          onChange={(e) => setRole(e.target.value as ChairopsUserRole)}
          className="h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          {assignableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          คุณมอบได้เฉพาะสิทธิ์ที่ต่ำกว่าตัวเอง (ป้องกัน privilege escalation)
        </p>
      </div>

      <div>
        <label className="text-sm font-medium">
          สาขาประจำ {role === "MAID" && <span className="text-danger">*</span>}
        </label>
        <select
          name="primaryBranchId"
          required={role === "MAID"}
          className="h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          <option value="">— ไม่ระบุ —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {role === "MAID" && (
          <p className="mt-1 text-xs text-muted-foreground">
            แม่บ้านต้องมีสาขาประจำ (1 คน : 1 สาขา)
          </p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium">
          รหัสผ่านชั่วคราว (เว้นว่างให้ระบบสุ่ม)
        </label>
        <Input name="tempPassword" type="text" placeholder="อย่างน้อย 8 ตัว" autoComplete="off" />
        <p className="mt-1 text-xs text-muted-foreground">
          ผู้ใช้ต้องกด &quot;ลืมรหัสผ่าน&quot; เพื่อรีเซ็ตในครั้งแรก
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "กำลังสร้าง..." : "สร้างผู้ใช้"}
        </Button>
      </div>
    </form>
  );
}
