"use client";

// Create-user form (W7 · claude-design Wave-1b)
//
// Two ways to onboard a new ChairOps user — picked by a segmented toggle:
//   1. "ลิงก์เชิญ LINE" (default) → createUserInvite → one-tap LINE onboarding
//      link for ANY role (office/manager/admin/ช่าง/CEO), not just maids. No
//      email, no password — the invitee taps the link → LINE login → in.
//   2. "อีเมล + รหัสผ่าน" (fallback) → createUser → classic auth account for
//      people who don't use LINE.
//
// Both server actions enforce (never trust the dropdown — see
// [[role-rank-privilege-escalation-guard]]):
//   - canAssignRole(actor, requestedRole)
//   - MAID requires primaryBranchId
//   - Atomic auth.user + ChairopsUser create with rollback

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { createUser, createUserInvite } from "@/app/(admin)/chairops/users/actions";
import { Check, Copy, Link2, Mail, UserPlus } from "lucide-react";

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

type Method = "invite" | "email";

interface Props {
  assignableRoles: ChairopsUserRole[];
  branches: { id: string; name: string }[];
}

export function NewUserForm({ assignableRoles, branches }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [method, setMethod] = useState<Method>("invite");
  const [role, setRole] = useState<ChairopsUserRole>(
    assignableRoles[0] ?? "TECHNICIAN",
  );
  const [inviteResult, setInviteResult] = useState<{ link: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const branchRequired = role === "MAID";

  // ----- invite success card -----
  if (inviteResult) {
    return (
      <div className="space-y-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5">
        <div className="flex items-center gap-2 text-emerald-800">
          <Check className="size-5" aria-hidden />
          <span className="font-semibold">สร้างลิงก์เชิญ {inviteResult.name} แล้ว</span>
        </div>
        <p className="text-sm text-zinc-600">
          ส่งลิงก์นี้ให้เขาทาง LINE → กดเปิด → ล็อกอิน LINE → เข้าใช้งานได้เลย
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2.5">
          <Link2 className="size-4 shrink-0 text-zinc-400" aria-hidden />
          <span className="min-w-0 grow truncate font-mono text-xs text-zinc-700">
            {inviteResult.link}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => {
              void navigator.clipboard?.writeText(inviteResult.link);
              setCopied(true);
              toast.success("คัดลอกลิงก์แล้ว");
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <>
                <Check className="mr-1.5 size-4" /> คัดลอกแล้ว
              </>
            ) : (
              <>
                <Copy className="mr-1.5 size-4" /> คัดลอกลิงก์
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              setInviteResult(null);
              setCopied(false);
            }}
          >
            <UserPlus className="mr-1.5 size-4" /> เชิญอีกคน
          </Button>
        </div>
        <p className="text-[11px] text-zinc-500">
          ลิงก์มีอายุ 30 วัน · ผูกกับ LINE คนแรกที่กดล็อกอิน · กดซ้ำได้ ไม่ต้องขอลิงก์ใหม่
        </p>
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          if (method === "invite") {
            const r = await createUserInvite(fd);
            if (r.ok && r.data) {
              setInviteResult({
                link: r.data.link,
                name: String(fd.get("displayName") ?? "ผู้ใช้ใหม่"),
              });
            } else {
              toast.error(r.ok ? "สร้างลิงก์ไม่สำเร็จ" : r.error);
            }
          } else {
            const r = await createUser(fd);
            if (r.ok && r.data) {
              toast.success("สร้างผู้ใช้เรียบร้อย · แจ้งให้ผู้ใช้ reset รหัสผ่าน");
              router.push(`/chairops/users/${r.data.id}`);
            } else {
              toast.error(r.ok ? "ไม่ทราบ id ผู้ใช้ใหม่" : r.error);
            }
          }
        })
      }
      className="rounded-2xl border-2 border-zinc-200 bg-white p-5 shadow-soft"
    >
      <header className="mb-4 border-b border-zinc-200 pb-3">
        <p className="text-[10px] font-bold tracking-[0.02em] text-zinc-500">
          ข้อมูลใหม่
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          กรอกข้อมูลผู้ใช้
        </h2>
      </header>

      {/* วิธีให้เขาเข้าระบบ — segmented toggle */}
      <fieldset className="mb-5">
        <legend className="mb-1.5 block text-sm font-semibold text-zinc-900">
          วิธีให้เขาเข้าระบบ
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <MethodCard
            active={method === "invite"}
            disabled={isPending}
            onClick={() => setMethod("invite")}
            icon={<Link2 className="size-4" aria-hidden />}
            title="ลิงก์เชิญ LINE"
            desc="แนะนำ · กดลิงก์ → ล็อกอิน LINE → เข้าใช้ได้เลย ไม่ต้องตั้งรหัส"
          />
          <MethodCard
            active={method === "email"}
            disabled={isPending}
            onClick={() => setMethod("email")}
            icon={<Mail className="size-4" aria-hidden />}
            title="อีเมล + รหัสผ่าน"
            desc="สำหรับคนที่ไม่ได้ใช้ LINE · ต้องกด “ลืมรหัสผ่าน” ครั้งแรก"
          />
        </div>
      </fieldset>

      <div className="space-y-4">
        {/* อีเมล — เฉพาะวิธีอีเมล */}
        {method === "email" && (
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
        )}

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
            placeholder="เช่น สมหญิง ฝ่ายบัญชี"
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

        {/* รหัสผ่านชั่วคราว — เฉพาะวิธีอีเมล */}
        {method === "email" && (
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
        )}
      </div>

      <footer className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4">
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isPending || assignableRoles.length === 0}
          loading={isPending}
        >
          {method === "invite" ? (
            <>
              <Link2 className="mr-1.5 size-4" aria-hidden /> สร้างลิงก์เชิญ
            </>
          ) : (
            "สร้างผู้ใช้"
          )}
        </Button>
      </footer>
    </form>
  );
}

// ----- segmented method card -----
function MethodCard({
  active,
  disabled,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        "flex flex-col gap-1 rounded-xl border-2 p-3 text-left transition disabled:opacity-60 " +
        (active
          ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
          : "border-zinc-200 bg-white hover:border-zinc-300")
      }
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
        {icon}
        {title}
      </span>
      <span className="text-[11px] leading-snug text-zinc-500">{desc}</span>
    </button>
  );
}
