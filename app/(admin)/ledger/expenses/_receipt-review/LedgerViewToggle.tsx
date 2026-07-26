// ปุ่มสลับมุมมองหน้ารายจ่าย — รายการ (โหมดเดิม) ↔ ตรวจใบเสร็จ (โหมดใหม่).
// mirror ของ components/recruit/view-toggle.tsx: เป็น <Link> ล้วน · หน้า page.tsx
// สร้าง href จาก searchParams ปัจจุบัน → ฟิลเตอร์ทั้งหมดถูกคงไว้โดยอัตโนมัติ.
import Link from "next/link";
import { List, ScanLine } from "lucide-react";

interface Props {
  current: "list" | "receipt-review";
  listHref: string;
  reviewHref: string;
  /** "flat" = ใช้ในหัวแถบขาวของโหมดตรวจ (ตัวหนังสือเล็กลง) */
  variant?: "default" | "flat";
}

export function LedgerViewToggle({ current, listHref, reviewHref, variant = "default" }: Props) {
  const flat = variant === "flat";
  const h = flat ? "h-7" : "h-8";
  const text = flat ? "text-[11px]" : "text-xs";
  const icon = flat ? "size-3" : "size-3.5";
  const item =
    `inline-flex items-center gap-1.5 ${h} px-2.5 ${text} font-bold rounded-lg transition-colors`;
  return (
    <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-50/40 p-0.5">
      <Link
        href={listHref}
        className={`${item} ${
          current === "list"
            ? "bg-white text-zinc-900 shadow-sm"
            : "text-zinc-500 hover:text-zinc-900"
        }`}
        title="ดูแบบรายการ (โหมดเดิม)"
      >
        <List className={icon} />
        รายการ
      </Link>
      <Link
        href={reviewHref}
        className={`${item} ${
          current === "receipt-review"
            ? "bg-white text-zinc-900 shadow-sm"
            : "text-zinc-500 hover:text-zinc-900"
        }`}
        title="โหมดตรวจใบเสร็จ (ดูรูป + ฟอร์ม + รายการข้าง ๆ)"
      >
        <ScanLine className={icon} />
        ตรวจใบเสร็จ
      </Link>
    </div>
  );
}
