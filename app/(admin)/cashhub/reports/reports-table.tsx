"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBahtCompact, bkkDate, bkkTime } from "@/lib/utils/format";
import type { ReportRowVm } from "./page";
import { cn } from "@/lib/utils/cn";

interface Props {
  rows: ReportRowVm[];
}

export function ReportsTable({ rows }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const submittedRows = useMemo(
    () => rows.filter((r) => r.status === "submitted"),
    [rows],
  );
  const allSubmittedSelected =
    submittedRows.length > 0 &&
    submittedRows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSubmittedSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(submittedRows.map((r) => r.id)));
    }
  }
  function bulkApprove() {
    if (selected.size === 0) return;
    const reportIds = Array.from(selected);
    startTransition(async () => {
      const res = await fetch("/api/cashhub/approve-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "อนุมัติไม่ได้");
        return;
      }
      toast.success(`อนุมัติ ${json.approved} รายงาน`, {
        description:
          json.skipped > 0 ? `ข้าม ${json.skipped} (ไม่มีสิทธิ์/อนุมัติแล้ว)` : "",
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <>
      {/* Selection bar */}
      {submittedRows.length > 0 && (
        <Card className="mb-3 border-[--color-brand-200]">
          <CardBody className="!py-3 !px-4 flex flex-wrap items-center gap-3 bg-[--color-brand-50]/40">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold">
              <input
                type="checkbox"
                checked={allSubmittedSelected}
                onChange={toggleAll}
                className="size-4 rounded border-zinc-300"
              />
              เลือกทั้งหมดที่รออนุมัติ ({submittedRows.length})
            </label>
            <span className="text-xs text-zinc-500">
              {selected.size > 0
                ? `เลือก ${selected.size} รายการ`
                : "กดติ๊กเพื่อเลือกที่จะอนุมัติพร้อมกัน"}
            </span>
            <div className="ml-auto flex gap-2">
              {selected.size > 0 && (
                <Button
                  size="md"
                  onClick={bulkApprove}
                  loading={pending}
                  className="!bg-emerald-600 hover:!bg-emerald-700"
                >
                  <CheckCircle2 className="size-4" />
                  อนุมัติ {selected.size} รายงาน
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="!p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <th className="w-9 p-3"></th>
                <th className="text-left p-3 w-9"></th>
                <th className="text-left p-3">สาขา</th>
                <th className="text-left p-3 hidden sm:table-cell">วันที่</th>
                <th className="text-right p-3">ยอด</th>
                <th className="text-left p-3 hidden md:table-cell">Reconcile</th>
                <th className="text-left p-3 hidden lg:table-cell">ส่งเมื่อ</th>
                <th className="text-right p-3">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSubmitted = r.status === "submitted";
                const isSelected = selected.has(r.id);
                const reconcileOk = Math.abs(r.reconcile_diff) < 0.01;
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-zinc-50 hover:bg-[--color-brand-50]/30 transition-colors",
                      isSelected && "bg-[--color-brand-50]/40",
                    )}
                  >
                    <td className="p-3 align-top">
                      {isSubmitted && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(r.id)}
                          aria-label={`เลือก ${r.branch_code}`}
                          className="size-4 rounded border-zinc-300 mt-1"
                        />
                      )}
                    </td>
                    <td className="p-3 align-top text-lg">{r.business_emoji}</td>
                    <td className="p-3">
                      <Link
                        href={`/cashhub/reports/${r.id}`}
                        className="block hover:text-[--color-brand-700]"
                      >
                        <div className="font-bold tabular-num text-sm">
                          {r.branch_code}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate sm:hidden">
                          {bkkDate(r.report_date)} · {r.shift_label}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate hidden sm:block">
                          {r.branch_name}
                        </div>
                      </Link>
                    </td>
                    <td className="p-3 hidden sm:table-cell">
                      <div className="text-sm font-medium tabular-num">
                        {bkkDate(r.report_date)}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {r.shift_label}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/cashhub/reports/${r.id}`}
                        className="font-bold tabular-num"
                      >
                        {formatBahtCompact(r.total_sales)}
                      </Link>
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      {reconcileOk ? (
                        <Badge tone="success">
                          <CheckCircle2 className="size-3" />
                          ตรงพอดี
                        </Badge>
                      ) : (
                        <Badge tone="danger">
                          <AlertTriangle className="size-3" />
                          {r.reconcile_diff > 0 ? "ขาด" : "เกิน"} ฿
                          {Math.abs(r.reconcile_diff).toLocaleString("th-TH")}
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 hidden lg:table-cell">
                      <span className="text-xs text-zinc-500 tabular-num">
                        {r.submitted_at ? bkkTime(r.submitted_at) : "—"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Badge tone={r.status_tone}>{r.status_label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
