"use client";

import {
  useState,
  useMemo,
  useTransition,
  useRef,
  useEffect,
  createContext,
  useContext,
} from "react";
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
  Search,
  X as XIcon,
  MoreHorizontal,
  Mail,
  LogOut,
  Lock,
  Unlock,
  Activity as ActivityIcon,
  ShieldCheck,
  RotateCcw,
  LayoutGrid,
  Table as TableIcon,
  UserCog,
} from "lucide-react";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { UsersTableView, type FlatUser } from "./users-table-view";
import {
  MANAGER_ROLES,
  HIDE_MESSAGING_ROLES,
  roleLabel,
  roleColor,
} from "@/lib/constants/roles";

/** Real (not impersonated) viewer info — used to gate the impersonate action. */
const ViewerCtx = createContext<{ id: string; role: string }>({
  id: "",
  role: "",
});

/** Per-user unread-notification counts — drives the red dot beside user names.
    Empty map = no dots anywhere. */
const UnreadCtx = createContext<Record<string, number>>({});

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
  last_login_at: string | null;
  created_at: string;
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

export interface UserStats {
  total: number;
  activeWeek: number;
  newThisWeek: number;
  pendingActivation: number;
  noLine: number;
  noTelegram: number;
  offline7d: number;
  branchesMissingMgr: number;
}

// Role labels + colors come from the shared constant — see lib/constants/roles.ts

const PERMISSION_DESC: Record<string, { can: string[]; cant: string[] }> = {
  super_admin: {
    can: [
      "ทำได้ทุกอย่างในระบบ",
      "เพิ่ม/ลบ Admin ได้",
      "ดู P&L / รายได้ / กำไร",
      "เปลี่ยน billing / org settings",
    ],
    cant: ["—"],
  },
  admin: {
    can: [
      "เพิ่ม/ลบผู้จัดการ พนักงาน",
      "อนุมัติคำขอเข้าใช้งาน",
      "Approve รายงานทุกสาขา",
      "ดู Audit Log",
      "Export ข้อมูล Operations",
    ],
    cant: [
      "ห้ามเพิ่ม Admin คนใหม่",
      "ดู P&L / Margin / Payroll ไม่ได้",
      "เปลี่ยน billing ไม่ได้",
    ],
  },
  area_manager: {
    can: [
      "ดูยอดทุกสาขาในเขต",
      "Approve รายงานในเขต",
      "เพิ่มผู้จัดการสาขาในเขตได้",
    ],
    cant: ["ดูข้ามเขตไม่ได้", "เพิ่ม Admin ไม่ได้"],
  },
  branch_manager: {
    can: [
      "ดูยอดสาขาตัวเอง",
      "Approve รายงานสาขา",
      "เพิ่มพนักงานในสาขา",
    ],
    cant: ["ข้ามสาขาตัวเองไม่ได้"],
  },
  staff: {
    can: ["กรอกรายงานสาขาตัวเอง", "ดูยอดของตัวเองที่ส่งไป"],
    cant: ["Approve ไม่ได้", "ดูยอดสาขาอื่นไม่ได้"],
  },
  driver: {
    can: ["ใช้ Driver App (FuelOS)", "อัพเดต GPS / สถานะ"],
    cant: ["ดูยอดขาย / รายงาน CashHub ไม่ได้"],
  },
  viewer: {
    can: ["ดูข้อมูลทั้งหมดเป็น Read-only"],
    cant: ["แก้ไขอะไรไม่ได้", "Approve ไม่ได้"],
  },
};

// MANAGER_ROLES + HIDE_MESSAGING_ROLES come from the shared constant
// — see lib/constants/roles.ts

