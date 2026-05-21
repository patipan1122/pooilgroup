// Repair module — shared TypeScript types + label maps
import type {
  RepairTicketStatus,
  RepairUrgency,
  RepairPhotoPhase,
  RepairPartStatus,
  RepairEventKind,
  RepairTechnicianKind,
  RepairReportSource,
} from "@/lib/generated/prisma/enums";

export type {
  RepairTicketStatus,
  RepairUrgency,
  RepairPhotoPhase,
  RepairPartStatus,
  RepairEventKind,
  RepairTechnicianKind,
  RepairReportSource,
};

export const TICKET_STATUSES: RepairTicketStatus[] = [
  "NEW",
  "ACK",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
];

export const STATUS_LABELS: Record<RepairTicketStatus, string> = {
  NEW: "เปิด · ใหม่",
  ACK: "ติดต่อช่างแล้ว",
  IN_PROGRESS: "กำลังซ่อม",
  WAITING_PARTS: "รออะไหล่",
  RESOLVED: "เสร็จแล้ว",
  CLOSED: "ปิดถาวร",
  CANCELLED: "ยกเลิก",
};

export const STATUS_COLORS: Record<RepairTicketStatus, string> = {
  NEW: "bg-blue-50 text-blue-700 border-blue-200",
  ACK: "bg-violet-50 text-violet-700 border-violet-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  WAITING_PARTS: "bg-orange-50 text-orange-700 border-orange-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-zinc-100 text-zinc-700 border-zinc-300",
  CANCELLED: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

/** Statuses shown in the Kanban board (in column order) */
export const KANBAN_STATUSES: RepairTicketStatus[] = [
  "NEW",
  "ACK",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "RESOLVED",
];

/** Statuses considered "open" for KPI counts */
export const OPEN_STATUSES: RepairTicketStatus[] = [
  "NEW",
  "ACK",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

export const URGENCIES: RepairUrgency[] = ["URGENT", "NORMAL", "LOW"];

export const URGENCY_LABELS: Record<RepairUrgency, string> = {
  URGENT: "ด่วนมาก",
  NORMAL: "ปานกลาง",
  LOW: "ไม่เร่งด่วน",
};

export const URGENCY_COLORS: Record<RepairUrgency, string> = {
  URGENT: "bg-red-50 text-red-700 border-red-200",
  NORMAL: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

/** SLA hours by urgency (response · resolve) */
export const URGENCY_SLA_HOURS: Record<RepairUrgency, { response: number; resolve: number }> = {
  URGENT: { response: 4, resolve: 24 },
  NORMAL: { response: 24, resolve: 72 },
  LOW: { response: 72, resolve: 24 * 7 },
};

export const PHOTO_PHASE_LABELS: Record<RepairPhotoPhase, string> = {
  BEFORE: "ก่อนซ่อม",
  DURING: "ระหว่างซ่อม",
  AFTER: "หลังซ่อม",
  PART: "อะไหล่",
  RECEIPT: "บิล/ใบเสร็จ",
};

export const PART_STATUS_LABELS: Record<RepairPartStatus, string> = {
  NEEDED: "ขอเตรียม",
  ORDERED: "สั่งแล้ว",
  DELIVERED: "ของถึง",
  INSTALLED: "ติดตั้ง",
  CANCELLED: "ยกเลิก",
};

export const PART_STATUS_COLORS: Record<RepairPartStatus, string> = {
  NEEDED: "bg-amber-50 text-amber-700 border-amber-200",
  ORDERED: "bg-blue-50 text-blue-700 border-blue-200",
  DELIVERED: "bg-violet-50 text-violet-700 border-violet-200",
  INSTALLED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

export const EVENT_KIND_LABELS: Record<RepairEventKind, string> = {
  CREATED: "เปิดใบ",
  STATUS_CHANGE: "เปลี่ยนสถานะ",
  ASSIGN: "มอบหมาย",
  UNASSIGN: "ปลดช่าง",
  COMMENT: "คอมเมนต์",
  PART_ADDED: "เพิ่มอะไหล่",
  PART_UPDATED: "อัปเดตอะไหล่",
  PHOTO_ADDED: "เพิ่มรูป",
  REOPEN: "เปิดใบใหม่",
  CLOSE: "ปิดถาวร",
  ETA_SET: "กำหนด ETA",
};

export const TECHNICIAN_KIND_LABELS: Record<RepairTechnicianKind, string> = {
  INTERNAL: "ช่างใน",
  VENDOR: "ช่างนอก",
};

/** Status transitions that are legal at any time (state machine) */
export const STATUS_TRANSITIONS: Record<RepairTicketStatus, RepairTicketStatus[]> = {
  NEW: ["ACK", "IN_PROGRESS", "CANCELLED"],
  ACK: ["IN_PROGRESS", "WAITING_PARTS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "RESOLVED", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"], // can reopen back to IN_PROGRESS
  CLOSED: [], // dead-end · admin must reopen via separate action
  CANCELLED: ["NEW"], // re-open cancelled ticket
};

export function canTransition(from: RepairTicketStatus, to: RepairTicketStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** thb display helper */
export function formatBaht(cents: number): string {
  const baht = cents / 100;
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(baht);
}

export function totalTicketCost(ticket: { partsCostCents: number; laborCostCents: number }): number {
  return ticket.partsCostCents + ticket.laborCostCents;
}

/**
 * Downtime cost rate per business type (baht/hour while branch is broken).
 * Conservative averages — CEO can tune per branch in settings later.
 * BA insight: surfacing this turns a "ticket counter" into an ROI conversation.
 */
export const DOWNTIME_BAHT_PER_HOUR: Record<string, number> = {
  fuel_station: 5000,        // ตู้จ่ายปั๊มเสีย — ขาดรายได้สูง
  lpg_station: 3000,
  lpg_retail: 1500,
  bottling_plant: 4000,
  hotel: 300,                 // 1 ห้องโดยเฉลี่ย
  convenience_store: 1200,    // 7-Eleven sub-tenant
  ev_station: 2000,
  cafe: 800,
  cafe_punthai: 800,
  massage_chair: 100,
  claw_machine: 50,
  training_center: 500,
  transport: 2000,
  gas_fleet: 2500,
};

export function downtimeCostBaht(args: {
  businessType: string | null | undefined;
  startedAt: Date | null;
  endedAt: Date | null;
}): number {
  if (!args.startedAt) return 0;
  const rate = args.businessType ? DOWNTIME_BAHT_PER_HOUR[args.businessType] ?? 0 : 0;
  if (rate === 0) return 0;
  const end = args.endedAt ?? new Date();
  const ms = Math.max(0, end.getTime() - args.startedAt.getTime());
  const hours = ms / (60 * 60 * 1000);
  return Math.round(rate * hours);
}
