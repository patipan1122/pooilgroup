"use client";

// LedgerLine LIFF Admin Console — mobile tab shell (Bainy-style). GAP 5.
//
// 5 tabs mirror Bainy's "จัดการองค์กร" [องค์กร · สาขา · สมาชิก · สิทธิ์ · ตั้งค่า]
// as a thumb-reachable bottom-nav. Each tab reuses the EXISTING, deployed manager
// components + server actions (no dead UI) and adds the new mobile pieces
// (permission toggles, branch/org editors) as they land. Sticky header carries
// the company context + a pending-approval badge.

import { useState } from "react";
import Link from "next/link";
import { Building2, MapPin, Users, ShieldCheck, Settings2, ChevronLeft } from "lucide-react";
import { MemberManager } from "@/app/(admin)/ledger/settings/_components/MemberManager";
import { InviteManager } from "@/app/(admin)/ledger/settings/_components/InviteManager";
import { CategoryManager } from "@/app/(admin)/ledger/settings/_components/CategoryManager";
import { LineChannelCard } from "@/app/(admin)/ledger/settings/_components/LineChannelCard";
import { RichMenuButton } from "@/app/(admin)/ledger/settings/_components/RichMenuButton";
import { ExportConfigCard } from "@/app/(admin)/ledger/settings/_components/ExportConfigCard";
import { TRCloudBranchConfig } from "@/app/(admin)/ledger/settings/_components/TRCloudBranchConfig";
import { PermissionPanel } from "./PermissionPanel";
import { BranchPanel, type BranchFull } from "./BranchPanel";
import { OrgPanel, type OrgInfo } from "./OrgPanel";
import type { LedgerMemberRow, InviteRow, LineChannelInfo } from "@/app/(admin)/ledger/_data";
import type { LedgerRole, LedgerCapability } from "@/lib/ledger/permission-constants";

type BranchOpt = { id: string; code: string; name: string };
type CompanyOpt = { id: string; name: string };
type Tab = "org" | "branch" | "member" | "permission" | "settings";

const TABS: { key: Tab; label: string; Icon: typeof Users }[] = [
  { key: "org", label: "องค์กร", Icon: Building2 },
  { key: "branch", label: "สาขา", Icon: MapPin },
  { key: "member", label: "สมาชิก", Icon: Users },
  { key: "permission", label: "สิทธิ์", Icon: ShieldCheck },
  { key: "settings", label: "ตั้งค่า", Icon: Settings2 },
];

export function AdminConsole({
  companyId,
  companyName,
  companies,
  company,
  members,
  invites,
  categories,
  branchOpts,
  branchesFull,
  channel,
  permissionMatrix,
  myUserId,
  myLineLinked,
  homeHref,
}: {
  companyId: string;
  companyName: string;
  companies: CompanyOpt[];
  company: OrgInfo;
  members: LedgerMemberRow[];
  invites: InviteRow[];
  categories: { id: string; name: string; color: string | null; trcloudAccCode: string | null; trcloudProductCode: string | null; vatClaimable: boolean; sort: number; active: boolean }[];
  branchOpts: BranchOpt[];
  branchesFull: (BranchFull & { settings?: Record<string, unknown> | null })[];
  channel: LineChannelInfo | null;
  permissionMatrix: Record<LedgerRole, Record<LedgerCapability, boolean>>;
  myUserId: string;
  myLineLinked: boolean;
  /** Where the ← button goes — web "หน้าหลัก" for Pool admins, LIFF list otherwise. */
  homeHref: string;
}) {
  const [tab, setTab] = useState<Tab>("member");
  const pendingCount = members.filter((m) => m.pendingBranchId).length;

  // Multi-company orgs: switching company reloads the server page with ?company=.
  function switchCompany(id: string) {
    if (id !== companyId) window.location.search = `?company=${encodeURIComponent(id)}`;
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-zinc-50">
      {/* Sticky header — company context + pending badge */}
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white px-4 pb-2 pt-3">
        <div className="flex items-center gap-1.5">
          <Link
            href={homeHref}
            aria-label="กลับไปหน้าหลัก"
            className="-ml-1 grid size-9 shrink-0 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-zinc-400">จัดการทีม</p>
            {companies.length > 1 ? (
              <select
                value={companyId}
                onChange={(e) => switchCompany(e.target.value)}
                aria-label="เลือกบริษัท"
                className="-ml-0.5 max-w-[230px] truncate rounded-md bg-transparent text-base font-bold text-zinc-900 outline-none"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <h1 className="truncate text-base font-bold text-zinc-900">{companyName || "บริษัท"}</h1>
            )}
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => setTab("member")}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
            >
              ⏳ {pendingCount} คำขอ
            </button>
          )}
        </div>
      </header>

      {/* Tab content (scrolls; padded for the bottom-nav) */}
      <main className="flex-1 overflow-y-auto px-3 pb-24 pt-3">
        {tab === "member" && (
          <div className="space-y-3">
            <MemberManager companyId={companyId} branches={branchOpts} members={members} myUserId={myUserId} myLineLinked={myLineLinked} />
            <InviteManager companyId={companyId} branches={branchOpts} invites={invites} />
          </div>
        )}
        {tab === "permission" && (
          <PermissionPanel key={companyId} matrix={permissionMatrix} />
        )}
        {tab === "branch" && (
          <BranchPanel companyId={companyId} branches={branchesFull} />
        )}
        {tab === "org" && (
          <OrgPanel company={company} />
        )}
        {tab === "settings" && (
          <div className="grid grid-cols-1 gap-3">
            <CategoryManager
              companyId={companyId}
              categories={categories}
            />
            <TRCloudBranchConfig
              companyId={companyId}
              branches={branchesFull.map((b) => ({
                id: b.id,
                code: b.code,
                name: b.name,
                settings:
                  b.settings && typeof b.settings === "object"
                    ? (b.settings as Record<string, unknown>)
                    : null,
              }))}
            />
            <LineChannelCard
              companyId={companyId}
              companyName={companyName}
              channel={channel}
              branches={branchOpts}
            />
            <RichMenuButton
              companyId={companyId}
              connected={!!channel?.hasAccessToken}
              alreadySet={!!channel?.richMenuId}
            />
            <ExportConfigCard companyId={companyId} />
          </div>
        )}
      </main>

      {/* Bottom-nav — thumb-reachable, Bainy-style */}
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md items-stretch border-t border-zinc-200 bg-white/95 backdrop-blur">
        {TABS.map(({ key, label, Icon }) => {
          const on = tab === key;
          const showDot = key === "member" && pendingCount > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                "relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium " +
                (on ? "text-[var(--color-brand-600,#2563EB)]" : "text-zinc-400")
              }
              aria-current={on ? "page" : undefined}
            >
              <Icon className="size-5" aria-hidden />
              {label}
              {showDot && (
                <span className="absolute right-[18%] top-1.5 size-2 rounded-full bg-amber-500" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
