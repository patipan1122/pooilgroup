"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/chairops/ui/card";
import { Button } from "@/components/chairops/ui/button";
import { Input } from "@/components/chairops/ui/input";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import {
  assignBranch,
  deactivateUser,
  reactivateUser,
  updateDisplayName,
  updateUserRole,
} from "../actions";

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

interface Props {
  target: {
    id: string;
    email: string | null;
    displayName: string;
    role: ChairopsUserRole;
    primaryBranchId: string | null;
    isActive: boolean;
  };
  canManage: boolean;
  assignableRoles: ChairopsUserRole[];
  branches: { id: string; name: string }[];
}

export function UserDetailForm({ target, canManage, assignableRoles, branches }: Props) {
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<ChairopsUserRole>(target.role);
  const [branchId, setBranchId] = useState<string>(target.primaryBranchId ?? "");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">แก้ไขผู้ใช้</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          action={(fd) =>
            startTransition(async () => {
              const r = await updateDisplayName(fd);
              if (r.ok) toast.success("บันทึกชื่อแล้ว");
              else toast.error(r.error);
            })
          }
          className="space-y-2"
        >
          <input type="hidden" name="userId" value={target.id} />
          <label className="text-sm font-medium">ชื่อแสดง</label>
          <div className="flex gap-2">
            <Input
              name="displayName"
              defaultValue={target.displayName}
              required
              disabled={!canManage || isPending}
            />
            <Button type="submit" disabled={!canManage || isPending}>
              บันทึก
            </Button>
          </div>
        </form>

        <div className="space-y-2 border-t border-border pt-4">
          <label className="text-sm font-medium">สิทธิ์ (GUARDED)</label>
          <div className="flex gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ChairopsUserRole)}
              disabled={!canManage || isPending || assignableRoles.length === 0}
              className="h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value={target.role} disabled>
                {ROLE_LABEL[target.role]} (ปัจจุบัน)
              </option>
              {assignableRoles
                .filter((r) => r !== target.role)
                .map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
            </select>
            <Button
              type="button"
              variant="warning"
              disabled={
                !canManage || isPending || role === target.role
              }
              onClick={() =>
                run(
                  () => updateUserRole(target.id, role),
                  `เปลี่ยนสิทธิ์เป็น ${ROLE_LABEL[role]}`
                )
              }
            >
              เปลี่ยน
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            ระบบจะตรวจ canAssignRole + canManageUser อีกครั้งฝั่ง server
          </p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <label className="text-sm font-medium">สาขาประจำ</label>
          <div className="flex gap-2">
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={!canManage || isPending}
              className="h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— ไม่ระบุ —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={!canManage || isPending}
              onClick={() =>
                run(
                  () => assignBranch(target.id, branchId || null),
                  "อัปเดตสาขาแล้ว"
                )
              }
            >
              บันทึก
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <label className="text-sm font-medium">สถานะบัญชี</label>
          {target.isActive ? (
            <Button
              type="button"
              variant="destructive"
              disabled={!canManage || isPending}
              onClick={() =>
                run(() => deactivateUser(target.id), "ปิดบัญชีแล้ว")
              }
            >
              ปิดใช้งานบัญชี
            </Button>
          ) : (
            <Button
              type="button"
              variant="success"
              disabled={!canManage || isPending}
              onClick={() =>
                run(() => reactivateUser(target.id), "เปิดบัญชีแล้ว")
              }
            >
              เปิดใช้งานบัญชี
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            การปิดบัญชีจะป้องกัน login ทันที (ระบบเช็คใน getSession)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
