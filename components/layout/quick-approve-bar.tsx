"use client";

// Quick Approve Bar (CORE_SYSTEM §4.2 + CASHHUB §4.2).
// แสดงด้านล่าง topnav บนหน้า admin · เห็นเฉพาะ admin tier ที่อนุมัติได้
// (super_admin / org_admin / admin / area_manager) — branch_manager เห็นเหมือนกัน
// แต่ scope เป็นสาขาตัวเอง.
//
// Features:
//   • ตัวเลข pending รวม + breakdown ต่อ module (CashHub Phase 1, FuelOS/DocuFlow ภายหลัง)
//   • ปุ่มเปิด /cashhub/reports?status=submitted สำหรับ approve เป็นรายการ
//   • Dismiss (close) ใน 1 session — เก็บใน sessionStorage
//
// Why: เจ้าของเปิดเครื่องมาเห็น "5 รายงานรออนุมัติ" + กดทีเดียวจบ ไม่ต้องเข้าไป
// ค้นเอง.

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, X } from "lucide-react";

interface Props {
  pendingCashReports: number;
  pendingRegisterRequests: number;
}

const SS_KEY = "pooilgroup:quick-approve-dismissed";

export function QuickApproveBar({
  pendingCashReports,
  pendingRegisterRequests,
}: Props) {
  const [dismissed, setDismissed] = useState(false);

  // sessionStorage hydrate (mount only) — re-show on next session
  // Pattern: setState in mount-effect เป็นวิธีมาตรฐานสำหรับ SSR hydration
  // (sessionStorage เข้าถึงไม่ได้ระหว่าง SSR → ต้องอ่านหลัง mount)
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(sessionStorage.getItem(SS_KEY) === "1");
  }, []);

  function dismiss() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SS_KEY, "1");
    }
    setDismissed(true);
  }

  const total = pendingCashReports + pendingRegisterRequests;
  if (dismissed || total === 0) return null;

  return (
    <div className="sticky top-14 sm:top-16 z-30 bg-gradient-to-r from-[var(--color-brand-700)] to-[var(--color-brand-500)] text-white shadow-md">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center gap-3">
        <CheckCircle2 className="size-4 sm:size-5 shrink-0" />

        <div className="min-w-0 flex-1 text-xs sm:text-sm">
          <span className="font-bold tabular-num">{total}</span>{" "}
          <span className="opacity-90">รายการรออนุมัติ</span>
          {pendingCashReports > 0 && (
            <span className="ml-2 text-[11px] opacity-80 hidden sm:inline">
              💰 {pendingCashReports} รายงาน
            </span>
          )}
          {pendingRegisterRequests > 0 && (
            <span className="ml-2 text-[11px] opacity-80 hidden sm:inline">
              👤 {pendingRegisterRequests} คำขอเข้าร่วม
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {pendingCashReports > 0 && (
            <Link
              href="/cashhub/reports?status=submitted"
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded-full bg-white/15 hover:bg-white/25 text-xs font-bold transition-colors"
            >
              อนุมัติรายงาน
              <ChevronRight className="size-3" />
            </Link>
          )}
          {pendingRegisterRequests > 0 && (
            <Link
              href="/users/requests"
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded-full bg-white/15 hover:bg-white/25 text-xs font-bold transition-colors"
            >
              คำขอเข้าร่วม
              <ChevronRight className="size-3" />
            </Link>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="ml-1 size-7 rounded-full hover:bg-white/15 inline-flex items-center justify-center"
            aria-label="ซ่อน"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
