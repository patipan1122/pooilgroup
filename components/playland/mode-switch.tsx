"use client";

// ปุ่มสลับโหมด หน้าร้าน ⇄ หลังร้าน (segmented control) · วางบนหัวหน้าไหนก็ได้
// active ตาม pathname อัตโนมัติ · กดแล้วเด้งไปหน้าหลักของโหมดนั้น

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, Settings2 } from "lucide-react";
import { playlandMode, FRONT_HOME, OFFICE_HOME } from "@/lib/playland/nav";

export function PlaylandModeSwitch() {
  const pathname = usePathname() || "";
  const mode = playlandMode(pathname);
  return (
    <div className="pl-mode-switch" role="tablist" aria-label="โหมดการใช้งาน">
      <Link
        href={FRONT_HOME}
        role="tab"
        aria-selected={mode === "front"}
        className={`pl-mode-pill${mode === "front" ? " is-active" : ""}`}
      >
        <Store size={15} strokeWidth={mode === "front" ? 2.4 : 1.9} /> หน้าร้าน
      </Link>
      <Link
        href={OFFICE_HOME}
        role="tab"
        aria-selected={mode === "office"}
        className={`pl-mode-pill${mode === "office" ? " is-active" : ""}`}
      >
        <Settings2 size={15} strokeWidth={mode === "office" ? 2.4 : 1.9} /> หลังร้าน
      </Link>
    </div>
  );
}
