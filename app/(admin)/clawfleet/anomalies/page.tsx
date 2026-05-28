import Link from "next/link";
import { listAnomalies } from "@/lib/clawfleet/queries";
import { formatTHB } from "@/lib/clawfleet/validation";
import { FLAG_LABEL_TH, type AnomalyFlag } from "@/lib/clawfleet/types";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage() {
  const list = await listAnomalies();
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">Anomaly รอ Review</h1>
        <p className="text-sm text-zinc-500">รอบเก็บที่ flag · ต้องอนุมัติ/recheck โดยหัวหน้า</p>
      </header>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-8 text-center">
          <p className="text-sm font-medium text-emerald-700">✅ ไม่มี anomaly</p>
          <p className="text-xs text-emerald-600">ทุกรอบผ่าน cross-check</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={`/clawfleet/sessions/${s.id}`}
                className="block rounded-2xl border border-red-200 bg-white p-4 hover:border-red-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <span className="font-mono text-sm font-semibold text-red-700">
                        {s.sessionCode}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-zinc-900">
                      {s.group?.name ?? "—"} · {s.group?.branch.name ?? "—"}
                    </div>
                    <div className="text-xs text-zinc-500">
                      เก็บโดย {s.openedBy.name} · {s._count.events} รายการ
                    </div>
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {s.anomalyFlags.map((f) => (
                        <li key={f} className="text-red-700">
                          • {FLAG_LABEL_TH[f as AnomalyFlag] ?? f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-zinc-900">
                      {formatTHB(s.totalCashCents)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {s.closedAt
                        ? new Date(s.closedAt).toLocaleDateString("th-TH")
                        : ""}
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
