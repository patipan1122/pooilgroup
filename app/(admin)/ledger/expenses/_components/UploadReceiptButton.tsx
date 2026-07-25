"use client";

// UploadReceiptButton — แค่ "ปุ่มเรียก" อัปโหลดใบเสร็จ (ตัวคุมงานจริงอยู่ที่
// LedgerUploadProvider ระดับ layout เพื่อให้งาน "ทำงานเบื้องหลัง" รอดข้ามการเปลี่ยน
// filter / เลือกใบ / ไปหน้าอื่นในเมนู LedgerLine — ดู _components/LedgerUploadProvider).
//
// ปุ่มนี้:
//   • กด → เปิดเมนูเลือก (openSheet) พร้อม scope ปัจจุบัน (บริษัท/สาขา/filter)
//   • ฟัง event `ledger:open-upload` จาก FAB "ถ่าย" ในแถบล่างมือถือ → เปิดเมนูเดียวกัน
//   • โชว์สถานะ "กำลังทำ x/y" ตอนงานวิ่งอยู่ (อ่านจาก context)

import { useEffect, useState } from "react";
import { Upload, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLedgerUpload } from "../../_components/LedgerUploadProvider";

export function UploadReceiptButton({
  companyId,
  branchId,
  baseParams,
  hideTriggerOnMobile = false,
}: {
  companyId: string;
  branchId?: string | null;
  /** company/branch/filter params — snapshot ตอนเริ่มงาน (ใช้ตอนเปิดใบใหม่หลังอัป) */
  baseParams: string;
  /** ซ่อนปุ่มบนมือถือ (FAB "ถ่าย" ในแถบล่างยิง event เดียวกัน) */
  hideTriggerOnMobile?: boolean;
}) {
  const { openSheet, busy, done, total, mode } = useLedgerUpload();
  const [topErr, setTopErr] = useState<string | null>(null);

  function trigger() {
    if (!companyId) {
      setTopErr("เลือกบริษัทก่อนอัปโหลด");
      return;
    }
    setTopErr(null);
    openSheet({ companyId, branchId, baseParams });
  }

  // FAB "ถ่าย" บนมือถือ (LedgerBottomNav) ยิง event นี้เมื่ออยู่หน้า /ledger/expenses
  // → เปิดเมนูเลือกในจังหวะเดียวกัน (กดอีกทีในเมนู = user-gesture ใหม่ → iOS/LINE ไม่บล็อก picker)
  useEffect(() => {
    const open = () => {
      if (companyId) openSheet({ companyId, branchId, baseParams });
    };
    window.addEventListener("ledger:open-upload", open);
    return () => window.removeEventListener("ledger:open-upload", open);
  }, [companyId, branchId, baseParams, openSheet]);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className={hideTriggerOnMobile ? "hidden sm:block" : undefined}>
        <Button
          variant="primary"
          onClick={trigger}
          disabled={busy || !companyId}
          aria-label="อัปโหลดใบเสร็จ"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {busy
            ? mode === "group"
              ? "กำลังอ่านบิล…"
              : `กำลังทำ ${done}/${total}…`
            : "อัปโหลดใบเสร็จ"}
        </Button>
      </div>
      {topErr && (
        <p className="flex items-center gap-1 text-xs font-medium text-rose-700 animate-fade-in" role="alert">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {topErr}
        </p>
      )}
    </div>
  );
}
