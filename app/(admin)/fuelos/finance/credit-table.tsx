import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/fuelos/utils/cn";
import { formatBaht } from "@/lib/fuelos/utils/format";
import type { CreditRow } from "@/lib/fuelos/finance-data";

export function CreditTable({ rows }: { rows: CreditRow[] }) {
  const overCount = rows.filter((r) => r.over90).length;

  return (
    <div>
      {overCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            มีลูกค้า <b className="tabular-nums">{overCount}</b> ราย ใช้วงเงินเกิน 90% — ต้องระวังก่อนขายเพิ่ม
          </span>
        </div>
      )}

      {/* desktop table */}
      <div className="hidden sm:block rounded-2xl border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-zinc-500 text-xs">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">ลูกค้า</th>
              <th className="text-right font-medium px-4 py-2.5">ใช้ไป / วงเงิน</th>
              <th className="text-left font-medium px-4 py-2.5 w-40">% ที่ใช้</th>
              <th className="text-right font-medium px-4 py-2.5">เครดิตเทอม</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-zinc-400 py-10">
                  ยังไม่มีลูกค้า
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className={cn("border-t border-border", r.over90 && "bg-danger/5")}
              >
                <td className="px-4 py-2.5">
                  <Link href={`/fuelos/customers/${r.id}`} className="font-medium hover:text-brand-700">
                    {r.name}
                  </Link>
                  <span className="text-zinc-400 text-xs ml-1.5">
                    {r.zone ? `· โซน ${r.zone}` : ""}
                  </span>
                  {r.over90 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-danger/10 text-danger ml-2 align-middle">
                      <AlertTriangle className="size-3" />
                      เกิน 90%
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-[family-name:var(--font-plex-mono)]">
                  {r.creditLimit == null ? (
                    <span className="text-zinc-400">ไม่ตั้งวงเงิน</span>
                  ) : (
                    <>
                      {formatBaht(r.creditUsed)}{" "}
                      <span className="text-zinc-400">/ {formatBaht(r.creditLimit)}</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.creditLimit == null ? (
                    <span className="text-zinc-300 text-xs">—</span>
                  ) : (
                    <PctBar pct={r.pct} over90={r.over90} />
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-600 tabular-nums">
                  {r.paymentTerms == null ? "เงินสด" : `${r.paymentTerms} วัน`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="sm:hidden grid gap-2">
        {rows.length === 0 && (
          <div className="text-center text-zinc-400 py-10 text-sm">ยังไม่มีลูกค้า</div>
        )}
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/fuelos/customers/${r.id}`}
            className={cn(
              "block rounded-2xl border border-border bg-surface p-3.5",
              r.over90 && "border-danger/40 bg-danger/5",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold truncate">{r.name}</span>
              {r.over90 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-danger/10 text-danger shrink-0">
                  <AlertTriangle className="size-3" />
                  เกิน 90%
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {r.zone ? `โซน ${r.zone} · ` : ""}
              {r.paymentTerms == null ? "เงินสด" : `เครดิต ${r.paymentTerms} วัน`}
            </div>
            <div className="mt-2 text-xs tabular-nums font-[family-name:var(--font-plex-mono)] text-zinc-600">
              {r.creditLimit == null ? (
                <span className="text-zinc-400">ไม่ตั้งวงเงิน</span>
              ) : (
                <>
                  {formatBaht(r.creditUsed)} / {formatBaht(r.creditLimit)}
                </>
              )}
            </div>
            {r.creditLimit != null && <div className="mt-1.5"><PctBar pct={r.pct} over90={r.over90} /></div>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PctBar({ pct, over90 }: { pct: number; over90: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            over90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-leaf-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          "text-xs tabular-nums w-9 text-right",
          over90 ? "text-danger font-semibold" : "text-zinc-500",
        )}
      >
        {pct}%
      </span>
    </div>
  );
}
