"use client";

// User-detail editor form (W7 · claude-design Wave-1b)
//
// Privilege model:
//   - canManage gates EVERY input (server still re-checks per
//     [[role-rank-privilege-escalation-guard]] — UI hide is not enough)
//   - assignableRoles = roles the actor can grant (filter happens on server)
//   - displayName edit is allowed for self-edit (server lets you rename
//     yourself but blocks role change → we mirror that with `selfNameOk`)
//
// Sections (top → bottom):
//   1) ชื่อแสดง (displayName · form action)
//   2) สิทธิ์ (role · button calls updateUserRole)
//   3) สาขาประจำ (primaryBranchId · button calls assignBranch)
//      - role==MAID → single select REQUIRED · helper text
//      - role==OFFICE/MANAGER → single select OPTIONAL · TODO[claude-design]
//        Wave 2 multi-branch via ChairopsBranchAssignment table
//   4) สถานะบัญชี (activate / deactivate)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChairopsUserRole, OffboardingReason } from "@/lib/generated/prisma/enums";
import {
  assignBranch,
  bindLineUserId,
  deactivateUser,
  deleteChairopsUser,
  reactivateUser,
  updateDisplayName,
  updateUserRole,
} from "@/app/(admin)/chairops/users/actions";

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
    lineUserId: string | null;
  };
  canManage: boolean;
  assignableRoles: ChairopsUserRole[];
  branches: { id: string; name: string }[];
  /** Super Admin only — shows the irreversible "ลบทิ้ง" (hard delete) button. */
  canHardDelete?: boolean;
}

export function UserDetailForm({
  target,
  canManage,
  assignableRoles,
  branches,
  canHardDelete = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [role, setRole] = useState<ChairopsUserRole>(target.role);
  const [branchId, setBranchId] = useState<string>(
    target.primaryBranchId ?? "",
  );

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-5 shadow-soft">
      <header className="mb-4 border-b border-zinc-200 pb-3">
        <p className="text-[10px] font-bold tracking-[0.02em] text-zinc-500">
          แก้ไขผู้ใช้
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          ข้อมูลบัญชี
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          ทุกการเปลี่ยนแปลงผ่าน role-rank guard ฝั่ง server (
          canManageUser · canAssignRole)
        </p>
      </header>

      {/* 1. displayName */}
      <Section title="ชื่อแสดง">
        <form
          action={(fd) =>
            startTransition(async () => {
              const r = await updateDisplayName(fd);
              if (r.ok) toast.success("บันทึกชื่อแล้ว");
              else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
            })
          }
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="userId" value={target.id} />
          <div className="min-w-[200px] flex-1">
            <Input
              name="displayName"
              defaultValue={target.displayName}
              required
              disabled={!canManage || isPending}
              maxLength={100}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canManage || isPending}
            loading={isPending}
          >
            บันทึก
          </Button>
        </form>
      </Section>

      {/* 2. role */}
      <Section
        title="สิทธิ์ (GUARDED)"
        hint="ระบบ block role ที่สูงกว่าหรือเท่าตัวเอง — ป้องกัน privilege escalation"
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ChairopsUserRole)}
            disabled={
              !canManage || isPending || assignableRoles.length === 0
            }
            className="h-10 min-w-[180px] flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
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
            variant="secondary"
            size="md"
            disabled={!canManage || isPending || role === target.role}
            loading={isPending}
            onClick={() =>
              run(
                () => updateUserRole(target.id, role),
                `เปลี่ยนสิทธิ์เป็น ${ROLE_LABEL[role]}`,
              )
            }
          >
            เปลี่ยนสิทธิ์
          </Button>
        </div>
      </Section>

      {/* 3. branch */}
      <Section
        title="สาขาประจำ"
        hint={
          target.role === "MAID"
            ? "แม่บ้านต้องมีสาขาประจำ (1 คน : 1 สาขา) — เปลี่ยนแล้วยอด collect ใหม่จะผูกสาขาใหม่ทันที"
            : target.role === "OFFICE" || target.role === "MANAGER"
              ? "Wave-1 รองรับสาขาเดียว · Wave-2 จะมี multi-branch assignment"
              : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={!canManage || isPending}
            className="h-10 min-w-[180px] flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
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
            variant="primary"
            size="md"
            disabled={
              !canManage ||
              isPending ||
              (branchId || null) === (target.primaryBranchId ?? null)
            }
            loading={isPending}
            onClick={() =>
              run(
                () => assignBranch(target.id, branchId || null),
                "อัปเดตสาขาแล้ว",
              )
            }
          >
            บันทึก
          </Button>
        </div>
      </Section>

      {/* 3.5 LINE Mini App binding */}
      <Section
        title="ผูก LINE (Mini App)"
        hint="ให้พนักงานเปิด Mini App จาก Rich Menu → หน้าจอจะโชว์ LINE ID ของเขา → เอามาวางที่นี่ แล้วเขาจะล็อกอินเข้า Mini App อัตโนมัติ (เว้นว่าง = ยกเลิกผูก)"
      >
        <form
          action={(fd) =>
            startTransition(async () => {
              const r = await bindLineUserId(fd);
              if (r.ok) toast.success("ผูก LINE แล้ว");
              else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
            })
          }
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="userId" value={target.id} />
          <div className="min-w-[200px] flex-1">
            <Input
              name="lineUserId"
              defaultValue={target.lineUserId ?? ""}
              placeholder="Uxxxxxxxxxxxx…"
              disabled={!canManage || isPending}
              maxLength={40}
              className="font-mono"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canManage || isPending}
            loading={isPending}
          >
            บันทึก
          </Button>
        </form>
        {/* Explicit unbind — clearing the field + บันทึก also works, but a maid
            bound to the wrong/leftover account needs an obvious one-tap "ปลด LINE".
            Frees this LINE so it can bind to another account. */}
        {target.lineUserId && (
          <form
            action={(fd) =>
              startTransition(async () => {
                const r = await bindLineUserId(fd);
                if (r.ok)
                  toast.success("ปลด LINE แล้ว · LINE นี้ผูกกับบัญชีอื่นได้แล้ว");
                else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
              })
            }
            className="mt-2"
          >
            <input type="hidden" name="userId" value={target.id} />
            <input type="hidden" name="lineUserId" value="" />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!canManage || isPending}
              loading={isPending}
              className="text-rose-700 ring-rose-200 hover:bg-rose-50"
            >
              ปลด LINE ออกจากบัญชีนี้
            </Button>
          </form>
        )}
      </Section>

      {/* 4. status · F7: reason + note required for deactivation */}
      <Section
        title="สถานะบัญชี"
        hint="ปิดบัญชีจะ block ทันทีในรอบ session ถัดไป (getSession เช็ค isActive)"
      >
        {target.isActive ? (
          <DeactivateSection
            targetId={target.id}
            targetName={target.displayName}
            canManage={canManage}
            isPending={isPending}
            startTransition={startTransition}
          />
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={!canManage || isPending}
            loading={isPending}
            onClick={() =>
              run(() => reactivateUser(target.id), "เปิดบัญชีแล้ว")
            }
          >
            เปิดใช้งานบัญชี
          </Button>
        )}

        {/* Hard delete — Super Admin only, irreversible. Two-tap confirm. Used to
            clear junk/test accounts; real accounts with work history are blocked
            server-side (FK Restrict → "ใช้ปิดบัญชีแทน"). */}
        {canHardDelete && canManage && (
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              loading={isPending}
              className="text-rose-700 ring-rose-200 hover:bg-rose-50"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                startTransition(async () => {
                  const r = await deleteChairopsUser(target.id);
                  if (r.ok) {
                    toast.success("ลบบัญชีถาวรแล้ว");
                    router.push("/chairops/users");
                    router.refresh();
                  } else {
                    toast.error(r.error ?? "ลบไม่สำเร็จ");
                    setConfirmDelete(false);
                  }
                });
              }}
            >
              {confirmDelete ? "⚠️ กดอีกครั้งเพื่อลบถาวร" : "ลบบัญชีถาวร (ลบทิ้ง)"}
            </Button>
            <p className="mt-1 text-[11px] text-zinc-500">
              ลบถาวร · เฉพาะ Super Admin · ใช้กับบัญชีขยะ/ทดสอบ · บัญชีที่มีประวัติงานจริงลบไม่ได้ (ใช้ปิดบัญชีแทน)
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-100 py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-sm font-semibold text-zinc-900">{title}</h3>
      {children}
      {hint && <p className="mt-2 text-[11px] text-zinc-500">{hint}</p>}
    </section>
  );
}

