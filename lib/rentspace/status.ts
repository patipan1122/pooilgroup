// RentSpace — richer ROOM STATUS taxonomy (shared web + server, NO React).
// Tailored to a COMMERCIAL PLAZA (โครงการเช่าเชิงพาณิชย์) — no daily-booking states.
// Reuses the same --rs-* CSS var tokens as format.ts (UNIT_STATUS / BILL_STATUS).

export type RsUnitState =
  | "vacant"
  | "occupied_ok"
  | "occupied_partial"
  | "occupied_overdue"
  | "near_expiry"
  | "reserved"
  | "inactive";

/** how many days ahead counts as "สัญญาใกล้หมด" for a plaza tenant */
const NEAR_EXPIRY_DAYS = 60;

function daysUntil(end: string | Date | null | undefined): number | null {
  if (!end) return null;
  const d = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  // compare at day granularity (ignore time-of-day) so "today" = 0, not negative
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}

/**
 * Collapse raw unit fields into one display state, priority-ordered for a plaza:
 *   inactive  →  (non-occupied) reserved  →  vacant  →  occupied: overdue → partial → near-expiry → ok
 */
export function deriveUnitState(u: {
  status: string;
  outstanding?: number | null;
  hasOverdue?: boolean | null;
  endDate?: string | Date | null;
}): RsUnitState {
  const status = u.status;
  if (status === "inactive") return "inactive";
  // non-occupied → map by status first (keeps reserved/vacant simple)
  if (status !== "occupied") {
    if (status === "reserved") return "reserved";
    return "vacant";
  }
  // occupied: money problems outrank everything
  if (u.hasOverdue) return "occupied_overdue";
  if ((u.outstanding ?? 0) > 0) return "occupied_partial";
  const left = daysUntil(u.endDate);
  if (left !== null && left >= 0 && left <= NEAR_EXPIRY_DAYS) return "near_expiry";
  return "occupied_ok";
}

export const RS_STATE_META: Record<
  RsUnitState,
  { label: string; color: string; soft: string; desc: string }
> = {
  vacant: {
    label: "ว่าง",
    color: "var(--rs-vacant)",
    soft: "var(--rs-vacant-soft)",
    desc: "ยังไม่มีผู้เช่า · พร้อมปล่อยเช่า",
  },
  occupied_ok: {
    label: "มีผู้เช่า · จ่ายครบ",
    color: "var(--rs-ok)",
    soft: "var(--rs-ok-soft)",
    desc: "มีผู้เช่าอยู่ และชำระค่าเช่าครบไม่มีค้าง",
  },
  occupied_partial: {
    label: "ค้างบางส่วน",
    color: "var(--rs-pending)",
    soft: "var(--rs-pending-soft)",
    desc: "มีผู้เช่า แต่ยังจ่ายไม่ครบ ยังไม่เลยกำหนด",
  },
  occupied_overdue: {
    label: "ค้างชำระเกินกำหนด",
    color: "var(--rs-danger)",
    soft: "var(--rs-danger-soft)",
    desc: "มีผู้เช่า และมีบิลค้างเกินวันครบกำหนด ต้องติดตาม",
  },
  near_expiry: {
    label: "สัญญาใกล้หมด",
    color: "var(--rs-info)",
    soft: "var(--rs-info-soft)",
    desc: "สัญญาเช่าจะหมดภายใน 60 วัน · ควรต่อสัญญา",
  },
  reserved: {
    label: "จอง",
    color: "var(--rs-pending)",
    soft: "var(--rs-pending-soft)",
    desc: "มีผู้สนใจจองไว้ ยังไม่เริ่มสัญญา",
  },
  inactive: {
    label: "ปิดใช้งาน",
    color: "var(--rs-text-3)",
    soft: "var(--rs-bg-3)",
    desc: "ห้องถูกปิด · ไม่เปิดให้เช่าในขณะนี้",
  },
};

/** display order for the legend + filter chips (worst-first within occupied) */
export const RS_STATE_LEGEND: RsUnitState[] = [
  "occupied_ok",
  "occupied_partial",
  "occupied_overdue",
  "near_expiry",
  "reserved",
  "vacant",
  "inactive",
];

export function unitStateColor(state: RsUnitState): { color: string; soft: string } {
  const m = RS_STATE_META[state];
  return { color: m.color, soft: m.soft };
}
