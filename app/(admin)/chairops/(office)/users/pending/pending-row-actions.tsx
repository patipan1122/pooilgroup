"use client";

// Per-row approve / reject controls for /chairops/users/pending (W7 · Wave-1b)
//
// Approve = inline dialog with role + branch + displayName · POSTs to
//   approveAccessRequest (creates ChairopsUser).
// Reject  = single-click with optional reason · POSTs to rejectAccessRequest
//   (audit-only · user keeps getting 403).
//
// Both server actions re-check role-rank (per
// [[role-rank-privilege-escalation-guard]]) so this UI cannot escalate.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import {
  approveAccessRequest,
  rejectAccessRequest,
} from "@/lib/chairops/auth/actions";

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

interface Props {
  authUserId: string;
  suggestedEmail: string;
  assignableRoles: ChairopsUserRole[];
  branches: { id: string; name: string }[];
}

export function PendingRowActions({
  authUserId,
  suggestedEmail,
  assignableRoles,
  branches,
}: Props) {
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<ChairopsUserRole>(
    assignableRoles.includes("OFFICE")
      ? "OFFICE"
      : (assignableRoles[0] ?? "TECHNICIAN"),
  );

  if (mode === "approve") {
    return (
      <form
        action={(fd) =>
          startTransition(async () => {
            const r = await approveAccessRequest(fd);
            if (r.ok) {
              toast.success("อนุมัติเรียบร้อย");
              setMode("idle");
            } else {
              toast.error(r.error);
            }
          })
        }
        className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-2"
      >
        <input type="hidden" name="authUserId" value={authUserId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-semibold text-zinc-700">
              ชื่อแสดง
            </label>
            <Input
              name="displayName"
              required
              maxLength={100}
              placeholder="ชื่อ-สกุล"
              disabled={isPending}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-700">
              อีเมล
            </label>
            <Input
              name="email"
              type="email"
              required
              defaultValue={suggestedEmail}
              disabled={isPending}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-700">
              สิทธิ์
            </label>
            <select
              name="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value as ChairopsUserRole)}
              disabled={isPending}
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-700">
              สาขาประจำ {role === "MAID" && <span className="text-red-600">*</span>}
            </label>
            <select
              name="primaryBranchId"
              required={role === "MAID"}
              disabled={isPending}
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none"
            >
              <option value="">— ไม่ระบุ —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => setMode("idle")}
          >
            ยกเลิก
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isPending}
            loading={isPending}
          >
            อนุมัติ
          </Button>
        </div>
      </form>
    );
  }

  if (mode === "reject") {
    return (
      <form
        action={(fd) =>
          startTransition(async () => {
            const r = await rejectAccessRequest(fd);
            if (r.ok) {
              toast.success("ปฏิเสธคำขอแล้ว");
              setMode("idle");
            } else {
              toast.error(r.error);
            }
          })
        }
        className="space-y-2 rounded-md border border-rose-200 bg-rose-50/40 p-2"
      >
        <input type="hidden" name="authUserId" value={authUserId} />
        <label className="text-[11px] font-semibold text-zinc-700">
          เหตุผล (ทางเลือก)
        </label>
        <Input
          name="reason"
          maxLength={280}
          placeholder="เช่น ไม่ใช่พนักงาน · ไม่ได้รับอนุญาต"
          disabled={isPending}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => setMode("idle")}
          >
            ยกเลิก
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            disabled={isPending}
            loading={isPending}
          >
            ยืนยันปฏิเสธ
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => setMode("approve")}
        disabled={assignableRoles.length === 0}
      >
        อนุมัติ
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setMode("reject")}
      >
        ปฏิเสธ
      </Button>
    </div>
  );
}
