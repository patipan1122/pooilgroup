"use client";

// Popup ที่แสดงรายงานของสาขา×วัน — เปิดเมื่อกด heatmap cell
// feedback_popup_first_drilldown.md — ห้าม navigate ออกจากหน้า
// feedback_heatmap_cell_clickable.md — popup ในหน้าเดิม + approve/reject

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  XCircle,
  CircleDashed,
  ExternalLink,
  Loader2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatBaht } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

interface ReportData {
  id: string;
  status: string;
  shift: string;
  total_sales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
  notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
}

interface BranchData {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  branchId: string;
  branchCode: string;
  date: string; // YYYY-MM-DD
  /** When true, viewer can fill ที่สาขานี้ (LIFF link visible) */
  canFill?: boolean;
  /** When true, show approve/reject buttons for submitted reports */
  canApprove?: boolean;
}

export function HeatmapCellModal({
  open,
  onClose,
  branchId,
  branchCode,
  date,
  canFill = false,
  canApprove = false,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [branch, setBranch] = useState<BranchData | null>(null);
  const [actionPending, setActionPending] = useState<"approve" | "reject" | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setBranch(null);
    setShowRejectInput(false);
    setRejectReason("");

    fetch(`/api/cashhub/reports/by-date?branchId=${branchId}&date=${date}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((j) => {
        setReport(j.report);
        setBranch(j.branch);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, branchId, date]);

  async function handleAction(action: "approve" | "reject") {
    if (!report || actionPending) return;
    if (action === "reject" && !rejectReason.trim()) {
      toast.error("กรุณาระบุเหตุผลที่ปฏิเสธ");
      return;
    }
    setActionPending(action);
    try {
      const res = await fetch("/api/cashhub/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          action,
          reason: action === "reject" ? rejectReason : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || "ทำรายการไม่สำเร็จ");
        return;
      }
      toast.success(action === "approve" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว");
      // Update local state so UI reflects immediately
      setReport({
        ...report,
        status: action === "approve" ? "approved" : "rejected",
        rejected_reason: action === "reject" ? rejectReason : null,
        approved_at: action === "approve" ? new Date().toISOString() : null,
      });
      setShowRejectInput(false);
      // Refresh server data so heatmap cell color updates after close
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เน็ตมีปัญหา");
    } finally {
      setActionPending(null);
    }
  }

  const cfg = branch ? BUSINESS_TYPES[branch.business_type] : null;
  const titleEmoji = cfg?.emoji ?? "📋";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${titleEmoji} ${branchCode} · ${date}`}
    >
      {loading && (
        <div className="flex items-center justify-center py-10 text-zinc-500">
          <Loader2 className="size-5 animate-spin mr-2" />
          กำลังโหลด...
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border-2 border-red-200 p-4 text-sm text-red-800">
          <AlertCircle className="size-4 inline mr-1.5" />
          {error}
        </div>
      )}

      {!loading && !error && branch && (
        <div className="space-y-4">
          {/* Branch info */}
          <div className="text-sm text-zinc-600">
            <div className="font-medium text-zinc-900">{branch.name}</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {cfg?.label}
              {branch.province && ` · ${branch.province}`}
            </div>
          </div>

          {/* Status banner */}
          {report ? (
            <StatusBanner status={report.status} />
          ) : (
            <div className="rounded-xl bg-zinc-100 border-2 border-zinc-200 px-4 py-3 flex items-center gap-2 text-sm">
              <CircleDashed className="size-4 text-zinc-500" />
              <span className="font-semibold text-zinc-700">ยังไม่กรอก</span>
            </div>
          )}

          {/* Report details */}
          {report && (
            <>
              <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                    ยอดขาย
                  </span>
                  {report.shift !== "all" && (
                    <Badge tone="neutral">
                      {report.shift === "morning" && "🌅 เช้า"}
                      {report.shift === "midday" && "☀️ กลางวัน"}
                      {report.shift === "evening" && "🌙 เย็น"}
                    </Badge>
                  )}
                </div>
                <div className="text-3xl font-extrabold tabular-num font-display tracking-tight text-zinc-900">
                  {formatBaht(report.total_sales)}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                  <BreakdownRow label="เงินสด" value={report.cash} />
                  <BreakdownRow label="โอน" value={report.transfer} />
                  <BreakdownRow label="บัตร" value={report.card} />
                  <BreakdownRow label="เครดิต" value={report.credit} />
                  {report.shortage > 0 && (
                    <BreakdownRow
                      label="เงินขาด"
                      value={report.shortage}
                      warning
                    />
                  )}
                </div>
              </div>

              {report.notes && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <p className="text-xs uppercase tracking-widest text-amber-700 font-bold mb-1">
                    โน้ต
                  </p>
                  <p className="text-sm text-amber-900">{report.notes}</p>
                </div>
              )}

              {report.rejected_reason && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                  <p className="text-xs uppercase tracking-widest text-red-700 font-bold mb-1">
                    เหตุผลที่ไม่อนุมัติ
                  </p>
                  <p className="text-sm text-red-900">
                    {report.rejected_reason}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-500">
                <span>
                  ส่งเมื่อ:{" "}
                  {report.submitted_at
                    ? new Date(report.submitted_at).toLocaleString("th-TH", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </span>
                {report.approved_at && (
                  <span className="text-[var(--color-leaf-700)] font-semibold">
                    อนุมัติแล้ว
                  </span>
                )}
              </div>

              {/* Approve / Reject — เฉพาะรายงานที่ submitted + ผู้ใช้มีสิทธิ์ */}
              {canApprove && report.status === "submitted" && (
                <div className="border-t border-zinc-100 pt-3 space-y-2">
                  {showRejectInput ? (
                    <>
                      <label className="text-xs font-bold text-zinc-700">
                        เหตุผลที่ปฏิเสธ
                      </label>
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="เช่น ตัวเลขโอนยังไม่ตรงสลิป — ให้สาขาแก้แล้วส่งใหม่"
                        rows={2}
                        maxLength={500}
                        className="w-full rounded-xl border-2 border-zinc-200 bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowRejectInput(false);
                            setRejectReason("");
                          }}
                          disabled={!!actionPending}
                          className="flex-1 h-10 rounded-xl border-2 border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAction("reject")}
                          disabled={!!actionPending || !rejectReason.trim()}
                          className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:bg-zinc-200 disabled:text-zinc-500 inline-flex items-center justify-center gap-1.5"
                        >
                          {actionPending === "reject" ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <ThumbsDown className="size-4" />
                          )}
                          ยืนยันปฏิเสธ
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRejectInput(true)}
                        disabled={!!actionPending}
                        className="flex-1 h-11 rounded-xl border-2 border-red-200 bg-white text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center justify-center gap-1.5"
                      >
                        <ThumbsDown className="size-4" />
                        ปฏิเสธ
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction("approve")}
                        disabled={!!actionPending}
                        className="flex-1 h-11 rounded-xl bg-[var(--color-leaf-600)] text-white text-sm font-bold hover:bg-[var(--color-leaf-700)] disabled:bg-zinc-200 disabled:text-zinc-500 inline-flex items-center justify-center gap-1.5 shadow-soft"
                      >
                        {actionPending === "approve" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ThumbsUp className="size-4" />
                        )}
                        อนุมัติ
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Empty state — quick fill button if user has permission */}
          {!report && canFill && (
            <Link
              href={`/liff/report/${branchId}`}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-[var(--color-brand-600)] hover:bg-[var(--color-brand-700)] text-white font-bold py-3 text-sm shadow-blue"
            >
              กรอกรายงานวันนี้
              <ExternalLink className="size-4" />
            </Link>
          )}

          {/* Drill-down — กดเข้าหน้าสาขาถ้าอยากดูประวัติเต็ม */}
          <Link
            href={`/cashhub/branches/${branchId}`}
            className="flex items-center justify-center gap-1.5 text-sm text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] font-semibold py-2"
          >
            ดูประวัติเต็มของสาขา
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      )}
    </Dialog>
  );
}

function StatusBanner({ status }: { status: string }) {
  const cfg =
    status === "approved"
      ? {
          icon: <CheckCircle2 className="size-4" />,
          label: "อนุมัติแล้ว",
          box: "bg-[var(--color-leaf-50)] border-[var(--color-leaf-200)] text-[var(--color-leaf-800)]",
        }
      : status === "submitted"
        ? {
            icon: <Clock className="size-4" />,
            label: "รออนุมัติ",
            box: "bg-amber-50 border-amber-200 text-amber-800",
          }
        : status === "rejected"
          ? {
              icon: <XCircle className="size-4" />,
              label: "ปฏิเสธ",
              box: "bg-red-50 border-red-200 text-red-800",
            }
          : {
              icon: <CircleDashed className="size-4" />,
              label: "ร่าง",
              box: "bg-zinc-100 border-zinc-200 text-zinc-700",
            };

  return (
    <div
      className={`rounded-xl border-2 px-4 py-2.5 flex items-center gap-2 text-sm font-semibold ${cfg.box}`}
    >
      {cfg.icon}
      {cfg.label}
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  warning,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${warning ? "bg-amber-50" : "bg-zinc-50"}`}
    >
      <span className="text-zinc-600">{label}</span>
      <span
        className={`tabular-num font-semibold ${warning ? "text-amber-800" : "text-zinc-900"}`}
      >
        {formatBaht(value)}
      </span>
    </div>
  );
}
