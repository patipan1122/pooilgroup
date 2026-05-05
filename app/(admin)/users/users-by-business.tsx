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
  Loader2,
  CheckCircle2,
  Crown,
  Bell,
  Inbox,
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

export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  is_read: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Owner",
  admin: "Admin",
  area_manager: "ผจก.เขต",
  branch_manager: "ผจก.สาขา",
  staff: "พนักงาน",
  driver: "คนขับ",
  viewer: "ผู้ดู",
  org_admin: "Admin",
};

const ROLE_COLOR: Record<string, string> = {
  super_admin: "bg-amber-100 text-amber-900 border-amber-300",
  admin: "bg-amber-50 text-amber-800 border-amber-200",
  org_admin: "bg-amber-50 text-amber-800 border-amber-200",
  area_manager: "bg-purple-50 text-purple-800 border-purple-200",
  branch_manager: "bg-[--color-brand-50] text-[--color-brand-800] border-[--color-brand-200]",
  staff: "bg-zinc-50 text-zinc-700 border-zinc-200",
  driver: "bg-blue-50 text-blue-800 border-blue-200",
  viewer: "bg-zinc-50 text-zinc-500 border-zinc-200",
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
  /** Recent admin/user notifications */
  notifications: AdminNotification[];
  pendingRequestCount: number;
}