interface FilterState {
  search: string;
  noLine: boolean;
  noTelegram: boolean;
  pending: boolean;
  offline7d: boolean;
  activeWeek: boolean;
  newThisWeek: boolean;
  roles: Set<string>;
  /** Show only branches that don't have a branch_manager assigned. */
  branchesMissingMgr: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type StatFilterKey =
  | "clear"
  | "activeWeek"
  | "newThisWeek"
  | "pending"
  | "noLine"
  | "offline7d"
  | "branchesMissingMgr";

interface Props {
  companies: Company[];
  branches: BranchWithUsers[];
  unassigned: BranchUser[];
  notifications: AdminNotification[];
  pendingRequestCount: number;
  stats: UserStats;
  /** Server-rendered timestamp. Use this for date-based filters so render stays pure. */
  nowMs: number;
  /** Flat list (id, name, branchCodes, ...) for the Excel-style table view. */
  flatUsers: FlatUser[];
  /** Real (not impersonated) viewer id — for hiding self from impersonate target. */
  currentUserId: string;
  /** Real (not impersonated) viewer role — controls impersonate target gating. */
  currentUserRole: string;
  /** userId → unread notification count. Drives the red dot in chips. */
  unreadByUserId: Record<string, number>;
}

export function UsersByBusiness({
  companies,
  branches,
  unassigned,
  notifications,
  pendingRequestCount,
  stats,
  nowMs,
  flatUsers,
  currentUserId,
  currentUserRole,
  unreadByUserId,
}: Props) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("admin-users-view-mode");
    if (saved === "card" || saved === "table") setViewMode(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("admin-users-view-mode", viewMode);
    }
  }, [viewMode]);
  const [filter, setFilter] = useState<FilterState>({
    search: "",
    noLine: false,
    noTelegram: false,
    pending: false,
    offline7d: false,
    activeWeek: false,
    newThisWeek: false,
    roles: new Set(),
    branchesMissingMgr: false,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();

  const now = nowMs;

  const matchesFilter = (u: BranchUser): boolean => {
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const hay = `${u.name} ${u.email ?? ""} ${u.phone ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // These three buckets must mirror their stat counters in page.tsx exactly,
    // otherwise the stat card and the filtered list disagree.
    if (filter.noLine && (!u.is_active || u.has_line)) return false;
    if (filter.noTelegram && (!u.is_active || u.has_telegram)) return false;
    if (filter.pending && (u.is_active || u.invite_used)) return false;
    if (filter.offline7d) {
      if (!u.is_active) return false;
      if (u.last_login_at) {
        const ageMs = now - new Date(u.last_login_at).getTime();
        if (ageMs < WEEK_MS) return false;
      }
    }
    if (filter.activeWeek) {
      if (!u.is_active) return false;
      if (!u.last_login_at) return false;
      const ageMs = now - new Date(u.last_login_at).getTime();
      if (ageMs >= WEEK_MS) return false;
    }
    if (filter.newThisWeek) {
      const ageMs = now - new Date(u.created_at).getTime();
      if (ageMs >= WEEK_MS) return false;
    }
    if (filter.roles.size > 0 && !filter.roles.has(u.role)) return false;
    return true;
  };

  // Filter branches → keep branches where any user matches OR no filter active
  const hasActiveFilter =
    !!filter.search ||
    filter.noLine ||
    filter.noTelegram ||
    filter.pending ||
    filter.offline7d ||
    filter.activeWeek ||
    filter.newThisWeek ||
    filter.roles.size > 0 ||
    filter.branchesMissingMgr;

  const filteredBranches = useMemo(() => {
    if (!hasActiveFilter) return branches;
    let list = branches.map((b) => ({
      ...b,
      users: b.users.filter(matchesFilter),
    }));
    // Branch-level filter: only branches missing a branch_manager.
    // Show even with 0 matching users so admin sees the branch needs attention.
    if (filter.branchesMissingMgr) {
      list = list.filter(
        (b) => !b.users.some((u) => u.role === "branch_manager"),
      );
    } else {
      list = list.filter((b) => b.users.length > 0);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, filter, hasActiveFilter]);

  const filteredUnassigned = useMemo(() => {
    if (!hasActiveFilter) return unassigned;
    // When filtering by branchesMissingMgr the unassigned list is irrelevant —
    // those users aren't tied to any branch.
    if (filter.branchesMissingMgr) return [];
    return unassigned.filter(matchesFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassigned, filter, hasActiveFilter]);

  const grouped = useMemo(() => {
    const byCompany = new Map<string, Map<string, BranchWithUsers[]>>();
    for (const b of filteredBranches) {
      const cId = b.company_id ?? "none";
      if (!byCompany.has(cId)) byCompany.set(cId, new Map());
      const cMap = byCompany.get(cId)!;
      if (!cMap.has(b.business_type)) cMap.set(b.business_type, []);
      cMap.get(b.business_type)!.push(b);
    }
    return byCompany;
  }, [filteredBranches]);

  const [openTypes, setOpenTypes] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const cId of grouped.keys()) {
      for (const t of grouped.get(cId)!.keys()) s.add(`${cId}:${t}`);
    }
    return s;
  });
  // Lifted: which branches' user-lists are expanded (controlled from parent
  // so the global ขยายทั้งหมด/ย่อทั้งหมด toggle works on every row).
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(
    new Set(),
  );

  function toggle(key: string) {
    const next = new Set(openTypes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenTypes(next);
  }

  function toggleBranch(branchId: string) {
    const next = new Set(expandedBranches);
    if (next.has(branchId)) next.delete(branchId);
    else next.add(branchId);
    setExpandedBranches(next);
  }

  // All keys for expand-all / collapse-all
  const allTypeKeys = useMemo(() => {
    const s = new Set<string>();
    for (const cId of grouped.keys()) {
      for (const t of grouped.get(cId)!.keys()) s.add(`${cId}:${t}`);
    }
    return s;
  }, [grouped]);
  const allBranchIdsWithUsers = useMemo(() => {
    const s = new Set<string>();
    for (const typesMap of grouped.values()) {
      for (const list of typesMap.values()) {
        for (const b of list) {
          if (b.users.length > 0) s.add(b.id);
        }
      }
    }
    return s;
  }, [grouped]);
  const isAllExpanded =
    openTypes.size === allTypeKeys.size &&
    expandedBranches.size === allBranchIdsWithUsers.size;
  function expandAll() {
    setOpenTypes(new Set(allTypeKeys));
    setExpandedBranches(new Set(allBranchIdsWithUsers));
  }
  function collapseAll() {
    setOpenTypes(new Set());
    setExpandedBranches(new Set());
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleAllVisible = () => {
    const visibleIds = new Set<string>();
    for (const b of filteredBranches) for (const u of b.users) visibleIds.add(u.id);
    for (const u of filteredUnassigned) visibleIds.add(u.id);
    if (visibleIds.size === selectedIds.size) {
      clearSelection();
    } else {
      setSelectedIds(visibleIds);
    }
  };

  const runBulkAction = (action: "lock" | "unlock" | "force_logout" | "resend_invite") => {
    if (selectedIds.size === 0) return;
    const labels = {
      lock: "ปิดบัญชี",
      unlock: "เปิดบัญชี",
      force_logout: "Force Logout",
      resend_invite: "ส่งลิงก์เชิญใหม่",
    };
    if (!confirm(`${labels[action]} ผู้ใช้ ${selectedIds.size} คน?`)) return;
    startBulkTransition(async () => {
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selectedIds), action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "ดำเนินการไม่สำเร็จ");
        return;
      }
      toast.success(
        `${labels[action]} สำเร็จ ${json.processed} คน${json.skipped > 0 ? ` (ข้าม ${json.skipped})` : ""}`,
      );
      clearSelection();
      router.refresh();
    });
  };

  const [inviteCtx, setInviteCtx] = useState<{
    branchId: string;
    branchCode: string;
    branchName: string;
  } | null>(null);

  const totalVisibleUsers =
    filteredBranches.reduce((s, b) => s + b.users.length, 0) +
    filteredUnassigned.length;

  return (
    <ViewerCtx.Provider value={{ id: currentUserId, role: currentUserRole }}>
    <UnreadCtx.Provider value={unreadByUserId}>
    <div className="space-y-5">
      {/* Notification box */}
      <NotificationBox
        notifications={notifications}
        pendingRequestCount={pendingRequestCount}
      />

      {/* Stats summary */}
      <StatsSummary stats={stats} filter={filter} setFilter={setFilter} hasFilter={hasActiveFilter} />

      {/* View-mode tabs: การ์ดสำหรับดูภาพรวม / ตารางสำหรับ bulk-edit + Excel */}
      <ViewModeTabs viewMode={viewMode} setViewMode={setViewMode} />

      {viewMode === "table" && <UsersTableView users={flatUsers} />}

      {viewMode === "card" && (
      <>
      {/* Search + filter bar */}
      <FilterBar filter={filter} setFilter={setFilter} totalVisible={totalVisibleUsers} />

      {/* Bulk action bar — appears when something selected */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-40 rounded-xl border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)] shadow-blue px-4 py-2.5 flex items-center gap-2 flex-wrap animate-fade-up">
          <span className="text-sm font-bold text-[var(--color-brand-900)]">
            เลือกแล้ว {selectedIds.size} คน
          </span>
          <button
            onClick={clearSelection}
            className="text-xs text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] font-medium"
          >
            ยกเลิก
          </button>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <BulkBtn
              onClick={() => runBulkAction("resend_invite")}
              disabled={bulkPending}
              icon={<Mail className="size-3.5" />}
              label="ส่งลิงก์ใหม่"
            />
            <BulkBtn
              onClick={() => runBulkAction("force_logout")}
              disabled={bulkPending}
              icon={<LogOut className="size-3.5" />}
              label="Force Logout"
            />
            <BulkBtn
              onClick={() => runBulkAction("unlock")}
              disabled={bulkPending}
              icon={<Unlock className="size-3.5" />}
              label="เปิด"
            />
            <BulkBtn
              onClick={() => runBulkAction("lock")}
              disabled={bulkPending}
              icon={<Lock className="size-3.5" />}
              label="ปิดบัญชี"
              danger
            />
          </div>
        </div>
      )}

      {/* Selection toggle + prominent expand/collapse-all button.
          Per project rule "Collapse-all/Expand-all button on lists" the
          control must be visually obvious — promoted from text-link to a
          bordered button so users with 30+ branches can scan fast. */}
      {totalVisibleUsers > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-xs text-zinc-500">
          <button
            onClick={toggleAllVisible}
            className="inline-flex items-center gap-1.5 hover:text-zinc-900 font-medium"
          >
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === totalVisibleUsers}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < totalVisibleUsers;
              }}
              readOnly
              className="size-3.5 rounded"
            />
            เลือกทั้งหมดที่แสดง
          </button>
          <span className="text-zinc-300">·</span>
          <span>แสดง {totalVisibleUsers} คน</span>
          <button
            onClick={isAllExpanded ? collapseAll : expandAll}
            title={isAllExpanded ? "พับทุกธุรกิจและทุกสาขา" : "ขยายทุกธุรกิจ + เห็นรายชื่อทุกสาขา"}
            className="ml-auto inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)] text-xs font-bold hover:bg-[var(--color-brand-100)] hover:border-[var(--color-brand-400)] transition-colors"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                isAllExpanded && "rotate-180",
              )}
            />
            {isAllExpanded ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
          </button>
        </div>
      )}

      {/* Empty state */}
      {grouped.size === 0 && filteredUnassigned.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-10 text-center">
          <p className="text-base font-bold text-zinc-700">ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข</p>
          <p className="text-sm text-zinc-500 mt-1">ลองล้างตัวกรองหรือเปลี่ยนคำค้น</p>
        </div>
      ) : (
        <>
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
                <div className="flex items-center gap-2 mb-2">
                  <div className="size-8 rounded-lg bg-[var(--color-brand-600)] text-white flex items-center justify-center font-extrabold text-xs font-display">
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
                                selectedIds={selectedIds}
                                onToggleSelect={toggleSelect}
                                expanded={expandedBranches.has(b.id)}
                                onToggleExpand={() => toggleBranch(b.id)}
                                onInvite={() =>
                                  setInviteCtx({
                                    branchId: b.id,
                                    branchCode: b.code,
                                    branchName: b.name,
                                  })
                                }
                                onAfterAction={() => router.refresh()}
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

          {filteredUnassigned.length > 0 && (
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
                      {filteredUnassigned.length}
                    </span>{" "}
                    คน · ไม่ผูกสาขา
                  </div>
                </div>
              </div>
              <div className="rounded-xl border-2 border-zinc-200 bg-white overflow-hidden divide-y divide-zinc-100">
                {filteredUnassigned.map((u) => (
                  <UserChipRow
                    key={u.id}
                    user={u}
                    selected={selectedIds.has(u.id)}
                    onToggleSelect={() => toggleSelect(u.id)}
                    onAfterAction={() => router.refresh()}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {inviteCtx && (
        <InviteDialog
          branchId={inviteCtx.branchId}
          branchCode={inviteCtx.branchCode}
          branchName={inviteCtx.branchName}
          onClose={() => setInviteCtx(null)}
        />
      )}
      </>
      )}
    </div>
    </UnreadCtx.Provider>
    </ViewerCtx.Provider>
  );
}

function ViewModeTabs({
  viewMode,
  setViewMode,
}: {
  viewMode: "card" | "table";
  setViewMode: (m: "card" | "table") => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl border-2 border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setViewMode("card")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
          viewMode === "card"
            ? "bg-[var(--color-brand-600)] text-white shadow-blue"
            : "text-zinc-700 hover:bg-zinc-100",
        )}
      >
        <LayoutGrid className="size-3.5" />
        การ์ด
      </button>
      <button
        type="button"
        onClick={() => setViewMode("table")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
          viewMode === "table"
            ? "bg-[var(--color-brand-600)] text-white shadow-blue"
            : "text-zinc-700 hover:bg-zinc-100",
        )}
      >
        <TableIcon className="size-3.5" />
        ตาราง · Excel
      </button>
    </div>
  );
}

function StatsSummary({
  stats,
  filter,
  setFilter,
  hasFilter,
}: {
  stats: UserStats;
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  hasFilter: boolean;
}) {
  type Tone = "leaf" | "brand" | "warning" | "neutral" | "danger";
  type Item = {
    label: string;
    value: number;
    tone: Tone;
    suffix?: string;
    filterKey: StatFilterKey;
    active: boolean;
    hint: string;
  };

  const items: Item[] = [
    {
      label: "ผู้ใช้ทั้งหมด",
      value: stats.total,
      tone: "brand",
      filterKey: "clear",
      active: !hasFilter,
      hint: "ล้างตัวกรอง · ดูทุกคน",
    },
    {
      label: "ACTIVE สัปดาห์นี้",
      value: stats.activeWeek,
      tone: "leaf",
      suffix: "คน",
      filterKey: "activeWeek",
      active: filter.activeWeek,
      hint: "ดูเฉพาะคนที่ login ใน 7 วัน",
    },
    {
      label: "เข้าใหม่ 7 วัน",
      value: stats.newThisWeek,
      tone: "leaf",
      suffix: "คน",
      filterKey: "newThisWeek",
      active: filter.newThisWeek,
      hint: "ดูเฉพาะคนที่เข้ามาใหม่ใน 7 วัน",
    },
    {
      label: "รอ ACTIVATE",
      value: stats.pendingActivation,
      tone: stats.pendingActivation > 0 ? "warning" : "neutral",
      filterKey: "pending",
      active: filter.pending,
      hint: "ดูเฉพาะคนที่ยังไม่กดลิงก์เชิญ",
    },
    {
      label: "ยังไม่ผูก LINE",
      value: stats.noLine,
      tone: stats.noLine > 0 ? "warning" : "neutral",
      filterKey: "noLine",
      active: filter.noLine,
      hint: "ดูเฉพาะคนที่ยังไม่ผูก LINE",
    },
    {
      label: "OFFLINE > 7 วัน",
      value: stats.offline7d,
      tone: stats.offline7d > 0 ? "warning" : "neutral",
      filterKey: "offline7d",
      active: filter.offline7d,
      hint: "ดูเฉพาะคนที่ไม่ได้ login เกิน 7 วัน",
    },
    {
      label: "สาขาขาด ผจก.",
      value: stats.branchesMissingMgr,
      suffix: "สาขา",
      tone: stats.branchesMissingMgr > 0 ? "danger" : "neutral",
      filterKey: "branchesMissingMgr",
      active: filter.branchesMissingMgr,
      hint: "ทุกสาขาควรมี ผจก.สาขา — กดดูสาขาที่ยังขาด",
    },
  ];

  const toneClass: Record<Tone, string> = {
    brand:
      "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 text-[var(--color-brand-700)]",
    leaf: "border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]/40 text-[var(--color-leaf-700)]",
    warning: "border-amber-300 bg-amber-50/60 text-amber-900",
    neutral: "border-zinc-200 bg-white text-zinc-700",
    danger: "border-red-300 bg-red-50/60 text-red-900",
  };

  const activeToneClass: Record<Tone, string> = {
    brand:
      "border-[var(--color-brand-500)] bg-[var(--color-brand-100)] text-[var(--color-brand-900)] shadow-blue",
    leaf: "border-[var(--color-leaf-500)] bg-[var(--color-leaf-100)] text-[var(--color-leaf-900)]",
    warning: "border-amber-500 bg-amber-100 text-amber-900",
    neutral: "border-zinc-500 bg-zinc-100 text-zinc-900",
    danger: "border-red-500 bg-red-100 text-red-900",
  };

  const hoverClass =
    "hover:border-zinc-400 hover:shadow-sm cursor-pointer";

  function handleClick(key: StatFilterKey) {
    if (key === "clear") {
      setFilter({
        search: "",
        noLine: false,
        noTelegram: false,
        pending: false,
        offline7d: false,
        activeWeek: false,
        newThisWeek: false,
        roles: new Set(),
        branchesMissingMgr: false,
      });
      return;
    }
    // Toggle the corresponding boolean key
    const next: FilterState = {
      ...filter,
      [key]: !filter[key],
    };
    // Mutually-exclusive pairs to avoid empty results from contradictory filters
    if (key === "activeWeek" && next.activeWeek) next.offline7d = false;
    if (key === "offline7d" && next.offline7d) next.activeWeek = false;
    setFilter(next);
  }

  return (
    <div className="grid grid-cols-3 lg:grid-cols-7 gap-2">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => handleClick(it.filterKey)}
          aria-pressed={it.active}
          title={it.hint}
          className={cn(
            "text-left rounded-xl border-2 px-3 py-2.5 transition-all",
            it.active ? activeToneClass[it.tone] : toneClass[it.tone],
            hoverClass,
          )}
        >
          <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold leading-tight">
            {it.label}
          </p>
          <p className="text-2xl font-extrabold tabular-num font-display tracking-tight mt-0.5">
            {it.value}
            {it.suffix && (
              <span className="text-xs text-zinc-400 font-medium ml-1">
                {it.suffix}
              </span>
            )}
          </p>
        </button>
      ))}
    </div>
  );
}

function FilterBar({
  filter,
  setFilter,
  totalVisible,
}: {
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  totalVisible: number;
}) {
  const toggleFlag = (key: keyof FilterState) => {
    setFilter({ ...filter, [key]: !filter[key] });
  };
  const reset = () =>
    setFilter({
      search: "",
      noLine: false,
      noTelegram: false,
      pending: false,
      offline7d: false,
      activeWeek: false,
      newThisWeek: false,
      roles: new Set(),
      branchesMissingMgr: false,
    });
  const hasFilter =
    !!filter.search ||
    filter.noLine ||
    filter.noTelegram ||
    filter.pending ||
    filter.offline7d ||
    filter.activeWeek ||
    filter.newThisWeek ||
    filter.roles.size > 0;

  return (
    <div className="rounded-xl border-2 border-zinc-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            type="text"
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            placeholder="ค้นหาชื่อ / เบอร์ / อีเมล..."
            className="w-full h-10 pl-10 pr-9 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none transition-colors"
          />
          {filter.search && (
            <button
              onClick={() => setFilter({ ...filter, search: "" })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        {hasFilter && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 px-3 h-10 rounded-lg text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 font-bold"
          >
            <RotateCcw className="size-3.5" />
            ล้าง
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <FilterChip
          on={filter.pending}
          onClick={() => toggleFlag("pending")}
          label="รอ activate"
          tone="warning"
        />
        <FilterChip
          on={filter.noLine}
          onClick={() => toggleFlag("noLine")}
          label="ยังไม่ผูก LINE"
          tone="warning"
        />
        <FilterChip
          on={filter.noTelegram}
          onClick={() => toggleFlag("noTelegram")}
          label="ยังไม่ผูก Telegram"
          tone="warning"
        />
        <FilterChip
          on={filter.offline7d}
          onClick={() => toggleFlag("offline7d")}
          label="offline > 7 วัน"
          tone="warning"
        />
        <span className="ml-auto text-[11px] text-zinc-500">
          ผลลัพธ์ <span className="font-bold tabular-num text-zinc-900">{totalVisible}</span> คน
        </span>
      </div>
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  label,
  tone,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  tone: "warning" | "brand";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-bold border-2 transition-colors",
        on
          ? tone === "warning"
            ? "bg-amber-100 border-amber-400 text-amber-900"
            : "bg-[var(--color-brand-100)] border-[var(--color-brand-400)] text-[var(--color-brand-900)]"
          : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400",
      )}
    >
      {label}
    </button>
  );
}

function BulkBtn({
  onClick,
  disabled,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        danger
          ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
          : "bg-white border-[var(--color-brand-200)] text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)]",
      )}
    >
      {icon}
      {label}
    </button>
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
    return null;
  }

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/40 overflow-hidden">
      <div className="px-4 py-2 border-b border-amber-200 bg-amber-100/40 flex items-center gap-2">
        <Bell className="size-3.5 text-amber-700" />
        <span className="text-[11px] uppercase tracking-wider font-bold text-amber-900">
          เกี่ยวกับผู้ใช้งาน
        </span>
        <span className="ml-auto text-[10px] tabular-num font-bold text-amber-700 bg-amber-200/50 px-1.5 py-0.5 rounded-full">
          {totalAlerts}
        </span>
      </div>
      <div className="divide-y divide-amber-200/50">
        {pendingRequestCount > 0 && (
          <Link
            href="/users/requests"
            className="flex items-center gap-3 px-4 py-2 hover:bg-amber-100/30 transition-colors"
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
            className="flex items-center gap-3 px-4 py-2 hover:bg-amber-100/30 transition-colors"
          >
            <span
              className={cn(
                "size-2 rounded-full shrink-0",
                n.type === "danger"
                  ? "bg-red-500"
                  : n.type === "warning"
                    ? "bg-amber-500"
                    : n.type === "success"
                      ? "bg-[var(--color-leaf-500)]"
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
  selectedIds,
  onToggleSelect,
  expanded,
  onToggleExpand,
  onInvite,
  onAfterAction,
}: {
  branch: BranchWithUsers;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Controlled expansion — managed by parent for global expand-all/collapse-all */
  expanded: boolean;
  onToggleExpand: () => void;
  onInvite: () => void;
  onAfterAction: () => void;
}) {
  // Split counts by actual role group — avoid the previous "ผจก. 3/2" confusion
  // where admin + manager were lumped together (could exceed denominator).
  // Branch manager (ผจก.สาขา) and area manager (ผจก.เขต) tracked separately —
  // every branch should have a branch_manager; missing one shows red.
  const admins = branch.users.filter(
    (u) =>
      u.role === "super_admin" || u.role === "org_admin" || u.role === "admin",
  );
  const branchMgrs = branch.users.filter((u) => u.role === "branch_manager");
  const areaMgrs = branch.users.filter((u) => u.role === "area_manager");
  const staffs = branch.users.filter((u) => u.role === "staff");
  const adminCount = admins.length;
  const branchMgrCount = branchMgrs.length;
  const areaMgrCount = areaMgrs.length;
  const staffCount = staffs.length;
  const hasUsers = branch.users.length > 0;
  const missingBranchMgr = !branchMgrs.length;

  // Compact name list — first names only, max 3, "..." if more
  function nameList(users: BranchUser[]): string {
    const firsts = users.map((u) => u.name.split(" ")[0] || u.name);
    if (firsts.length <= 3) return firsts.join(", ");
    return `${firsts.slice(0, 3).join(", ")} +${firsts.length - 3}`;
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => hasUsers && onToggleExpand()}
          disabled={!hasUsers}
          className="min-w-0 flex items-center gap-2 flex-wrap text-left disabled:cursor-default group/row"
        >
          {hasUsers ? (
            <ChevronDown
              className={cn(
                "size-3.5 text-zinc-400 transition-transform group-hover/row:text-zinc-700 shrink-0",
                expanded && "rotate-180",
              )}
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <span className="font-extrabold tabular-num font-display text-xs text-zinc-900">
            {branch.code}
          </span>
          <span className="text-xs text-zinc-800 truncate">{branch.name}</span>
          {/* Role counts — separate chips so admin / branch_mgr / area_mgr / staff
              don't get visually merged. Only show chips with count > 0.
              Missing branch manager is the most prominent state — every branch
              should have one (CEO rule). */}
          {missingBranchMgr && (
            <span
              className="text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-300"
              title="สาขานี้ยังไม่มีผู้จัดการสาขา — ทุกสาขาควรมี"
            >
              ⚠ ยังไม่มี ผจก.สาขา
            </span>
          )}
          {!hasUsers && (
            <span className="text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-700 border border-zinc-300">
              ยังไม่มีคน
            </span>
          )}
          {adminCount > 0 && (
            <span className="text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
              Admin {adminCount}
            </span>
          )}
          {areaMgrCount > 0 && (
            <span className="text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200">
              ผจก.เขต {areaMgrCount}
            </span>
          )}
          {branchMgrCount > 0 && (
            <span className="text-[10px] font-bold tabular-num px-1.5 py-0.5 rounded-md bg-[var(--color-brand-50)] text-[var(--color-brand-800)] border border-[var(--color-brand-200)]">
              ผจก.สาขา {branchMgrCount}
            </span>
          )}
          {staffCount > 0 && (
            <span className="text-[10px] font-bold tabular-num text-zinc-700 px-1.5 py-0.5 rounded-md bg-zinc-50 border border-zinc-200">
              พน. {staffCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onInvite}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] text-[11px] font-bold hover:bg-[var(--color-brand-100)] transition-colors shrink-0"
        >
          <UserPlus className="size-3" />
          เชิญ
        </button>
      </div>
      {/* Inline name preview when collapsed — see WHO holds each role
          without having to expand. Staff omitted (could be many). */}
      {!expanded && hasUsers &&
        (adminCount > 0 || branchMgrCount > 0 || areaMgrCount > 0) && (
          <div className="ml-5 mt-1 text-[11px] text-zinc-500 leading-relaxed">
            {adminCount > 0 && (
              <span>
                <span className="font-semibold text-amber-800">Admin:</span>{" "}
                {nameList(admins)}
              </span>
            )}
            {adminCount > 0 && (areaMgrCount > 0 || branchMgrCount > 0) && (
              <span className="text-zinc-300 mx-1.5">·</span>
            )}
            {areaMgrCount > 0 && (
              <span>
                <span className="font-semibold text-purple-700">ผจก.เขต:</span>{" "}
                {nameList(areaMgrs)}
              </span>
            )}
            {areaMgrCount > 0 && branchMgrCount > 0 && (
              <span className="text-zinc-300 mx-1.5">·</span>
            )}
            {branchMgrCount > 0 && (
              <span>
                <span className="font-semibold text-[var(--color-brand-700)]">
                  ผจก.สาขา:
                </span>{" "}
                {nameList(branchMgrs)}
              </span>
            )}
            {staffCount > 0 && (
              <>
                <span className="text-zinc-300 mx-1.5">·</span>
                <span className="text-zinc-500">พนักงาน {staffCount} คน</span>
              </>
            )}
          </div>
        )}
      {expanded && hasUsers && (
        <div className="flex flex-wrap gap-1 mt-2 ml-5">
          {branch.users.map((u) => (
            <UserChipCompact
              key={u.id}
              user={u}
              selected={selectedIds.has(u.id)}
              onToggleSelect={() => onToggleSelect(u.id)}
              onAfterAction={onAfterAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function statusInfo(u: BranchUser): { dot: string; label: string } {
  if (!u.is_active) return { dot: "bg-zinc-300", label: "ปิดบัญชี" };
  if (!u.invite_used) return { dot: "bg-amber-400", label: "ยังไม่ activate" };
  return { dot: "bg-[var(--color-leaf-500)]", label: "พร้อมใช้งาน" };
}

function UserChipCompact({
  user,
  selected,
  onToggleSelect,
  onAfterAction,
}: {
  user: BranchUser;
  selected: boolean;
  onToggleSelect: () => void;
  onAfterAction: () => void;
}) {
  const isManager = MANAGER_ROLES.has(user.role);
  const status = statusInfo(user);
  const roleClass = roleColor(user.role);
  const unreadMap = useContext(UnreadCtx);
  const unread = unreadMap[user.id] ?? 0;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] transition-colors group",
        selected
          ? "bg-[var(--color-brand-100)] border-[var(--color-brand-400)]"
          : "bg-white border-zinc-200 hover:border-[var(--color-brand-300)]",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        className="size-3 rounded shrink-0"
        title="เลือก"
      />
      <span className={cn("size-1.5 rounded-full shrink-0", status.dot)} title={status.label} />
      <Link
        href={`/users/${user.id}`}
        className={cn("truncate max-w-[120px]", isManager && "font-bold")}
      >
        {user.name}
      </Link>
      {unread > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold tabular-num"
          title={`มี ${unread} แจ้งเตือนยังไม่อ่าน`}
          aria-label={`${unread} unread`}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
      <RoleBadgeWithPreview role={user.role} className={roleClass} />
      {!HIDE_MESSAGING_ROLES.has(user.role) && (
        <span className="flex items-center gap-0.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              user.has_line ? "bg-[var(--color-leaf-500)]" : "bg-zinc-200",
            )}
            title={user.has_line ? "LINE ผูกแล้ว" : "ยังไม่ผูก LINE"}
          />
          <span
            className={cn(
              "size-1.5 rounded-full",
              user.has_telegram ? "bg-[var(--color-leaf-500)]" : "bg-zinc-200",
            )}
            title={user.has_telegram ? "Telegram ผูกแล้ว" : "ยังไม่ผูก Telegram"}
          />
        </span>
      )}
      <UserActionMenu user={user} onAfterAction={onAfterAction} />
    </div>
  );
}

function UserChipRow({
  user,
  selected,
  onToggleSelect,
  onAfterAction,
}: {
  user: BranchUser;
  selected: boolean;
  onToggleSelect: () => void;
  onAfterAction: () => void;
}) {
  const status = statusInfo(user);
  const roleClass = roleColor(user.role);
  const unreadMap = useContext(UnreadCtx);
  const unread = unreadMap[user.id] ?? 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 transition-colors text-sm",
        selected ? "bg-[var(--color-brand-50)]" : "hover:bg-zinc-50",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="size-3.5 rounded shrink-0"
      />
      <span className={cn("size-2 rounded-full shrink-0", status.dot)} title={status.label} />
      <Link href={`/users/${user.id}`} className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="font-bold truncate">{user.name}</span>
        {unread > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-extrabold tabular-num"
            title={`มี ${unread} แจ้งเตือนยังไม่อ่าน`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <span className="text-[11px] text-zinc-500 truncate">
          {user.email ?? user.phone ?? ""}
        </span>
      </Link>
      <RoleBadgeWithPreview role={user.role} className={roleClass} />
      {!HIDE_MESSAGING_ROLES.has(user.role) && (
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "size-2 rounded-full",
              user.has_line ? "bg-[var(--color-leaf-500)]" : "bg-zinc-200",
            )}
            title="LINE"
          />
          <span
            className={cn(
              "size-2 rounded-full",
              user.has_telegram ? "bg-[var(--color-leaf-500)]" : "bg-zinc-200",
            )}
            title="Telegram"
          />
        </span>
      )}
      <UserActionMenu user={user} onAfterAction={onAfterAction} />
    </div>
  );
}

function RoleBadgeWithPreview({ role, className }: { role: string; className: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  const desc = PERMISSION_DESC[role];
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "text-[9px] px-1 py-0.5 rounded border font-bold",
          className,
        )}
      >
        {roleLabel(role)}
      </button>
      {open && desc && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border-2 border-zinc-200 bg-white shadow-lg p-3 text-left">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck className="size-3.5 text-[var(--color-brand-600)]" />
            <p className="text-xs font-extrabold text-zinc-900">
              {roleLabel(role)}
            </p>
          </div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-leaf-700)] mb-1">
            ทำได้
          </p>
          <ul className="space-y-0.5 text-[11px] text-zinc-700 mb-2">
            {desc.can.map((c, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-[var(--color-leaf-600)]">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] uppercase tracking-wider font-bold text-red-700 mb-1">
            ทำไม่ได้
          </p>
          <ul className="space-y-0.5 text-[11px] text-zinc-700">
            {desc.cant.map((c, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-red-500">✕</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserActionMenu({
  user,
  onAfterAction,
}: {
  user: BranchUser;
  onAfterAction: () => void;
}) {
  const router = useRouter();
  const viewer = useContext(ViewerCtx);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  const callApi = (path: string, method = "POST", body?: unknown) => {
    startTransition(async () => {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "ดำเนินการไม่สำเร็จ");
        return;
      }
      if (json.inviteUrl) {
        navigator.clipboard.writeText(json.inviteUrl);
        toast.success("Copy ลิงก์ใหม่ไปที่ clipboard แล้ว ส่งใน LINE ได้เลย");
      } else {
        toast.success("เรียบร้อย");
      }
      setOpen(false);
      onAfterAction();
      router.refresh();
    });
  };

  // Impersonate gating:
  // - Viewer must be admin-tier (super_admin, org_admin, admin)
  // - Cannot target self
  // - Target must be active
  // - Only super_admin can target super_admin (privilege ceiling)
  const viewerIsAdminTier =
    viewer.role === "super_admin" ||
    viewer.role === "org_admin" ||
    viewer.role === "admin";
  const canImpersonate =
    viewerIsAdminTier &&
    user.id !== viewer.id &&
    user.is_active &&
    (viewer.role === "super_admin" || user.role !== "super_admin");

  function startImpersonate() {
    if (!confirm(`เข้าใช้แทน ${user.name}?\n\nคุณจะเห็นระบบเหมือนที่ผู้ใช้คนนี้เห็น — กลับมาเป็นตัวเองได้ตลอด`)) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${user.id}/impersonate`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "เข้าใช้แทนไม่สำเร็จ");
        return;
      }
      toast.success(`เข้าใช้แทน ${user.name} แล้ว`);
      setOpen(false);
      router.push("/home");
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="size-5 rounded hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700"
        title="เพิ่มเติม"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border-2 border-zinc-200 bg-white shadow-lg overflow-hidden">
          <Link
            href={`/users/${user.id}`}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-zinc-50"
            onClick={() => setOpen(false)}
          >
            <ActivityIcon className="size-3.5 text-zinc-400" />
            ดูโปรไฟล์ + audit
          </Link>
          {canImpersonate && (
            <button
              type="button"
              onClick={startImpersonate}
              disabled={pending}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-[var(--color-brand-50)] text-[var(--color-brand-700)] text-left"
              title="เข้าใช้ระบบเหมือนเป็นผู้ใช้คนนี้ (กลับเป็นตัวเองได้ตลอด)"
            >
              <UserCog className="size-3.5" />
              เข้าใช้แทน
            </button>
          )}
          {!user.invite_used && (
            <button
              type="button"
              onClick={() => callApi(`/api/admin/users/${user.id}/resend-invite`)}
              disabled={pending}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-zinc-50 text-left"
            >
              <Mail className="size-3.5 text-[var(--color-brand-600)]" />
              ส่งลิงก์เชิญใหม่
            </button>
          )}
          {user.is_active && (
            <button
              type="button"
              onClick={() => callApi(`/api/admin/users/${user.id}/force-logout`)}
              disabled={pending}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-zinc-50 text-left"
            >
              <LogOut className="size-3.5 text-amber-600" />
              Force Logout
            </button>
          )}
          {user.is_active ? (
            <button
              type="button"
              onClick={() => {
                if (confirm(`ปิดบัญชี ${user.name}?`)) callApi(`/api/admin/users/${user.id}`, "DELETE");
              }}
              disabled={pending}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-red-50 text-red-700 text-left border-t border-zinc-100"
            >
              <Lock className="size-3.5" />
              ปิดบัญชี
            </button>
          ) : (
            <button
              type="button"
              onClick={() => callApi(`/api/admin/users/${user.id}/reactivate`)}
              disabled={pending}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-[var(--color-leaf-50)] text-[var(--color-leaf-700)] text-left border-t border-zinc-100"
            >
              <Unlock className="size-3.5" />
              เปิดบัญชี
            </button>
          )}
        </div>
      )}
    </div>
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
                className="w-full mt-1 px-4 py-3 rounded-xl border-2 border-zinc-200 bg-white text-base focus:border-[var(--color-brand-500)] focus:outline-none transition-colors"
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
                className="w-full mt-1 px-4 py-3 rounded-xl border-2 border-zinc-200 bg-white text-base focus:border-[var(--color-brand-500)] focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                ตำแหน่ง
              </label>
              <div className="mt-1 grid grid-cols-1 gap-1.5">
                {[
                  { v: "staff", l: "พนักงาน" },
                  { v: "branch_manager", l: "ผจก.สาขา" },
                  { v: "area_manager", l: "ผจก.เขต" },
                  { v: "viewer", l: "ผู้ดู (Read-only)" },
                ].map((r) => (
                  <label
                    key={r.v}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 cursor-pointer transition-colors",
                      role === r.v
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
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
                className="flex-1 h-12 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] shadow-blue disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                สร้างลิงก์เชิญ
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-[var(--color-leaf-50)] border-2 border-[var(--color-leaf-200)] p-4">
              <div className="flex items-center gap-2 mb-2 text-[var(--color-leaf-700)]">
                <CheckCircle2 className="size-5" />
                <p className="font-bold">ลิงก์พร้อมส่งแล้ว</p>
              </div>
              <p className="text-xs text-zinc-700 mb-3">
                Copy ลิงก์ด้านล่างแล้วส่งให้ <strong>{name}</strong> ทาง LINE — หมดอายุใน 48 ชั่วโมง
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
                  className="inline-flex items-center gap-1.5 px-4 rounded-lg bg-[var(--color-brand-600)] text-white text-sm font-bold hover:bg-[var(--color-brand-700)]"
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
