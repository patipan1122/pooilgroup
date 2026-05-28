// Repair — SLA computation (response + resolve due dates) per urgency.
// CEO Q7 default: 4hr/24hr/72hr scaled per urgency.
import type { RepairUrgency } from "@/lib/generated/prisma/enums";
import { URGENCY_SLA_HOURS } from "./types";

type TicketSlaShape = {
  status: import("@/lib/generated/prisma/enums").RepairTicketStatus;
  resolveDueAt: Date | null;
  resolvedAt: Date | null;
};

export interface SlaDates {
  responseDueAt: Date;
  resolveDueAt: Date;
}

export function computeSlaDates(urgency: RepairUrgency, from: Date = new Date()): SlaDates {
  const cfg = URGENCY_SLA_HOURS[urgency];
  return {
    responseDueAt: new Date(from.getTime() + cfg.response * 60 * 60 * 1000),
    resolveDueAt: new Date(from.getTime() + cfg.resolve * 60 * 60 * 1000),
  };
}

export type SlaStatus = "ok" | "soon" | "overdue" | "done";

/** Single status against the resolve SLA */
export function slaStatusFor(ticket: TicketSlaShape): SlaStatus {
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED" || ticket.status === "CANCELLED") {
    return "done";
  }
  if (!ticket.resolveDueAt) return "ok";
  const now = Date.now();
  const due = ticket.resolveDueAt.getTime();
  if (now > due) return "overdue";
  if (due - now < 60 * 60 * 1000) return "soon"; // < 1hr
  return "ok";
}

export function slaBadgeColor(status: SlaStatus): string {
  switch (status) {
    case "overdue":
      return "bg-red-50 text-red-700 border-red-200";
    case "soon":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "done":
      return "bg-zinc-100 text-zinc-600 border-zinc-200";
    default:
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

export function slaBadgeLabel(status: SlaStatus, resolveDueAt: Date | null): string {
  if (status === "done") return "ปิดงานแล้ว";
  if (!resolveDueAt) return "—";
  const diffMs = resolveDueAt.getTime() - Date.now();
  const absHr = Math.abs(diffMs) / (60 * 60 * 1000);
  if (status === "overdue") {
    if (absHr > 24) return `เกิน ${Math.round(absHr / 24)} วัน`;
    return `เกิน ${Math.round(absHr)} ชม`;
  }
  if (absHr < 1) return `เหลือ <1 ชม`;
  if (absHr < 24) return `เหลือ ${Math.round(absHr)} ชม`;
  return `เหลือ ${Math.round(absHr / 24)} วัน`;
}
