"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stockCountBatch } from "@/lib/clawfleet/actions";

type Row = { productId: string; name: string; sku: string; expected: number };

export function StockCountForm({ branchId, rows }: { branchId: string; rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // J4-C fix: do NOT prefill with expected (blind-submit bypasses control)
  // Staff must actively input the actual count.
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.productId, ""])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});

  function set(id: string, v: string) {
    setCounts((c) => ({ ...c, [id]: v.replace(/[^0-9]/g, "") }));
  }

  function variance(r: Row): number {
    const actual = Number(counts[r.productId] ?? 0);
    return r.expected - actual;
  }

  function light(r: Row): "ok" | "warn" | "danger" {
    const v = Math.abs(variance(r));
    const pct = r.expected > 0 ? v / r.expected : 0;
    if (v === 0) return "ok";
    if (v <= 2 && pct <= 0.02) return "ok";
    if (v <= 10 && pct <= 0.05) return "warn";
    return "danger";
  }

  function submit() {
    setError(null);
    // Require staff to enter every count explicitly (no blind-submit)
    const missing = rows.filter((r) => (counts[r.productId] ?? "").trim() === "");
    if (missing.length > 0) {
      setError(`ยังไม่ได้กรอกจำนวน ${missing.length} รายการ`);
      return;
    }
    const items = rows.map((r) => ({
      productId: r.productId,
      actualQty: Number(counts[r.productId] ?? 0),
      reason: reasons[r.productId] || undefined,
    }));
    // require reason for danger rows
    for (const r of rows) {
      if (light(r) === "danger" && !reasons[r.productId]) {
        setError(`${r.name}: ขาด/เกินเยอะ ต้องใส่เหตุผล`);
        return;
      }
    }
    startTransition(async () => {
      const res = await stockCountBatch({ branchId, counts: items });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/clawfleet/stock?branch=${branchId}`);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((r) => {
          const v = variance(r);
          const L = light(r);
          const tone =
            L === "ok"
              ? "border-emerald-200"
              : L === "warn"
                ? "border-amber-300"
                : "border-red-400";
          return (
            <li key={r.productId} className={`rounded-xl border ${tone} bg-white p-3`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-zinc-900">{r.name}</div>
                  <div className="text-xs text-zinc-500">
                    ระบบคำนวณ: <span className="font-mono">{r.expected}</span>
                  </div>
                </div>
                <input
                  inputMode="numeric"
                  value={counts[r.productId] ?? ""}
                  onChange={(e) => set(r.productId, e.target.value)}
                  className="w-24 rounded-xl border border-zinc-300 px-2 py-1.5 text-right text-lg font-bold"
                />
              </div>
              <div
                className={`mt-1 text-xs ${
                  L === "ok"
                    ? "text-emerald-700"
                    : L === "warn"
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {v === 0
                  ? "✅ ตรง"
                  : v > 0
                    ? `🟡 ขาด ${v} ตัว`
                    : `🟢 เกิน ${-v} ตัว`}
              </div>
              {L === "danger" && (
                <input
                  value={reasons[r.productId] ?? ""}
                  onChange={(e) =>
                    setReasons((rs) => ({ ...rs, [r.productId]: e.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-red-300 px-2 py-1.5 text-sm"
                  placeholder="ต้องใส่เหตุผล..."
                />
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? "กำลังบันทึก..." : "บันทึกการนับ"}
      </button>
    </div>
  );
}
