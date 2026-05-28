"use client";

// SetupTabs — client tab navigator for ClawFleet · Workspace 4 Setup.
// 6 tabs: ระบบ · โครงสร้าง · ผู้ใช้ · บัญชี · Audit log · Danger zone
// URL state via ?tab=... · horizontal scroll on mobile.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  SlidersHorizontal,
  Boxes,
  Upload,
  Users,
  Building2,
  History,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PanelSystem } from "./panel-system";
import { PanelStructure } from "./panel-structure";
import { PanelImport } from "./panel-import";
import { PanelUsers } from "./panel-users";
import { PanelOrg } from "./panel-org";
import { PanelAudit } from "./panel-audit";
import { PanelDanger } from "./panel-danger";

type TabKey =
  | "system"
  | "structure"
  | "import"
  | "users"
  | "org"
  | "audit"
  | "danger";

interface Tab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  hint: string;
}

const TABS: Tab[] = [
  { key: "system", label: "ระบบ", icon: SlidersHorizontal, hint: "tolerance · cron" },
  { key: "structure", label: "โครงสร้าง", icon: Boxes, hint: "ตู้ · กลุ่ม · สินค้า" },
  { key: "import", label: "นำเข้า", icon: Upload, hint: "CSV · diff ก่อนเขียน" },
  { key: "users", label: "ผู้ใช้", icon: Users, hint: "สิทธิ์ · สาขา" },
  { key: "org", label: "บัญชี", icon: Building2, hint: "องค์กร · LINE" },
  { key: "audit", label: "Audit log", icon: History, hint: "ใครทำอะไร" },
  { key: "danger", label: "Danger zone", icon: ShieldAlert, hint: "เลือกใช้ระวัง" },
];

export interface SetupTabsProps {
  activeTab: TabKey;
  branches: { id: string; name: string; code: string }[];
  groups: {
    id: string;
    name: string;
    branchId: string;
    branchName: string;
    machineCount: number;
    sessionCount: number;
    toleranceBps: number;
    exchangerCode: string | null;
  }[];
  machines: {
    id: string;
    code: string;
    kind: "CLAW" | "EXCHANGER";
    branchName: string;
    isActive: boolean;
  }[];
  products: {
    id: string;
    sku: string;
    name: string;
    category: string;
    defaultPriceCoins: number;
  }[];
  users: {
    id: string;
    name: string;
    email: string | null;
    role: string;
    lastLoginAt: string | null;
    branches: { id: string; name: string; code: string }[];
  }[];
  orgConfig: {
    id: string;
    name: string;
    slug: string;
    lineOaId: string | null;
    telegramChatId: string | null;
    cronSecretSet: boolean;
  };
  recentAudit: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    createdAt: string;
    actor: { id: string; name: string; email: string | null } | null;
  }[];
}

export function SetupTabs(props: SetupTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function setTab(next: TabKey) {
    const sp = new URLSearchParams(search?.toString() ?? "");
    sp.set("tab", next);
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      {/* Tab bar — horizontal scroll on mobile, sticky under page header */}
      <div className="sticky top-[68px] z-20 -mx-4 bg-zinc-50 px-4 pb-2 pt-1 sm:-mx-6 sm:px-6">
        <div
          role="tablist"
          aria-label="หัวข้อตั้งค่า"
          className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-sm"
        >
          {TABS.map((t) => {
            const active = t.key === props.activeTab;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex min-w-[88px] shrink-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                )}
              >
                <Icon className="size-4" />
                <span className="whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 px-2 text-xs text-zinc-500">
          {TABS.find((t) => t.key === props.activeTab)?.hint}
        </div>
      </div>

      {/* Active panel */}
      <div role="tabpanel" aria-labelledby={`tab-${props.activeTab}`}>
        {props.activeTab === "system" && <PanelSystem />}
        {props.activeTab === "structure" && (
          <PanelStructure
            branches={props.branches}
            groups={props.groups}
            machines={props.machines}
            products={props.products}
          />
        )}
        {props.activeTab === "import" && (
          <PanelImport machines={props.machines} branches={props.branches} />
        )}
        {props.activeTab === "users" && (
          <PanelUsers users={props.users} branches={props.branches} />
        )}
        {props.activeTab === "org" && <PanelOrg orgConfig={props.orgConfig} />}
        {props.activeTab === "audit" && (
          <PanelAudit entries={props.recentAudit} />
        )}
        {props.activeTab === "danger" && (
          <PanelDanger branches={props.branches} />
        )}
      </div>
    </div>
  );
}