// F7: deactivation reason dropdown + optional note
const OFFBOARDING_LABEL: Record<OffboardingReason, string> = {
  RESIGNED: "ลาออก",
  TERMINATED: "เลิกจ้าง",
  TRANSFERRED: "ย้ายสาขา",
  OTHER: "อื่นๆ",
};

function DeactivateSection({
  targetId,
  targetName,
  canManage,
  isPending,
  startTransition,
}: {
  targetId: string;
  targetName: string;
  canManage: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  const [reason, setReason] = useState<OffboardingReason>("RESIGNED");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="danger"
        size="md"
        disabled={!canManage || isPending}
        onClick={() => setConfirming(true)}
      >
        ปิดใช้งานบัญชี
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-red-200 bg-red-50/50 p-3">
      <p className="text-xs font-semibold text-red-700">ยืนยันการปิดบัญชี</p>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-zinc-700">
          เหตุผล
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as OffboardingReason)}
          className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm focus:outline-none"
        >
          {(Object.keys(OFFBOARDING_LABEL) as OffboardingReason[]).map((r) => (
            <option key={r} value={r}>
              {OFFBOARDING_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-zinc-700">
          หมายเหตุ (ไม่บังคับ)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="รายละเอียดเพิ่มเติม..."
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>
      {/* Q5: Name confirmation — admin must type the maid's name to proceed */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-zinc-700">
          พิมพ์ชื่อ <span className="font-bold text-zinc-900">{targetName}</span> เพื่อยืนยัน
        </label>
        <Input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={targetName}
          disabled={isPending}
          className="text-sm"
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={isPending || confirmName.trim() !== targetName.trim()}
          loading={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await deactivateUser(targetId, reason, note || undefined);
              if (r.ok) toast.success("ปิดบัญชีแล้ว");
              else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
            })
          }
        >
          ยืนยันปิดบัญชี
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => { setConfirming(false); setConfirmName(""); }}
        >
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}
