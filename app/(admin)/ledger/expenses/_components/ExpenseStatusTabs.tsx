"use client";

// PRIMARY status strip extracted from ExpenseList (CEO 2026-06-09: บนจอคอม ย้ายแท็บสถานะ
// ขึ้นไปบนแถบเต็มกว้างด้านบน — ใช้พื้นที่ว่างแทนที่จะยัดในคอลัมน์รายการ 420px · ตรงดีไซน์
// desktopA.jsx). One component, two placements: full-width bar in page.tsx (hidden lg:block,
// desktop) + inside ExpenseList (lg:hidden, mobile). Drives ?status=/?nr=/?pay= like before.
import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";

// CEO 2026-06-10: ตัดด่าน "ยืนยัน" ออก → แท็บโฟกัสที่ "ส่ง TRCloud แล้วหรือยัง" แทน
// (ยังไม่ส่ง = trcloudDocId ว่าง · ส่งแล้ว = ส่งขึ้น TRCloud แล้ว). คง "รอตรวจ" (AI ยังไม่ชัวร์)
// ไว้เป็น triage. draft/confirmed ไม่เป็นแท็บแล้ว (ขับด้วย ?tr= แทน ?status=).
type PrimaryTabId =
  | "review" | "unsent" | "sent" | "ap" | "eligible" | "requested" | "paid" | "pv" | "all";

// วงจร PO → AP (CEO 2026-07-22): "ยังไม่ส่ง PO" → "ส่ง PO แล้ว" (ยังไม่ลงบัญชี) → "AP แล้ว"
// (ลงบัญชีจริง). ใบที่แปลง AP แล้วหลุดจาก "ส่ง PO แล้ว" ไปอยู่ "AP แล้ว" (กันโชว์ซ้ำ).
// "PV แล้ว" (CEO 2026-07-25): ออกใบสำคัญจ่าย (PV) เข้า TRCloud แล้ว — ขั้นถัดจาก "โอนแล้ว".
const PRIMARY_TABS: Array<{ id: PrimaryTabId; label: string; pay?: boolean }> = [
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

export interface ExpenseStatusCounts {
  all: number; review: number; unsent: number; sent: number; ap: number;
  eligible: number; requested: number; paid: number; pv: number;
  // legacy counts kept for callers that still pass them (unused by the tabs now).
  draft?: number; confirmed?: number;
}

export function ExpenseStatusTabs({
  baseParams,
  status,
  tr,
  ap,
  pv,
  nr,
  pay,
  payreqEnabled,
  statusCounts,
  selectedId,
  className,
}: {
  baseParams: string;
  status?: LedgerStatusValue;
  tr?: "sent" | "unsent";
  /** แท็บ "AP แล้ว" active (?ap=1) — ใบที่แปลง PO → AP แล้ว. */
  ap?: boolean;
  /** แท็บ "PV แล้ว" active (?pv=1) — ใบที่ออกใบสำคัญจ่าย (PV) เข้า TRCloud แล้ว. */
  pv?: boolean;
  nr?: boolean;
  pay?: "eligible" | "requested" | "paid";
  payreqEnabled?: boolean;
  statusCounts: ExpenseStatusCounts;
  selectedId?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // สลับแท็บ = navigation ภายใน transition → Next ไม่โชว์ loading.tsx คั่น (จอไม่วูบ)
  // และค้างจอเดิมไว้จน data ใหม่พร้อม (pending ใช้หรี่แถบให้รู้ว่ากำลังโหลด).
  const [pending, startTransition] = useTransition();

  const activePrimary: PrimaryTabId | null =
    pv
      ? "pv"
      : ap
      ? "ap"
      : pay === "eligible"
      ? "eligible"
      : pay === "requested"
        ? "requested"
        : pay === "paid"
          ? "paid"
          : tr === "sent"
            ? "sent"
            : tr === "unsent"
              ? "unsent"
              : status === "draft" && nr === true
                ? "review"
                : !status && !tr && !pay
                  ? "all"
                  : null;

  function setPrimaryTab(id: PrimaryTabId) {
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
    if (selectedId) sp.set("selected", selectedId);
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  return (
    <div
      className={
        "-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
        (className ?? "")
      }
      role="tablist"
      aria-label="กรองตามสถานะ"
      aria-busy={pending}
      style={{ opacity: pending ? 0.65 : 1, transition: "opacity .12s ease" }}
    >
      {PRIMARY_TABS.filter((t) => payreqEnabled || !t.pay).map((t) => {
        const active = activePrimary === t.id;
        const count = statusCounts[t.id];
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setPrimaryTab(t.id)}
            className={
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
              (active
                ? "bg-[var(--color-brand-600)] text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
            }
          >
            {t.label}
            {count > 0 && (
              <span
                className={
                  "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums " +
                  (active ? "bg-white/25 text-white" : "bg-white text-zinc-500")
                }
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
