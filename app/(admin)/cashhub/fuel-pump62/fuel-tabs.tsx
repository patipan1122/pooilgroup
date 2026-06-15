"use client";

import { useState } from "react";
import { Table2, LayoutGrid } from "lucide-react";
import { FuelManageView, type FuelRow } from "./fuel-manage-view";
import { FuelSheetView, type FuelMonthMeta } from "./fuel-sheet-view";
import { ReconcileImportBar } from "./reconcile-import-bar";

export function FuelTabs({
  rows,
  fetchedAt,
  months,
}: {
  rows: FuelRow[];
  fetchedAt: string | null;
  months: FuelMonthMeta[];
}) {
  const [tab, setTab] = useState<"reconcile" | "full">("reconcile");

  const tabCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
      active
        ? "bg-white text-[var(--ch-text)] shadow-sm"
        : "text-[var(--ch-text-2)] hover:text-[var(--ch-text)]"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit gap-1 rounded-xl border border-[var(--ch-border)] bg-[var(--ch-bg-2)] p-1">
        <button type="button" onClick={() => setTab("reconcile")} className={tabCls(tab === "reconcile")}>
          <LayoutGrid className="size-4" /> กระทบยอด
        </button>
        <button type="button" onClick={() => setTab("full")} className={tabCls(tab === "full")}>
          <Table2 className="size-4" /> ตารางเต็ม (เหมือนชีต)
        </button>
      </div>

      {tab === "reconcile" ? (
        <div className="flex flex-col gap-3">
          <ReconcileImportBar months={months} />
          <FuelManageView rows={rows} fetchedAt={fetchedAt} />
        </div>
      ) : (
        <FuelSheetView months={months} />
      )}
    </div>
  );
}
