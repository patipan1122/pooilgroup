"use client";

// W3 (claude-design) · DiffTable client component.
//
// Renders the 4-bucket pills as filter chips above a table colored by bucket.
// Click a pill to filter; click again to clear (handled inside DiffBucketPills).

import { useState } from "react";
import {
  DiffBucketPills,
  type DiffBucket,
  type DiffBucketCounts,
} from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { baht, thaiDate } from "@/lib/chairops/utils/format";
import type { DiffRow } from "@/app/(admin)/chairops/pos-ingest/actions";

// Map action's RowStatus ("new"|"same"|"changed"|"error") to kit's
// DiffBucket ("new"|"same"|"changed"|"bad")
function statusToBucket(s: DiffRow["status"]): DiffBucket {
  return s === "error" ? "bad" : s;
}

const ROW_TINT: Record<DiffBucket, string> = {
  new: "bg-emerald-50/50",
  same: "",
  changed: "bg-amber-50/60",
  bad: "bg-rose-50/60",
};

const PILL_TONE: Record<
  DiffBucket,
  "success" | "neutral" | "warning" | "danger"
> = {
  new: "success",
  same: "neutral",
  changed: "warning",
  bad: "danger",
};

const PILL_LABEL: Record<DiffBucket, string> = {
  new: "ใหม่",
  same: "เหมือนเดิม",
  changed: "เปลี่ยน",
  bad: "ผิด",
};

export function DiffTable({
  counts,
  rows,
}: {
  counts: DiffBucketCounts;
  rows: DiffRow[];
}) {
  const [active, setActive] = useState<DiffBucket | null>(null);

  const visible =
    active === null
      ? rows
      : rows.filter((r) => statusToBucket(r.status) === active);

  return (
    <section className="space-y-3">
      {/* ── Filter pills ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DiffBucketPills
          counts={counts}
          active={active}
          onSelect={setActive}
        />
        <p className="text-xs text-muted-foreground">
          แสดง {visible.length.toLocaleString("th-TH")} จาก{" "}
          {rows.length.toLocaleString("th-TH")} แถว
          {active && (
            <>
              {" "}
              · กรอง:{" "}
              <button
                type="button"
                onClick={() => setActive(null)}
                className="underline"
              >
                ล้าง
              </button>
            </>
          )}
        </p>
      </div>

      {/* ── Diff table ──────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground sm:top-16">
            <tr className="bg-muted text-left [&>th]:bg-muted">
              <th className="w-12 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">สถานะ</th>
              <th className="px-2 py-2 font-medium">วันที่</th>
              <th className="px-2 py-2 font-medium">สาขา</th>
              <th className="px-2 py-2 font-medium">เครื่อง</th>
              <th className="px-2 py-2 text-right font-medium">ออนไลน์</th>
              <th className="px-2 py-2 text-right font-medium">แบงค์</th>
              <th className="px-2 py-2 text-right font-medium">เหรียญ</th>
              <th className="px-2 py-2 text-right font-medium">รวม</th>
              <th className="px-2 py-2 font-medium">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  ไม่มีแถวที่ match filter นี้
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const bucket = statusToBucket(r.status);
              return (
                <tr
                  key={r.rowIndex}
                  className={`${ROW_TINT[bucket]} hover:bg-muted/40`}
                >
                  <td className="px-2 py-1.5 text-xs tabular-nums text-muted-foreground">
                    {r.rowIndex}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusPill tone={PILL_TONE[bucket]}>
                      {PILL_LABEL[bucket]}
                    </StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {r.bizDate ? (
                      thaiDate(r.bizDate)
                    ) : (
                      <span className="text-rose-600">—</span>
                    )}
                    {r.isPastDay && (
                      <span className="ml-1 text-xs text-amber-700">
                        (ย้อนหลัง)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.branchName ?? (
                      <span className="text-rose-600">หาไม่เจอ</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {r.chairCode ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {baht(r.online)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {baht(r.cash)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {baht(r.coin)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                    {baht(r.totalRevenue)}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">
                    {r.errors.length > 0 && (
                      <span className="text-rose-600">
                        {r.errors.join(" · ")}
                      </span>
                    )}
                    {r.status === "changed" &&
                      r.changes &&
                      r.changes.join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
