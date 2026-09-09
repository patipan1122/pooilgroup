"use client";

// CEO 2026-09-09: "อยากให้ปุ่มส่งยอดกดมีอยู่หน้าตารางค่าเช่าเลยครับ" — ปุ่มเดียวกับ
// settings/_components/reconcile-account-section.tsx (actSendBillsToReconcile ตัวเดิม
// ไม่มี server logic ซ้อน) วางไว้ในแถบเครื่องมือของหน้าตารางแทน — ใช้รูปแบบ popover
// เดียวกับ ExportSummaryButton (chip trigger + rs-card ลอย) กันหน้าบวม (RULE L).
// เพิ่มด่านยอดสลิปจาก pushProjectBillsToLedger (Part B) → ถ้ามีบิลถูกกันเพราะยอดสลิป
// ไม่ตรง แสดงรายการละเอียดตรงนี้เลย (ห้อง+ผู้เช่า+งวด+เหตุผล) ไม่ต้องเปิดหน้าอื่น
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X } from "lucide-react";
import { toast } from "sonner";
import { actSendBillsToReconcile } from "../../_actions";
import type { ProjectReconcileSummary, PushResult } from "@/lib/rentspace/ledger-push";

const fmtBaht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SendToLedgerButton({
  projectId,
  summary,
}: {
  projectId: string;
  summary: ProjectReconcileSummary;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, startSend] = useTransition();
  const [result, setResult] = useState<PushResult | null>(null);

  function send() {
    startSend(async () => {
      try {
        const r = await actSendBillsToReconcile(projectId);
        setResult(r);
        const skipped = r.skippedForSlipMismatch.length;
        toast.success(
          `ส่งสำเร็จ ${r.inserted} ใบ (ยอด ${fmtBaht(r.insertedAmountBaht)} บาท)` +
            (r.alreadySent ? ` · ข้าม ${r.alreadySent} ใบ (ส่งไปแล้ว)` : "") +
            (skipped ? ` · ข้าม ${skipped} ใบเพราะยอดสลิปไม่ตรง` : ""),
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ส่งไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rs-chip shrink-0 !h-11 sm:!h-7 ${open ? "active" : ""}`}
      >
        <Send className="mr-1 inline h-3.5 w-3.5" /> ส่งเข้าบัญชี
        {summary.configured && summary.readyCount > 0 && (
          <span className="ml-1 tabular-nums">({summary.readyCount})</span>
        )}
      </button>

      {open && (
        <div className="rs-card absolute right-0 z-20 mt-2 w-[21rem] max-w-[calc(100vw-2rem)] space-y-2.5 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-bold" style={{ color: "var(--rs-text)" }}>
              ส่งเข้าบัญชี LedgerLine
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="ปิด"
              className="inline-flex h-6 w-6 items-center justify-center rounded"
              style={{ color: "var(--rs-text-3)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!summary.configured ? (
            <p className="text-[12.5px]" style={{ color: "var(--rs-danger)" }}>
              ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคารของโครงการนี้ —{" "}
              <Link href="/rentspace/settings" className="underline">
                ไปตั้งค่าก่อน
              </Link>
            </p>
          ) : (
            <>
              <p className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                พร้อมส่ง <strong style={{ color: "var(--rs-text)" }}>{summary.readyCount}</strong> ใบ · ยอดรวม{" "}
                <strong className="tabular-nums" style={{ color: "var(--rs-text)" }}>
                  {fmtBaht(summary.readyAmountBaht)} ฿
                </strong>
              </p>
              <button
                type="button"
                onClick={send}
                disabled={sending || summary.readyCount === 0}
                className="rs-btn w-full justify-center"
              >
                <Send className="h-4 w-4" /> {sending ? "กำลังตรวจสลิป+ส่ง…" : "ส่งเข้าบัญชี LedgerLine"}
              </button>
            </>
          )}

          {result && result.skippedForSlipMismatch.length > 0 && (
            <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: "var(--rs-border)" }}>
              <p className="text-[12px] font-semibold" style={{ color: "var(--rs-danger)" }}>
                ข้าม {result.skippedForSlipMismatch.length} ใบ — ยอดสลิปไม่ตรง
              </p>
              <ul className="max-h-52 space-y-1.5 overflow-y-auto">
                {result.skippedForSlipMismatch.map((s) => (
                  <li
                    key={s.billId}
                    className="rounded-lg p-2 text-[11.5px]"
                    style={{ background: "var(--rs-bg-3)" }}
                  >
                    <div className="font-semibold" style={{ color: "var(--rs-text)" }}>
                      {s.unitCode} · {s.tenantLabel} · {s.periodLabel}
                    </div>
                    {s.reasons.map((r, i) => (
                      <div key={i} style={{ color: "var(--rs-text-2)" }}>
                        {r}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
