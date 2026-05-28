import Link from "next/link";
import { listSessions } from "@/lib/clawfleet/queries";
import { formatTHB } from "@/lib/clawfleet/validation";
import { Plus, Clock, Lock, AlertTriangle } from "lucide-react";
import type { SessionStatus } from "@/lib/clawfleet/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<SessionStatus, string> = {
  OPEN: "กำลังเก็บ",
  CLOSED: "ปิดแล้ว",
  ANOMALY_REVIEW: "รอ review",
  LOCKED: "อนุมัติแล้ว",
};

const STATUS_TONE: Record<SessionStatus, string> = {
  OPEN: "border-blue-300 bg-blue-50 text-blue-700",
  CLOSED: "border-zinc-300 bg-zinc-50 text-zinc-700",
  ANOMALY_REVIEW: "border-red-300 bg-red-50 text-red-700",
  LOCKED: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

export default async function SessionsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: SessionStatus }>;
}) {
  const params = await searchParams;
  const status = params.status;
  const sessions = await listSessions({ status });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900">รอบเก็บเงิน</h1>
        <Link
          href="/clawfleet/sessions/new"
          className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          เริ่มรอบเก็บ
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        {(["OPEN", "ANOMALY_REVIEW", "CLOSED", "LOCKED"] as SessionStatus[]).map((s) => (
          <Link
            key={s}
            href={s === status ? "/clawfleet/sessions" : `/clawfleet/sessions?status=${s}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              s === status
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
            }`}
          >
            {STATUS_LABEL[s]}
          </Link>
        ))}
        {status && (
          <Link
            href="/clawfleet/sessions"
            className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            ล้างฟิลเตอร์
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {sessions.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">ยังไม่มีรอบเก็บ</p>
        ) : (
          <table className="w-full">
            <thead className="bg-zinc-50">
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">รหัส</th>
                <th className="px-4 py-3 font-medium">สาขา / กลุ่ม</th>
                <th className="px-4 py-3 font-medium">พนักงาน</th>
                <th className="px-4 py-3 font-medium">เริ่ม</th>
                <th className="px-4 py-3 font-medium">ตู้</th>
                <th className="px-4 py-3 font-medium text-right">รายได้</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-sm">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/clawfleet/sessions/${s.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {s.sessionCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{s.group?.branch.name ?? "—"}</div>
                    <div className="text-xs text-zinc-500">{s.group?.name ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{s.openedBy.name}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {new Date(s.openedAt).toLocaleString("th-TH", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{s._count.events}</td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                    {s.status === "OPEN" ? "—" : formatTHB(s.totalCashCents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s.status as SessionStatus]}`}
                    >
                      {s.status === "ANOMALY_REVIEW" && <AlertTriangle className="h-3 w-3" />}
                      {s.status === "LOCKED" && <Lock className="h-3 w-3" />}
                      {STATUS_LABEL[s.status as SessionStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
