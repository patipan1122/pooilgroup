// Shared tab header for /reports, /shifts, /audit (back-office)
// Renders identical tab nav so cashier feels they're in one section

import Link from "next/link";
import { BarChart3, Clock, History } from "lucide-react";

type ActiveTab = "reports" | "shifts" | "audit";

export function BackOfficeTabs({ active }: { active: ActiveTab }) {
  return (
    <div className="pl-tabs">
      <Link href="/playland/reports" className={`pl-tab${active === "reports" ? " is-active" : ""}`}>
        <BarChart3 size={14} /> รายงาน
      </Link>
      <Link href="/playland/shifts" className={`pl-tab${active === "shifts" ? " is-active" : ""}`}>
        <Clock size={14} /> กะ · ปิดวัน
      </Link>
      <Link href="/playland/audit" className={`pl-tab${active === "audit" ? " is-active" : ""}`}>
        <History size={14} /> Audit Log
      </Link>
    </div>
  );
}
