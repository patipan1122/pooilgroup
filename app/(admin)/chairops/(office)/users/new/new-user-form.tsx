"use client";

// Create-user form (W7 · claude-design Wave-1b)
//
// Submits to existing `createUser` server action (Wave-0 hardened — see
// app/(admin)/chairops/users/actions.ts). Server enforces:
//   - canAssignRole(actor, requestedRole)
//   - email uniqueness
//   - MAID requires primaryBranchId
//   - Atomic auth.user + ChairopsUser create with rollback
//
// UI just helps the operator pick valid combos. Never trust the dropdown —
// rely on the server (per [[role-rank-privilege-escalation-guard]]).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { createUser } from "@/app/(admin)/chairops/users/actions";

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

const ROLE_HINT: Partial<Record<ChairopsUserRole, string>> = {
  MAID: "แม่บ้านเก็บเงินตามสาขา · ต้องมีสาขาประจำ",
  OFFICE: "ฝ่ายบัญชี · เห็นทุกสาขา · reconcile",
  MANAGER: "ผู้จัดการพื้นที่ · บริหารหลายสาขา",
  TECHNICIAN: "ช่างซ่อม · รับ-แก้ damage ticket",
  CEO: "ระดับ executive · approve write-off ≥500฿",
  ADMIN: "Full access · ระวัง — มอบเฉพาะคนที่จำเป็น",
};

interface Props {
  assignableRoles: ChairopsUserRole[];
  branches: { id: string; name: string }[];
}

export function NewUserForm({ assignableRoles, branches }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<ChairopsUserRole>(
    assignableRoles[0] ?? "TECHNICIAN",
  );

  const branchRequired = role === "MAID";

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const r = await createUser(fd);
          if (r.ok && r.data) {
            toast.success(
              "สร้างผู้ใช้เรียบร้อย · แจ้งให้ผู้ใช้ reset รหัสผ่าน",
            );
            router.push(`/chairops/users/${r.data.id}`);
          } else {
            toast.error(r.ok ? "ไม่ทราบ id ผู้ใช้ใหม่" : r.error);
          }
        })
      }
      className="rounded-2xl border-2 border-zinc-200 bg-white p-5 shadow-soft"
    >
      <header className="mb-4 border-b border-zinc-200 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          ข้อมูลใหม่
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          กรอกข้อมูลผู้ใช้
        </h2>
      </header>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-semibold text-zinc-900"
          >
            อีเมล <span className="text-red-600">*</span>
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="user@example.com"
            autoComplete="off"
            disabled={isPending}
          />
        </div>

        <div>
          <label
            htmlFor="displayName"
            className="mb-1 block text-sm font-semibold text-zinc-900"
          >
            ชื่อแสดง <span className="text-red-600">*</span>
          </label>
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={100}
            placeholder="เช่น สมหญิง แม่บ้าน"
            disabled={isPending}
          />
        </div>

        <div>
          <label
            htmlFor="role"
            className="mb-1 block text-sm font-semibold text-zinc-900"
          >
            สิทธิ์ <span className="text-red-600">*</span>
          </label>
          <select
            id="role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value as ChairopsUserRole)}
            disabled={isPending || assignableRoles.length === 0}
            className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base focus:border-zinc-500 focus:outline-none disabled:bg-zinc-100"
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            คุณมอบได้เฉพาะสิทธิ์ที่ต่ำกว่าตัวเอง (ป้องกัน privilege escalation)
          </p>
          {ROLE_HINT[role] && (
            <p className="mt-1 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700 ring-1 ring-zinc-200">
              <span className="font-semibold">{ROLE_LABEL[role]}:</span>{" "}
              {ROLE_HINT[role]}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="primaryBranchId"
            className="mb-1 block text-sm font-semibold text-zinc-900"
          >
            สาขาประจำ{" "}
            {branchRequired && <span className="text-red-600">*</span>}
          </label>
          <select
            id="primaryBranchId"
            name="primaryBranchId"
            required={branchRequired}
            disabled={isPending}
            className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base focus:border-zinc-500 focus:outline-none disabled:bg-zinc-100"
          >
            <option value="">— ไม่ระบุ —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {branchRequired && (
            <p className="mt-1 text-xs text-amber-700">
              แม่บ้านต้องมีสาขาประจำ (1 คน : 1 สาขา)
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="tempPassword"
            className="mb-1 block text-sm font-semibold text-zinc-900"
          >
            รหัสผ่านชั่วคราว
          </label>
          <Input
            id="tempPassword"
            name="tempPassword"
            type="text"
            placeholder="เว้นว่างให้ระบบสุ่ม (แนะนำ)"
            autoComplete="off"
            disabled={isPending}
          />
          <p className="mt-1 text-xs text-zinc-500">
            ผู้ใช้ต้องกด &quot;ลืมรหัสผ่าน&quot; ในการ login ครั้งแรก
          </p>
        </div>
      </div>

      <footer className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4">
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isPending || assignableRoles.length === 0}
          loading={isPending}
        >
          สร้างผู้ใช้
        </Button>
      </footer>
    </form>
  );
}
