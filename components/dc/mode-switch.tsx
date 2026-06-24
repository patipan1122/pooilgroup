"use client";

// ปุ่มสลับโหมด หน้าคลัง ⇄ หลังบ้าน (segmented control) · active ตาม pathname
// กดแล้วเด้งไปหน้าหลักของโหมดนั้น. ซ่อนฝั่งหลังบ้านถ้าไม่มีสิทธิ์ (canManage=false).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Settings2 } from "lucide-react";
import { dcMode, FLOOR_HOME, OFFICE_HOME } from "@/lib/dc/nav";

export function DcModeSwitch({ canManage = true }: { canManage?: boolean }) {
  const pathname = usePathname() || "";
  const mode = dcMode(pathname);
  return (
    <div className="dc-mode-switch" role="tablist" aria-label="โหมดการใช้งาน">
      <Link
        href={FLOOR_HOME}
        role="tab"
        aria-selected={mode === "floor"}
        className={`dc-mode-pill${mode === "floor" ? " is-active" : ""}`}
      >
        <Boxes size={15} strokeWidth={mode === "floor" ? 2.4 : 1.9} /> หน้าคลัง
      </Link>
      {canManage && (
        <Link
          href={OFFICE_HOME}
          role="tab"
          aria-selected={mode === "office"}
          className={`dc-mode-pill${mode === "office" ? " is-active" : ""}`}
        >
          <Settings2 size={15} strokeWidth={mode === "office" ? 2.4 : 1.9} /> หลังบ้าน
        </Link>
      )}
    </div>
  );
}
