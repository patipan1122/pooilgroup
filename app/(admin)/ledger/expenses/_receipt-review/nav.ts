// ตัวช่วยสร้างลิงก์ในโหมดตรวจใบเสร็จ — คงฟิลเตอร์เดิม + คง view=receipt-review เสมอ.
// logic การสลับแท็บสถานะ mirror จาก ExpenseStatusTabs.setPrimaryTab (เคลียร์กลุ่มเก่า
// ก่อนตั้งใหม่) เพื่อให้ผลเหมือน list mode 100%.
import type { RRFilterState } from "./types";

export type RRTabId =
  | "review" | "unsent" | "sent" | "ap" | "eligible" | "requested" | "paid" | "pv" | "all";

export const RR_PRIMARY_TABS: Array<{ id: RRTabId; label: string; pay?: boolean }> = [
  { id: "review", label: "รอตรวจ" },
  { id: "unsent", label: "ยังไม่ส่ง PO" },
  { id: "sent", label: "ส่ง PO แล้ว" },
  { id: "ap", label: "AP แล้ว" },
  { id: "eligible", label: "ขอโอน", pay: true },
  { id: "requested", label: "รอโอน", pay: true },
  { id: "paid", label: "โอนแล้ว", pay: true },
  { id: "pv", label: "PV แล้ว", pay: true },
  { id: "all", label: "ทั้งหมด" },
];

/** ลิงก์ทั่วไป — ตั้ง/ลบ params ที่กำหนด + คง selected + คง view. */
export function rrHref(
  baseParams: string,
  overrides: Record<string, string | null>,
  selected?: string | null,
): string {
  const sp = new URLSearchParams(baseParams);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  if (selected) sp.set("selected", selected);
  else sp.delete("selected");
  sp.set("view", "receipt-review");
  return `/ledger/expenses?${sp.toString()}`;
}

/** ลิงก์เปลี่ยนแท็บสถานะ — เคลียร์กลุ่ม status/tr/ap/pv/nr/pay ก่อนตั้งใหม่ (เหมือนของเดิม). */
export function rrStatusHref(baseParams: string, id: RRTabId, selected?: string | null): string {
  const sp = new URLSearchParams(baseParams);
  sp.delete("status");
  sp.delete("tr");
  sp.delete("ap");
  sp.delete("pv");
  sp.delete("nr");
  sp.delete("pay");
  if (id === "review") {
    sp.set("status", "draft");
    sp.set("nr", "1");
  } else if (id === "unsent") {
    sp.set("tr", "unsent");
  } else if (id === "sent") {
    sp.set("tr", "sent");
  } else if (id === "ap") {
    sp.set("ap", "1");
  } else if (id === "pv") {
    sp.set("pv", "1");
  } else if (id === "eligible" || id === "requested" || id === "paid") {
    sp.set("pay", id);
  }
  if (selected) sp.set("selected", selected);
  else sp.delete("selected");
  sp.set("view", "receipt-review");
  return `/ledger/expenses?${sp.toString()}`;
}

/** แท็บไหน active ตอนนี้ (mirror activePrimary). */
export function rrActivePrimary(f: RRFilterState): RRTabId | null {
  if (f.pv) return "pv";
  if (f.ap) return "ap";
  if (f.pay === "eligible") return "eligible";
  if (f.pay === "requested") return "requested";
  if (f.pay === "paid") return "paid";
  if (f.tr === "sent") return "sent";
  if (f.tr === "unsent") return "unsent";
  if (f.status === "draft" && f.nr === true) return "review";
  if (!f.status && !f.tr && !f.pay) return "all";
  return null;
}
