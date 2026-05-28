import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionDetail } from "@/lib/clawfleet/queries";
import { formatTHB } from "@/lib/clawfleet/validation";
import { FLAG_LABEL_TH, type AnomalyFlag } from "@/lib/clawfleet/types";
import { CheckCircle2, Circle, AlertTriangle, ArrowLeft } from "lucide-react";
import { CloseSessionButton } from "@/components/clawfleet/close-session-button";
import { ReviewSessionPanel } from "@/components/clawfleet/review-session-panel";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionDetail(id);
  if (!session) notFound();

  const machinesCollected = new Map(
    session.events.filter((e) => e.eventType === "COLLECTION").map((e) => [e.machineId, e]),
  );
  const allMachines = session.group?.machines ?? [];
  const collectedCount = machinesCollected.size;
  const totalCount = allMachines.length;
  const isOpen = session.status === "OPEN";
  const isAnomaly = session.status === "ANOMALY_REVIEW";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link
        href="/clawfleet/sessions"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        <ArrowLeft className="h-4 w-4" /> กลับ
      </Link>

      <header className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-zinc-500">{session.sessionCode}</div>
            <h1 className="text-xl font-bold text-zinc-900">{session.group?.name ?? "—"}</h1>
            <p className="text-sm text-zinc-500">
              {session.group?.branch.name ?? "—"} · เปิดโดย {session.openedBy.name}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500">
              {new Date(session.openedAt).toLocaleString("th-TH", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            {!isOpen && (
              <div className="mt-1 text-2xl font-bold text-zinc-900">
                {formatTHB(session.totalCashCents)}
              </div>
            )}
          </div>
        </div>

        {!isOpen && session.coinVarianceBps != null && (
          <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3 text-sm">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Cross-check ตู้แลก ↔ ตู้คีบ</span>
              <span className="font-mono">
                ห่าง {(session.coinVarianceBps / 100).toFixed(2)}%
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-zinc-700">
              <div>
                ตู้แลกแจก:{" "}
                <span className="font-semibold">{session.exchangerCoinsOut} เหรียญ</span>
              </div>
              <div>
                ตู้คีบรับ:{" "}
                <span className="font-semibold">{session.clawCoinsIn} เหรียญ</span>
              </div>
            </div>
          </div>
        )}

        {isAnomaly && session.anomalyFlags.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50/40 p-3">
            <div className="flex items-center gap-1 text-sm font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4" />
              Anomaly flags · ต้อง review
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-800">
              {session.anomalyFlags.map((f) => (
                <li key={f}>• {FLAG_LABEL_TH[f as AnomalyFlag] ?? f}</li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <header className="flex items-center justify-between border-b border-zinc-100 p-4">
          <h2 className="font-semibold text-zinc-900">ตู้ในกลุ่ม</h2>
          <span className="text-sm font-medium text-zinc-700">
            {collectedCount} / {totalCount}
          </span>
        </header>
        <ul className="divide-y divide-zinc-100">
          {allMachines.map((m) => {
            const ev = machinesCollected.get(m.id);
            const loadout = m.loadouts[0];
            return (
              <li key={m.id}>
                <Link
                  href={
                    isOpen
                      ? `/clawfleet/sessions/${session.id}/collect/${m.code}`
                      : `/clawfleet/machines/${m.code}`
                  }
                  className="flex items-center justify-between p-4 hover:bg-zinc-50"
                >
                  <div className="flex items-center gap-3">
                    {ev ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <Circle className="h-5 w-5 text-zinc-300" />
                    )}
                    <div>
                      <div className="font-medium text-zinc-900">
                        {m.code}
                        {m.kind === "EXCHANGER" && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            ตู้แลก
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {m.nickname ?? loadout?.product.name ?? ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {ev ? (
                      <div className="text-sm font-semibold text-zinc-900">
                        {formatTHB(ev.cashCountedCents)}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">รอกรอก</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {isOpen && (
          <footer className="border-t border-zinc-100 bg-zinc-50/50 p-4">
            <CloseSessionButton
              sessionId={session.id}
              ready={collectedCount === totalCount && totalCount > 0}
              total={totalCount}
              collected={collectedCount}
            />
          </footer>
        )}
      </section>

      {isAnomaly && <ReviewSessionPanel sessionId={session.id} />}
    </div>
  );
}
