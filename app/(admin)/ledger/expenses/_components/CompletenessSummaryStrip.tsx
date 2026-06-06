"use client";

// CompletenessSummaryStrip — แถบสรุปสถานะภาษีซื้อเหนือรายการ.
//   นับจำนวนใบต่อสี (เขียว/เหลือง/แดง [+เทา ยังไม่ตรวจ]) + ยอด VAT ที่ยัง "ติด"
//   (ขอคืนไม่ได้/ยังไม่ตัดสิน). คลิกการ์ดสี → ตั้ง ?cc= เพื่อกรองรายการ (ไม่ dead UI).
//
// รับ summary จาก summarizeCompleteness() (lib/ledger/queries.ts). ใช้ tokens เดิม
// (emerald/amber/rose/zinc + brand) — ไม่สร้าง token ใหม่.

import { useRouter, usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import type { CompletenessSummary } from "@/lib/ledger/queries";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

const TILES: Array<{
  key: keyof CompletenessSummary["counts"];
  cc: "" | "green" | "yellow" | "red";
  label: string;
  dot: string;
  text: string;
}> = [
  { key: "green_full", cc: "green", label: "ขอคืนได้", dot: "bg-emerald-500", text: "text-emerald-700" },
  { key: "yellow_partial", cc: "yellow", label: "ขอใบใหม่", dot: "bg-amber-500", text: "text-amber-700" },
  { key: "red_invalid", cc: "red", label: "ขอคืนไม่ได้", dot: "bg-rose-500", text: "text-rose-700" },
];

export function CompletenessSummaryStrip({
  summary,
  baseParams,
  selectedId,
  cc,
}: {
  summary: CompletenessSummary;
  /** scope/filter params to preserve when clicking a tile. */
  baseParams: string;
  selectedId?: string;
  /** active color filter — highlights the matching tile. */
  cc?: "green" | "yellow" | "red";
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Same URL-driven pattern as ExpenseList.setParam — keep server as source of truth.
  function setCc(next: "" | "green" | "yellow" | "red") {
    const sp = new URLSearchParams(baseParams);
    sp.delete("cc");
    // toggle off if already active
    if (next && next !== cc) sp.set("cc", next);
    if (selectedId) sp.set("selected", selectedId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const { counts, blockedVat } = summary;
  const graded = counts.green_full + counts.yellow_partial + counts.red_invalid;
  // ไม่มีใบที่ตรวจแล้วเลย → ไม่ต้องโชว์แถบ (กันรกหน้าใบเก่าล้วน).
  if (graded === 0 && counts.undecided === 0) return null;

  // Compact single-row strip (CEO: cards กินพื้นที่ → เล็ก + โชว์เลขพอ). Each tile
  // is a small clickable pill that still filters by colour; VAT-stuck on the right.
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {TILES.map((t) => {
        const active = cc === t.cc;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setCc(t.cc)}
            aria-pressed={active}
            title={t.label}
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
              (active ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white hover:bg-zinc-50")
            }
          >
            <span className={"size-2 shrink-0 rounded-full " + t.dot} aria-hidden />
            <span className={"font-bold tabular-nums " + t.text}>
              {counts[t.key].toLocaleString("en-US")}
            </span>
            <span className="text-zinc-500">{t.label}</span>
          </button>
        );
      })}

      {/* ยอด VAT ที่ยังติด — เป้าหมายไล่ให้เป็นเขียว */}
      {blockedVat > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs">
          <ShieldAlert className="size-3.5 shrink-0 text-amber-600" aria-hidden />
          <span className="font-bold tabular-nums text-amber-800">{baht(blockedVat)}</span>
          <span className="text-amber-700">VAT ติด</span>
        </span>
      )}

      {counts.undecided > 0 && (
        <span className="text-[11px] text-zinc-400">
          · อีก {counts.undecided.toLocaleString("en-US")} ใบยังไม่ตรวจ
        </span>
      )}
    </div>
  );
}
