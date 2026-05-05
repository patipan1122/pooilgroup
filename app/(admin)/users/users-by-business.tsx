"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  UserPlus,
  Copy,
  Check,
  Phone,
  Mail,
  X as XIcon,
  Loader2,
  CheckCircle2,
  Circle,
  Crown,
} from "lucide-react";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";

export interface BranchWithUsers {
  id: string;
  code: string;
  name: string;
  business_type: string;
  company_id: string | null;
  province: string | null;
  is_active: boolean;
  users: BranchUser[];
}

export interface BranchUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
  has_line: boolean;
  has_telegram: boolean;
  invite_used: boolean;
}

export interface Company {
  id: string;
  code: string;
  name: string;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "ซุปเปอร์แอดมิน",
  admin: "แอดมิน",
  area_manager: "ผจก.เขต",
  branch_manager: "ผจก.สาขา",
  staff: "พนักงาน",
  driver: "คนขับ",
  viewer: "ผู้ดู",
  org_admin: "แอดมิน",
};

const MANAGER_ROLES = new Set([
  "branch_manager",
  "area_manager",
  "super_admin",
  "admin",
  "org_admin",
]);

interface Props {
  companies: Company[];
  branches: BranchWithUsers[];
  /** Users not assigned to any branch (admins, viewers) */
  unassigned: BranchUser[];
}

