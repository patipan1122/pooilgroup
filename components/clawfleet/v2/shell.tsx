"use client";

// ClawFleet v2 shell — BRANDED full-screen (Playalot redesign, 2026-06-23).
//
// CEO เคาะ (2026-06-23): standalone ClawFleet-branded เต็มจอ ตาม Playalot prototype.
// This restores the dedicated ClawFleet sidebar + topbar (which already exist in
// chrome.tsx but were unused while the shell was "slim"). The `.cf-scope` wrapper
// in the v2 layout is made `position:fixed; inset:0` by clawfleet-playalot.css, so
// ClawFleet TAKES OVER the viewport — only ITS branded sidebar shows, covering the
// Pool AdminShell underneath. That avoids the 2026-06-02 "two left sidebars" issue
// (no 2nd sidebar nested inside AdminShell — it's a full-screen takeover instead).
// Auth + module-entitlement still run in the parent (admin) layouts beneath.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sidebar, TopBar, type BranchSummary, type SidebarNavCounts, type SidebarUser } from "@/components/clawfleet/v2/chrome";

/* sidebar short-id ↔ App Router segment */
const SEG_TO_ID: Record<string, string> = {
  hub: "hub",
  fleet: "fleet",
  operations: "ops",
  anomalies: "anom",
  stock: "stock",
  insights: "insights",
  team: "team",
  manage: "manage",
  audit: "audit",
  settings: "settings",
  app: "staffapp",
  collect: "hub",
};
const ID_TO_SEG: Record<string, string> = {
  hub: "hub",
  fleet: "fleet",
  ops: "operations",
  anom: "anomalies",
  stock: "stock",
  insights: "insights",
  team: "team",
  manage: "manage",
  audit: "audit",
  settings: "settings",
  staffapp: "app",
};
const PAGE_LABEL: Record<string, string> = {
  hub: "Hub",
  fleet: "Fleet",
  operations: "Operations",
  anomalies: "Anomaly",
  stock: "Stock",
  insights: "Insights",
  team: "ทีม & สาขา",
  manage: "จัดการ",
  audit: "Audit log",
  settings: "ตั้งค่า",
  staffapp: "แอปพนักงาน",
  collect: "เก็บรอบ",
};

export function V2Shell({
  children,
  branches,
  navCounts,
  user,
}: {
  children: React.ReactNode;
  branches: BranchSummary[];
  navCounts?: SidebarNavCounts;
  user?: SidebarUser | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const seg = pathname.split("/").filter(Boolean).pop() ?? "hub";
  const activeId = SEG_TO_ID[seg] ?? "hub";
  const branch = params.get("branch") ?? "all";

  // drawer เมนูบนมือถือ — ปิดอัตโนมัติเมื่อเปลี่ยนหน้า (pathname เปลี่ยน)
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const onNav = useCallback(
    (id: string) => {
      setDrawerOpen(false);
      const target = ID_TO_SEG[id] ?? "hub";
      const q = branch !== "all" ? `?branch=${branch}` : "";
      router.push(`/clawfleet/v2/${target}${q}`);
    },
    [router, branch],
  );

  const onBranchChange = useCallback(
    (id: string) => {
      const target = ID_TO_SEG[activeId] ?? seg;
      const q = id !== "all" ? `?branch=${id}` : "";
      router.push(`/clawfleet/v2/${target}${q}`);
    },
    [router, activeId, seg],
  );

  return (
    <div className={`cf-app ${drawerOpen ? "cf-drawer-open" : ""}`}>
      {/* scrim มืด — แตะเพื่อปิด drawer (โชว์เฉพาะตอนเปิดบนมือถือ) */}
      <div
        className="cf-scrim"
        role="button"
        tabIndex={-1}
        aria-label="ปิดเมนู"
        onClick={() => setDrawerOpen(false)}
      />
      <Sidebar
        active={activeId}
        onNav={onNav}
        subtitle="ตู้คีบ · cross-check"
        navCounts={navCounts}
        branchCount={branches.length}
        user={user}
      />
      <div className="cf-main">
        <TopBar
          branch={branch}
          onBranchChange={onBranchChange}
          page={PAGE_LABEL[seg] ?? "ClawFleet"}
          branches={branches}
          onMenu={() => setDrawerOpen(true)}
        />
        <main className="cf-content">{children}</main>
      </div>
    </div>
  );
}
