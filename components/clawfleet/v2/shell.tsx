"use client";

// V2 redesign shell — wires the mockup's SPA Sidebar/TopBar into Next App Router.
// Active nav is derived from pathname · branch filter lives in ?branch= searchParam.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Sidebar, TopBar } from "@/components/clawfleet/v2/chrome";
import { BRANCHES } from "@/lib/clawfleet/v2-data";

const PAGE_LABELS: Record<string, string> = {
  hub: "Hub",
  operations: "ปฏิบัติการ",
  anomalies: "Anomaly inbox",
  stock: "Stock",
  insights: "Insights",
  mobile: "Mobile flow",
  team: "ทีม & สาขา",
  audit: "Audit log",
  settings: "ตั้งค่า",
};

// map pathname segment → sidebar item id (sidebar uses short ids)
const SEG_TO_NAV: Record<string, string> = {
  hub: "hub",
  operations: "ops",
  anomalies: "anom",
  stock: "stock",
  insights: "insights",
  mobile: "mobile",
  team: "team",
  audit: "audit",
  settings: "settings",
};
const NAV_TO_SEG: Record<string, string> = Object.fromEntries(
  Object.entries(SEG_TO_NAV).map(([seg, nav]) => [nav, seg]),
);

export function V2Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const seg = pathname.split("/").filter(Boolean).pop() ?? "hub";
  const activeNav = SEG_TO_NAV[seg] ?? "hub";
  const pageLabel = PAGE_LABELS[seg] ?? "Hub";
  const branch = params.get("branch") ?? "all";

  const onNav = useCallback(
    (navId: string) => {
      const targetSeg = NAV_TO_SEG[navId] ?? "hub";
      const q = branch !== "all" ? `?branch=${branch}` : "";
      router.push(`/clawfleet/v2/${targetSeg}${q}`);
    },
    [router, branch],
  );

  const onBranchChange = useCallback(
    (id: string) => {
      const q = id !== "all" ? `?branch=${id}` : "";
      router.push(`/clawfleet/v2/${seg}${q}`);
    },
    [router, seg],
  );

  return (
    <div className="cf-app">
      <Sidebar active={activeNav} onNav={onNav} subtitle="ตู้คีบ · cross-check" />
      <div className="cf-main">
        <TopBar
          branch={branch}
          onBranchChange={onBranchChange}
          page={pageLabel}
          branches={BRANCHES}
        />
        <main className="cf-content">{children}</main>
      </div>
    </div>
  );
}
