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

  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-stretch gap-2">
        {TILES.map((t) => {
          const active = cc === t.cc;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setCc(t.cc)}
              aria-pressed={active}
              className={
                "flex min-w-[96px] flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
                (active
                  ? "border-zinc-900 bg-zinc-50"
                  : "border-zinc-200 hover:bg-zinc-50")
              }
            >
              <span className={"size-2.5 shrink-0 rounded-full " + t.dot} aria-hidden />
              <span className="min-w-0">
                <span className={"block text-lg font-bold tabular-nums " + t.text}>
                  {counts[t.key].toLocaleString("en-US")}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">{t.label}</span>
              </span>
            </button>
          );
        })}

        {/* ยอด VAT ที่ยังติด (ขอคืนไม่ได้/ยังไม่ตัดสิน) — เป้าหมายไล่ให้เป็นเขียว */}
        <div className="flex min-w-[150px] flex-1 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <ShieldAlert className="size-4 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0">
            <span className="block text-lg font-bold tabular-nums text-amber-800">
              {baht(blockedVat)}
            </span>
            <span className="block truncate text-[11px] text-amber-700">
              ยอด VAT ที่ยังติด
            </span>
          </span>
        </div>
      </div>

      {counts.undecided > 0 && (
        <p className="mt-2 text-[11px] text-zinc-400">
          มีอีก {counts.undecided.toLocaleString("en-US")} ใบที่ยังไม่ตรวจสถานะ (ใบเก่าก่อนเปิดฟีเจอร์ — เปิดแล้วกดบันทึกจะตรวจให้)
        </p>
      )}
    </div>
  );
}
