// Ledger · เทียบยอด TRCloud ↔ LedgerLine (Phase 2 · อ่านล้วน).
//   เช็คว่าใบที่เราส่งเข้า TRCloud ครบ + ยอดตรงไหม (ดู lib/ledger/trcloud-reconcile.ts).
import Link from "next/link";
import { ArrowLeft, FileText, AlertTriangle, SearchX, CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getTrcloudReconcile } from "@/lib/ledger/trcloud-reconcile";

export const dynamic = "force-dynamic";

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default async function TrcloudReconcilePage() {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const data = await getTrcloudReconcile(session.user.org_id);

  const cards = [
    { label: "ตรงกัน", value: data.summary.matched, icon: CheckCircle2, cls: "text-emerald-700 bg-emerald-50 ring-emerald-200" },
    { label: "ยอดไม่ตรง", value: data.summary.mismatch, icon: AlertTriangle, cls: "text-amber-700 bg-amber-50 ring-amber-200" },
    { label: "ส่งแล้วหาไม่เจอ", value: data.summary.missing, icon: SearchX, cls: "text-rose-700 bg-rose-50 ring-rose-200" },
  ];

  return (
    <div className="space-y-4 p-4 sm:px-6 sm:pt-4 sm:pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/ledger/trcloud-docs" className="text-zinc-400 hover:text-zinc-700"><ArrowLeft className="h-4 w-4" /></Link>
            <h1 className="text-lg font-semibold text-zinc-900">เทียบยอด TRCloud ↔ LedgerLine</h1>
          </div>
          <p className="text-xs text-zinc-500">
            เช็คใบที่ส่งจากเรา ({data.summary.totalPushed.toLocaleString("th-TH")} ใบ) ว่าอยู่ครบ + ยอดตรงกับ TRCloud ไหม
          </p>
        </div>
        <Link href="/ledger/trcloud-docs" className="text-sm text-[var(--color-brand-600)] hover:underline">← กลับหน้าเอกสาร TRCloud</Link>
      </div>

      {/* Freshness note */}
      <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-inset ring-sky-200">
        เทียบจากสำเนาล่าสุด ({data.snapshotCount.toLocaleString("th-TH")} ใบ · อัปเดต {fmtDate(data.lastSyncedAt)}) —
        ถ้ายังไม่ครบ กด <Link href="/ledger/trcloud-docs" className="font-medium underline">รีเฟรชจาก TRCloud</Link> ที่หน้าเอกสารก่อน แล้วกลับมาดูใหม่
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl px-3 py-3 ring-1 ring-inset ${c.cls}`}>
            <div className="flex items-center gap-1.5 text-xs font-medium"><c.icon className="h-4 w-4" />{c.label}</div>
            <div className="mt-1 text-2xl font-semibold">{c.value.toLocaleString("th-TH")}</div>
          </div>
        ))}
      </div>

      {/* Mismatch table */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-800">⚠️ ยอดไม่ตรง ({data.summary.mismatch})</h2>
        {data.mismatches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-400">ไม่มี — ยอดตรงกันหมด</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
                  <th className="px-3 py-2 font-medium">เลขใบ (เรา)</th>
                  <th className="px-3 py-2 font-medium">ผู้ขาย</th>
                  <th className="px-3 py-2 text-right font-medium">ยอดเรา</th>
                  <th className="px-3 py-2 text-right font-medium">ยอด TRCloud</th>
                  <th className="px-3 py-2 text-right font-medium">ต่าง</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.mismatches.map((r) => (
                  <tr key={r.expenseId} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800">{r.docCode}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-zinc-700" title={r.vendor ?? undefined}>{r.vendor || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-700">{money(r.ourTotal)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-700">{money(r.trcloudTotal)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-amber-700">{r.diff == null ? "—" : (r.diff > 0 ? "+" : "") + money(r.diff)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link href={`/ledger/expenses?selected=${r.expenseId}`} className="text-xs font-medium text-[var(--color-brand-600)] hover:underline">เปิดใบ</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Missing table */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-800">⚠️ ส่งแล้วแต่หาไม่เจอใน TRCloud ({data.summary.missing})</h2>
        <p className="text-xs text-zinc-400">อาจถูกลบใน TRCloud · หรือสำเนายังดึงไม่ถึง (กดรีเฟรชให้ลึกกว่านี้)</p>
        {data.missing.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-400">ไม่มี — เจอครบทุกใบ</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
                  <th className="px-3 py-2 font-medium">เลขใบ (เรา)</th>
                  <th className="px-3 py-2 font-medium">ผู้ขาย</th>
                  <th className="px-3 py-2 text-right font-medium">ยอด</th>
                  <th className="px-3 py-2 font-medium">เลข TRCloud</th>
                  <th className="px-3 py-2 font-medium">ส่งเมื่อ</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.missing.map((r) => (
                  <tr key={r.expenseId} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800">{r.docCode}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-zinc-700" title={r.vendor ?? undefined}>{r.vendor || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-700">{money(r.ourTotal)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{r.trcloudDocNo || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{fmtDate(r.pushedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link href={`/ledger/expenses?selected=${r.expenseId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"><FileText className="h-3.5 w-3.5" />เปิดใบ</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