export function UsersByBusiness({ companies, branches, unassigned }: Props) {
  // Group: company → business_type → branches[]
  const grouped = useMemo(() => {
    const byCompany = new Map<string, Map<string, BranchWithUsers[]>>();
    for (const b of branches) {
      const cId = b.company_id ?? "none";
      if (!byCompany.has(cId)) byCompany.set(cId, new Map());
      const cMap = byCompany.get(cId)!;
      if (!cMap.has(b.business_type)) cMap.set(b.business_type, []);
      cMap.get(b.business_type)!.push(b);
    }
    return byCompany;
  }, [branches]);

  // Default: all expanded (open) — first business type per company
  const [openTypes, setOpenTypes] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const cId of grouped.keys()) {
      const types = grouped.get(cId)!;
      let first = true;
      for (const t of types.keys()) {
        if (first) {
          s.add(`${cId}:${t}`);
          first = false;
        }
      }
    }
    return s;
  });

  function toggle(key: string) {
    const next = new Set(openTypes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenTypes(next);
  }

  const [inviteCtx, setInviteCtx] = useState<{
    branchId: string;
    branchCode: string;
    branchName: string;
  } | null>(null);

  return (
    <>
      {Array.from(grouped.entries()).map(([companyId, typesMap]) => {
        const company = companies.find((c) => c.id === companyId);
        const totalBranches = Array.from(typesMap.values()).reduce(
          (s, list) => s + list.length,
          0,
        );
        const totalUsers = Array.from(typesMap.values()).reduce(
          (s, list) =>
            s + list.reduce((ss, b) => ss + b.users.length, 0),
          0,
        );

        return (
          <div key={companyId} className="mb-10">
            {/* Company header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="size-12 rounded-xl bg-[--color-brand-600] text-white flex items-center justify-center font-extrabold tracking-tight font-display text-lg shadow-blue">
                {company?.code.slice(0, 2) ?? "?"}
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display">
                  {company?.name ?? "ไม่ระบุบริษัท"}
                </h2>
                <p className="text-sm text-zinc-500">
                  <span className="tabular-num font-bold text-zinc-700">
                    {totalBranches}
                  </span>{" "}
                  สาขา ·{" "}
                  <span className="tabular-num font-bold text-zinc-700">
                    {totalUsers}
                  </span>{" "}
                  คนในระบบ
                </p>
              </div>
            </div>

            {/* Business type accordions */}
            <div className="space-y-3">
              {Array.from(typesMap.entries()).map(([type, branchList]) => {
                const cfg = BUSINESS_TYPES[type];
                const key = `${companyId}:${type}`;
                const isOpen = openTypes.has(key);
                const userCountInType = branchList.reduce(
                  (s, b) => s + b.users.length,
                  0,
                );
                return (
                  <div
                    key={type}
                    className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="w-full flex items-center gap-3 px-5 py-4 hover:bg-zinc-50 transition-colors text-left"
                    >
                      <span className="text-2xl">{cfg?.emoji ?? "📋"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold font-display text-base text-zinc-900">
                          {cfg?.label ?? type}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          <span className="tabular-num font-bold">
                            {branchList.length}
                          </span>{" "}
                          สาขา ·{" "}
                          <span className="tabular-num font-bold">
                            {userCountInType}
                          </span>{" "}
                          คน
                        </div>
                      </div>
                      <ChevronDown
                        className={cn(
                          "size-5 text-zinc-400 transition-transform shrink-0",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>

                    {isOpen && (
                      <div className="border-t-2 border-zinc-100 divide-y divide-zinc-100">
                        {branchList.map((b) => (
                          <BranchRow
                            key={b.id}
                            branch={b}
                            onInvite={() =>
                              setInviteCtx({
                                branchId: b.id,
                                branchCode: b.code,
                                branchName: b.name,
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Unassigned users (admins, super_admin, viewers — not tied to a branch) */}
      {unassigned.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="size-12 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Crown className="size-5" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display">
                ทีมส่วนกลาง
              </h2>
              <p className="text-sm text-zinc-500">
                <span className="tabular-num font-bold text-zinc-700">
                  {unassigned.length}
                </span>{" "}
                คน · ไม่ผูกสาขา (Admin / Owner / ผู้ดู)
              </p>
            </div>
          </div>
          <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {unassigned.map((u) => (
                <UserChip key={u.id} user={u} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Invite dialog */}
      {inviteCtx && (
        <InviteDialog
          branchId={inviteCtx.branchId}
          branchCode={inviteCtx.branchCode}
          branchName={inviteCtx.branchName}
          onClose={() => setInviteCtx(null)}
        />
      )}
    </>
  );
}

function BranchRow({
  branch,
  onInvite,
}: {
  branch: BranchWithUsers;
  onInvite: () => void;
}) {
  const managerCount = branch.users.filter((u) => MANAGER_ROLES.has(u.role)).length;
  const staffCount = branch.users.filter((u) => u.role === "staff").length;

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold tabular-num font-display text-sm">
              {branch.code}
            </span>
            <span className="text-sm text-zinc-700 truncate">
              {branch.name}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center gap-3">
            <span>
              <span
                className={cn(
                  "tabular-num font-bold",
                  managerCount === 0
                    ? "text-amber-700"
                    : managerCount >= 2
                      ? "text-[--color-leaf-700]"
                      : "text-zinc-700",
                )}
              >
                ผจก. {managerCount}/2
              </span>
            </span>
            <span className="text-zinc-300">·</span>
            <span>
              <span className="tabular-num font-bold text-zinc-700">
                พนักงาน {staffCount}
              </span>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onInvite}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[--color-brand-50] border-2 border-[--color-brand-200] text-[--color-brand-700] text-xs font-bold hover:bg-[--color-brand-100] transition-colors"
        >
          <UserPlus className="size-3.5" />
          เชิญคนเข้าสาขานี้
        </button>
      </div>

      {branch.users.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">— ยังไม่มีคนในสาขา —</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {branch.users.map((u) => (
            <UserChip key={u.id} user={u} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function UserChip({
  user,
  compact = false,
}: {
  user: BranchUser;
  compact?: boolean;
}) {
  const isManager = MANAGER_ROLES.has(user.role);

  // Status: green = active and channels bound, white = invited not yet active
  const isReady = user.is_active && user.invite_used;
  const dotClass = isReady
    ? "bg-[--color-leaf-500]"
    : user.is_active
      ? "bg-zinc-300"
      : "bg-amber-400";

  if (compact) {
    return (
      <Link
        href={`/users/${user.id}`}
        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border-2 border-zinc-200 text-xs font-medium hover:border-[--color-brand-300] transition-colors group"
      >
        <span
          className={cn("size-2 rounded-full shrink-0", dotClass)}
          title={isReady ? "พร้อมใช้งาน" : user.is_active ? "ยังไม่ Login" : "รอ activate"}
        />
        <span className={cn("truncate", isManager && "font-bold")}>
          {user.name}
        </span>
        <span className="text-[10px] text-zinc-500 shrink-0">
          {ROLE_LABEL[user.role] ?? user.role}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/users/${user.id}`}
      className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 transition-colors"
    >
      <span
        className={cn("size-2.5 rounded-full shrink-0", dotClass)}
        title={isReady ? "พร้อมใช้งาน" : "รอ activate"}
      />
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate">{user.name}</div>
        <div className="text-[11px] text-zinc-500 truncate">
          {user.email ?? user.phone ?? "—"}
        </div>
      </div>
      <span className="text-xs font-bold text-zinc-600 shrink-0">
        {ROLE_LABEL[user.role] ?? user.role}
      </span>
    </Link>
  );
}

function InviteDialog({
  branchId,
  branchCode,
  branchName,
  onClose,
}: {
  branchId: string;
  branchCode: string;
  branchName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("branch_manager");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function submit() {
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อ");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          role,
          branchIds: [branchId],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "เชิญไม่สำเร็จ");
        return;
      }
      setInviteUrl(json.inviteUrl);
      toast.success("สร้างลิงก์สำเร็จ — copy แล้วส่งให้คนนั้นใน LINE");
      router.refresh();
    });
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copy เรียบร้อย");
  }

  return (
    <Dialog open onClose={onClose} title={`เชิญคนเข้า ${branchCode}`}>
      <div className="space-y-4">
        <p className="text-xs text-zinc-500 -mt-1">{branchName}</p>

        {!inviteUrl ? (
          <>
            <div>
              <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                ชื่อ-นามสกุล
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น สมชาย ใจดี"
                className="w-full mt-1 px-4 py-3 rounded-xl border-2 border-zinc-200 bg-white text-base focus:border-[--color-brand-500] focus:outline-none transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                เบอร์โทร (ไม่บังคับ)
              </label>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="081-234-5678"
                className="w-full mt-1 px-4 py-3 rounded-xl border-2 border-zinc-200 bg-white text-base focus:border-[--color-brand-500] focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                ตำแหน่ง
              </label>
              <div className="mt-1 grid grid-cols-1 gap-1.5">
                {[
                  { v: "branch_manager", l: "ผู้จัดการสาขา" },
                  { v: "staff", l: "พนักงาน" },
                  { v: "viewer", l: "ผู้ดู (Read-only)" },
                ].map((r) => (
                  <label
                    key={r.v}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 cursor-pointer transition-colors",
                      role === r.v
                        ? "border-[--color-brand-500] bg-[--color-brand-50]"
                        : "border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r.v}
                      checked={role === r.v}
                      onChange={() => setRole(r.v)}
                    />
                    <span className="text-sm font-medium">{r.l}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-12 rounded-xl border-2 border-zinc-200 bg-white font-bold hover:bg-zinc-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !name.trim()}
                className="flex-1 h-12 rounded-xl bg-[--color-brand-600] text-white font-bold hover:bg-[--color-brand-700] shadow-blue disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                สร้างลิงก์เชิญ
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-[--color-leaf-50] border-2 border-[--color-leaf-200] p-4">
              <div className="flex items-center gap-2 mb-2 text-[--color-leaf-700]">
                <CheckCircle2 className="size-5" />
                <p className="font-bold">ลิงก์พร้อมส่งแล้ว</p>
              </div>
              <p className="text-xs text-zinc-700 mb-3">
                Copy ลิงก์ด้านล่างแล้วส่งให้ <strong>{name}</strong> ทาง LINE — ลิงก์หมดอายุใน 48 ชั่วโมง
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-xs font-mono"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 px-4 rounded-lg bg-[--color-brand-600] text-white text-sm font-bold hover:bg-[--color-brand-700]"
                >
                  {copied ? (
                    <>
                      <Check className="size-4" /> Copy แล้ว
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full h-12 rounded-xl bg-zinc-900 text-white font-bold hover:bg-zinc-800"
            >
              เสร็จแล้ว
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
