"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { DataGrid } from "@/components/ui/data-grid";
import type {
  DataGridBulkAction,
  DataGridColumn,
} from "@/components/ui/data-grid";
import { formatBahtCompact, bkkDate, bkkTime } from "@/lib/utils/format";
import type { ReportRowVm } from "./page";

const STATUS_COLOR: Record<string, string> = {
  submitted: "bg-amber-50 text-amber-800 border-amber-200",
  approved:
    "bg-[var(--color-leaf-50)] text-[var(--color-leaf-800)] border-[var(--color-leaf-200)]",
  rejected: "bg-red-50 text-red-800 border-red-200",
  draft: "bg-zinc-50 text-zinc-700 border-zinc-200",
};

export function ReportsFlatView({ rows }: { rows: ReportRowVm[] }) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const columns: DataGridColumn<ReportRowVm>[] = useMemo(
    () => [
      {
        key: "branch_code",
        label: "รหัสสาขา",
        type: "text",
        frozen: true,
        minWidth: 120,
        href: (r) => `/cashhub/reports/${r.id}`,
        render: (r) => (
          <span className="font-extrabold tabular-num font-display text-zinc-900">
            {r.branch_code}
          </span>
        ),
      },
      {
        key: "branch_name",
        label: "ชื่อสาขา",
        minWidth: 180,
        type: "text",
      },
      {
        key: "business_label",
        label: "ประเภทธุรกิจ",
        minWidth: 140,
        getValue: (r) => r.business_label,
        render: (r) => (
          <span className="inline-flex items-center gap-1 text-xs">
            <span>{r.business_emoji}</span>
            <span className="font-medium text-zinc-800">{r.business_label}</span>
          </span>
        ),
      },
      {
        key: "report_date",
        label: "วันที่",
        minWidth: 110,
        getValue: (r) => r.report_date,
        render: (r) => (
          <span className="tabular-num text-xs text-zinc-700">
            {bkkDate(r.report_date)}
          </span>
        ),
        format: (r) => bkkDate(r.report_date),
      },
      {
        key: "shift_label",
        label: "กะ",
        minWidth: 100,
        type: "text",
      },
      {
        key: "total_sales",
        label: "ยอดขาย",
        type: "number",
        align: "right",
        minWidth: 120,
        getValue: (r) => r.total_sales,
        render: (r) => (
          <span className="tabular-num font-bold text-zinc-900">
            {formatBahtCompact(r.total_sales)}
          </span>
        ),
        format: (r) => String(r.total_sales),
      },
      {
        key: "reconcile_diff",
        label: "ผลต่าง Reconcile",
        type: "number",
        align: "right",
        minWidth: 130,
        getValue: (r) => r.reconcile_diff,
        render: (r) => {
          const ok = Math.abs(r.reconcile_diff) < 0.01;
          if (ok) {
            return (
              <span className="inline-flex items-center gap-1 text-[var(--color-leaf-700)] text-xs font-bold">
                <CheckCircle2 className="size-3" />
                ตรง
              </span>
            );
          }
          return (
            <span
              className={`tabular-num font-bold text-xs ${
                r.reconcile_diff > 0 ? "text-rose-700" : "text-amber-700"
              }`}
            >
              {r.reconcile_diff > 0 ? "ขาด " : "เกิน "}฿
              {Math.abs(r.reconcile_diff).toLocaleString("th-TH")}
            </span>
          );
        },
        format: (r) => String(r.reconcile_diff),
      },
      {
        key: "status",
        label: "สถานะ",
        type: "badge",
        minWidth: 110,
        getValue: (r) => r.status,
        render: (r) => (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${
              STATUS_COLOR[r.status] ?? "bg-zinc-50 text-zinc-700 border-zinc-200"
            }`}
          >
            {r.status_label}
          </span>
        ),
        format: (r) => r.status_label,
      },
      {
        key: "submitted_at",
        label: "ส่งเมื่อ",
        minWidth: 110,
        getValue: (r) =>
          r.submitted_at ? new Date(r.submitted_at).getTime() : 0,
        render: (r) => (
          <span className="text-xs text-zinc-500 tabular-num">
            {r.submitted_at ? bkkTime(r.submitted_at) : "—"}
          </span>
        ),
        format: (r) => (r.submitted_at ? bkkTime(r.submitted_at) : ""),
      },
    ],
    [],
  );

  const bulkActions: DataGridBulkAction<ReportRowVm>[] = [
    {
      id: "approve",
      label: "อนุมัติเลย",
      icon: <CheckCircle2 className="size-3.5" />,
      run: (rows) => {
        const onlySubmitted = rows.filter((r) => r.status === "submitted");
        if (onlySubmitted.length === 0) {
          toast.error("ไม่มีรายงานที่อนุมัติได้ในรายการที่เลือก");
          return;
        }
        startTransition(async () => {
          const res = await fetch("/api/cashhub/approve-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportIds: onlySubmitted.map((r) => r.id) }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(json.error || "อนุมัติไม่ได้");
            return;
          }
          toast.success(`อนุมัติ ${json.approved} รายงาน`, {
            description:
              json.skipped > 0
                ? `ข้าม ${json.skipped} (ไม่มีสิทธิ์/อนุมัติแล้ว)`
                : undefined,
          });
          setSelectedIds(new Set());
          router.refresh();
        });
      },
    },
  ];

  return (
    <DataGrid<ReportRowVm>
      rows={rows}
      columns={columns}
      rowHref={(r) => `/cashhub/reports/${r.id}`}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      bulkActions={pending ? [] : bulkActions}
      persistKey="cashhub-reports-table"
      maxHeight={650}
    />
  );
}
