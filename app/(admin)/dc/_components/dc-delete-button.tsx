"use client";

// DC · ปุ่มลบเอกสาร (reusable · super_admin เท่านั้น) — CEO 2026-07-10.
//   ใช้ได้ทั้งในแถวรายการ (list row) และหัวใบ (detail header).
//   เลือก server action ตาม docType → ยืนยันด้วยข้อความเตือนไทยที่ต่างกันต่อชนิดเอกสาร →
//   ระหว่างลบ disable ปุ่ม · สำเร็จ → onDeleted?.() + router.refresh() · ล้มเหลว → alert(error).
//
// ⚠️ ฝั่ง server (delete-actions) ตรวจ super_admin เองอยู่แล้ว — ปุ่มนี้เป็นแค่ชั้น UX
//    (หน้าเรียกใช้ต้องซ่อนปุ่มเมื่อ !canDelete อยู่แล้ว) · กันพลาดสองชั้น.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  deletePurchaseOrder,
  deleteGoodsReceipt,
  deleteTransfer,
  deleteIssue,
  deleteMove,
  type DeleteDocResult,
} from "@/lib/dc/delete-actions";

export type DcDeleteDocType = "po" | "grn" | "transfer" | "issue" | "move";

// เลือก action ตามชนิดเอกสาร (แต่ละอันรับ id เดี่ยว → คืน DeleteDocResult)
const ACTION: Record<DcDeleteDocType, (id: string) => Promise<DeleteDocResult>> = {
  po: deletePurchaseOrder,
  grn: deleteGoodsReceipt,
  transfer: deleteTransfer,
  issue: deleteIssue,
  move: deleteMove,
};

// ข้อความเตือนก่อนลบ — ต่างกันตามชนิดเอกสาร (เน้นผลกระทบต่อสต๊อก/บัญชี)
function confirmMessage(docType: DcDeleteDocType, docCode: string): string {
  switch (docType) {
    case "po":
      return `⚠️ ลบใบสั่งซื้อ ${docCode}?\nใบรับสินค้า/สต๊อกที่เกิดจากใบนี้จะถูกลบและคืนกลับทั้งหมด — ลบแล้วกู้ผ่านประวัติการลบเท่านั้น`;
    case "grn":
      return `⚠️ ลบใบรับ ${docCode}?\nระบบจะตัดของที่รับเข้าออกจากสต๊อก (และลบเอกสารในบัญชี TRCloud ถ้าเคยส่ง) — ลบแล้วกู้ผ่านประวัติการลบเท่านั้น`;
    case "transfer":
      return `⚠️ ลบใบโอน ${docCode}?\nสต๊อกที่โอนออกจะถูกคืนกลับสู่สภาพก่อนโอน — ลบแล้วกู้ผ่านประวัติการลบเท่านั้น`;
    case "issue":
      return `⚠️ ลบใบเบิก ${docCode}?\nของที่เบิกออกจะถูกคืนกลับเข้าคลัง — ลบแล้วกู้ผ่านประวัติการลบเท่านั้น`;
    case "move":
      return `⚠️ ลบใบย้ายที่ ${docCode}?\n(ย้ายที่ไม่กระทบจำนวนสินค้า) — ลบแล้วกู้ผ่านประวัติการลบเท่านั้น`;
  }
}

export function DcDeleteButton({
  docType,
  docId,
  docCode,
  label,
  size = "md",
  onDeleted,
}: {
  docType: DcDeleteDocType;
  docId: string;
  docCode: string;
  /** ถ้าใส่ → แสดงข้อความข้างไอคอน · ถ้าไม่ใส่ → เป็นปุ่มไอคอนล้วน (ใช้ในแถว) */
  label?: string;
  size?: "sm" | "md";
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const iconSize = size === "sm" ? 13 : 15;

  function handleClick(e: React.MouseEvent) {
    // กันคลิกทะลุไปโดน row-link (DataTable ทำให้ทั้งแถวเป็นลิงก์)
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(confirmMessage(docType, docCode))) return;
    startTransition(async () => {
      const res = await ACTION[docType](docId);
      if (res.ok) {
        onDeleted?.();
        router.refresh();
      } else {
        window.alert(res.error);
      }
    });
  }

  const base: React.CSSProperties = label
    ? {
        // ปุ่มมีข้อความ (หัวใบ) — โทนแดงตัน matching dc-btn danger
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: size === "sm" ? "6px 12px" : "8px 16px",
        borderRadius: 9,
        border: "1px solid #e6b6ae",
        background: "#fdeaea",
        color: "#b8362a",
        fontSize: size === "sm" ? 13 : 14,
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.6 : 1,
      }
    : {
        // ปุ่มไอคอนล้วน (แถวรายการ) — matching iconBtn ใน po-detail (Trash2 size 13, สีแดง)
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size === "sm" ? 28 : 34,
        height: size === "sm" ? 28 : 34,
        borderRadius: 9,
        border: "1px solid var(--dc-line, #e4e4e7)",
        background: "#fff",
        color: "#b8362a",
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.6 : 1,
      };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={label ? undefined : `ลบ ${docCode}`}
      aria-label={label ?? `ลบ ${docCode}`}
      style={base}
    >
      <Trash2 size={iconSize} aria-hidden />
      {label ? (pending ? "กำลังลบ…" : label) : null}
    </button>
  );
}