export function UsersByBusiness({
  companies,
  branches,
  unassigned,
  notifications,
  pendingRequestCount,
}: Props) {
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

  // Default: all expanded
  const [openTypes, setOpenTypes] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const cId of grouped.keys()) {
      for (const t of grouped.get(cId)!.keys()) s.add(`${cId}:${t}`);
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
    <div className="space-y-6">
      {/* Notification box at top */}
      <NotificationBox
        notifications={notifications}
        pendingRequestCount={pendingRequestCount}
      />

      {Array.from(grouped.entries()).map(([companyId, typesMap]) => {
        const company = companies.find((c) => c.id === companyId);
        const totalBranches = Array.from(typesMap.values()).reduce(
          (s, list) => s + list.length,
          0,
        );
        const totalUsers = Array.from(typesMap.values()).reduce(
          (s, list) => s + list.reduce((ss, b) => ss + b.users.length, 0),
          0,
        );

        return (
          <div key={companyId}>
            {/* Company header — compact */}
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-[--color-brand-600] text-white flex items-center justify-center font-extrabold text-xs font-display">
                {company?.code.slice(0, 2) ?? "?"}
              </div>
              <div>
                <div className="font-extrabold font-display text-base text-zinc-900">
                  {company?.name ?? "ไม่ระบุบริษัท"}
                </div>
                <div className="text-[10px] text-zinc-500 -mt-0.5">
                  <span className="tabular-num font-bold">{totalBranches}</span>{" "}
                  สาขา ·{" "}
                  <span className="tabular-num font-bold">{totalUsers}</span>{" "}
                  คน
                </div>
              </div>
            </div>

            {/* Business type accordions — compact */}
            <div className="space-y-2">
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
                    className="rounded-xl border-2 border-zinc-200 bg-white overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 transition-colors text-left"
                    >
                      <span className="text-base">{cfg?.emoji ?? "📋"}</span>
                      <span className="font-extrabold font-display text-sm text-zinc-900">
                        {cfg?.label ?? type}
                      </span>
                      <span className="text-[11px] text-zinc-500 ml-1">
                        <span className="tabular-num font-bold text-zinc-700">
                          {branchList.length}
                        </span>{" "}
                        สาขา ·{" "}
                        <span className="tabular-num font-bold text-zinc-700">
                          {userCountInType}
                        </span>{" "}
                        คน
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-4 text-zinc-400 transition-transform shrink-0 ml-auto",
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

      {/* Unassigned users */}
      {unassigned.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="size-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center">
              <Crown className="size-4" />
            </div>
            <div>
              <div className="font-extrabold font-display text-base">
                ทีมส่วนกลาง
              </div>
              <div className="text-[10px] text-zinc-500 -mt-0.5">
                <span className="tabular-num font-bold">
                  {unassigned.length}
                </span>{" "}
                คน · ไม่ผูกสาขา
              </div>
            </div>
          </div>
          <div className="rounded-xl border-2 border-zinc-200 bg-white overflow-hidden divide-y divide-zinc-100">
            {unassigned.map((u) => (
              <UserChipRow key={u.id} user={u} />
            ))}
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
    </div>
  );
}

function NotificationBox({
  notifications,
  pendingRequestCount,
}: {
  notifications: AdminNotification[];
  pendingRequestCount: number;
}) {
  const totalAlerts = notifications.length + pendingRequestCount;

  if (totalAlerts === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 px-4 py-3 flex items-center gap-3">
        <div className="size-8 rounded-lg bg-[--color-leaf-50] border border-[--color-leaf-200] flex items-center justify-center text-[--color-leaf-600]">
          <CheckCircle2 className="size-4" />
        </div>
        <div className="text-xs text-zinc-500">
          ไม่มีเรื่องค้างเกี่ยวกับผู้ใช้งาน · ระบบเรียบร้อย
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/40 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-100/40 flex items-center gap-2">
        <Bell className="size-4 text-amber-700" />
        <span className="text-xs uppercase tracking-wider font-bold text-amber-900">
          แจ้งเตือนเกี่ยวกับผู้ใช้งาน
        </span>
        <span className="ml-auto text-[10px] tabular-num font-bold text-amber-700 bg-amber-200/50 px-2 py-0.5 rounded-full">
          {totalAlerts}
        </span>
      </div>
      <div className="divide-y divide-amber-200/50">
        {pendingRequestCount > 0 && (
          <Link
            href="/users/requests"
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-100/30 transition-colors"
          >
            <Inbox className="size-4 text-amber-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-zinc-900">
                คำขอเข้าใช้งานใหม่ {pendingRequestCount} คน
              </div>
              <div className="text-[11px] text-zinc-500">
                คลิกเพื่อดู/อนุมัติ
              </div>
            </div>
            <span className="text-[10px] font-bold text-amber-700">รออนุมัติ →</span>
          </Link>
        )}
        {notifications.slice(0, 5).map((n) => (
          <Link
            key={n.id}
            href={n.link ?? "#"}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-100/30 transition-colors"
          >
            <span
              className={cn(
                "size-2 rounded-full shrink-0",
                n.type === "danger"
                  ? "bg-red-500"
                  : n.type === "warning"
                    ? "bg-amber-500"
                    : n.type === "success"
                      ? "bg-[--color-leaf-500]"
                      : "bg-blue-500",
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-zinc-900 truncate">
                {n.title}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">{n.body}</div>
            </div>
            <span className="text-[10px] text-zinc-400 shrink-0">
              {timeAgo(n.created_at)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "เมื่อกี้";
  if (min < 60) return `${min} น.`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.`;
  const d = Math.floor(hr / 24);
  return `${d} วัน`;
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
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-extrabold tabular-num font-display text-xs">
            {branch.code}
          </span>
          <span className="text-xs text-zinc-700 truncate">{branch.name}</span>
          <span
            className={cn(
              "text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-md border",
              managerCount === 0
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-[--color-leaf-50] text-[--color-leaf-700] border-[--color-leaf-200]",
            )}
          >
            ผจก. {managerCount}/2
          </span>
          {staffCount > 0 && (
            <span className="text-[10px] font-bold tabular-num text-zinc-600 px-1.5 py-0.5 rounded-md bg-zinc-50 border border-zinc-200">
              พน. {staffCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onInvite}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[--color-brand-50] border border-[--color-brand-200] text-[--color-brand-700] text-[11px] font-bold hover:bg-[--color-brand-100] transition-colors shrink-0"
        >
          <UserPlus className="size-3" />
          เชิญ
        </button>
      </div>
      {branch.users.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {branch.users.map((u) => (
            <UserChipCompact key={u.id} user={u} />
          ))}
        </div>
      )}
    </div>
  );
}

function statusInfo(u: BranchUser): { dot: string; label: string } {
  if (!u.is_active) return { dot: "bg-zinc-300", label: "ปิดบัญชี" };
  if (!u.invite_used) return { dot: "bg-amber-400", label: "ยังไม่ activate" };
  return { dot: "bg-[--color-leaf-500]", label: "พร้อมใช้งาน" };
}

function UserChipCompact({ user }: { user: BranchUser }) {
  const isManager = MANAGER_ROLES.has(user.role);
  const status = statusInfo(user);
  const roleClass = ROLE_COLOR[user.role] ?? "bg-zinc-50 text-zinc-700 border-zinc-200";

  return (
    <Link
      href={`/users/${user.id}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-zinc-200 text-[11px] hover:border-[--color-brand-300] transition-colors group"
      title={status.label}
    >
      <span className={cn("size-1.5 rounded-full shrink-0", status.dot)} />
      <span className={cn("truncate max-w-[120px]", isManager && "font-bold")}>
        {user.name}
      </span>
      <span className={cn("text-[9px] px-1 py-0.5 rounded border font-bold", roleClass)}>
        {ROLE_LABEL[user.role] ?? user.role}
      </span>
      {/* Channel dots */}
      <span className="flex items-center gap-0.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            user.has_line ? "bg-[--color-leaf-500]" : "bg-zinc-200",
          )}
          title={user.has_line ? "LINE ผูกแล้ว" : "ยังไม่ผูก LINE"}
        />
        <span
          className={cn(
            "size-1.5 rounded-full",
            user.has_telegram ? "bg-[--color-leaf-500]" : "bg-zinc-200",
          )}
          title={user.has_telegram ? "Telegram ผูกแล้ว" : "ยังไม่ผูก Telegram"}
        />
      </span>
    </Link>
  );
}

function UserChipRow({ user }: { user: BranchUser }) {
  const status = statusInfo(user);
  const roleClass = ROLE_COLOR[user.role] ?? "bg-zinc-50 text-zinc-700 border-zinc-200";

  return (
    <Link
      href={`/users/${user.id}`}
      className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 transition-colors text-sm"
    >
      <span className={cn("size-2 rounded-full shrink-0", status.dot)} />
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="font-bold truncate">{user.name}</span>
        <span className="text-[11px] text-zinc-500 truncate">
          {user.email ?? user.phone ?? ""}
        </span>
      </div>
      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md border font-bold", roleClass)}>
        {ROLE_LABEL[user.role] ?? user.role}
      </span>
      <span className="flex items-center gap-1">
        <span
          className={cn(
            "size-2 rounded-full",
            user.has_line ? "bg-[--color-leaf-500]" : "bg-zinc-200",
          )}
          title="LINE"
        />
        <span
          className={cn(
            "size-2 rounded-full",
            user.has_telegram ? "bg-[--color-leaf-500]" : "bg-zinc-200",
          )}
          title="Telegram"
        />
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
      toast.success("สร้างลิงก์สำเร็จ — Copy แล้วส่งใน LINE");
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
