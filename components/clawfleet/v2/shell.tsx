"use client";

// ClawFleet v2 shell — SLIM version (unified nav, 2026-06-02).
//
// Previously this rendered a full second sidebar (cf-sidebar) + topbar that
// DUPLICATED the Pool AdminShell's left nav (CEO flagged "แถบซ้าย 2 อันซ้ำกัน").
// The Pool AdminShell already shows ClawFleet's inner nav (from lib/modules.ts)
// and the global company switcher. So this shell now renders ONLY what Pool does
// NOT provide: the per-branch filter (?branch=) as a thin bar. No 2nd sidebar.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { BranchFilterBar, type BranchSummary } from "@/components/clawfleet/v2/chrome";

export function V2Shell({
  children,
  branches,
}: {
  children: React.ReactNode;
  branches: BranchSummary[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const seg = pathname.split("/").filter(Boolean).pop() ?? "hub";
  const branch = params.get("branch") ?? "all";

  const onBranchChange = useCallback(
    (id: string) => {
      const q = id !== "all" ? `?branch=${id}` : "";
      router.push(`/clawfleet/v2/${seg}${q}`);
    },
    [router, seg],
  );

  return (
    <div className="cf-slim">
      <BranchFilterBar branch={branch} onBranchChange={onBranchChange} branches={branches} />
      <main className="cf-content cf-content-slim">{children}</main>
    </div>
  );
}
